export type BrowserLoginMethod =
  Readonly<{ id: "password" }> | Readonly<{ id: "oidc"; displayName: string }>;

export interface BrowserLoginConfiguration {
  readonly backend: "native" | "cloudflare-access";
  readonly methods: readonly BrowserLoginMethod[];
}

// Self-contained so the same parser can be embedded in both shipped scripts.
// The server remains authoritative for authentication and provisioning.
export function normalizeBrowserLoginConfiguration(
  value: unknown,
): BrowserLoginConfiguration {
  const invalid = () =>
    new Error("ログイン方式の設定を確認できません。管理者へ連絡してください。");
  const record = (input: unknown): Record<string, unknown> => {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        return !descriptor || !("value" in descriptor);
      })
    )
      throw invalid();
    return input as Record<string, unknown>;
  };
  const config = record(value);
  if (!Object.hasOwn(config, "backend") && !Object.hasOwn(config, "methods")) {
    if (config.mode === "cloudflare-access")
      return Object.freeze({
        backend: "cloudflare-access",
        methods: Object.freeze([]),
      });
    if (config.mode === "password" || config.mode === "oidc")
      return Object.freeze({
        backend: "native",
        methods: Object.freeze([
          Object.freeze(
            config.mode === "password"
              ? { id: "password" as const }
              : { id: "oidc" as const, displayName: "IDプロバイダー" },
          ),
        ]),
      });
    throw invalid();
  }
  const configuredMethods = config.methods;
  if (
    !Object.hasOwn(config, "backend") ||
    !Object.hasOwn(config, "methods") ||
    (config.backend !== "native" && config.backend !== "cloudflare-access") ||
    !Array.isArray(configuredMethods) ||
    Object.getPrototypeOf(configuredMethods) !== Array.prototype ||
    configuredMethods.length > 2 ||
    Reflect.ownKeys(configuredMethods).some(
      (key) =>
        key !== "length" &&
        key !== "0" &&
        !(key === "1" && configuredMethods.length === 2),
    )
  )
    throw invalid();
  const methods: BrowserLoginMethod[] = [];
  for (let index = 0; index < configuredMethods.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(
      configuredMethods,
      index,
    );
    if (!descriptor || !("value" in descriptor)) throw invalid();
    const method = record(descriptor.value);
    if (
      !Object.hasOwn(method, "id") ||
      Reflect.ownKeys(method).some(
        (key) => key !== "id" && key !== "displayName",
      ) ||
      methods.some((entry) => entry.id === method.id)
    )
      throw invalid();
    if (method.id === "password" && !Object.hasOwn(method, "displayName"))
      methods.push(Object.freeze({ id: "password" }));
    else if (
      method.id === "oidc" &&
      Object.hasOwn(method, "displayName") &&
      typeof method.displayName === "string" &&
      method.displayName.length >= 1 &&
      method.displayName.length <= 80 &&
      method.displayName.trim() === method.displayName &&
      !Array.from(method.displayName).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    )
      methods.push(
        Object.freeze({ id: "oidc", displayName: method.displayName }),
      );
    else throw invalid();
  }
  if (
    (config.backend === "native" && methods.length === 0) ||
    (config.backend === "cloudflare-access" && methods.length !== 0)
  )
    throw invalid();
  return Object.freeze({
    backend: config.backend,
    methods: Object.freeze(methods),
  });
}

export const browserLoginConfigurationScript = `const normalizeBrowserLoginConfiguration=${normalizeBrowserLoginConfiguration.toString()};\n`;
