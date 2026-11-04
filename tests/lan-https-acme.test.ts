import { afterEach, describe, expect, it } from "vitest";
import acme from "acme-client";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  issueLanHttpsCertificate,
  validateLanHttpsIssuedCertificate,
  createLanHttpsAcmeSession,
} from "../deploy/lan-https/acme.mjs";
import { lanCertificateFixture } from "./fixtures/lan-https.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
async function fixture() {
  const f = await lanCertificateFixture();
  cleanups.push(f.cleanup);
  return f;
}
function issueOptions(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    provider: f.provider,
    authority: f.authority,
    client: f.client,
    issuerId: "zerossl",
    accountKey: f.accountKey,
    tlsKey: f.tlsKey,
    termsAccepted: true,
    saveAccount: () => {
      f.events.push("save");
      return Promise.resolve();
    },
    verifyCertificate: async (
      input: Parameters<typeof validateLanHttpsIssuedCertificate>[0],
    ) =>
      validateLanHttpsIssuedCertificate({
        ...input,
        trustedCertificates: [f.root.certificate.toString()],
      }),
  };
}

describe("local-key ACME issuance", () => {
  it("builds a CSR containing only the IP-derived and independent management names", async () => {
    const f = await fixture();
    const domains = acme.crypto.readCsrDomains(f.request.csr);
    expect(domains.altNames).toEqual(f.request.hostnames);
    expect(f.request.hostnames[0]).toBe("192-168-1-50.lan.example.test");
    expect(f.request.hostnames[0]).not.toContain(f.id);
    expect(createPublicKey(f.tlsKey).asymmetricKeyType).toBe("ec");
  });
  it("persists the registered account before orders, verifies DNS, cleans TXT and checks a real TLS chain", async () => {
    const f = await fixture();
    const result = await issueLanHttpsCertificate(issueOptions(f));
    expect(result.certificate).toBe(f.certificate);
    expect(result.cleanupPending).toEqual([]);
    expect(result.accountUrl).toBe("https://acme.example.test/account");
    expect(f.events.slice(0, 4)).toEqual(["bind", "account", "save", "order"]);
    expect(f.events.filter((value) => value === "verify")).toHaveLength(2);
    expect(
      f.events.filter((value) => value.startsWith("remove:")),
    ).toHaveLength(2);
    expect(f.events.at(-1)).toBe("finalize");
  });
  it("rejects an untrusted chain, incorrect names and mismatched TLS key", async () => {
    const f = await fixture();
    const input = {
      certificate: f.certificate,
      privateKey: f.tlsKey,
      hostnames: f.request.hostnames,
      trustedCertificates: [f.root.certificate.toString()],
    };
    await expect(
      validateLanHttpsIssuedCertificate({ ...input, trustedCertificates: [] }),
    ).rejects.toThrow(/failed trust/);
    await expect(
      validateLanHttpsIssuedCertificate({
        ...input,
        hostnames: ["other.test", f.request.hostnames[1] ?? ""],
      }),
    ).rejects.toThrow(/failed trust/);
    await expect(
      validateLanHttpsIssuedCertificate({ ...input, privateKey: f.accountKey }),
    ).rejects.toThrow(/failed trust/);
  });
  it("does not proceed without terms acceptance or when account persistence fails", async () => {
    const f = await fixture();
    await expect(
      issueLanHttpsCertificate({ ...issueOptions(f), termsAccepted: false }),
    ).rejects.toThrow(/terms acceptance/);
    expect(f.events).toEqual([]);
    await expect(
      issueLanHttpsCertificate({
        ...issueOptions(f),
        saveAccount: () => Promise.reject(new Error("fixture ENOSPC")),
      }),
    ).rejects.toThrow(/existing certificate was retained/);
    expect(f.events).not.toContain("order");
  });
  it("cleans up after failed DNS verification and never finalizes the failed order", async () => {
    const f = await fixture();
    f.client.verifyChallenge = () =>
      Promise.reject(new Error("DNS unavailable"));
    await expect(issueLanHttpsCertificate(issueOptions(f))).rejects.toThrow(
      /existing certificate was retained/,
    );
    expect(f.events.some((event) => event.startsWith("remove:"))).toBe(true);
    expect(f.events).not.toContain("finalize");
  });
  it("reports cleanup to retry without discarding a successfully verified certificate", async () => {
    const f = await fixture();
    f.authority.removeChallenge = () =>
      Promise.reject(new Error("helper unavailable"));
    const result = await issueLanHttpsCertificate(issueOptions(f));
    expect(result.certificate).toBe(f.certificate);
    expect(result.cleanupPending).toHaveLength(2);
  });
  it("does not accept wildcard or substituted authorization names", async () => {
    const f = await fixture();
    const first = f.authorizations[0];
    if (!first) throw new Error("Missing fixture authorization");
    first.identifier.value = "outside.test";
    await expect(issueLanHttpsCertificate(issueOptions(f))).rejects.toThrow(
      /issuance failed/,
    );
    expect(f.events).not.toContain("verify");
    expect(f.events).not.toContain("finalize");
  });
  it("preserves Retry-After through the actual pinned client without leaking provider details or retrying inline", async () => {
    const f = await fixture();
    const session = await createLanHttpsAcmeSession({
      directoryUrl: "https://acme.example.test/directory",
      accountKey: f.accountKey,
      accountUrl: "https://acme.example.test/account",
    });
    const previous = acme.axios.defaults.adapter;
    let posts = 0;
    acme.axios.defaults.adapter = (config) => {
      const nonce = config.method === "head";
      const directory = config.url === "https://acme.example.test/directory";
      if (!nonce && !directory) posts++;
      return Promise.resolve({
        config,
        status: nonce || directory ? 200 : 429,
        statusText: "fixture",
        headers: nonce
          ? { "replay-nonce": "fixture-nonce" }
          : directory
            ? {}
            : { "retry-after": "86400" },
        data: directory
          ? {
              newNonce: "https://acme.example.test/nonce",
              newOrder: "https://acme.example.test/order",
            }
          : nonce
            ? ""
            : {
                type: "urn:ietf:params:acme:error:rateLimited",
                detail: "private provider diagnostic",
              },
      });
    };
    try {
      await expect(
        session.createOrder({
          identifiers: f.request.hostnames.map((value) => ({
            type: "dns",
            value,
          })),
        }),
      ).rejects.toMatchObject({
        message: "ACME authority deferred the operation",
        response: { headers: { "retry-after": "86400" } },
      });
      expect(posts).toBe(1);
    } finally {
      if (previous === undefined) delete acme.axios.defaults.adapter;
      else acme.axios.defaults.adapter = previous;
    }
  });
  it("constructs a bounded real ACME client without making a network request", async () => {
    const accountKey = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    }).privateKey;
    const session = await createLanHttpsAcmeSession({
      directoryUrl: "https://acme.example.test/directory",
      accountKey,
    });
    expect(session).toBeInstanceOf(acme.Client);
    expect(acme.axios.defaults.timeout).toBe(15000);
    expect(acme.axios.defaults.maxRedirects).toBe(0);
    expect(acme.axios.defaults.httpsAgent).toMatchObject({
      options: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      maxSockets: 2,
    });
    await expect(
      createLanHttpsAcmeSession({
        directoryUrl: "http://acme.example.test/directory",
        accountKey,
      }),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      createLanHttpsAcmeSession({
        directoryUrl: "https://acme.example.test/directory",
        accountKey,
        accountUrl: "https://other.test/account",
      }),
    ).rejects.toThrow(/another authority/);
  });
});
