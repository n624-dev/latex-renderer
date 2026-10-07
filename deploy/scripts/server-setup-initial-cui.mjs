import {
  createServerSetupSession,
  serverSetupInitialOwnerPlan,
} from "../../packages/server-setup-core/src/index.mjs";

/** Equivalent initial setup/recovery flow without handing off to a Web page.
 * The injected secret/file IO keeps terminal handling outside the shared core.
 */
export async function runServerInitialCui(host, io) {
  const session = createServerSetupSession(host);
  try {
    const state = await session.status();
    io.print(
      "Prepared infrastructure only. No OS, account, Docker or disk changes. Custom HTTPS or existing Cloudflare ingress is required.",
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
    const review = JSON.parse(
      await io.ask(
        "Complete format-4 JSON (set real HTTPS origin, ingress and prepared immutable image): ",
      ),
    );
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
    if (checked.review.deployment.ingress.mode === "standalone") {
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
    }
    io.print(
      "Setup completed with service and HTTPS health verified. Verify owner login and a representative render.",
    );
    return { applied: true };
  } finally {
    session.close();
  }
}
