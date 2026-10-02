import { parseEnvironmentFile } from "./production-profile.mjs";
import {
  importServerSetupProfile,
  validateServerSetupProfile,
  serverSetupProfileEnvironment,
} from "./profile-model.mjs";
import {
  parseBrowserAuthenticationSelection,
  validateBrowserAuthenticationSelection,
  browserAuthenticationRequirements,
  legacyBrowserAuthenticationMode,
} from "./browser-auth-selection.mjs";
import { profileRecord as record } from "./profile-shape.mjs";

const SELECTION_KEYS = [
  "AUTH_BACKEND",
  "AUTH_PASSWORD_ENABLED",
  "AUTH_OIDC_ENABLED",
  "OIDC_DISPLAY_NAME",
];

// Explicit review API only. Production/runtime adapters retain their rollout
// gate. Every enabled method must pass existing production-profile validation.
export function importServerSetupAuthenticationReview(contents) {
  const values = parseEnvironmentFile(contents);
  const selection = parseBrowserAuthenticationSelection(values);
  const legacy = (mode) => {
    const projected = new Map(values);
    for (const key of SELECTION_KEYS) projected.delete(key);
    projected.set("AUTH_MODE", mode);
    return importServerSetupProfile(environmentContents(projected));
  };
  if (selection.backend === "cloudflare-access") {
    const checked = legacy("cloudflare-access");
    return reviewFromProfiles(selection, checked);
  }
  const password = selection.passwordEnabled ? legacy("password") : undefined;
  const oidc = selection.oidcEnabled ? legacy("oidc") : undefined;
  return reviewFromProfiles(selection, password ?? oidc, oidc);
}

// Existing format-1 callers stay unchanged; JSON migration is always explicit.
export function migrateServerSetupAuthenticationReview(input) {
  return importServerSetupAuthenticationReview(
    environmentContents(serverSetupProfileEnvironment(input)),
  );
}

export function validateServerSetupAuthenticationReview(input) {
  const model = record(input, "authentication review", [
    "format",
    "deployment",
    "authentication",
  ]);
  if (model.format !== 2)
    throw new Error("Server authentication review format must be 2");
  const auth = record(model.authentication, "authentication", [
    "backend",
    "passwordEnabled",
    "oidcEnabled",
    "oidc",
    "issuer",
    "adminAudience",
    "remoteMcpAudience",
  ]);
  const legacy = (authentication) =>
    validateServerSetupProfile({
      format: 1,
      deployment: model.deployment,
      authentication,
    });
  if (auth.backend === "cloudflare-access") {
    record(auth, "Cloudflare authentication", [
      "backend",
      "issuer",
      "adminAudience",
      "remoteMcpAudience",
    ]);
    const checked = legacy({
      mode: "cloudflare-access",
      issuer: auth.issuer,
      adminAudience: auth.adminAudience,
      remoteMcpAudience: auth.remoteMcpAudience,
    });
    return reviewFromProfiles({ backend: "cloudflare-access" }, checked);
  }
  record(auth, "native authentication", [
    "backend",
    "passwordEnabled",
    "oidcEnabled",
    "oidc",
  ]);
  let oidc;
  if (Object.hasOwn(auth, "oidc"))
    oidc = record(auth.oidc, "OIDC configuration", [
      "issuer",
      "clientId",
      "allowedAlgorithms",
      "displayName",
    ]);
  const selection = validateBrowserAuthenticationSelection({
    backend: auth.backend,
    passwordEnabled: auth.passwordEnabled,
    oidcEnabled: auth.oidcEnabled,
    ...(oidc && Object.hasOwn(oidc, "displayName")
      ? { oidcDisplayName: oidc.displayName }
      : {}),
  });
  if (selection.oidcEnabled !== Boolean(oidc))
    throw new Error(
      "OIDC configuration must exist exactly when OIDC is enabled",
    );
  const passwordProfile = selection.passwordEnabled
    ? legacy({ mode: "password" })
    : undefined;
  const oidcProfile = oidc
    ? legacy({
        mode: "oidc",
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        ...(Object.hasOwn(oidc, "allowedAlgorithms")
          ? { allowedAlgorithms: oidc.allowedAlgorithms }
          : {}),
      })
    : undefined;
  return reviewFromProfiles(
    selection,
    passwordProfile ?? oidcProfile,
    oidcProfile,
  );
}

