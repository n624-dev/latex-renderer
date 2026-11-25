import { terminalSetupText as setupText } from "./setup-messages.mjs";
import {
  createServerSetupSession,
  serverSetupInitialOwnerPlan,
  lanHttpsInterfaceChoices,
  LAN_HTTPS_COMMON,
  validateLanHttpsProvider,
} from "../../packages/server-setup-core/src/index.mjs";
import { networkInterfaces } from "node:os";

/** Equivalent initial setup/recovery flow without handing off to a Web page.
 * The injected secret/file IO keeps terminal handling outside the shared core.
 */
export async function runServerInitialCui(host, io) {
  const session = createServerSetupSession(host);
  try {
    const state = await session.status();
    io.print(
      setupText("preparedInfrastructureOnlyNoOsAccount"),
    );
    if (
      (await io.ask(
        setupText("typeRecoverToRecoverAnInterrupted") + " ",
      )) === "RECOVER"
    ) {
      const result = await session.recover();
      if (result.phase === "complete") {
        io.print(setupText("recoveredAndVerified"));
        return { applied: true };
      }
      io.print(
        setupText("noOwnerWasCommittedReviewThe"),
      );
    }
    io.print(JSON.stringify(state.review, null, 2));
    const entry = await io.ask(
      setupText("completeFormat4JsonOrType") + " ",
    );
    const review =
      entry.trim().toUpperCase() === "LAN"
        ? await guidedLanReview(
            state.review,
            host.scope === "initial-prepared-host",
            io,
          )
        : JSON.parse(entry);
    const checked = await session.preview(review);
    const ingressOnly = host.scope === "ingress-prepared-host";
    const owner = ingressOnly
      ? {}
      : { displayName: await io.ask(setupText("initialOwnerDisplayName") + " ") };
    if (!ingressOnly) {
      const email = await io.ask(
        setupText("ownerEmailOptionalNeverUsedTo") + " ",
      );
      if (email) owner.email = email;
      const plan = serverSetupInitialOwnerPlan(
        checked.review.deployment.authentication,
      );
      if (plan.bootstrapMethod === "password") {
        owner.loginName = await io.ask(setupText("ownerLoginName") + " ");
        owner.password = await io.askSecret(setupText("ownerPasswordHidden") + " ");
        if (
          owner.password !==
          (await io.askSecret(setupText("confirmOwnerPasswordHidden") + " "))
        )
          throw new Error("Password confirmation differs");
      } else
        owner.subject = await io.ask(setupText("exactProviderSubjectNotEmail") + " ");
    }
    const credentials = ingressOnly ? {} : { owner };
    if (!ingressOnly)
      credentials.deploymentUser = await io.ask(
        setupText("existingNonRootDeploymentUserFor") + " ",
      );
    const auth = checked.review.deployment.authentication.authentication;
    if (!ingressOnly && auth.backend === "native" && auth.oidcEnabled)
      credentials.oidcClientSecret = await io.askSecret(
        setupText("oidcClientSecretHidden") + " ",
      );
    if (
      checked.review.deployment.ingress.mode === "standalone" &&
      checked.review.deployment.ingress.tlsProvider === "automatic"
    ) {
      const invitation = await io.askSecret(
        setupText("authorityInvitationHiddenOptionalForOpen") + " ",
      );
      if (invitation) credentials.lanInvitation = invitation;
    }
    if (
      checked.review.deployment.ingress.mode === "standalone" &&
      checked.review.deployment.ingress.tlsProvider === "custom"
    ) {
      credentials.tls = {
        certificate: await io.readFile(
          await io.ask(setupText("certificatePemFile") + " "),
          512 * 1024,
        ),
        privateKey: await io.readFile(
          await io.ask(setupText("privateKeyPemFileNeverDisplayed") + " "),
          16 * 1024,
        ),
      };
    }
    io.print(JSON.stringify(checked.review, null, 2));
    if (
      (await io.ask(
        setupText("typeApplyToCreateTheOwner") + " ",
      )) !== "APPLY"
    )
      return { applied: false };
    try {
      await session.apply(checked.confirmation, credentials);
    } catch {
      if (
        (await io.ask(
          setupText("setupFailedTypeRecoverToReconcile") + " ",
        )) !== "RECOVER"
      )
        throw new Error("Recovery required");
      const recovered = await session.recover();
      if (recovered.phase !== "complete")
        throw new Error("Credentials must be resubmitted after review");
    } finally {
      owner.password = undefined;
      credentials.tls = undefined;
      credentials.oidcClientSecret = undefined;
      credentials.lanInvitation = undefined;
    }
    io.print(
      setupText("setupCompletedWithServiceAndHttps"),
    );
    return { applied: true };
  } finally {
    session.close();
  }
}

