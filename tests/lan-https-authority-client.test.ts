import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  createLanHttpsAuthorityClient,
  requestLanHttpsAuthorityJson,
} from "../deploy/lan-https/authority-client.mjs";
import type { LanHttpsAuthorityTransport } from "../deploy/lan-https/authority-client.mjs";
import type { LanHttpsProof } from "../deploy/lan-https/proof.mjs";
import { LanHttpsAuthorityStore } from "../deploy/lan-https/authority-store.mjs";
import {
  canonicalLanHttpsAcmePublicKey,
  createLanHttpsExternalAccountBinding,
} from "../deploy/lan-https/eab.mjs";

const provider = {
  format: 1,
  provider: "akebi-local-acme",
  serverOrigin: "https://akebi.example.test",
  lanDomain: "lan.example.test",
  address: "192.168.1.50",
  keylessFallback: true,
};
function fixture() {
  const database = new DatabaseSync(":memory:");
  const store = new LanHttpsAuthorityStore({
    database,
    policy: {
      format: 1,
      registration: "open",
      serverOrigin: provider.serverOrigin,
      lanDomain: provider.lanDomain,
    },
  });
  const config = {
    id: "zerossl",
    directoryUrl: "https://acme.example.test/directory",
    newAccountUrl: "https://acme.example.test/new-account",
    kid: "fixture",
    hmacKey: randomBytes(32).toString("base64url"),
  };
  const calls: string[] = [];
  const transport: LanHttpsAuthorityTransport = (url, options) =>
    Promise.resolve().then(() => {
      expect(url.origin).toBe(provider.serverOrigin);
      if (url.pathname === "/.well-known/latex-renderer-lan-https")
        return {
          status: 200,
          body: {
            format: 1,
            serverOrigin: provider.serverOrigin,
            lanDomain: provider.lanDomain,
            registration: "open",
            proofAlgorithm: "Ed25519",
            issuers: [
              {
                id: config.id,
                directoryUrl: config.directoryUrl,
                newAccountUrl: config.newAccountUrl,
              },
            ],
          },
        };
      const body = options.body;
      if (!body) throw new Error("Expected JSON request");
      calls.push(body.toString());
      const parsed = JSON.parse(body.toString()) as { publicKey: unknown };
      if (url.pathname === "/v1/nonce")
        return { status: 200, body: store.issueNonce(parsed.publicKey) };
      const header = options.headers?.["x-latex-renderer-lan-proof"];
      if (!header) throw new Error("Expected signed request");
      const proof = JSON.parse(
        Buffer.from(header, "base64url").toString(),
      ) as LanHttpsProof;
      switch (url.pathname) {
        case "/v1/enroll":
          return { status: 200, body: store.enroll(body, proof) };
        case "/v1/acme/bind":
          return {
            status: 200,
            body: store.bindAcmeAccount(body, proof, config),
          };
        case "/v1/challenge/present":
          return { status: 200, body: store.presentChallenge(body, proof) };
        case "/v1/challenge/remove":
          return { status: 200, body: store.removeChallenge(body, proof) };
        default:
          return { status: 404, body: {} };
      }
    });
  const identity = generateKeyPairSync("ed25519");
  const client = createLanHttpsAuthorityClient({
    provider,
    identityKey: identity.privateKey,
    transport,
  });
  return { client, database, store, config, calls, identity, transport };
}

describe("installation client with authority-owned EAB", () => {
  it("enrolls, binds a private-key-free account, and presents/removes a DNS challenge", async () => {
    const f = fixture();
    try {
      expect((await f.client.metadata()).registration).toBe("open");
      expect((await f.client.enroll()).created).toBe(true);
      expect((await f.client.enroll()).created).toBe(false);
      const acme = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const publicKey = canonicalLanHttpsAcmePublicKey(
        acme.publicKey.export({ format: "jwk" }),
      );
      expect(await f.client.bindAcmeAccount("zerossl", publicKey)).toEqual(
        createLanHttpsExternalAccountBinding(publicKey, f.config),
      );
      const challenge = await f.client.presentChallenge(
        "192-168-1-50.lan.example.test",
        randomBytes(32).toString("base64url"),
      );
      expect(f.store.counts().challenges).toBe(1);
      expect(await f.client.removeChallenge(challenge.id)).toEqual({
        removed: true,
      });
      expect(f.store.counts().challenges).toBe(0);
      const wire = f.calls.join("\n");
      expect(wire).not.toContain(f.config.hmacKey);
      expect(wire).not.toContain("PRIVATE KEY");
      expect(wire).not.toContain('"d":');
    } finally {
      f.database.close();
    }
  });
  it("rejects a provider metadata change, disabled issuer and binding to a different account key", async () => {
    const f = fixture();
    try {
      const mismatched = createLanHttpsAuthorityClient({
        provider: { ...provider, lanDomain: "other.test" },
        identityKey: f.identity.privateKey,
        transport: f.transport,
      });
      await expect(mismatched.metadata()).rejects.toThrow(/does not match/);
      await f.client.enroll();
      const key = canonicalLanHttpsAcmePublicKey(
        generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
        }).publicKey.export({ format: "jwk" }),
      );
      await expect(
        f.client.bindAcmeAccount("unconfigured", key),
      ).rejects.toThrow(/not configured/);
      const substituted: LanHttpsAuthorityTransport = async (url, options) => {
        if (url.pathname === "/v1/acme/bind")
          return {
            status: 200,
            body: {
              issuer: "zerossl",
              externalAccountBinding: createLanHttpsExternalAccountBinding(
                canonicalLanHttpsAcmePublicKey(
                  generateKeyPairSync("ec", {
                    namedCurve: "prime256v1",
                  }).publicKey.export({ format: "jwk" }),
                ),
                f.config,
              ),
            },
          };
        return f.transport(url, options);
      };
      const other = createLanHttpsAuthorityClient({
        provider,
        identityKey: f.identity.privateKey,
        transport: substituted,
      });
      await expect(other.bindAcmeAccount("zerossl", key)).rejects.toThrow(
        /mismatched/,
      );
    } finally {
      f.database.close();
    }
  });
  it("rejects transport errors without disclosing provider response contents", async () => {
    const identity = generateKeyPairSync("ed25519");
    const client = createLanHttpsAuthorityClient({
      provider,
      identityKey: identity.privateKey,
      transport: () =>
        Promise.resolve({
          status: 403,
          body: { error: "sensitive-provider-message" },
        }),
    });
    await expect(client.enroll()).rejects.toThrow(
      "LAN HTTPS authority rejected the request",
    );
    await expect(
      requestLanHttpsAuthorityJson(new URL("http://example.test"), {
        method: "GET",
      }),
    ).rejects.toThrow(/requires HTTPS/);
  });
});