export function serverSetupAuthenticationReviewEnvironment(input) {
  const review = validateServerSetupAuthenticationReview(input);
  const auth = review.authentication;
  let authentication;
  if (auth.backend === "cloudflare-access") {
    authentication = {
      mode: "cloudflare-access",
      issuer: auth.issuer,
      adminAudience: auth.adminAudience,
      remoteMcpAudience: auth.remoteMcpAudience,
    };
  } else if (auth.oidcEnabled) {
    authentication = {
      mode: "oidc",
      issuer: auth.oidc.issuer,
      clientId: auth.oidc.clientId,
      allowedAlgorithms: auth.oidc.allowedAlgorithms,
    };
  } else authentication = { mode: "password" };
  const values = serverSetupProfileEnvironment({
    format: 1,
    deployment: review.deployment,
    authentication,
  });
  values.delete("AUTH_MODE");
  values.set("AUTH_BACKEND", auth.backend);
  if (auth.backend === "native") {
    values.set("AUTH_PASSWORD_ENABLED", String(auth.passwordEnabled));
    values.set("AUTH_OIDC_ENABLED", String(auth.oidcEnabled));
    if (auth.oidc && Object.hasOwn(auth.oidc, "displayName"))
      values.set("OIDC_DISPLAY_NAME", auth.oidc.displayName);
  }
  return values;
}

// The approved dual-method policy: password first, explicit OIDC linkage later.
// This is a plan, not owner creation, password generation or identity linking.
export function serverSetupInitialOwnerPlan(input) {
  const { authentication: auth } =
    validateServerSetupAuthenticationReview(input);
  const requirements = browserAuthenticationRequirements(
    auth.backend === "cloudflare-access"
      ? { backend: auth.backend }
      : {
          backend: auth.backend,
          passwordEnabled: auth.passwordEnabled,
          oidcEnabled: auth.oidcEnabled,
        },
  );
  return Object.freeze({
    bootstrapMethod: requirements.bootstrapMethod,
    followUpOidcRegistration: requirements.followUpOidcRegistration,
  });
}

// Host consumers share this gated, validated, non-secret execution plan. The
// legacy profile APIs remain unchanged and new installed configurations still
// fail before any file/secret mutation. No full EnvironmentFile is exported.
export function productionAuthenticationPlan(values) {
  legacyBrowserAuthenticationMode(values);
  const review = importServerSetupAuthenticationReview(
    environmentContents(values),
  );
  const selection = parseBrowserAuthenticationSelection(values);
  const requirements = browserAuthenticationRequirements(selection);
  const auth = review.authentication;
  return Object.freeze({
    deploymentMode: review.deployment.mode,
    publicOrigin: review.deployment.publicOrigin,
    ...requirements,
    authMode:
      auth.backend === "cloudflare-access"
        ? "cloudflare-access"
        : auth.passwordEnabled && auth.oidcEnabled
          ? "native"
          : requirements.bootstrapMethod,
    externalIssuer:
      auth.backend === "cloudflare-access"
        ? auth.issuer
        : auth.oidcEnabled
          ? auth.oidc.issuer
          : "",
  });
}

function reviewFromProfiles(selection, primary, oidc) {
  const source = primary.authentication;
  const authentication =
    selection.backend === "cloudflare-access"
      ? {
          backend: "cloudflare-access",
          issuer: source.issuer,
          adminAudience: source.adminAudience,
          remoteMcpAudience: source.remoteMcpAudience,
        }
      : {
          backend: "native",
          passwordEnabled: selection.passwordEnabled,
          oidcEnabled: selection.oidcEnabled,
          ...(oidc
            ? {
                oidc: Object.freeze({
                  issuer: oidc.authentication.issuer,
                  clientId: oidc.authentication.clientId,
                  allowedAlgorithms: oidc.authentication.allowedAlgorithms,
                  ...(Object.hasOwn(selection, "oidcDisplayName")
                    ? { displayName: selection.oidcDisplayName }
                    : {}),
                }),
              }
            : {}),
        };
  return Object.freeze({
    format: 2,
    deployment: primary.deployment,
    authentication: Object.freeze(authentication),
  });
}

function environmentContents(values) {
  return [...values].map(([key, value]) => `${key}=${value}`).join("\n");
}
