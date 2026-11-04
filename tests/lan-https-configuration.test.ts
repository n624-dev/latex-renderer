import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  chmodSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLanHttpsConfiguration,
  validateLanHttpsAuthorityConfiguration,
  validateLanHttpsClientConfiguration,
} from "../deploy/lan-https/configuration.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
export function authorityConfiguration(stateDirectory: string) {
  return {
    format: 1,
    role: "authority",
    stateDirectory,
    policy: {
      format: 1,
      registration: "open",
      serverOrigin: "https://akebi.example.test",
      lanDomain: "lan.example.test",
    },
    http: { address: "127.0.0.1", port: 3181, trustLoopbackProxy: true },
    dns: {
      listeners: [{ address: "0.0.0.0", port: 53 }],
      nameserver: "ns1.example.test",
      caaIssuers: ["comodoca.com", "letsencrypt.org"],
    },
    issuers: [
      {
        id: "letsencrypt",
        directoryUrl: "https://acme.example.test/directory",
        newAccountUrl: "https://acme.example.test/newAccount",
      },
    ],
  };
}
describe("LAN HTTPS service configuration", () => {
  it("validates custom authority and client policy without reading secrets or starting listeners", () => {
    const authority = validateLanHttpsAuthorityConfiguration(
      authorityConfiguration("/var/lib/authority"),
    );
    expect(authority.issuers[0]?.eabFile).toBeUndefined();
    expect(authority.keyless).toBeNull();
    expect(() =>
      validateLanHttpsAuthorityConfiguration({
        ...authority,
        http: { ...authority.http, address: "0.0.0.0" },
      }),
    ).toThrow(/loopback/);
    expect(() =>
      validateLanHttpsAuthorityConfiguration({
        ...authority,
        policy: {
          ...authority.policy,
          serverOrigin: "https://api.lan.example.test",
        },
      }),
    ).toThrow(/outside/);
    expect(() =>
      validateLanHttpsAuthorityConfiguration({
        ...authority,
        dns: { ...authority.dns, listeners: [{ address: "0.0.0.0", port: 0 }] },
      }),
    ).toThrow(/port/);
    const input = {
      format: 1,
      role: "client",
      stateDirectory: "/var/lib/lan-client",
      provider: {
        format: 1,
        provider: "akebi-local-acme",
        serverOrigin: "https://akebi.example.test",
        lanDomain: "lan.example.test",
        address: "192.168.1.50",
        keylessFallback: false,
      },
      issuerId: "letsencrypt",
      termsAccepted: true,
      allowedNetworks: ["192.168.1.0/24"],
    };
    expect(
      validateLanHttpsClientConfiguration(input).provider.publicOrigin,
    ).toBe("https://192-168-1-50.lan.example.test");
    expect(() =>
      validateLanHttpsClientConfiguration({
        ...input,
        allowedNetworks: ["0.0.0.0/0"],
      }),
    ).toThrow();
    expect(() =>
      validateLanHttpsClientConfiguration({
        ...input,
        stateDirectory: "../../outside",
      }),
    ).toThrow();
  });
  it("reads bounded canonical regular configuration and rejects unsafe secret permissions and aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "lan-config-"));
    roots.push(root);
    const path = join(root, "private.json");
    writeFileSync(path, JSON.stringify({ fixture: true }), { mode: 0o600 });
    expect(readLanHttpsConfiguration(path, { secret: true })).toEqual({
      fixture: true,
    });
    chmodSync(path, 0o644);
    expect(() => readLanHttpsConfiguration(path, { secret: true })).toThrow(
      /Unsafe/,
    );
    expect(readLanHttpsConfiguration(path)).toEqual({ fixture: true });
    const alias = join(root, "alias.json");
    symlinkSync(path, alias);
    expect(() => readLanHttpsConfiguration(alias)).toThrow(/canonical/);
    expect(() =>
      readLanHttpsConfiguration(path, { maximumBytes: 2 }),
    ).toThrow();
    chmodSync(root, 0o777);
    expect(() => readLanHttpsConfiguration(path)).toThrow(/directory/);
  });
});
