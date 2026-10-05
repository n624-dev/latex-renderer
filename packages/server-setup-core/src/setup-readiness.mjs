import { validateServerSetupDeploymentReview } from "./deployment-review.mjs";
import { serverSetupInitialOwnerPlan } from "./authentication-review.mjs";
import { discoverServerOidcProvider } from "./oidc-discovery.mjs";
import { SERVER_INGRESS_TLS_PATHS } from "./ingress-nginx.mjs";

// Common CUI/Web readiness summary. No credential input or file/provider access.
// This is explicitly not a completed installation or authorization to apply it.
export function reviewServerSetupReadiness(input) {
  const review = validateServerSetupDeploymentReview(input);
  const authentication = review.authentication.authentication;
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
    review.ingress?.mode === "standalone" &&
    review.ingress.tlsProvider === "custom"
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
    initialOwner: serverSetupInitialOwnerPlan(review.authentication),
    requiredCredentialFiles: Object.freeze(credentials),
    oidcDiscoveryRequired:
      authentication.backend === "native" && authentication.oidcEnabled,
    ingressStatus:
      review.ingress === null
        ? "unreviewed"
        : review.ingress.tlsProvider === "automatic"
          ? "unsupported-automatic"
          : "reviewed",
    readyForApply: false,
  });
}

// Explicit opt-in network check. Password/Access never read stale OIDC values,
// request a provider, fetch JWKS/tokens, create owners or link identities.
export async function checkServerSetupOidc(input, options = {}) {
  const review = validateServerSetupDeploymentReview(input);
  const auth = review.authentication.authentication;
  if (auth.backend !== "native" || !auth.oidcEnabled)
    return Object.freeze({ status: "not-required", metadata: null });
  const metadata = await discoverServerOidcProvider(auth.oidc.issuer, options);
  return Object.freeze({ status: "checked", metadata });
}
