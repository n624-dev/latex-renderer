import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessTokenLifetimeMs,
  authorizationLifetimeMs,
  GatewayOAuthTokens,
  validateOAuthAuthorizationRequest,
} from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

const issuer = "https://gateway.example.com";
const resource = `${issuer}/mcp`;
const redirectUri = "https://client.example.com/oauth/callback";
const client = { id: "test-client", redirectUris: [redirectUri] };
const verifier = "a".repeat(43);
const request = new URLSearchParams({
  client_id: client.id,
  redirect_uri: redirectUri,
  resource,
  response_type: "code",
  code_challenge_method: "S256",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  state: "example-state",
});
const key = Buffer.alloc(32, 7);
const start = 1_800_000_000_000;

function setup(store: SqliteConnectionStore, clock: () => number) {
  store.putVerifiedInstance({ id: "instance", publicKey: "instance-key" });
  const profile = store.profileFor("instance", "local-user");
  const transport = store.addTransport("instance", {
    kind: "agent",
    publicKey: "agent-key",
  });
  const auth = store.createAuthorization(
    {
      profileId: profile.id,
      transportId: transport.id,
      localGrantId: "local-grant",
      scopes: ["mcp:read", "mcp:render"],
      expiresAt: clock() + authorizationLifetimeMs,
    },
    clock(),
  );
  const tokens = new GatewayOAuthTokens(
    issuer,
    store.oauth,
    key,
    300_000,
    clock,
  );
  const authorization = validateOAuthAuthorizationRequest(
    request,
    client,
    resource,
  );
  const consent = tokens.beginConsent(authorization, {
    lifetimeMs: 300_000,
    capacity: 10,
  });
  const callback = tokens.completeConsent(
    consent,
    authorization,
    auth.id,
    auth.scopes,
  );
  const form = new URLSearchParams({
    code: callback.searchParams.get("code") ?? "",
    code_verifier: verifier,
    resource,
    redirect_uri: redirectUri,
  });
  return { auth, tokens, callback, form };
}

function refreshForm(token: string, scope?: string) {
  return new URLSearchParams({
    refresh_token: token,
    resource,
    ...(scope === undefined ? {} : { scope }),
  });
}

