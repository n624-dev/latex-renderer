#!/usr/bin/env node
import { parseArgs } from "node:util";
import { X509Certificate } from "node:crypto";
import { lstatSync } from "node:fs";
import { lanHttpsBinary } from "./binary.mjs";
export { lanHttpsBinary } from "./binary.mjs";
import { isMainModule } from "../scripts/is-main-module.mjs";
import {
  readLanHttpsConfiguration,
  validateLanHttpsAuthorityConfiguration,
  validateLanHttpsClientConfiguration,
} from "./configuration.mjs";
import {
  initializeLanHttpsAuthority,
  startLanHttpsAuthority,
  withLanHttpsAuthorityStore,
} from "./authority-runtime.mjs";
import { withLanHttpsClientLock } from "./client-state.mjs";
import {
  withLanHttpsProfile,
  withExistingLanHttpsProfile,
} from "./profiles.mjs";
import { rotateLanHttpsAccountKeys } from "./key-rotation.mjs";
import { runLanHttpsCertificateAgent } from "./certificate-agent.mjs";
import { installLanHttpsOperatorCertificate } from "./operator-certificate.mjs";
import { createLanHttpsAcmeSession } from "./acme.mjs";

export async function runLanHttpsCli(argv = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      certificate: { type: "string" },
      key: { type: "string" },
      installation: { type: "string" },
      uses: { type: "string" },
      "ttl-hours": { type: "string" },
      "confirm-revoke": { type: "boolean" },
    },
  });
  if (positionals.length !== 2 || typeof values.config !== "string")
    throw new Error("Use authority/client ACTION --config ABSOLUTE_JSON");
  const [role, action] = positionals;
  const input = readLanHttpsConfiguration(values.config);
  const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  if (role === "authority") {
    const config = validateLanHttpsAuthorityConfiguration(input);
    if (action === "init") return output(initializeLanHttpsAuthority(config));
    if (action === "import-keyless") {
      if (
        typeof values.certificate !== "string" ||
        typeof values.key !== "string"
      )
        throw new Error("Certificate and key source paths required");
      return output(
        await installLanHttpsOperatorCertificate({
          config,
          certificateFile: values.certificate,
          keyFile: values.key,
        }),
      );
    }
    if (action === "check")
      return output({
        valid: true,
        role,
        registration: config.policy.registration,
        issuerCount: config.issuers.length,
      });
    if (action === "acme-hook-present" || action === "acme-hook-cleanup") {
      const hostname = (process.env.CERTBOT_DOMAIN ?? "").replace(/^\*\./, "");
      const value = process.env.CERTBOT_VALIDATION;
      const result = withLanHttpsAuthorityStore(config, (store) =>
        store.operatorChallenge(
          hostname,
          value,
          action === "acme-hook-cleanup",
        ),
      );
      if (action === "acme-hook-present")
        await new Promise((resolve) => globalThis.setTimeout(resolve, 30000));
      return output(result);
    }
    if (action === "gc")
      return output(withLanHttpsAuthorityStore(config, (store) => store.gc()));
    if (action === "invite")
      return output(
        withLanHttpsAuthorityStore(config, (store) =>
          store.createInvite({
            uses: values.uses === undefined ? 1 : Number(values.uses),
            ttlMs:
              values["ttl-hours"] === undefined
                ? 86400000
                : Number(values["ttl-hours"]) * 3600000,
          }),
        ),
      );
    if (action === "revoke") {
      if (!values["confirm-revoke"] || typeof values.installation !== "string")
        throw new Error(
          "Explicit revocation confirmation and installation ID required",
        );
      withLanHttpsAuthorityStore(config, (store) =>
        store.revokeInstallation(values.installation),
      );
      return output({ revoked: true });
    }
    if (action === "serve") {
      process.umask(0o077);
      const service = await startLanHttpsAuthority(config, { event: output });
      output({ event: "lan_https.authority_started" });
      await new Promise((resolve) => {
        process.once("SIGTERM", resolve);
        process.once("SIGINT", resolve);
      });
      await service.close();
      return;
    }
  }
  if (role === "client") {
    const config = validateLanHttpsClientConfiguration(input);
    if (action === "check")
      return output({
        valid: true,
        role,
        publicOrigin: config.provider.publicOrigin,
      });
    if (action === "init")
      return withLanHttpsProfile(config, async ({ installationId }) =>
        output({
          initialized: true,
          installationId,
          publicOrigin: config.provider.publicOrigin,
        }),
      );
    lstatSync(config.stateDirectory);
    if (action === "set-invitation") {
      if (process.stdin.isTTY)
        throw new Error("Invitation input uses bounded JSON on stdin");
      let data = "";
      for await (const chunk of process.stdin) {
        data += chunk.toString();
        if (Buffer.byteLength(data) > 4096)
          throw new Error("Invitation input too large");
      }
      const value = JSON.parse(data);
      if (!value || Object.keys(value).join(",") !== "invitationCode")
        throw new Error("Invalid invitation input");
      return withLanHttpsClientLock(config.stateDirectory, async (state) => {
        state.ensureIdentityKey();
        state.saveInvitation(value.invitationCode);
        output({ saved: true });
      });
    }
    if (action === "rotate-account")
      return output(await rotateLanHttpsAccountKeys(config));
    if (action === "rotate-tls")
      return withLanHttpsProfile(config, async ({ state }) => {
        state.prepareTlsRotation();
        output({ scheduled: true, runRenewal: true });
      });
    if (action === "renew") {
      if (config.provider.provider === "akebi-keyless")
        return output({ status: "keyless_only" });
      let invitationCode;
      if (config.invitationFile) {
        const value = readLanHttpsConfiguration(config.invitationFile, {
          secret: true,
          maximumBytes: 4096,
        });
        if (
          !value ||
          Object.keys(value).join(",") !== "invitationCode" ||
          typeof value.invitationCode !== "string"
        )
          throw new Error("Invalid invitation file");
        invitationCode = value.invitationCode || undefined;
      }
      return withLanHttpsProfile(
        config,
        async ({ profileRoot, state, groupState }) => {
          const result = await runLanHttpsCertificateAgent({
            root: profileRoot,
            provider: config.provider,
            issuerId: config.issuerId,
            termsAccepted: config.termsAccepted,
            ...(invitationCode === undefined ? {} : { invitationCode }),
          });
          for (const [issuer, account] of Object.entries(state.readAccounts()))
            groupState.saveAccount(
              issuer,
              account.directoryUrl,
              account.accountUrl,
            );
          output({ event: "lan_https.certificate_attempt", ...result });
          if (result.reason === "retry_scheduled") process.exitCode = 75;
          return;
        },
      );
    }
    if (action === "status")
      return withExistingLanHttpsProfile(config, async ({ state }) => {
        const bundle = state.read("bundle.pem");
        let certificate = null;
        if (bundle) {
          const blocks = bundle
            .toString()
            .match(
              /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
            );
          if (!blocks) throw new Error("Invalid saved certificate");
          const leaf = new X509Certificate(blocks[0]);
          certificate = {
            fingerprint256: leaf.fingerprint256,
            expiresAt: new Date(leaf.validTo).toISOString(),
            withinValidity:
              Date.now() >= Date.parse(leaf.validFrom) &&
              Date.now() < Date.parse(leaf.validTo),
          };
        }
        const schedule = state.read("renewal.json", 32768);
        output({
          publicOrigin: config.provider.publicOrigin,
          provider: config.provider.provider,
          keylessFallback: config.provider.keylessFallback,
          certificate,
          nextAttemptAt: schedule
            ? JSON.parse(schedule.toString()).nextAttemptAt
            : null,
        });
      });
    if (action === "revoke") {
      if (!values["confirm-revoke"])
        throw new Error(
          "Explicit certificate revocation confirmation required",
        );
      return withLanHttpsProfile(config, async ({ state }) => {
        const account = state.readAccounts()[config.issuerId];
        const keys = state.ensureKeys();
        const bundle = state.read("bundle.pem");
        if (!account || !bundle)
          throw new Error("Saved account and certificate are required");
        const certificate = bundle
          .toString()
          .match(
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
          )?.[0];
        if (!certificate) throw new Error("Invalid saved certificate");
        const client = await createLanHttpsAcmeSession({
          ...account,
          accountKey: keys.accountKey,
        });
        await client.revokeCertificate(certificate, { reason: 1 });
        output({ revoked: true, restartRequired: true });
      });
    }
    if (action === "front" || action === "keyless-check") {
      const binary = lanHttpsBinary();
      const environment = {
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
        GOMAXPROCS: "1",
        GOMEMLIMIT: "48MiB",
        ...(process.env.SSL_CERT_FILE
          ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE }
          : {}),
        ...(process.env.SSL_CERT_DIR
          ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR }
          : {}),
      };
      process.execve(
        binary,
        [binary, action, "--config", values.config],
        environment,
      );
    }
  }
  throw new Error("Unsupported LAN HTTPS command");
}
if (isMainModule(import.meta.url)) {
  runLanHttpsCli().catch(() => {
    process.stderr.write(
      JSON.stringify({ event: "lan_https.command_failed" }) + "\n",
    );
    process.exitCode = 1;
  });
}
