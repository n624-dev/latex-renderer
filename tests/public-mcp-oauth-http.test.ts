import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGatewayOAuthHandler } from "../apps/public-mcp-gateway/src/oauth-http.js";
import {
  authorizationLifetimeMs,
  GatewayOAuthTokens,
} from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";
import { dcrClientRetentionMs } from "../apps/public-mcp-gateway/src/oauth-clients.js";

const issuer = "https://gateway.example.com";
const resource = `${issuer}/mcp`;
const redirect = "https://client.example.com/oauth/callback";
const clientDocument = "https://client.example.com/oauth/client.json";
const verifier = "x".repeat(43);

describe("central OAuth HTTP protocol", () => {
  it("discovers both client methods, registers a client and issues resource-bound tokens", async () => {
    using fixture = createFixture();
    const metadata = await fixture.handle(
      new Request(`${issuer}/.well-known/oauth-authorization-server`),
    );
    expect(await metadata?.json()).toMatchObject({
      issuer,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    });
    expect(metadata?.headers.get("Cache-Control")).toBe("no-store");
    const raw = await fixture.handle(
      post(
        "/oauth/register",
        "application/json",
        JSON.stringify({
          client_name: "Review Client",
          redirect_uris: [redirect],
        }),
      ),
    );
    expect(raw?.status).toBe(201);
    const { client_id } = (await raw?.json()) as { client_id: string };
    const inquiry = new URLSearchParams({
      client_id,
      redirect_uri: redirect,
      resource,
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state: "original",
    });
    const consent = await fixture.handle(
      new Request(`${issuer}/oauth/authorize?${inquiry}`),
    );
    expect(consent?.status).toBe(200);
    expect(fixture.consentUrl()?.searchParams.get("state")).toBe("original");
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      redirect_uri: redirect,
      resource,
      code: fixture.consentUrl()?.searchParams.get("code") ?? "",
      code_verifier: verifier,
    });
    const response = await fixture.handle(
      post(
        "/oauth/token",
        "application/x-www-form-urlencoded",
        form.toString(),
      ),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      expires_in: 600,
      scope: "mcp:read mcp:render",
    });
    fixture.store.pruneExpiredCredentials(fixture.now + dcrClientRetentionMs);
    expect(fixture.store.dcrClient(client_id)).toBeDefined();
    const reused = await fixture.handle(
      post(
        "/oauth/token",
        "application/x-www-form-urlencoded",
        form.toString(),
      ),
    );
    expect(await reused?.json()).toEqual({ error: "invalid_grant" });
  });

  it("reclaims unused DCR registration capacity at the seven-day boundary", () => {
    using fixture = createFixture();
    const registration = { clientName: "Review Client", redirectUris: [redirect] };
    const issued = fixture.store.registerDcrClient(registration, 1, fixture.now);
    expect(issued).toBeDefined();
    expect(fixture.store.registerDcrClient(registration, 1, fixture.now + dcrClientRetentionMs - 1)).toBeUndefined();
    const replacement = fixture.store.registerDcrClient(registration, 1, fixture.now + dcrClientRetentionMs);
    expect(replacement?.id).toBeDefined();
    expect(replacement?.id).not.toBe(issued?.id);
  });

  it("rejects unauthorised callbacks, duplicate grants and cross-origin consent", async () => {
    using fixture = createFixture();
    const invalid = await fixture.handle(
      post(
        "/oauth/register",
        "application/json",
        JSON.stringify({ redirect_uris: ["https://wrong.example.com/"] }),
      ),
    );
    expect(await invalid?.json()).toEqual({ error: "invalid_client_metadata" });
    const duplicate = await fixture.handle(
      post(
        "/oauth/token",
        "application/x-www-form-urlencoded",
        "grant_type=authorization_code&grant_type=refresh_token",
      ),
    );
    expect(await duplicate?.json()).toEqual({ error: "invalid_request" });
    const noOrigin = await fixture.handle(
      post(
        "/oauth/authorize",
        "application/x-www-form-urlencoded",
        "decision=approve",
      ),
    );
    expect(noOrigin?.status).toBe(403);
  });

  it("limits registrations while keeping an existing client available", async () => {
    using fixture = createFixture();
    const register = () =>
      fixture.handle(
        post(
          "/oauth/register",
          "application/json",
          JSON.stringify({ redirect_uris: [redirect] }),
        ),
      );
    const first = await register();
    const { client_id } = (await first?.json()) as { client_id: string };
    expect((await register())?.status).toBe(503);
    expect(fixture.store.dcrClient(client_id)?.redirectUris).toEqual([
      redirect,
    ]);
  });
});

function post(path: string, type: string, body: string): Request {
  return new Request(`${issuer}${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });
}

function createFixture() {
  const store = new SqliteConnectionStore(":memory:");
  const now = 1_800_000_000_000;
  const tokens = new GatewayOAuthTokens(
    issuer,
    store.oauth,
    Buffer.alloc(32, 9),
    300_000,
    () => now,
  );
  store.putVerifiedInstance({ id: "instance", publicKey: "instance-key" });
  const profile = store.profileFor("instance", "local-user");
  const transport = store.addTransport("instance", {
    kind: "agent",
    publicKey: "agent-key",
  });
  let callback: URL | undefined;
  const handle = createGatewayOAuthHandler({
    tokens,
    clients: store,
    dcrRedirectUris: new Set([redirect]),
    dcrCapacity: 1,
    cimdClients: new Map([
      [
        clientDocument,
        {
          redirectUris: new Set([redirect]),
          jwksUri: "https://client.example.com/oauth/jwks.json",
        },
      ],
    ]),
    maxBodyBytes: 4096,
    maxMetadataBytes: 8192,
    networkTimeoutMs: 1000,
    assertionLifetimeSeconds: 120,
    allowRegistration: () => true,
    claimAssertion: (hash, expiresAt, time) =>
      store.claimClientAssertion(hash, expiresAt, time),
    // The transport's local approval is represented by a test-only callback.
    showConsent: (_request, authorization) => {
      const consent = tokens.beginConsent(authorization, {
        lifetimeMs: 1000,
        capacity: 1,
      });
      const approved = store.createAuthorization(
        {
          profileId: profile.id,
          transportId: transport.id,
          localGrantId: "confirmed-local-grant",
          scopes: authorization.scopes,
          expiresAt: now + authorizationLifetimeMs,
        },
        now,
      );
      callback = tokens.completeConsent(
        consent,
        authorization,
        approved.id,
        approved.scopes,
      );
      return Promise.resolve(new Response("confirmed"));
    },
    submitConsent: () => Promise.resolve(new Response(null, { status: 200 })),
  });
  return {
    store,
    now,
    handle,
    consentUrl: () => callback,
    [Symbol.dispose]: () => store.close(),
  };
}
