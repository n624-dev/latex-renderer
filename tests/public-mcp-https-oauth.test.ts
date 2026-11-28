import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HttpsResponseError,
  type HttpsJsonClient,
} from "../apps/public-mcp-gateway/src/https-json.js";
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

const originalExpiry = 50_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function dispatchFixture(request: HttpsJsonClient, clock: () => number) {
  const store = new SqliteConnectionStore(":memory:");
  store.putVerifiedInstance({ id: "instance", publicKey: "fixture" });
  const profile = store.profileFor("instance", "user");
  const transport = store.addTransport("instance", {
    kind: "https",
    mcpUrl: connection.resource,
  });
  const key = Buffer.alloc(32, 4);
  const keys = new HttpsCredentialKeys("test", new Map([["test", key]]));
  const authorization = store.createAuthorization(
    {
      profileId: profile.id,
      transportId: transport.id,
      localGrantId: "fixture",
      expiresAt: 2_000_000,
      scopes: ["mcp:read", "mcp:render"],
    },
    0,
    (id) =>
      keys.seal(id, {
        clientId,
        accessToken: "stale-token",
        refreshToken: "test-refresh",
        scopes: ["mcp:read", "mcp:render"],
        expiresAt: originalExpiry,
      }),
  );
  const dispatcher = createHttpsDispatch({
    store,
    keys,
    request,
    maxResponseBytes: 8192,
    timeoutMs: 2000,
    clock,
  });
  return {
    store,
    authorization,
    call: (name = "get_renderer_capabilities") =>
      dispatcher.dispatch({
        authorization,
        transport,
        signal,
        operation: { method: "tools/call", name, arguments: {} },
      }),
    credentials: () => {
      const stored = store.httpsCredentials(authorization.id, clock());
      if (!stored) throw new Error("Missing stored HTTPS credentials");
      return {
        generation: stored.generation,
        ...keys.open(authorization.id, stored.envelope),
      };
    },
    [Symbol.dispose]: () => store.close(),
  };
}

