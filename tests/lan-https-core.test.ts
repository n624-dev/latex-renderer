import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  lanHttpsHostname,
  lanHttpsAddress,
  lanHttpsOrigin,
  normalizeLanHttpsDomain,
  validateLanHttpsProvider,
  validateLanHttpsAuthorityPolicy,
} from "../packages/server-setup-core/src/index.mjs";
import {
  createLanHttpsProof,
  lanHttpsPublicIdentity,
  verifyLanHttpsProof,
} from "../deploy/lan-https/proof.mjs";

const domain = "lan.example.test";
const provider = {
  format: 1,
  provider: "akebi-local-acme",
  serverOrigin: "https://akebi.example.test",
  lanDomain: domain,
  address: "192.168.1.50",
  keylessFallback: true,
};
const policy = {
  format: 1,
  serverOrigin: provider.serverOrigin,
  lanDomain: domain,
  registration: "open",
};

describe("deterministic LAN HTTPS names and deployment boundary", () => {
  it.each([
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.50",
    "fd12::1",
    "fc00::",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  ])("round-trips private address %s with no instance identity", (address) => {
    const hostname = lanHttpsHostname(address, domain);
    expect(lanHttpsHostname(lanHttpsAddress(hostname, domain), domain)).toBe(
      hostname,
    );
    expect(hostname).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.lan\.example\.test$/);
    expect(lanHttpsOrigin(address, domain)).toBe(`https://${hostname}`);
  });
  it("keeps the expected IPv4 URL and normalizes equivalent IPv6 spellings", () => {
    expect(lanHttpsOrigin("192.168.1.50", domain)).toBe(
      "https://192-168-1-50.lan.example.test",
    );
    expect(lanHttpsHostname("fd12::1", domain)).toBe(
      lanHttpsHostname("FD12:0:0:0:0:0:0:1", domain),
    );
    expect(lanHttpsAddress("192-168-1-50.LAN.EXAMPLE.TEST", domain)).toBe(
      "192.168.1.50",
    );
    expect(lanHttpsOrigin("192.168.1.50", domain, 8443)).toMatch(/:8443$/);
    expect(normalizeLanHttpsDomain("LAN.Example.Test")).toBe(domain);
  });
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "8.8.8.8",
    "169.254.1.2",
    "224.0.0.1",
    "100.64.0.1",
    "172.32.0.1",
    "192.168.001.1",
    "192.168.1",
    "::",
    "::1",
    "::ffff:192.168.1.1",
    "fe80::1",
    "fd12::1%eth0",
    "2001:db8::1",
  ])("rejects ineligible or ambiguous address %s", (address) => {
    expect(() => lanHttpsHostname(address, domain)).toThrow();
  });
  it.each([
    "example.test.",
    "https://example.test",
    "a..test",
    "*.example.test",
    "example.test/path",
    "example.test:53",
    "example.test\n",
    "例.example",
    "192.168.1.1",
    "example.123",
    "a".repeat(64) + ".test",
  ])("rejects unsafe domain %s", (value) => {
    expect(() => normalizeLanHttpsDomain(value)).toThrow();
  });
  it.each([
    "192-168-1-50.lan.example.test.evil.test",
    "192-168-1-50.evillan.example.test",
    "192-168-1-50.other.lan.example.test",
    "0192-168-1-50.lan.example.test",
    "127-0-0-1.lan.example.test",
    "fd12--1.lan.example.test",
    "192-168-1-50.lan.example.test.",
  ])("refuses aliases and out-of-zone name %s", (name) => {
    expect(() => lanHttpsAddress(name, domain)).toThrow();
  });
  it("bounds wire names and refuses internal port overlap", () => {
    const longest =
      Array(3).fill("a".repeat(63)).join(".") + "." + "b".repeat(21);
    expect(longest).toHaveLength(213);
    expect(lanHttpsHostname("fd12::", longest)).toHaveLength(253);
    expect(() => normalizeLanHttpsDomain(longest + "b")).toThrow();
    for (const port of [0, 65536, 3100, 3105, 3199, 1.5, NaN])
      expect(() => lanHttpsOrigin(provider.address, domain, port)).toThrow();
  });
  it("reviews both providers, custom domains, and explicit fallback without credentials", () => {
    const checked = validateLanHttpsProvider(provider);
    expect(validateLanHttpsProvider(checked)).toEqual(checked);
    expect(() =>
      validateLanHttpsProvider({
        ...checked,
        publicOrigin: "https://other.test",
      }),
    ).toThrow();
    expect(Object.isFrozen(checked)).toBe(true);
    expect(checked.publicOrigin).toBe(lanHttpsOrigin(provider.address, domain));
    expect(
      validateLanHttpsProvider({
        ...provider,
        lanDomain: "lan.custom.test",
        serverOrigin: "https://custom.test:8443",
        keylessFallback: false,
      }).publicOrigin,
    ).toBe("https://192-168-1-50.lan.custom.test");
    expect(
      validateLanHttpsProvider({ ...provider, provider: "akebi-keyless" })
        .provider,
    ).toBe("akebi-keyless");
    expect(() =>
      validateLanHttpsProvider({
        ...provider,
        provider: "akebi-keyless",
        keylessFallback: false,
      }),
    ).toThrow();
    expect(() =>
      validateLanHttpsProvider({ ...provider, registration: "open" }),
    ).toThrow();
    expect(() =>
      validateLanHttpsProvider({ ...provider, eabHmacKey: "excluded" }),
    ).toThrow();
  });
  it.each([
    "http://custom.test",
    "https://custom.test/",
    "https://user:secret@custom.test",
    "https://custom.test/a",
    "https://custom.test?x",
    "https://CUSTOM.test",
    " https://custom.test",
  ])("requires an exact secure server origin: %s", (serverOrigin) => {
    expect(() =>
      validateLanHttpsProvider({ ...provider, serverOrigin }),
    ).toThrow();
  });
  it("puts registration policy on the server and bounds temporary state", () => {
    for (const registration of ["open", "invite"]) {
      const checked = validateLanHttpsAuthorityPolicy({
        ...policy,
        registration,
      });
      expect(checked.registration).toBe(registration);
      expect(Object.isFrozen(checked.limits)).toBe(true);
      expect(checked.limits.maxInstallations).toBeGreaterThan(0);
    }
    for (const limits of [
      { maxNonces: 0 },
      { nonceTtlMs: Infinity },
      { maxInstallations: 1.5 },
      { maxChallenges: 1, maxChallengesPerInstallation: 2 },
      { arbitrary: 1 },
    ])
      expect(() =>
        validateLanHttpsAuthorityPolicy({ ...policy, limits }),
      ).toThrow();
    expect(() =>
      validateLanHttpsAuthorityPolicy({
        ...policy,
        registration: "client-decides",
      }),
    ).toThrow();
    const getter = vi.fn(() => "open");
    expect(() =>
      validateLanHttpsAuthorityPolicy(
        Object.defineProperty({ ...policy }, "registration", { get: getter }),
      ),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("installation request proof", () => {
  function fixture() {
    const key = generateKeyPairSync("ed25519");
    const exported = key.publicKey.export({ format: "jwk" });
    const publicKey = { kty: "OKP", crv: "Ed25519", x: exported.x };
    const input = {
      audience: provider.serverOrigin,
      nonce: randomBytes(32).toString("base64url"),
      path: "/v1/enroll",
      body: Buffer.from('{"address":"192.168.1.50"}'),
    };
    return {
      key,
      publicKey,
      input,
      proof: createLanHttpsProof(key.privateKey, input),
    };
  }
  it("binds the public identity, server nonce, exact body, API path and authority", () => {
    const f = fixture();
    expect(verifyLanHttpsProof(f.publicKey, f.proof, f.input)).toEqual(
      lanHttpsPublicIdentity(f.publicKey),
    );
    for (const change of [
      { audience: "https://another.test" },
      { nonce: randomBytes(32).toString("base64url") },
      { path: "/v1/challenge/present" },
      { body: Buffer.from('{"address":"192.168.1.51"}') },
    ])
      expect(() =>
        verifyLanHttpsProof(f.publicKey, f.proof, { ...f.input, ...change }),
      ).toThrow();
    expect(() =>
      verifyLanHttpsProof(fixture().publicKey, f.proof, f.input),
    ).toThrow();
  });
  it("rejects private-key material, alternate encodings and oversized requests", () => {
    const f = fixture();
    expect(() =>
      lanHttpsPublicIdentity(f.key.privateKey.export({ format: "jwk" })),
    ).toThrow();
    for (const change of [
      { signature: f.proof.signature + "=" },
      { installationId: "0".repeat(64) },
      { signature: "a".repeat(86) },
    ])
      expect(() =>
        verifyLanHttpsProof(f.publicKey, { ...f.proof, ...change }, f.input),
      ).toThrow();
    for (const change of [
      { nonce: "short" },
      { path: "/v1/enroll?x=1" },
      { body: Buffer.alloc(65537) },
    ])
      expect(() =>
        createLanHttpsProof(f.key.privateKey, { ...f.input, ...change }),
      ).toThrow();
  });
});
