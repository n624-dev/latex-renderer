import { describe, expect, it, vi } from "vitest";
import {
  browserAuthenticationFromMode,
  parseBrowserAuthenticationSelection,
  validateBrowserAuthenticationSelection,
  isBrowserAuthenticationMethodEnabled,
  legacyBrowserAuthenticationMode,
  parseEnvironmentFile,
  importServerSetupProfile,
} from "../packages/server-setup-core/src/index.mjs";

const native = { backend: "native", passwordEnabled: true, oidcEnabled: true };
function values(entries: Record<string, string>) {
  return new Map(Object.entries(entries));
}

describe("shared browser authentication selection", () => {
  it.each(["password", "oidc", "cloudflare-access"])(
    "maps legacy %s without enabling another method",
    (mode) => {
      const parsed = parseBrowserAuthenticationSelection(
        values({ AUTH_MODE: mode }),
      );
      expect(parsed).toEqual(browserAuthenticationFromMode(mode));
      expect(legacyBrowserAuthenticationMode(values({ AUTH_MODE: mode }))).toBe(
        mode,
      );
      for (const candidate of [
        "password",
        "oidc",
        "cloudflare-access",
        "native",
        "unknown",
      ])
        expect(isBrowserAuthenticationMethodEnabled(parsed, candidate)).toBe(
          candidate === mode,
        );
      expect(Object.isFrozen(parsed)).toBe(true);
    },
  );

  it.each([
    ["true", "false"],
    ["false", "true"],
    ["true", "true"],
  ])("requires explicit native flags %s/%s", (password, oidc) => {
    const parsed = parseBrowserAuthenticationSelection(
      values({
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: password,
        AUTH_OIDC_ENABLED: oidc,
      }),
    );
    expect(parsed).toEqual({
      backend: "native",
      passwordEnabled: password === "true",
      oidcEnabled: oidc === "true",
    });
    expect(
      isBrowserAuthenticationMethodEnabled(parsed, "cloudflare-access"),
    ).toBe(false);
  });

  it("supports the separate Access backend and treats a provider label as text only", () => {
    expect(
      parseBrowserAuthenticationSelection(
        values({ AUTH_BACKEND: "cloudflare-access" }),
      ),
    ).toEqual({ backend: "cloudflare-access" });
    const label = '<img src=x onerror="alert(1)">';
    const parsed = parseBrowserAuthenticationSelection(
      values({
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: "true",
        AUTH_OIDC_ENABLED: "true",
        OIDC_DISPLAY_NAME: label,
      }),
    );
    expect(parsed).toEqual({ ...native, oidcDisplayName: label });
    expect(parsed).not.toHaveProperty("issuer");
  });

  it.each([
    {},
    { AUTH_MODE: "none" },
    { AUTH_BACKEND: " native " },
    {
      AUTH_MODE: "password",
      AUTH_BACKEND: "native",
      AUTH_PASSWORD_ENABLED: "true",
      AUTH_OIDC_ENABLED: "false",
    },
    { AUTH_MODE: "password", AUTH_OIDC_ENABLED: "true" },
    { AUTH_MODE: "oidc", OIDC_DISPLAY_NAME: "SSO" },
    { AUTH_BACKEND: "native" },
    { AUTH_BACKEND: "native", AUTH_PASSWORD_ENABLED: "true" },
    {
      AUTH_BACKEND: "native",
      AUTH_PASSWORD_ENABLED: "1",
      AUTH_OIDC_ENABLED: "false",
    },
    {
      AUTH_BACKEND: "native",
      AUTH_PASSWORD_ENABLED: "true",
      AUTH_OIDC_ENABLED: "TRUE",
    },
    {
      AUTH_BACKEND: "native",
      AUTH_PASSWORD_ENABLED: "false",
      AUTH_OIDC_ENABLED: "false",
    },
    {
      AUTH_BACKEND: "native",
      AUTH_PASSWORD_ENABLED: "true",
      AUTH_OIDC_ENABLED: "false",
      OIDC_DISPLAY_NAME: "SSO",
    },
    { AUTH_BACKEND: "cloudflare-access", AUTH_PASSWORD_ENABLED: "false" },
    { AUTH_BACKEND: "cloudflare-access", OIDC_DISPLAY_NAME: "SSO" },
  ])(
    "rejects incomplete, conflicting or misleading settings: %j",
    (entries) => {
      expect(() =>
        parseBrowserAuthenticationSelection(new Map(Object.entries(entries))),
      ).toThrow();
    },
  );

  it.each([
    undefined,
    null,
    [],
    { ...native, passwordEnabled: "true" },
    { ...native, oidcEnabled: undefined },
    { ...native, clientSecret: "secret-marker" },
    { backend: "cloudflare-access", oidcEnabled: false },
    { ...native, oidcDisplayName: "" },
    { ...native, oidcDisplayName: " SSO" },
    { ...native, oidcDisplayName: "a".repeat(81) },
    { ...native, oidcDisplayName: "SSO\n" },
  ])(
    "rejects malformed models without returning input secrets: %j",
    (input) => {
      expect(() => validateBrowserAuthenticationSelection(input)).toThrow();
      try {
        validateBrowserAuthenticationSelection(input);
      } catch (error) {
        expect(String(error)).not.toContain("secret-marker");
      }
    },
  );

  it("rejects inherited, accessor and symbol fields without invoking a getter", () => {
    const getter = vi.fn(() => "native");
    const input = { ...native };
    Object.defineProperty(input, "backend", { get: getter });
    expect(() => validateBrowserAuthenticationSelection(input)).toThrow(
      /accessors/,
    );
    expect(getter).not.toHaveBeenCalled();
    const inherited: unknown = Object.create(native);
    expect(() => validateBrowserAuthenticationSelection(inherited)).toThrow(
      /plain object/,
    );
    expect(() =>
      validateBrowserAuthenticationSelection({
        ...native,
        [Symbol("extra")]: true,
      }),
    ).toThrow(/unsupported/);
  });

  it("copies and freezes the model, and ignores unrelated environment secrets", () => {
    const input = { ...native };
    const parsed = validateBrowserAuthenticationSelection(input);
    input.passwordEnabled = false;
    expect(parsed).toEqual(native);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      parseBrowserAuthenticationSelection(
        values({
          AUTH_MODE: "password",
          OIDC_CLIENT_SECRET: "secret-marker",
          AUTH_PASSWORD_PEPPER_FILE: "/private/marker",
        }),
      ),
    ).toEqual(browserAuthenticationFromMode("password"));
  });

  it("keeps format-1 import legacy-only rather than dropping enabled methods", () => {
    for (const selection of [
      { AUTH_BACKEND: "cloudflare-access" },
      {
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: "true",
        AUTH_OIDC_ENABLED: "false",
      },
      {
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: "true",
        AUTH_OIDC_ENABLED: "true",
      },
    ]) {
      const entries = new Map(Object.entries(selection));
      expect(() => legacyBrowserAuthenticationMode(entries)).toThrow(
        /Format-1 profiles/,
      );
      const contents = [
        ...entries,
        ["DEPLOYMENT_MODE", "standalone"],
        ["PUBLIC_ORIGIN", "https://renderer.example.test"],
        ["RENDERER_PUBLIC_URL", "https://renderer.example.test"],
      ]
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      expect(parseEnvironmentFile(contents).has("AUTH_BACKEND")).toBe(true);
      expect(() => importServerSetupProfile(contents)).toThrow(
        /Format-1 profiles/,
      );
    }
  });
});
