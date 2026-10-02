import { describe, expect, it, vi } from "vitest";
import { normalizeBrowserLoginConfiguration as normalize } from "../apps/admin-web/src/assets/auth-configuration.js";

const password = { id: "password" };
const oidc = { id: "oidc", displayName: "School Account" };
const native = (methods: unknown[]) => ({ backend: "native", methods });

describe("browser login configuration", () => {
  it.each([
    ["password", native([password])],
    ["oidc", native([{ id: "oidc", displayName: "IDプロバイダー" }])],
    ["cloudflare-access", { backend: "cloudflare-access", methods: [] }],
  ])("preserves the exact legacy %s choice", (mode, expected) => {
    expect(normalize({ mode })).toEqual(expected);
  });

  it.each([
    native([password]),
    native([oidc]),
    native([password, oidc]),
    native([oidc, password]),
    { backend: "cloudflare-access", methods: [] },
  ])("accepts an explicit enabled method selection: %j", (config) => {
    expect(normalize(config)).toEqual(config);
  });

  it("uses capabilities rather than a compatibility mode or session provenance", () => {
    expect(normalize({ ...native([oidc]), mode: "password" })).toEqual(
      native([oidc]),
    );
  });

  it.each([
    null,
    [],
    {},
    { mode: "unknown" },
    { mode: "native" },
    { mode: "password", backend: "native" },
    { mode: "password", methods: [password] },
    { backend: "unknown", methods: [] },
    native([]),
    native([password, password]),
    native([oidc, oidc]),
    native([password, oidc, password]),
    native([{ id: "external" }]),
    native([{ ...password, displayName: "Password" }]),
    native([{ ...password, secret: "must-not-render" }]),
    native([{ id: "oidc" }]),
    native([{ ...oidc, displayName: "" }]),
    native([{ ...oidc, displayName: " padded " }]),
    native([{ ...oidc, displayName: "x".repeat(81) }]),
    native([{ ...oidc, displayName: "line\nbreak" }]),
    { backend: "cloudflare-access", methods: [password] },
    { backend: "cloudflare-access", methods: [oidc] },
    Object.create({ mode: "password" }) as unknown,
  ])(
    "rejects invalid or ambiguous configuration without fallback: %j",
    (config) => {
      expect(() => normalize(config)).toThrow("ログイン方式の設定");
    },
  );

  it("rejects accessors and malformed arrays without evaluating getters", () => {
    const getter = vi.fn(() => password);
    const methods: unknown[] = [];
    Object.defineProperty(methods, 0, { get: getter, enumerable: true });
    expect(() => normalize(native(methods))).toThrow();
    expect(() => normalize(native(new Array(1)))).toThrow();
    expect(() =>
      normalize(native(Object.assign([password], { extra: 1 }))),
    ).toThrow();
    expect(() =>
      normalize({
        get mode() {
          return getter();
        },
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it("returns a detached, frozen projection without unrelated secrets", () => {
    const input = { ...native([{ ...oidc }]), secret: "must-not-render" };
    const output = normalize(input);
    input.methods.length = 0;
    expect(output).toEqual(native([oidc]));
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.methods)).toBe(true);
    expect(Object.isFrozen(output.methods[0])).toBe(true);
    expect(JSON.stringify(output)).not.toContain("secret");
  });

  it("keeps provider labels as data, not markup", () => {
    const label = '<img src=x onerror="alert(1)">';
    expect(
      normalize(native([{ ...oidc, displayName: label }])).methods,
    ).toEqual([{ id: "oidc", displayName: label }]);
  });
});
