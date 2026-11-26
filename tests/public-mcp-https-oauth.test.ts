import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HttpsResponseError, type HttpsJsonClient } from "../apps/public-mcp-gateway/src/https-json.js";
import { createHttpsDispatch } from "../apps/public-mcp-gateway/src/https-dispatch.js";
import { HttpsCredentialKeys } from "../apps/public-mcp-gateway/src/https-credential-keys.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";
import type { RendererHttpsConnection } from "../apps/public-mcp-gateway/src/renderer-https-discovery.js";
import { RendererHttpsOAuth } from "../apps/public-mcp-gateway/src/renderer-https-oauth.js";

const origin = "https://renderer.example.com";
const redirect = "https://gateway.example.com/callback";
const clientId = "mcp_client_local";
const signal = new AbortController().signal;
const connection: RendererHttpsConnection = {
  issuer: origin,
  resource: `${origin}/mcp`,
  responseIncludesIssuer: true,
  authorizationEndpoint: `${origin}/oauth/authorize`,
  tokenEndpoint: `${origin}/oauth/token`,
  registrationEndpoint: `${origin}/oauth/register`,
};
const approved = {
  token_type: "Bearer",
  access_token: "test-access",
  refresh_token: "test-refresh",
  scope: "mcp:read",
  expires_in: 600,
};

describe("downstream HTTPS OAuth", () => {
  it.each([true, false])("refreshes after a stale access token and only repeats reads (%s)", async (readOnly) => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      store.putVerifiedInstance({ id: "instance", publicKey: "fixture" });
      const profile = store.profileFor("instance", "user");
      const transport = store.addTransport("instance", { kind: "https", mcpUrl: connection.resource });
      const key = Buffer.alloc(32, 4);
      const keys = new HttpsCredentialKeys("test", new Map([["test", key]]));
      const authorization = store.createAuthorization(
        {
          profileId: profile.id, transportId: transport.id, localGrantId: "fixture",
          expiresAt: 120_000, scopes: ["mcp:read", "mcp:render"],
        },
        0,
        (id) => keys.seal(id, {
          clientId, accessToken: "stale-token", refreshToken: "test-refresh",
          scopes: ["mcp:read", "mcp:render"], expiresAt: 50_000,
        }),
      );
      const request = vi.fn<HttpsJsonClient>()
        .mockRejectedValueOnce(new HttpsResponseError(401))
        .mockResolvedValueOnce({ ...approved, scope: "mcp:read mcp:render" })
        .mockResolvedValueOnce({ accepted: true });
      const { dispatch } = createHttpsDispatch({
        store, keys, request, maxResponseBytes: 8192, timeoutMs: 2000, clock: () => 1000,
      });
      const outcome = dispatch({
        authorization, transport, signal,
        operation: { method: "tools/call", name: readOnly ? "get_renderer_capabilities" : "create_project", arguments: {} },
      });
      if (readOnly) {
        await expect(outcome).resolves.toEqual({ accepted: true });
        expect(request.mock.calls[2]?.[0].bearer).toBe(approved.access_token);
      } else {
        await expect(outcome).rejects.toMatchObject({ code: "outcome_unknown" });
        expect(request).toHaveBeenCalledTimes(2);
      }
      expect(request.mock.calls[1]?.[0].url.href).toBe(connection.tokenEndpoint);
      expect(store.authorization(authorization.id)?.reauthRequired).toBe(false);
    } finally {
      store.close();
    }
  });
  it("registers the gateway callback and exchanges a bound code for scoped credentials", async () => {
    let now = 0;
    const request = vi
      .fn<HttpsJsonClient>()
      .mockResolvedValueOnce({
        client_id: clientId,
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      })
      .mockImplementationOnce(() => {
        now = 30_000;
        return Promise.resolve(approved);
      });
    const oauth = new RendererHttpsOAuth(connection, 8192, request, () => now);
    expect(await oauth.registerClient(redirect, signal)).toBe(clientId);
    const attempt = oauth.authorize(clientId, redirect, [
      "mcp:read",
      "mcp:render",
    ]);
    const authorization = new URL(attempt.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe(
      connection.authorizationEndpoint,
    );
    expect(authorization.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(attempt.verifier).digest("base64url"),
    );
    expect(authorization.searchParams.get("scope")).toBe("mcp:read mcp:render");
    expect(attempt.verifier).not.toBe(attempt.state);
    const callback = new URL(redirect);
    callback.search = new URLSearchParams({
      state: attempt.state,
      iss: origin,
      code: "test-code",
    }).toString();
    const result = await oauth.exchange(attempt, callback, signal);
    expect(result).toEqual({
      clientId,
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: 600_000,
      scopes: ["mcp:read"],
    });
    const tokenRequest = request.mock.calls[1]?.[0];
    expect(tokenRequest).toMatchObject({
      trustedOrigin: origin,
      url: new URL(connection.tokenEndpoint),
    });
    expect(tokenRequest?.bearer).toBeUndefined();
    expect(
      Object.fromEntries(new URLSearchParams(tokenRequest?.body?.text)),
    ).toEqual({
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code_verifier: attempt.verifier,
      code: "test-code",
      client_id: clientId,
      resource: connection.resource,
    });
  });

  it.each(["state", "iss", "callback"])(
    "rejects a mismatched %s before calling the token endpoint",
    async (field) => {
      const request = vi.fn<HttpsJsonClient>();
      const oauth = new RendererHttpsOAuth(connection, 8192, request);
      const attempt = oauth.authorize(clientId, redirect, ["mcp:read"]);
      const callback = new URL(
        field === "callback" ? `${redirect}/other` : redirect,
      );
      callback.search = new URLSearchParams({
        state: attempt.state,
        iss: origin,
        code: "test-code",
      }).toString();
      if (field !== "callback") callback.searchParams.set(field, "different");
      await expect(oauth.exchange(attempt, callback, signal)).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("does not let the downstream OAuth response expand scopes", async () => {
    const request = vi
      .fn<HttpsJsonClient>()
      .mockResolvedValue({ ...approved, scope: "mcp:read mcp:delete" });
    const oauth = new RendererHttpsOAuth(connection, 8192, request);
    await expect(
      oauth.refresh(
        {
          clientId,
          accessToken: "test-access",
          refreshToken: "test-refresh",
          expiresAt: 0,
          scopes: ["mcp:read"],
        },
        signal,
      ),
    ).rejects.toThrow("invalid permissions");
  });

  it("uses the renderer access token for get_profile and validates the matching reply", async () => {
    const request = vi.fn<HttpsJsonClient>().mockImplementation(({ body }) => {
      const rpc = JSON.parse(body?.text ?? "{}") as { id: string };
      return Promise.resolve({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { structuredContent: { id: "user-local" } },
      });
    });
    const oauth = new RendererHttpsOAuth(connection, 8192, request);
    expect(await oauth.getProfile("test-access", "2025-11-25", signal)).toEqual(
      { id: "user-local" },
    );
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      bearer: "test-access",
      trustedOrigin: origin,
      url: new URL(connection.resource),
    });
    request.mockResolvedValueOnce({
      jsonrpc: "2.0",
      id: "other",
      result: { structuredContent: { id: "user-other" } },
    });
    await expect(
      oauth.getProfile("test-access", "2025-11-25", signal),
    ).rejects.toThrow("verified profile");
  });
});
