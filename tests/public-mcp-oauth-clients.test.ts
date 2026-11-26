import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  jwtClientAssertionType,
  parseDcrClientRegistration,
  readCimdClient,
  verifyCimdClientAssertion,
} from "../apps/public-mcp-gateway/src/oauth-clients.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

const clientId = "https://client.example.com/oauth/client.json";
const jwksUri = "https://client.example.com/oauth/jwks.json";
const redirect = "https://client.example.com/oauth/callback";
const allow = new Set([redirect]);
const trust = new Map([[clientId, { redirectUris: allow, jwksUri }]]);
const limits = { signal: new AbortController().signal, maxResponseBytes: 4096 };
const client = {
  id: clientId,
  jwksUri,
  redirectUris: [redirect],
  clientName: "Chat Client",
};
const metadata = {
  client_id: clientId,
  client_name: client.clientName,
  redirect_uris: [redirect],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_signing_alg: "RS256",
  grant_types: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  ],
  response_types: ["code"],
  jwks_uri: jwksUri,
};

describe("public OAuth client validation", () => {
  it("accepts dynamic registration for an explicitly approved callback", () => {
    expect(
      parseDcrClientRegistration(
        {
          client_name: "Chat Client",
          redirect_uris: [redirect],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none",
        },
        allow,
      ),
    ).toEqual({ clientName: "Chat Client", redirectUris: [redirect] });
  });

  it.each([
    { redirect_uris: [`${redirect}/`] },
    { redirect_uris: [redirect, "https://other.example.com/oauth/callback"] },
    { grant_types: ["client_credentials"] },
    { token_endpoint_auth_method: "none-else" },
  ])("rejects unsupported DCR registrations", (change) => {
    expect(() =>
      parseDcrClientRegistration(
        { redirect_uris: [redirect], ...change },
        allow,
      ),
    ).toThrow();
  });

  it("reads the exact trusted CIMD document and requires the configured callback and key URI", async () => {
    const request = vi.fn().mockResolvedValue(metadata);
    expect(await readCimdClient(clientId, trust, limits, request)).toEqual(
      client,
    );
    expect(request).toHaveBeenCalledWith({
      url: new URL(clientId),
      trustedOrigin: new URL(clientId).origin,
      ...limits,
    });
    request.mockClear();
    await expect(
      readCimdClient(
        "https://unknown.example.com/client.json",
        trust,
        limits,
        request,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { client_id: "https://another.example.com/oauth/client.json" },
    { redirect_uris: [`${redirect}/`] },
    { jwks_uri: "https://another.example.com/oauth/jwks.json" },
    { token_endpoint_auth_methods_supported: ["none"] },
  ])("rejects incompatible CIMD documents", async (change) => {
    const request = vi.fn().mockResolvedValue({ ...metadata, ...change });
    await expect(
      readCimdClient(clientId, trust, limits, request),
    ).rejects.toThrow();
  });
});

describe("CIMD token endpoint assertions", () => {
  const audience = "https://gateway.example.com/oauth/token";
  const now = 1_800_000_000_000;
  let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwk: Awaited<ReturnType<typeof exportJWK>>;
  let store: SqliteConnectionStore | undefined;

  beforeAll(async () => {
    keyPair = await generateKeyPair("RS256");
    jwk = {
      ...(await exportJWK(keyPair.publicKey)),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
  });
  afterEach(() => {
    store?.close();
    store = undefined;
  });

  async function verify({
    checkAudience = audience,
    issuer = clientId,
    subject = clientId,
    lifetimeSeconds = 60,
    kid = "test-key",
    jti = "request-identifier",
  } = {}) {
    const sqlite = (store ??= new SqliteConnectionStore(":memory:"));
    const assertion = await new SignJWT({})
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(checkAudience)
      .setIssuedAt(now / 1000)
      .setExpirationTime(now / 1000 + lifetimeSeconds)
      .setJti(jti)
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(keyPair.privateKey);
    await verifyCimdClientAssertion(
      client,
      new URLSearchParams({
        client_assertion: assertion,
        client_assertion_type: jwtClientAssertionType,
        client_id: clientId,
      }),
      {
        ...limits,
        now,
        audience,
        maxLifetimeSeconds: 120,
        claimAssertion: (hash, expiresAt, time) =>
          sqlite.claimClientAssertion(hash, expiresAt, time),
      },
      vi.fn().mockResolvedValue({ keys: [jwk] }),
    );
  }

  it("checks the signature and accepts an assertion only once", async () => {
    await expect(verify()).resolves.toBeUndefined();
    await expect(verify()).rejects.toThrow("could not be verified");
    await expect(verify({ jti: "a-new-assertion" })).resolves.toBeUndefined();
  });

  it.each([
    { checkAudience: "https://another-gateway.example.com/oauth/token" },
    { issuer: "https://another.example.com/oauth/client.json" },
    { subject: "https://another.example.com/oauth/client.json" },
    { lifetimeSeconds: -1 },
    { lifetimeSeconds: 121 },
    { kid: "wrong-key" },
  ])("rejects a mismatched or expired assertion", async (change) => {
    await expect(verify(change)).rejects.toThrow("could not be verified");
    await expect(verify()).resolves.toBeUndefined();
  });
});