async function guidedLanReview(current, initial, io) {
  const review = JSON.parse(JSON.stringify(current));
  const choices = lanHttpsInterfaceChoices(
    io.interfaces ?? networkInterfaces(),
  );
  if (!choices.length)
    throw new Error(
      "No eligible private LAN interface is assigned; configure the host interface first",
    );
  io.print(setupText("lanInterfaces"));
  choices.forEach((entry, index) =>
    io.print(
      `${index + 1}: ${entry.interfaceName} ${entry.address} ${entry.network}`,
    ),
  );
  const selected = Number(await io.ask(setupText("interfaceNumber") + " "));
  const entry = choices[selected - 1];
  if (!Number.isSafeInteger(selected) || !entry)
    throw new Error("Choose an explicit LAN interface");
  const source =
    (
      await io.ask(setupText("certificateAuthority1Shared2Self") + " ")
    ).trim() || "1";
  if (!["1", "2"].includes(source))
    throw new Error("Choose shared or self-hosted authority");
  const common = LAN_HTTPS_COMMON;
  const serverOrigin =
    source === "1"
      ? common.serverOrigin
      : await io.ask(setupText("authorityHttpsOrigin") + " ");
  const lanDomain =
    source === "1"
      ? common.lanDomain
      : await io.ask(setupText("delegatedLanDnsDomain") + " ");
  const issuerId =
    source === "1"
      ? common.issuerId
      : await io.ask(setupText("authorityAcmeIssuerId") + " ");
  const mode =
    (await io.ask(setupText("tls1LocalCertificate2Keyless") + " ")).trim() || "1";
  if (!["1", "2"].includes(mode)) throw new Error("Choose a TLS provider");
  const fallback =
    mode === "2" ||
    (await io.ask(
      setupText("useKeylessWhileNoLocalCertificate") + " ",
    )) === "yes";
  const port = Number((await io.ask(setupText("httpsPort443") + " ")).trim() || "443");
  const provider = validateLanHttpsProvider({
    format: 1,
    provider: mode === "1" ? "akebi-local-acme" : "akebi-keyless",
    serverOrigin,
    lanDomain,
    address: entry.address,
    port,
    keylessFallback: fallback,
  });
  const termsAccepted =
    mode === "1" &&
    (await io.ask(
      setupText("confirmTheSelectedCaTermsType") + " ",
    )) === "AGREE";
  review.deployment.ingress = {
    format: 1,
    mode: "standalone",
    accessScope: "lan",
    tlsProvider: "automatic",
    publicOrigin: provider.publicOrigin,
    listenAddress: provider.address,
    allowedNetworks: [entry.network],
    lanHttps: { format: 1, provider, issuerId, termsAccepted },
  };
  Object.assign(review.deployment.authentication.deployment, {
    mode: "standalone",
    publicOrigin: provider.publicOrigin,
    rendererPublicUrl: provider.publicOrigin,
  });
  if (initial) {
    const method =
      (await io.ask("Login: password / oidc / both [password]: ")).trim() ||
      "password";
    if (!["password", "oidc", "both"].includes(method))
      throw new Error("Choose a supported login method");
    const authentication = {
      backend: "native",
      passwordEnabled: method !== "oidc",
      oidcEnabled: method !== "password",
    };
    if (method !== "password")
      authentication.oidc = {
        issuer: await io.ask(setupText("oidcIssuerHttpsUrl") + " "),
        clientId: await io.ask(setupText("oidcClientId") + " "),
        allowedAlgorithms: ["RS256", "ES256"],
        displayName: "OIDC",
      };
    review.deployment.authentication.authentication = authentication;
    const image = await io.ask(
      setupText("preparedImmutableRuntimeDigestValue", { value: review.runtime.rendererImage }) + " ",
    );
    if (image) review.runtime.rendererImage = image;
  }
  return review;
}
