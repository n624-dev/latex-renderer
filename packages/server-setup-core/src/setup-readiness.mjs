import { validateServerSetupDeploymentReview } from "./deployment-review.mjs";
import { serverSetupInitialOwnerPlan } from "./authentication-review.mjs";
import { discoverServerOidcProvider } from "./oidc-discovery.mjs";
import { SERVER_INGRESS_TLS_PATHS } from "./ingress-nginx.mjs";
import { validateServerSetupReview } from "./runtime-review.mjs";
import { profileRecord } from "./profile-shape.mjs";

function checkedReview(input) {
  const record = profileRecord(input, "setup readiness", [
    "format",
    "authentication",
    "ingress",
    "deployment",
    "runtime",
  ]);
  return record.format === 4
    ? validateServerSetupReview(record)
    : validateServerSetupDeploymentReview(record);
}

// Common CUI/Web readiness summary. No credential input or file/provider access.
// This is explicitly not a completed installation or authorization to apply it.
export function reviewServerSetupReadiness(input) {
  const review = checkedReview(input);
  const deployment = review.format === 4 ? review.deployment : review;
  const authentication = deployment.authentication.authentication;
  const credentials = [];
  if (authentication.backend === "native") {
    if (authentication.passwordEnabled)
      credentials.push(
        Object.freeze({
          id: "password-pepper",
          path: "/etc/latex-renderer/secrets/auth-password-pepper",
        }),
      );
    if (authentication.oidcEnabled)
      credentials.push(
        Object.freeze({
          id: "oidc-client-secret",
          path: "/etc/latex-renderer/secrets/oidc-client-secret",
        }),
      );
  }
  if (
    deployment.ingress?.mode === "standalone" &&
    deployment.ingress.tlsProvider === "custom"
  ) {
    credentials.push(
      Object.freeze({
        id: "https-certificate",
        path: SERVER_INGRESS_TLS_PATHS.certificate,
      }),
    );
    credentials.push(
      Object.freeze({
        id: "https-private-key",
        path: SERVER_INGRESS_TLS_PATHS.privateKey,
      }),
    );
  }
  return Object.freeze({
    format: 1,
    review,
    initialOwner: serverSetupInitialOwnerPlan(deployment.authentication),
    requiredCredentialFiles: Object.freeze(credentials),
    oidcDiscoveryRequired:
      authentication.backend === "native" && authentication.oidcEnabled,
    ingressStatus:
      deployment.ingress === null
        ? "unreviewed"
        : deployment.ingress.tlsProvider === "automatic"
          ? "unsupported-automatic"
          : "reviewed",
    readyForApply: false,
  });
}

// Explicit opt-in network check. Password/Access never read stale OIDC values,
// request a provider, fetch JWKS/tokens, create owners or link identities.
export async function checkServerSetupOidc(input, options = {}) {
  const review = checkedReview(input);
  const auth = (review.format === 4 ? review.deployment : review).authentication
    .authentication;
  if (auth.backend !== "native" || !auth.oidcEnabled)
    return Object.freeze({ status: "not-required", metadata: null });
  const metadata = await discoverServerOidcProvider(auth.oidc.issuer, options);
  return Object.freeze({ status: "checked", metadata });
}
