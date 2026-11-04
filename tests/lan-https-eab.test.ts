import { describe, expect, it } from "vitest";
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalLanHttpsAcmePublicKey,
  createLanHttpsExternalAccountBinding,
  lanHttpsAcmeAccountId,
} from "../deploy/lan-https/eab.mjs";
import { LanHttpsAuthorityStore } from "../deploy/lan-https/authority-store.mjs";
import { createLanHttpsProof } from "../deploy/lan-https/proof.mjs";

const publicKey = () =>
  canonicalLanHttpsAcmePublicKey(
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
      format: "jwk",
    }),
  );
const credentials = () => ({
  id: "zerossl",
  newAccountUrl: "https://acme.example.test/new-account",
  kid: "fixture-account",
  hmacKey: randomBytes(32).toString("base64url"),
});

describe("authority-owned EAB credential boundary", () => {
  it("returns the RFC 8555 binding of a single public key and endpoint without revealing the HMAC key", () => {
    const key = publicKey(),
      config = credentials();
    const binding = createLanHttpsExternalAccountBinding(key, config);
    expect(
      JSON.parse(Buffer.from(binding.protected, "base64url").toString()),
    ).toEqual({ alg: "HS256", kid: config.kid, url: config.newAccountUrl });
    expect(
      JSON.parse(Buffer.from(binding.payload, "base64url").toString()),
    ).toEqual(key);
    expect(binding.signature).toBe(
      createHmac("sha256", Buffer.from(config.hmacKey, "base64url"))
        .update(`${binding.protected}.${binding.payload}`)
        .digest("base64url"),
    );
    expect(JSON.stringify(binding)).not.toContain(config.hmacKey);
    expect(lanHttpsAcmeAccountId(key)).toHaveLength(43);
    expect(
      createLanHttpsExternalAccountBinding(publicKey(), config),
    ).not.toEqual(binding);
    expect(
      createLanHttpsExternalAccountBinding(key, {
        ...config,
        newAccountUrl: "https://other.test/new-account",
      }),
    ).not.toEqual(binding);
  });
  it("rejects private key fields, unsupported algorithms and malformed operator configuration", () => {
    const key = publicKey(),
      config = credentials();
    for (const change of [
      { d: "secret" },
      { crv: "P-384" },
      { kty: "RSA" },
      { x: key.x + "=" },
      { y: "a".repeat(42) },
    ])
      expect(() =>
        createLanHttpsExternalAccountBinding({ ...key, ...change }, config),
      ).toThrow();
    for (const change of [
      { newAccountUrl: "http://acme.test/new" },
      { newAccountUrl: "https://user:secret@acme.test/new" },
      { newAccountUrl: "https://acme.test/new?query=1" },
      { newAccountUrl: "https://acme.test/new#fragment" },
      { hmacKey: "short" },
      { hmacKey: config.hmacKey + "=" },
      { kid: "bad\nheader" },
    ])
      expect(() =>
        createLanHttpsExternalAccountBinding(key, { ...config, ...change }),
      ).toThrow();
  });
  it("requires enrollment and a fresh proof, binds only one account key per issuer, and does not expose a general signing endpoint", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const serverOrigin = "https://akebi.example.test";
      const store = new LanHttpsAuthorityStore({
        database,
        policy: {
          format: 1,
          serverOrigin,
          lanDomain: "lan.example.test",
          registration: "open",
        },
      });
      const identity = generateKeyPairSync("ed25519");
      const exported = identity.publicKey.export({ format: "jwk" });
      const jwk = { kty: "OKP", crv: "Ed25519", x: exported.x };
      const request = (path: string, value: object) => {
        const body = Buffer.from(JSON.stringify(value));
        const nonce = store.issueNonce(jwk).nonce;
        return {
          body,
          proof: createLanHttpsProof(identity.privateKey, {
            audience: serverOrigin,
            path,
            body,
            nonce,
          }),
        };
      };
      const config = credentials(),
        key = publicKey();
      const rejected = request("/v1/acme/bind", {
        issuer: config.id,
        publicKey: key,
      });
      expect(() =>
        store.bindAcmeAccount(rejected.body, rejected.proof, config),
      ).toThrow(/authentication_rejected/);
      const registration = request("/v1/enroll", { publicKey: jwk });
      store.enroll(registration.body, registration.proof);
      const r = request("/v1/acme/bind", { issuer: config.id, publicKey: key });
      const bound = store.bindAcmeAccount(r.body, r.proof, config);
      expect(bound.externalAccountBinding).toEqual(
        createLanHttpsExternalAccountBinding(key, config),
      );
      expect(() => store.bindAcmeAccount(r.body, r.proof, config)).toThrow(
        /authentication_rejected/,
      );
      const repeat = request("/v1/acme/bind", {
        issuer: config.id,
        publicKey: key,
      });
      expect(store.bindAcmeAccount(repeat.body, repeat.proof, config)).toEqual(
        bound,
      );
      const replaced = request("/v1/acme/bind", {
        issuer: config.id,
        publicKey: publicKey(),
      });
      expect(() =>
        store.bindAcmeAccount(replaced.body, replaced.proof, config),
      ).toThrow(/already_bound/);
      const arbitrary = request("/v1/acme/bind", {
        issuer: config.id,
        publicKey: key,
        newAccountUrl: "https://attacker.test/sign",
      });
      expect(() =>
        store.bindAcmeAccount(arbitrary.body, arbitrary.proof, config),
      ).toThrow(/invalid_request/);
      expect(
        JSON.stringify(
          database.prepare("SELECT * FROM authority_acme_accounts").all(),
        ),
      ).not.toContain(config.hmacKey);
      expect(
        database
          .prepare("SELECT count(*) AS count FROM authority_acme_accounts")
          .get()?.count,
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
