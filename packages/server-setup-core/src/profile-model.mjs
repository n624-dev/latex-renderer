import {
  parseEnvironmentFile,
  validateProfileValues,
} from "./production-profile.mjs";
import {
  profileRecord as record,
  profileText as text,
} from "./profile-shape.mjs";
import { legacyBrowserAuthenticationMode } from "./browser-auth-selection.mjs";

// Format 1 intentionally models the existing single-method production profile.
// Password+OIDC, ingress/TLS apply and owner creation are separate milestones;
// do not enable them or infer network scope while importing an old installation.
export function importServerSetupProfile(environmentContents) {
  return profileFromValues(parseEnvironmentFile(environmentContents));
}

export function validateServerSetupProfile(input) {
  return profileFromValues(modelValues(input));
}

export function serverSetupProfileEnvironment(input) {
  return modelValues(validateServerSetupProfile(input));
}

function profileFromValues(values) {
  // Format 1 cannot represent two methods or a presentation label. Never
  // silently drop new configuration while importing into the old model.
  legacyBrowserAuthenticationMode(values);
  const summary = validateProfileValues(values);
  const deployment = {
    mode: summary.deploymentMode,
    publicOrigin: summary.publicOrigin,
    rendererPublicUrl: summary.publicOrigin,
    ...(values.has("ADMIN_API_URL")
      ? { adminApiUrl: summary.publicOrigin }
      : {}),
  };
  let authentication;
  if (summary.authMode === "cloudflare-access") {
    authentication = {
      mode: summary.authMode,
      issuer: values.get("CLOUDFLARE_ACCESS_ISSUER"),
      adminAudience: values.get("CLOUDFLARE_ADMIN_AUDIENCE"),
      remoteMcpAudience: values.get("CLOUDFLARE_REMOTE_MCP_AUDIENCE"),
    };
  } else if (summary.authMode === "oidc") {
    authentication = {
      mode: summary.authMode,
      issuer: values.get("OIDC_ISSUER"),
      clientId: values.get("OIDC_CLIENT_ID"),
      allowedAlgorithms: Object.freeze(
        (values.get("OIDC_ALLOWED_ALGORITHMS") ?? "RS256,ES256")
          .split(",")
          .map((value) => value.trim()),
      ),
    };
  } else {
    authentication = { mode: summary.authMode };
  }
  return Object.freeze({
    format: 1,
    deployment: Object.freeze(deployment),
    authentication: Object.freeze(authentication),
  });
}

function modelValues(input) {
  const model = record(input, "profile", [
    "format",
    "deployment",
    "authentication",
  ]);
  if (model.format !== 1)
    throw new Error("Server setup profile format must be 1");
  const deployment = record(model.deployment, "deployment", [
    "mode",
    "publicOrigin",
    "rendererPublicUrl",
    "adminApiUrl",
  ]);
  const values = new Map([
    ["DEPLOYMENT_MODE", text(deployment, "mode", "deployment.mode")],
    [
      "PUBLIC_ORIGIN",
      text(deployment, "publicOrigin", "deployment.publicOrigin"),
    ],
    [
      "RENDERER_PUBLIC_URL",
      text(deployment, "rendererPublicUrl", "deployment.rendererPublicUrl"),
    ],
  ]);
  if (Object.hasOwn(deployment, "adminApiUrl"))
    values.set(
      "ADMIN_API_URL",
      text(deployment, "adminApiUrl", "deployment.adminApiUrl"),
    );
  // Inspect shape/descriptors before reading mode; never invoke supplied getters.
  const auth = record(model.authentication, "authentication", [
    "mode",
    "issuer",
    "clientId",
    "allowedAlgorithms",
    "adminAudience",
    "remoteMcpAudience",
  ]);
  const mode = text(auth, "mode", "authentication.mode");
  values.set("AUTH_MODE", mode);
  if (mode === "cloudflare-access") {
    record(auth, "cloudflare-access authentication", [
      "mode",
      "issuer",
      "adminAudience",
      "remoteMcpAudience",
    ]);
    values.set(
      "CLOUDFLARE_ACCESS_ISSUER",
      text(auth, "issuer", "authentication.issuer"),
    );
    values.set(
      "CLOUDFLARE_ADMIN_AUDIENCE",
      text(auth, "adminAudience", "authentication.adminAudience"),
    );
    values.set(
      "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
      text(auth, "remoteMcpAudience", "authentication.remoteMcpAudience"),
    );
  } else if (mode === "oidc") {
    record(auth, "oidc authentication", [
      "mode",
      "issuer",
      "clientId",
      "allowedAlgorithms",
    ]);
    values.set("OIDC_ISSUER", text(auth, "issuer", "authentication.issuer"));
    values.set(
      "OIDC_CLIENT_ID",
      text(auth, "clientId", "authentication.clientId"),
    );
    if (Object.hasOwn(auth, "allowedAlgorithms")) {
      const algorithms = auth.allowedAlgorithms;
      if (
        !Array.isArray(algorithms) ||
        algorithms.length < 1 ||
        algorithms.length > 6 ||
        Object.getPrototypeOf(algorithms) !== Array.prototype
      )
        throw new Error(
          "authentication.allowedAlgorithms must be a string array",
        );
      const descriptors = Object.getOwnPropertyDescriptors(algorithms);
      if (
        Reflect.ownKeys(algorithms).some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" &&
              (!/^(?:0|[1-9][0-9]*)$/.test(key) ||
                Number(key) >= algorithms.length)),
        )
      )
        throw new Error(
          "authentication.allowedAlgorithms contains unsupported fields",
        );
      const names = [];
      for (let i = 0; i < algorithms.length; i++) {
        const descriptor = descriptors[i];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          typeof descriptor.value !== "string" ||
          descriptor.value.includes(",") ||
          descriptor.value.trim() !== descriptor.value
        )
          throw new Error(
            "authentication.allowedAlgorithms must contain individual strings",
          );
        names.push(descriptor.value);
      }
      values.set("OIDC_ALLOWED_ALGORITHMS", names.join(","));
    }
  } else if (mode === "password") {
    record(auth, "password authentication", ["mode"]);
  }
  // Exactly the validator used by the privileged deployment preflight.
  validateProfileValues(values);
  return values;
}
