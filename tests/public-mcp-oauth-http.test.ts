import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createGatewayOAuthHandler } from "../apps/public-mcp-gateway/src/oauth-http.js";
import {
  authorizationLifetimeMs,
  GatewayOAuthTokens,
  validateOAuthAuthorizationRequest,
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
    expect(dcrClientRetentionMs).toBe(7 * 86_400_000);
    const registration = {
      clientName: "Review Client",
      redirectUris: [redirect],
    };
    const issued = fixture.store.registerDcrClient(
      registration,
      1,
      fixture.now,
    );
    expect(issued).toBeDefined();
    expect(
      fixture.store.registerDcrClient(
        registration,
        1,
        fixture.now + dcrClientRetentionMs - 1,
      ),
    ).toBeUndefined();
    const replacement = fixture.store.registerDcrClient(
      registration,
      1,
      fixture.now + dcrClientRetentionMs,
    );
    expect(replacement?.id).toBeDefined();
    expect(replacement?.id).not.toBe(issued?.id);
  });

  it.each(["expiry", "revocation"] as const)(
    "retains a used registration while referenced and for seven days after %s",
    async (ending) => {
      using fixture = createFixture();
      const { store, clock } = fixture;
      const registration = {
        clientName: "Review Client",
        redirectUris: [redirect],
      };
      const client = store.registerDcrClient(registration, 1, clock());
      if (!client) throw new Error("Missing test registration");
      const request = authorizationQuery(client.id);
      const authorize = async () => {
        const response = await fixture.handle(
          new Request(`${issuer}/oauth/authorize?${request}`),
        );
        expect(response?.status).toBe(200);
        return fixture.approval();
      };
      const earlier = await authorize();
      const lastApprovalTime = fixture.now + 1000;
      fixture.setTime(lastApprovalTime);
      const { code, authorizationId } = await authorize();
      const exchange = await fixture.handle(
        post(
          "/oauth/token",
          "application/x-www-form-urlencoded",
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: client.id,
            redirect_uri: redirect,
            resource,
            code,
            code_verifier: verifier,
          }).toString(),
        ),
      );
      expect(exchange?.status).toBe(200);
      const { refresh_token } = (await exchange?.json()) as {
        refresh_token: string;
      };

      fixture.setTime(fixture.now + dcrClientRetentionMs);
      expect(store.revokeAuthorization(earlier.authorizationId, clock())).toBe(
        true,
      );
      store.pruneExpiredCredentials(clock());
      expect(store.registerDcrClient(registration, 1, clock())).toBeUndefined();
      expect(store.dcrClient(client.id)).toEqual(client);
      const refresh = (token: string) =>
        fixture.handle(
          post(
            "/oauth/token",
            "application/x-www-form-urlencoded",
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: client.id,
              resource,
              refresh_token: token,
            }).toString(),
          ),
        );
      const refreshed = await refresh(refresh_token);
      expect(refreshed?.status).toBe(200);
      const rotated = (await refreshed?.json()) as { refresh_token: string };
      expect(rotated.refresh_token).not.toBe(refresh_token);

      const end =
        ending === "expiry"
          ? lastApprovalTime + authorizationLifetimeMs
          : clock() + 1000;
      fixture.setTime(end);
      if (ending === "revocation")
        expect(store.revokeAuthorization(authorizationId, end)).toBe(true);
      expect(await (await refresh(rotated.refresh_token))?.json()).toEqual({
        error: "invalid_grant",
      });

      store.pruneExpiredCredentials(end + dcrClientRetentionMs - 1);
      expect(store.dcrClient(client.id)).toEqual(client);
      expect(
        store.registerDcrClient(
          registration,
          1,
          end + dcrClientRetentionMs - 1,
        ),
      ).toBeUndefined();
      store.pruneExpiredCredentials(end + dcrClientRetentionMs);
      expect(store.dcrClient(client.id)).toBeUndefined();
      const replacement = store.registerDcrClient(
        registration,
        1,
        end + dcrClientRetentionMs,
      );
      expect(replacement?.id).toMatch(/^gateway_client_/);
      expect(replacement?.id).not.toBe(client.id);
    },
  );

  it("protects an old registration until its pending consent expires", () => {
    using fixture = createFixture();
    const { store, tokens } = fixture;
    const registration = {
      clientName: "Review Client",
      redirectUris: [redirect],
    };
    const client = store.registerDcrClient(registration, 1, fixture.now);
    if (!client) throw new Error("Missing test registration");
    fixture.setTime(fixture.now + dcrClientRetentionMs - 1);
    const authorization = validateOAuthAuthorizationRequest(
      authorizationQuery(client.id),
      client,
      resource,
    );
    const lifetimeMs = 1000;
    tokens.beginConsent(authorization, { lifetimeMs, capacity: 1 });
    const expiresAt = fixture.clock() + lifetimeMs;
    store.pruneExpiredCredentials(expiresAt - 1);
    expect(store.dcrClient(client.id)).toEqual(client);
    expect(
      store.registerDcrClient(registration, 1, expiresAt - 1),
    ).toBeUndefined();
    expect(store.pruneExpiredCredentials(expiresAt)).toEqual({
      expiredRecordsRemoved: 1,
      expiredConnectionsRemoved: 0,
      dcrRegistrationsReclaimed: 1,
      dcrRegistrationsUsed: 0,
    });
    expect(store.dcrClient(client.id)).toBeUndefined();
    expect(store.registerDcrClient(registration, 1, expiresAt)).toBeDefined();
  });

  it("completes simultaneous registration and cleanup from independent SQLite connections under contention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-mcp-dcr-race-"));
    const path = join(dir, "gateway.sqlite");
    const store = new SqliteConnectionStore(path);
    const writer = new DatabaseSync(path);
    const workers: Worker[] = [];
    const gate = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    );
    try {
      const now = 1_800_000_000_000;
      const registration = {
        clientName: "Review Client",
        redirectUris: [redirect],
      };
      const old = store.registerDcrClient(registration, 1, now);
      if (!old) throw new Error("Missing test registration");
      const module = new URL(
        "../apps/public-mcp-gateway/src/sqlite-connections.ts",
        import.meta.url,
      );
      const source = `
        import { parentPort, workerData } from "node:worker_threads";
        import { SqliteConnectionStore } from ${JSON.stringify(module.href)};
        const { path, operation, time, registration, gate } = workerData;
        const store = new SqliteConnectionStore(path);
        parentPort.postMessage("ready");
        Atomics.wait(gate, 0, 0);
        try {
          if (operation === "cleanup") {
            store.pruneExpiredCredentials(time);
            parentPort.postMessage("cleaned");
          } else {
            parentPort.postMessage(store.registerDcrClient(registration, 1, time)?.id);
          }
        } catch (error) {
          parentPort.postMessage(error?.errcode === 5 ? "SQLITE_BUSY" : String(error));
        } finally {
          store.close();
        }
      `;
      for (const operation of ["register", "cleanup"]) {
        const worker = new Worker(
          new URL(`data:text/javascript,${encodeURIComponent(source)}`),
          {
            execArgv: ["--import", "tsx"],
            workerData: {
              path,
              operation,
              time: now + dcrClientRetentionMs,
              registration,
              gate,
            },
          },
        );
        workers.push(worker);
        expect(await once(worker, "message")).toEqual(["ready"]);
      }
      const results = workers.map((worker) => once(worker, "message"));
      writer.exec("BEGIN IMMEDIATE");
      try {
        Atomics.store(gate, 0, 1);
        Atomics.notify(gate, 0);
        // Force a short overlap with an existing writer, then let both operations finish.
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      } finally {
        writer.exec("ROLLBACK");
      }
      const [[registered], [cleaned]] = (await Promise.all(results)) as [
        [unknown],
        [unknown],
      ];
      expect(registered).toMatch(/^gateway_client_/);
      expect(cleaned).toBe("cleaned");
      expect(store.dcrClient(old.id)).toBeUndefined();
      expect(
        store.registerDcrClient(registration, 1, now + dcrClientRetentionMs),
      ).toBeUndefined();
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      writer.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
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

function authorizationQuery(clientId: string) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    resource,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
}

function createFixture() {
  const store = new SqliteConnectionStore(":memory:");
  const now = 1_800_000_000_000;
  let time = now;
  const clock = () => time;
  const tokens = new GatewayOAuthTokens(
    issuer,
    store.oauth,
    Buffer.alloc(32, 9),
    300_000,
    clock,
  );
  store.putVerifiedInstance({ id: "instance", publicKey: "instance-key" });
  const profile = store.profileFor("instance", "local-user");
  const transport = store.addTransport("instance", {
    kind: "agent",
    publicKey: "agent-key",
  });
  let callback: URL | undefined;
  let approvedId: string | undefined;
  let approvalCount = 0;
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
          localGrantId: `confirmed-local-grant-${++approvalCount}`,
          scopes: authorization.scopes,
          expiresAt: clock() + authorizationLifetimeMs,
        },
        clock(),
      );
      approvedId = approved.id;
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
    clock,
    tokens,
    setTime: (next: number) => {
      time = next;
    },
    handle,
    consentUrl: () => callback,
    approval: () => {
      const code = callback?.searchParams.get("code");
      if (!code || !approvedId) throw new Error("Missing OAuth approval");
      return { code, authorizationId: approvedId };
    },
    [Symbol.dispose]: () => store.close(),
  };
}