describe("public OAuth grants and token rotation", () => {
  it("binds the request and final consent to the starting browser", () => {
    using store = disposableStore();
    let now = start;
    const tokens = new GatewayOAuthTokens(
      issuer,
      store.value.oauth,
      key,
      300_000,
      () => now,
    );
    const authorization = validateOAuthAuthorizationRequest(
      request,
      client,
      resource,
    );
    const limits = { lifetimeMs: 500, capacity: 1 };
    const consent = tokens.beginConsent(authorization, limits);
    expect(() => tokens.beginConsent(authorization, limits)).toThrow();
    expect(() =>
      tokens.denyConsent(
        { ...consent, browserSecret: "different" },
        authorization,
      ),
    ).toThrow();
    expect(() =>
      tokens.denyConsent(consent, { ...authorization, state: "changed" }),
    ).toThrow();
    const denial = tokens.denyConsent(consent, authorization);
    expect(denial.searchParams.get("error")).toBe("access_denied");
    expect(denial.searchParams.get("iss")).toBe(issuer);
    expect(denial.searchParams.get("state")).toBe(authorization.state);
    expect(() => tokens.denyConsent(consent, authorization)).toThrow();
    const expiring = tokens.beginConsent(authorization, limits);
    now += limits.lifetimeMs;
    expect(() => tokens.denyConsent(expiring, authorization)).toThrow();
    expect(() => tokens.beginConsent(authorization, limits)).not.toThrow();
  });

  it("preserves state and the issuer, and binds one authorization code to client, callback, PKCE and resource", () => {
    using store = disposableStore();
    const { tokens, callback, form } = setup(store.value, () => start);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("example-state");
    expect(callback.searchParams.get("iss")).toBe(issuer);
    expect(() => tokens.exchangeCode("other-client", form)).toThrow();
    for (const [field, wrong] of [
      ["redirect_uri", `${redirectUri}/`],
      ["resource", `${resource}/`],
      ["code_verifier", "b".repeat(43)],
    ] as const) {
      const invalid = new URLSearchParams(form);
      invalid.set(field, wrong);
      expect(() => tokens.exchangeCode(client.id, invalid)).toThrow();
    }
    const response = tokens.exchangeCode(client.id, form);
    expect(response).toMatchObject({
      scope: "mcp:read mcp:render",
      expires_in: 600,
    });
    expect(() => tokens.exchangeCode(client.id, form)).toThrow();
  });

  it("keeps both refresh replies and scopes consistent across a restart, then revokes on old token reuse", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-mcp-oauth-"));
    const path = join(dir, "gateway.sqlite");
    try {
      let now = start;
      const timer = () => now;
      let previous: ReturnType<GatewayOAuthTokens["exchangeCode"]>;
      let first: ReturnType<GatewayOAuthTokens["refresh"]>;
      let authId: string;
      {
        using store = disposableStore(path);
        const { tokens, form, auth } = setup(store.value, timer);
        authId = auth.id;
        previous = tokens.exchangeCode(client.id, form);
        now += accessTokenLifetimeMs;
        expect(tokens.authenticate(previous.access_token)).toBeUndefined();
        expect(() =>
          tokens.refresh(
            client.id,
            refreshForm(previous.refresh_token, "mcp:delete"),
          ),
        ).toThrow();
        first = tokens.refresh(
          client.id,
          refreshForm(previous.refresh_token, "mcp:read"),
        );
        expect(tokens.authenticate(first.access_token)?.scopes).toEqual([
          "mcp:read",
        ]);
        expect(() =>
          tokens.refresh(client.id, refreshForm(previous.refresh_token)),
        ).toThrow();
      }
      using store = disposableStore(path);
      const restarted = new GatewayOAuthTokens(
        issuer,
        store.value.oauth,
        key,
        300_000,
        timer,
      );
      expect(
        restarted.refresh(
          client.id,
          refreshForm(previous.refresh_token, "mcp:read"),
        ),
      ).toEqual(first);
      expect(() =>
        restarted.refresh(
          client.id,
          refreshForm(first.refresh_token, "mcp:render"),
        ),
      ).toThrow();
      const next = restarted.refresh(
        client.id,
        refreshForm(first.refresh_token),
      );
      now += 30_000;
      expect(() =>
        restarted.refresh(
          client.id,
          refreshForm(previous.refresh_token, "mcp:read"),
        ),
      ).toThrow();
      expect(store.value.authorization(authId)?.revokedAt).toBe(now);
      expect(restarted.authenticate(next.access_token)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the 30-day family deadline after rotation and rejects tokens after a restore", () => {
    using store = disposableStore();
    let now = start;
    const { tokens, form, auth } = setup(store.value, () => now);
    const issued = tokens.exchangeCode(client.id, form);
    now = auth.expiresAt - 2000;
    const last = tokens.refresh(client.id, refreshForm(issued.refresh_token));
    expect(last.expires_in).toBe(2);
    expect(tokens.authenticate(last.access_token)?.id).toBe(auth.id);
    store.value.invalidateRestoredAuthorizations(now);
    expect(tokens.authenticate(last.access_token)).toBeUndefined();
    expect(() =>
      tokens.refresh(client.id, refreshForm(last.refresh_token)),
    ).toThrow();
  });

  it.each([
    { scope: "mcp" },
    { scope: "" },
    { code_challenge_method: "plain" },
    { redirect_uri: `${redirectUri}/` },
  ])("rejects invalid incoming authorization requests", (change) => {
    const invalid = new URLSearchParams(request);
    for (const [key, value] of Object.entries(change)) invalid.set(key, value);
    expect(() =>
      validateOAuthAuthorizationRequest(invalid, client, resource),
    ).toThrow();
  });
});

function disposableStore(path = ":memory:") {
  const value = new SqliteConnectionStore(path);
  return { value, [Symbol.dispose]: () => value.close() };
}
