// Pure selection only: no secrets, provider discovery, identity linking or I/O.
const SELECTION_KEYS = [
  "AUTH_BACKEND",
  "AUTH_PASSWORD_ENABLED",
  "AUTH_OIDC_ENABLED",
  "OIDC_DISPLAY_NAME",
];

export function browserAuthenticationFromMode(mode) {
  if (mode === "cloudflare-access")
    return validateBrowserAuthenticationSelection({ backend: mode });
  if (mode === "password" || mode === "oidc")
    return validateBrowserAuthenticationSelection({
      backend: "native",
      passwordEnabled: mode === "password",
      oidcEnabled: mode === "oidc",
    });
  throw new Error("AUTH_MODE must be cloudflare-access, oidc, or password");
}

export function parseBrowserAuthenticationSelection(values) {
  if (!values.has("AUTH_BACKEND")) {
    if (SELECTION_KEYS.some((key) => values.has(key)))
      throw new Error("Authentication method settings require AUTH_BACKEND");
    return browserAuthenticationFromMode(values.get("AUTH_MODE"));
  }
  if (values.has("AUTH_MODE"))
    throw new Error(
      "AUTH_MODE and AUTH_BACKEND must not be configured together",
    );
  const backend = values.get("AUTH_BACKEND");
  if (backend === "cloudflare-access") {
    if (SELECTION_KEYS.slice(1).some((key) => values.has(key)))
      throw new Error("Cloudflare Access must not configure native methods");
    return validateBrowserAuthenticationSelection({ backend });
  }
  if (backend !== "native")
    throw new Error("AUTH_BACKEND must be cloudflare-access or native");
  const boolean = (key) => {
    const value = values.get(key);
    if (value !== "true" && value !== "false")
      throw new Error(`${key} must explicitly be true or false`);
    return value === "true";
  };
  return validateBrowserAuthenticationSelection({
    backend,
    passwordEnabled: boolean("AUTH_PASSWORD_ENABLED"),
    oidcEnabled: boolean("AUTH_OIDC_ENABLED"),
    ...(values.has("OIDC_DISPLAY_NAME")
      ? { oidcDisplayName: values.get("OIDC_DISPLAY_NAME") }
      : {}),
  });
}

export function validateBrowserAuthenticationSelection(input) {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error("Browser authentication selection must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = [
    "backend",
    "passwordEnabled",
    "oidcEnabled",
    "oidcDisplayName",
  ];
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    ) ||
    Object.values(descriptors).some((d) => !Object.hasOwn(d, "value"))
  )
    throw new Error(
      "Browser authentication selection contains unsupported fields or accessors",
    );
  if (input.backend === "cloudflare-access") {
    if (Reflect.ownKeys(input).length !== 1)
      throw new Error("Cloudflare Access must not configure native methods");
    return Object.freeze({ backend: "cloudflare-access" });
  }
  if (input.backend !== "native")
    throw new Error(
      "Authentication backend must be cloudflare-access or native",
    );
  if (
    typeof input.passwordEnabled !== "boolean" ||
    typeof input.oidcEnabled !== "boolean"
  )
    throw new Error("Native authentication requires explicit boolean methods");
  if (!input.passwordEnabled && !input.oidcEnabled)
    throw new Error(
      "Native authentication requires at least one enabled method",
    );
  const hasDisplayName = Object.hasOwn(input, "oidcDisplayName");
  if (
    hasDisplayName &&
    (!input.oidcEnabled ||
      typeof input.oidcDisplayName !== "string" ||
      input.oidcDisplayName.length < 1 ||
      input.oidcDisplayName.length > 80 ||
      input.oidcDisplayName.trim() !== input.oidcDisplayName ||
      [...input.oidcDisplayName].some((c) => {
        const code = c.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }))
  )
    throw new Error(
      "OIDC display name must be bounded text for an enabled OIDC method",
    );
  return Object.freeze({
    backend: "native",
    passwordEnabled: input.passwordEnabled,
    oidcEnabled: input.oidcEnabled,
    ...(hasDisplayName ? { oidcDisplayName: input.oidcDisplayName } : {}),
  });
}

export function isBrowserAuthenticationMethodEnabled(selection, method) {
  if (selection.backend === "cloudflare-access")
    return method === "cloudflare-access";
  return (
    (method === "password" && selection.passwordEnabled) ||
    (method === "oidc" && selection.oidcEnabled)
  );
}

// A single source for credential requirements and the approved bootstrap policy.
export function browserAuthenticationRequirements(input) {
  const selection = validateBrowserAuthenticationSelection(input);
  const passwordEnabled = isBrowserAuthenticationMethodEnabled(
    selection,
    "password",
  );
  const oidcEnabled = isBrowserAuthenticationMethodEnabled(selection, "oidc");
  return Object.freeze({
    passwordEnabled,
    oidcEnabled,
    bootstrapMethod:
      selection.backend === "cloudflare-access"
        ? "cloudflare-access"
        : passwordEnabled
          ? "password"
          : "oidc",
    followUpOidcRegistration: passwordEnabled && oidcEnabled,
  });
}

// Legacy format-1 and single-method CLI boundary, not a production rollout gate.
export function legacyBrowserAuthenticationMode(values) {
  const selection = parseBrowserAuthenticationSelection(values);
  if (SELECTION_KEYS.some((key) => values.has(key)))
    throw new Error(
      "Format-1 profiles require AUTH_MODE; use the format-2 authentication review for AUTH_BACKEND",
    );
  return selection.backend === "cloudflare-access"
    ? "cloudflare-access"
    : selection.passwordEnabled
      ? "password"
      : "oidc";
}
