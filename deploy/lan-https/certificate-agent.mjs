import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { URL } from "node:url";
import { validateLanHttpsProvider } from "../../packages/server-setup-core/src/lan-https.mjs";
import { createLanHttpsAuthorityClient } from "./authority-client.mjs";
import { withLanHttpsClientLock } from "./client-state.mjs";
import { LanHttpsOrderJournal } from "./order-journal.mjs";
import { LanHttpsRenewalJournal } from "./renewal-journal.mjs";
import { lanHttpsPublicIdentity } from "./proof.mjs";
import { lanHttpsManagementHostname } from "./authority-store.mjs";
import {
  createLanHttpsAcmeSession,
  issueLanHttpsCertificate,
  validateLanHttpsIssuedCertificate,
  LanHttpsIssuanceError,
} from "./acme.mjs";
import { planLanHttpsRenewal } from "./renewal.mjs";

// One bounded timer invocation, never a persistent process sleeping inside CA
// backoff. Importing it does not register accounts or start any listener.
export async function runLanHttpsCertificateAgent({
  root,
  provider,
  issuerId,
  termsAccepted,
  invitationCode,
  now = Date.now,
  authorityFactory = createLanHttpsAuthorityClient,
  clientFactory = createLanHttpsAcmeSession,
  renewalPlanner = planLanHttpsRenewal,
  trustedCertificates,
}) {
  const checked = validateLanHttpsProvider(provider);
  if (
    checked.provider !== "akebi-local-acme" ||
    termsAccepted !== true ||
    typeof issuerId !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(issuerId) ||
    !Number.isSafeInteger(now()) ||
    now() < 0
  )
    throw new Error(
      "Local ACME configuration and explicit terms acceptance are required",
    );
  return withLanHttpsClientLock(root, async (state) => {
    state.recoverTemporaryFiles();
    const keys = state.ensureKeys();
    const jwk = createPublicKey(keys.identityKey).export({ format: "jwk" });
    const { installationId } = lanHttpsPublicIdentity({
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
    });
    const hostnames = [
      new URL(checked.publicOrigin).hostname,
      lanHttpsManagementHostname(installationId, checked.lanDomain),
    ];
    const context = createHash("sha256")
      .update(
        JSON.stringify([
          checked,
          installationId,
          issuerId,
          createPublicKey(keys.accountKey)
            .export({ type: "spki", format: "der" })
            .toString("base64"),
          createPublicKey(keys.tlsKey)
            .export({ type: "spki", format: "der" })
            .toString("base64"),
        ]),
      )
      .digest("hex");
    const schedule = new LanHttpsRenewalJournal({ state, context });
    let record = schedule.read();
    const bundle = state.read("bundle.pem");
    let leaf = null,
      certificateAvailable = false;
    if (bundle) {
      const blocks = bundle
        .toString("utf8")
        .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!blocks)
        throw new Error(
          "Stored LAN HTTPS bundle is invalid; state was retained",
        );
      const certificate = blocks.join("\n") + "\n";
      leaf = new X509Certificate(certificate);
      if (Date.parse(leaf.validTo) > now()) {
        await validateLanHttpsIssuedCertificate({
          certificate,
          privateKey: keys.tlsKey,
          hostnames,
          now: now(),
          ...(trustedCertificates ? { trustedCertificates } : {}),
        });
        certificateAvailable = true;
      }
    }
    const fingerprint256 = leaf?.fingerprint256 ?? null;
    // A changed published bundle is expected after a crash between atomic
    // publication and schedule commit. Preserve its validity and rebuild only
    // its schedule; the pending order itself remains durable.
    if (!record || record.fingerprint256 !== fingerprint256) {
      record = schedule.plan({
        fingerprint256,
        renewAt: certificateAvailable
          ? Math.floor(
              Date.parse(leaf.validFrom) +
                ((Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) * 2) /
                  3,
            )
          : now(),
        now: now(),
      });
    }
    // Check both files even when not due. Corruption must not be silently
    // treated as an absent pending order by the next timer invocation.
    const accounts = state.readAccounts();
    const account = accounts[issuerId];
    let journal;
    if (account) {
      journal = new LanHttpsOrderJournal({
        state,
        provider: checked,
        installationId,
        issuerId,
        ...account,
        accountKey: keys.accountKey,
        tlsKey: keys.tlsKey,
      });
      const pending = journal.load();
      if (pending && record.nextAttemptAt === null && record.renewAt > now()) {
        record = schedule.plan({ fingerprint256, renewAt: now(), now: now() });
      }
    } else if (state.read("order.json", 32768)) {
      // Includes a completed journal: losing accounts.json is a recovery case,
      // not permission to register a replacement account automatically.
      throw new Error(
        "Stored ACME order has no account mapping; restore the saved state",
      );
    }
    if (!schedule.due(now()))
      return Object.freeze({
        status: "deferred",
        certificateAvailable,
        nextAttemptAt: record.nextAttemptAt ?? record.renewAt,
        reason: "scheduled",
      });
    schedule.begin(now());
    try {
      const authority = authorityFactory({
        provider: checked,
        identityKey: keys.identityKey,
      });
      if (authority.installationId !== installationId)
        throw new Error("Authority identity mismatch");
      const metadata = await authority.metadata();
      const issuer = metadata.issuers.find((value) => value.id === issuerId);
      if (!issuer || (account && account.directoryUrl !== issuer.directoryUrl))
        throw new Error(
          "Configured ACME issuer changed; explicit migration is required",
        );
      await authority.enroll(invitationCode);
      const client = await clientFactory({
        directoryUrl: issuer.directoryUrl,
        accountKey: keys.accountKey,
        ...(account ? { accountUrl: account.accountUrl } : {}),
      });
      const getJournal = () => {
        journal ??= new LanHttpsOrderJournal({
          state,
          provider: checked,
          installationId,
          issuerId,
          directoryUrl: issuer.directoryUrl,
          accountUrl: client.getAccountUrl(),
          accountKey: keys.accountKey,
          tlsKey: keys.tlsKey,
        });
        return journal;
      };
      const result = await issueLanHttpsCertificate({
        provider: checked,
        authority,
        client,
        issuerId,
        accountKey: keys.accountKey,
        tlsKey: keys.tlsKey,
        termsAccepted: true,
        saveAccount: (accountUrl) => {
          state.saveAccount(issuerId, issuer.directoryUrl, accountUrl);
          return Promise.resolve();
        },
        journal: {
          load: () => getJournal().load(),
          save: (order, csr) => getJournal().save(order, csr),
          clear: () => getJournal().clear(),
        },
        ...(record.ari && record.certificateId
          ? { replaces: record.certificateId }
          : {}),
        now,
        verifyCertificate: (input) =>
          validateLanHttpsIssuedCertificate({
            ...input,
            ...(trustedCertificates ? { trustedCertificates } : {}),
          }),
      });
      // Publication repeats full certificate validation before atomic replacement.
      await state.installCertificate(result.certificate, {
        hostnames,
        now: now(),
        ...(trustedCertificates ? { trustedCertificates } : {}),
      });
      certificateAvailable = true;
      journal.clear();
      const plan = await renewalPlanner({
        certificate: result.certificate,
        directoryUrl: issuer.directoryUrl,
        now: now(),
      });
      record = schedule.plan({
        fingerprint256: result.fingerprint256,
        ...plan,
        now: now(),
      });
      return Object.freeze({
        status: "issued",
        certificateAvailable: true,
        nextAttemptAt: record.renewAt,
        cleanupPending: result.cleanupPending.length,
      });
    } catch (error) {
      // Invalid/expired orders are released only after the CA's terminal state
      // was checked. Network failure alone must never clear a pending order.
      if (error instanceof LanHttpsIssuanceError && error.orderTerminal)
        journal?.clear();
      const failed = schedule.failed(
        now(),
        error instanceof LanHttpsIssuanceError ? error.retryAt : null,
      );
      return Object.freeze({
        status: "deferred",
        certificateAvailable,
        nextAttemptAt: failed.nextAttemptAt,
        reason: "retry_scheduled",
      });
    }
  });
}