describe("downstream HTTPS OAuth", () => {
  it.each([true, false])(
    "refreshes after a stale access token and only repeats reads (%s)",
    async (readOnly) => {
      const request = vi
        .fn<HttpsJsonClient>()
        .mockRejectedValueOnce(new HttpsResponseError(401))
        .mockResolvedValueOnce({ ...approved, scope: "mcp:read mcp:render" })
        .mockResolvedValueOnce({ accepted: true });
      using fixture = dispatchFixture(request, () => 1000);
      const { store, authorization } = fixture;
      const outcome = fixture.call(
        readOnly ? "get_renderer_capabilities" : "create_project",
      );
      if (readOnly) {
        await expect(outcome).resolves.toEqual({ accepted: true });
        expect(request.mock.calls[2]?.[0].bearer).toBe(approved.access_token);
      } else {
        await expect(outcome).rejects.toMatchObject({
          code: "outcome_unknown",
        });
        expect(request).toHaveBeenCalledTimes(2);
      }
      expect(request.mock.calls[1]?.[0].url.href).toBe(
        connection.tokenEndpoint,
      );
      expect(store.authorization(authorization.id)?.reauthRequired).toBe(false);
    },
  );
  it("uses the old token one millisecond before expiry and refreshes at the request-time boundary", async () => {
    let now = originalExpiry - 1;
    const request = vi
      .fn<HttpsJsonClient>()
      .mockResolvedValueOnce({ accepted: true })
      .mockImplementationOnce(() => {
        now += 20_000;
        return Promise.resolve({
          ...approved,
          expires_in: 30,
          refresh_token: "rotated-refresh",
        });
      })
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ ...approved, access_token: "next-access" })
      .mockResolvedValueOnce({ accepted: true });
    using fixture = dispatchFixture(request, () => now);
    await expect(fixture.call()).resolves.toEqual({ accepted: true });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].bearer).toBe("stale-token");

    now++;
    await expect(fixture.call()).resolves.toEqual({ accepted: true });
    expect(request.mock.calls[1]?.[0].url.href).toBe(connection.tokenEndpoint);
    expect(request.mock.calls[2]?.[0].bearer).toBe(approved.access_token);
    expect(fixture.credentials()).toMatchObject({
      generation: 2,
      expiresAt: originalExpiry + 30_000,
      refreshToken: "rotated-refresh",
    });

    now = originalExpiry + 30_000 - 1;
    await expect(fixture.call()).resolves.toEqual({ accepted: true });
    expect(request.mock.calls[3]?.[0].bearer).toBe(approved.access_token);
    now++;
    await expect(fixture.call()).resolves.toEqual({ accepted: true });
    expect(request.mock.calls[4]?.[0].url.href).toBe(connection.tokenEndpoint);
    expect(
      new URLSearchParams(request.mock.calls[4]?.[0].body?.text).get(
        "refresh_token",
      ),
    ).toBe("rotated-refresh");
    expect(request.mock.calls[5]?.[0].bearer).toBe("next-access");
    expect(
      fixture.store.authorization(fixture.authorization.id)?.reauthRequired,
    ).toBe(false);
  });

  it("coalesces overlapping 401 recoveries and commits the rotated credentials once", async () => {
    const rejected = deferred<undefined>();
    const refresh = deferred<typeof approved>();
    const refreshing = deferred<undefined>();
    const request = vi
      .fn<HttpsJsonClient>()
      .mockImplementation(async ({ url, bearer }) => {
        if (url.href === connection.tokenEndpoint) {
          refreshing.resolve(undefined);
          return refresh.promise;
        }
        if (bearer === "stale-token") {
          await rejected.promise;
          throw new HttpsResponseError(401);
        }
        return { accepted: bearer === approved.access_token };
      });
    using fixture = dispatchFixture(request, () => 1000);
    const calls = [fixture.call(), fixture.call()];
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    rejected.resolve(undefined);
    await refreshing.promise;
    refresh.resolve({ ...approved, refresh_token: "rotated-refresh" });
    await expect(Promise.all(calls)).resolves.toEqual([
      { accepted: true },
      { accepted: true },
    ]);
    expect(request.mock.calls.map(([input]) => input.bearer)).toEqual([
      "stale-token",
      "stale-token",
      undefined,
      approved.access_token,
      approved.access_token,
    ]);
    expect(
      request.mock.calls.filter(
        ([input]) => input.url.href === connection.tokenEndpoint,
      ),
    ).toHaveLength(1);
    expect(fixture.credentials()).toMatchObject({
      generation: 2,
      refreshToken: "rotated-refresh",
    });
    expect(
      fixture.store.authorization(fixture.authorization.id)?.reauthRequired,
    ).toBe(false);
  });

  it.each([400, 401])(
    "requires reauthentication after a rejected refresh (HTTP %i) without another dispatch",
    async (status) => {
      const request = vi
        .fn<HttpsJsonClient>()
        .mockRejectedValueOnce(new HttpsResponseError(401))
        .mockRejectedValueOnce(new HttpsResponseError(status));
      using fixture = dispatchFixture(request, () => 1000);
      await expect(fixture.call()).rejects.toMatchObject({
        code: "reauthentication_required",
      });
      expect(request.mock.calls[1]?.[0].url.href).toBe(
        connection.tokenEndpoint,
      );
      expect(
        fixture.store.authorization(fixture.authorization.id)?.reauthRequired,
      ).toBe(true);
      expect(
        fixture.store.httpsCredentials(fixture.authorization.id, 1000),
      ).toBeUndefined();
      await expect(fixture.call()).rejects.toMatchObject({
        code: "reauthentication_required",
      });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("discards a refresh reply if the connection is revoked while the request is in flight", async () => {
    const refresh = deferred<typeof approved>();
    const request = vi
      .fn<HttpsJsonClient>()
      .mockReturnValueOnce(refresh.promise);
    using fixture = dispatchFixture(request, () => originalExpiry);
    const call = fixture.call();
    expect(request.mock.calls[0]?.[0].url.href).toBe(connection.tokenEndpoint);
    expect(
      fixture.store.revokeAuthorization(
        fixture.authorization.id,
        originalExpiry,
      ),
    ).toBe(true);
    refresh.resolve(approved);
    await expect(call).rejects.toMatchObject({ code: "connection_revoked" });
    expect(request).toHaveBeenCalledOnce();
    expect(
      fixture.store.httpsCredentials(fixture.authorization.id, originalExpiry),
    ).toBeUndefined();
  });

  it("requires reauthentication if the renewed token also returns 401", async () => {
    const request = vi
      .fn<HttpsJsonClient>()
      .mockRejectedValueOnce(new HttpsResponseError(401))
      .mockResolvedValueOnce(approved)
      .mockRejectedValueOnce(new HttpsResponseError(401));
    using fixture = dispatchFixture(request, () => 1000);
    await expect(fixture.call()).rejects.toMatchObject({
      code: "reauthentication_required",
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[0].bearer).toBe(approved.access_token);
    expect(
      fixture.store.authorization(fixture.authorization.id)?.reauthRequired,
    ).toBe(true);
  });

  it("keeps the refresh grant after a transient token endpoint failure", async () => {
    const request = vi
      .fn<HttpsJsonClient>()
      .mockRejectedValueOnce(new HttpsResponseError(503))
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce({ accepted: true });
    using fixture = dispatchFixture(request, () => originalExpiry);
    await expect(fixture.call()).rejects.toMatchObject({
      code: "connection_offline",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(fixture.credentials()).toMatchObject({
      generation: 1,
      refreshToken: "test-refresh",
    });
    expect(
      fixture.store.authorization(fixture.authorization.id)?.reauthRequired,
    ).toBe(false);
    await expect(fixture.call()).resolves.toEqual({ accepted: true });
    expect(fixture.credentials().generation).toBe(2);
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
