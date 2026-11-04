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
      "Prepared infrastructure only. No OS, account, Docker or disk changes. Select automatic LAN HTTPS, custom HTTPS, or existing Cloudflare ingress.",
    );
    if (
      (await io.ask(
        "Type RECOVER to recover an interrupted setup; Enter to configure: ",
      )) === "RECOVER"
    ) {
      const result = await session.recover();
      if (result.phase === "complete") {
        io.print("Recovered and verified.");
        return { applied: true };
      }
      io.print(
        "No owner was committed. Review the same settings and resubmit credentials.",
      );
    }
    io.print(JSON.stringify(state.review, null, 2));
    const entry = await io.ask(
      "Complete format-4 JSON, or type LAN for guided LAN HTTPS: ",
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
      : { displayName: await io.ask("Initial owner display name: ") };
    if (!ingressOnly) {
      const email = await io.ask(
        "Owner email (optional; never used to link identity): ",
      );
      if (email) owner.email = email;
      const plan = serverSetupInitialOwnerPlan(
        checked.review.deployment.authentication,
      );
      if (plan.bootstrapMethod === "password") {
        owner.loginName = await io.ask("Owner login name: ");
        owner.password = await io.askSecret("Owner password (hidden): ");
        if (
          owner.password !==
          (await io.askSecret("Confirm owner password (hidden): "))
        )
          throw new Error("Password confirmation differs");
      } else
        owner.subject = await io.ask("Exact provider subject (not email): ");
    }
    const credentials = ingressOnly ? {} : { owner };
    if (!ingressOnly)
      credentials.deploymentUser = await io.ask(
        "Existing non-root deployment user for Updater builds: ",
      );
    const auth = checked.review.deployment.authentication.authentication;
    if (!ingressOnly && auth.backend === "native" && auth.oidcEnabled)
      credentials.oidcClientSecret = await io.askSecret(
        "OIDC client secret (hidden): ",
      );
    if (
      checked.review.deployment.ingress.mode === "standalone" &&
      checked.review.deployment.ingress.tlsProvider === "automatic"
    ) {
      const invitation = await io.askSecret(
        "Authority invitation (hidden, optional for open registration): ",
      );
      if (invitation) credentials.lanInvitation = invitation;
    }
    if (
      checked.review.deployment.ingress.mode === "standalone" &&
      checked.review.deployment.ingress.tlsProvider === "custom"
    ) {
      credentials.tls = {
        certificate: await io.readFile(
          await io.ask("Certificate PEM file: "),
          512 * 1024,
        ),
        privateKey: await io.readFile(
          await io.ask("Private key PEM file (never displayed): "),
          16 * 1024,
        ),
      };
    }
    io.print(JSON.stringify(checked.review, null, 2));
    if (
      (await io.ask(
        "Type APPLY to create the owner and activate HTTPS/services: ",
      )) !== "APPLY"
    )
      return { applied: false };
    try {
      await session.apply(checked.confirmation, credentials);
    } catch {
      if (
        (await io.ask(
          "Setup failed. Type RECOVER to reconcile private state now: ",
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
      "Setup completed with service and HTTPS health verified. Verify owner login and a representative render.",
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
  io.print("LAN interfaces:");
  choices.forEach((entry, index) =>
    io.print(
      `${index + 1}: ${entry.interfaceName} ${entry.address} ${entry.network}`,
    ),
  );
  const selected = Number(await io.ask("Interface number: "));
  const entry = choices[selected - 1];
  if (!Number.isSafeInteger(selected) || !entry)
    throw new Error("Choose an explicit LAN interface");
  const source =
    (
      await io.ask("Certificate authority: 1 shared / 2 self-hosted [1]: ")
    ).trim() || "1";
  if (!["1", "2"].includes(source))
    throw new Error("Choose shared or self-hosted authority");
  const common = LAN_HTTPS_COMMON;
  const serverOrigin =
    source === "1"
      ? common.serverOrigin
      : await io.ask("Authority HTTPS origin: ");
  const lanDomain =
    source === "1"
      ? common.lanDomain
      : await io.ask("Delegated LAN DNS domain: ");
  const issuerId =
    source === "1"
      ? common.issuerId
      : await io.ask("Authority ACME issuer ID: ");
  const mode =
    (await io.ask("TLS: 1 local certificate / 2 Keyless [1]: ")).trim() || "1";
  if (!["1", "2"].includes(mode)) throw new Error("Choose a TLS provider");
  const fallback =
    mode === "2" ||
    (await io.ask(
      "Use Keyless while no local certificate is usable? yes/no [no]: ",
    )) === "yes";
  const port = Number((await io.ask("HTTPS port [443]: ")).trim() || "443");
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
      "Confirm the selected CA terms. Type AGREE to enable account registration: ",
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
        issuer: await io.ask("OIDC issuer HTTPS URL: "),
        clientId: await io.ask("OIDC client ID: "),
        allowedAlgorithms: ["RS256", "ES256"],
        displayName: "OIDC",
      };
    review.deployment.authentication.authentication = authentication;
    const image = await io.ask(
      `Prepared immutable Runtime digest [${review.runtime.rendererImage}]: `,
    );
    if (image) review.runtime.rendererImage = image;
  }
  return review;
}
