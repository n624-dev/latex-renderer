import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserConsent } from "../apps/public-mcp-gateway/src/browser-consent.js";
import type { NewAuthorization } from "../apps/public-mcp-gateway/src/connections.js";
import { GatewayAgentPairing } from "../apps/public-mcp-gateway/src/agent-pairing.js";
import { HttpsCredentialKeys } from "../apps/public-mcp-gateway/src/https-credential-keys.js";
import {
  dcrClientRetentionMs,
  expiredConnectionRetentionMs,
} from "../apps/public-mcp-gateway/src/oauth-clients.js";
import { GatewayOAuthTokens } from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { RelayReferences } from "../apps/public-mcp-gateway/src/relay-references.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";
import {
  agentRevocationSchema,
  connectionApplicationId,
  connectionSchema,
  connectionSchemaVersion,
} from "../apps/public-mcp-gateway/src/sqlite-schema.js";
import { publicGatewayBearer } from "./helpers/public-mcp.js";

const stores = new Set<SqliteConnectionStore>();
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores) store.close();
  stores.clear();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function open(path = ":memory:"): SqliteConnectionStore {
  const store = new SqliteConnectionStore(path);
  stores.add(store);
  return store;
}

function fixture(store = open()) {
  store.putVerifiedInstance({ id: "instance-a", publicKey: "instance-a-key" });
  const https = store.addTransport("instance-a", {
    kind: "https",
    mcpUrl: "https://a.example.com/mcp",
  });
  const agent = store.addTransport("instance-a", {
    kind: "agent",
    publicKey: "agent-a-key",
  });
  const profile = store.profileFor("instance-a", "local-user");
  const input: NewAuthorization = {
    profileId: profile.id,
    transportId: https.id,
    localGrantId: "grant-https",
    expiresAt: 100,
    scopes: ["mcp:read"],
  };
  return { store, https, agent, profile, input };
}

describe("public MCP connection storage", () => {
  it("removes an expired approval after seven days and keeps the profile ID", () => {
    const { store, https, profile, input } = fixture();
    expect(expiredConnectionRetentionMs).toBe(7 * 86_400_000);
    store.profileFor("instance-a", "local-user", "Example device");
    const approved = store.createAuthorization(input, 0, () => "fixture");
    store.pruneExpiredCredentials(
      input.expiresAt + expiredConnectionRetentionMs - 1,
    );
    expect(store.authorization(approved.id)).toBeDefined();
    store.pruneExpiredCredentials(
      input.expiresAt + expiredConnectionRetentionMs,
    );
    expect(store.authorization(approved.id)).toBeUndefined();
    expect(store.transport(https.id)).toBeUndefined();
    expect(store.profileFor("instance-a", "local-user")).toEqual(profile);
    const now = input.expiresAt + expiredConnectionRetentionMs;
    const transport = store.addTransport("instance-a", https.endpoint);
    const enrolled = store.profileFor(
      "instance-a",
      "local-user",
      "Reconnected device",
    );
    const reconnected = store.createAuthorization(
      {
        ...input,
        profileId: enrolled.id,
        transportId: transport.id,
        localGrantId: "grant-reconnected",
        expiresAt: now + 60_000,
      },
      now,
      () => "new-credentials",
    );
    const tokens = new GatewayOAuthTokens(
      "https://gateway.example.com",
      store.oauth,
      Buffer.alloc(32, 6),
      300_000,
      () => now,
    );
    expect(
      tokens.authenticate(publicGatewayBearer(tokens, reconnected)),
    ).toMatchObject({
      id: reconnected.id,
      profileId: profile.id,
      transportId: transport.id,
    });
    expect(reconnected.id).not.toBe(approved.id);
  });

  it("manages expired connections only with their own proof during the retention window", async () => {
    const { store, input, https } = fixture();
    const seal = () => "fixture";
    const expired = store.createAuthorization(input, 0, seal);
    const boundary = store.createAuthorization(
      { ...input, localGrantId: "boundary" },
      0,
      seal,
    );
    const foreign = store.profileFor(
      "instance-a",
      "other-user",
      "Other account",
    );
    const live = store.createAuthorization(
      {
        ...input,
        profileId: foreign.id,
        localGrantId: "live",
        expiresAt: input.expiresAt + expiredConnectionRetentionMs + 60_000,
      },
      0,
      seal,
    );
    let now = input.expiresAt;
    const key = Buffer.alloc(32, 6);
    const origin = "https://gateway.example.com";
    const tokens = new GatewayOAuthTokens(
      origin,
      store.oauth,
      key,
      300_000,
      () => now,
    );
    const references = new RelayReferences(key);
    const revokeHttps = vi.fn<() => Promise<void>>();
    const { handle } = createBrowserConsent({
      tokens,
      store,
      references,
      revokeHttps,
      pairing: new GatewayAgentPairing(store.agentPairing, key, {
        perTransport: 2,
        perInstance: 2,
        total: 5,
      }),
      keys: new HttpsCredentialKeys("test", new Map([["test", key]])),
      capacity: 5,
      timeoutMs: 1000,
      maxMetadataBytes: 8192,
      agentOnline: () => false,
      deliverAgentRevocations: () => Promise.resolve(),
    });
    const cookie = (id: string, proof: string) => `relay_manage_${id}=${proof}`;
    const proof = (authorization: typeof live) =>
      references.seal(authorization, "manage-connection", authorization.id);
    const manage = (cookies: string, id?: string) =>
      handle(
        new Request(
          `${origin}/oauth/connection`,
          id
            ? {
                method: "POST",
                headers: {
                  Origin: origin,
                  Cookie: cookies,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ id, action: "forget" }),
              }
            : { headers: { Cookie: cookies } },
        ),
      );
    const expiredCookie = cookie(expired.id, proof(expired));
    const boundaryCookie = cookie(boundary.id, proof(boundary));
    const liveCookie = cookie(live.id, proof(live));
    const foreignCookie = cookie(expired.id, proof(live));

    for (const cookies of ["", liveCookie, foreignCookie]) {
      expect(await (await manage(cookies))?.text()).not.toContain(expired.id);
      expect((await manage(cookies, expired.id))?.status).toBe(404);
    }
    expect(store.authorization(expired.id)).toEqual(expired);
    expect((await manage(liveCookie, live.id))?.status).toBe(409);

    now += expiredConnectionRetentionMs - 1;
    const list = await (
      await manage([expiredCookie, boundaryCookie, liveCookie].join("; "))
    )?.text();
    expect(list).toContain("Expired");
    expect(list).toContain("Forget connection");
    expect(list).toContain("Other account");
    expect(list).toContain("Authorized");
    expect(list).toContain(expired.id);
    expect(list).toContain(boundary.id);
    const forgotten = await manage(expiredCookie, expired.id);
    expect(forgotten?.status).toBe(200);
    expect(await forgotten?.text()).toContain("Connection forgotten.");
    expect(forgotten?.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(store.authorization(expired.id)).toBeUndefined();

    now++;
    expect(await (await manage(boundaryCookie))?.text()).not.toContain(
      boundary.id,
    );
    expect((await manage(boundaryCookie, boundary.id))?.status).toBe(404);
    store.pruneExpiredCredentials(now);
    expect(store.authorization(boundary.id)).toBeUndefined();
    expect(store.authorization(live.id)).toEqual(live);
    expect(store.httpsCredentials(live.id, now)?.envelope).toBe("fixture");
    expect(store.transport(https.id)).toEqual(https);
    expect(revokeHttps).not.toHaveBeenCalled();
  });

  it("migrates a populated version 2 database and preserves DCR authorization references", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-mcp-v2-database-"));
    directories.push(dir);
    const path = join(dir, "legacy.sqlite");
    const now = Date.now();
    const liveUntil = now + 2 * dcrClientRetentionMs;
    const issuer = "https://gateway.example.com";
    const clientId = "legacy-client";
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(`
        ${connectionSchema}
        ${agentRevocationSchema}
        PRAGMA application_id=${connectionApplicationId};
        PRAGMA user_version=2;
        INSERT INTO instances VALUES ('instance-a', 'instance-key');
        INSERT INTO profiles VALUES ('stable-profile', 'instance-a', 'user', 'Legacy name');
        INSERT INTO transports VALUES ('agent', 'instance-a', 'agent', NULL, 'agent-key', NULL);
        INSERT INTO oauth_dcr_clients VALUES ('legacy-client', 'Legacy client', '["https://client.example.com/callback"]');
      `);
      legacy
        .prepare(
          `INSERT INTO authorizations (id, instance_id, profile_id, transport_id, local_grant_id, scopes, expires_at)
        VALUES ('legacy-approval', 'instance-a', 'stable-profile', 'agent', 'local-grant', '["mcp:read"]', ?)`,
        )
        .run(liveUntil);
      legacy
        .prepare(
          "INSERT INTO oauth_families VALUES ('legacy-approval', ?, ?, 0)",
        )
        .run(clientId, `${issuer}/mcp`);
      legacy
        .prepare(
          `INSERT INTO oauth_tokens VALUES ('refresh-hash', 'access-hash', 'legacy-approval', 0, '["mcp:read"]', ?, NULL)`,
        )
        .run(liveUntil);
    } finally {
      legacy.close();
    }
    const store = open(path);
    const aged = now + dcrClientRetentionMs + 60_000;
    store.pruneExpiredCredentials(aged);
    expect(store.dcrClient(clientId)?.clientName).toBe("Legacy client");
    expect(
      store.registerDcrClient(
        {
          clientName: "New client",
          redirectUris: ["https://client.example.com/callback"],
        },
        1,
        aged,
      ),
    ).toBeUndefined();
    expect(
      store.oauth.accessAuthorization("access-hash", `${issuer}/mcp`, aged),
    ).toMatchObject({
      id: "legacy-approval",
      profileId: "stable-profile",
      scopes: ["mcp:read"],
    });
    expect(
      store.oauth.refresh({
        oldHash: "refresh-hash",
        clientId,
        resource: `${issuer}/mcp`,
        accessHash: "new-access-hash",
        refreshHash: "new-refresh-hash",
        now: aged,
        retryWindowMs: 1000,
        requestedScopes: null,
      }),
    ).toMatchObject({ scopes: ["mcp:read"] });
    const migrated = new DatabaseSync(path, { readOnly: true });
    try {
      expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(
        connectionSchemaVersion,
      );
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  });
  it("forgets one approval and retains only its pending revocation while an agent is offline", () => {
    const { store, agent, profile, input } = fixture();
    const first = store.createAuthorization(
      { ...input, transportId: agent.id },
      0,
    );
    const second = store.createAuthorization(
      {
        ...input,
        localGrantId: "second-grant",
        transportId: agent.id,
      },
      0,
    );
    expect(store.disconnect(first.id, 1, false)).toBe(true);
    expect(store.authorization(first.id)?.revokedAt).toBe(1);
    expect(store.disconnect(first.id, 2, true)).toBe(true);
    expect(store.authorization(first.id)).toBeUndefined();
    expect(store.pendingAgentRevocations(agent.id, 2)).toEqual([
      first.localGrantId,
    ]);
    expect(store.authorization(second.id)?.profileId).toBe(profile.id);
    expect(store.profile(profile.id)).toEqual(profile);
    store.acknowledgeAgentRevocation(agent.id, first.localGrantId);
    expect(store.pendingAgentRevocations(agent.id, 2)).toEqual([]);
  });

  it("keeps profile identity stable and isolates clones with identical local user IDs", () => {
    const { store, profile, agent, input } = fixture();
    const approval = store.createAuthorization(
      { ...input, transportId: agent.id },
      0,
    );
    store.putVerifiedInstance({
      id: "instance-b",
      publicKey: "instance-b-key",
    });
    const otherProfile = store.profileFor("instance-b", "local-user");
    expect(otherProfile.id).not.toEqual(profile.id);
    expect(store.profileFor("instance-a", "local-user", "New name")).toEqual({
      ...profile,
      displayName: "New name",
    });
    expect(() =>
      store.createAuthorization(
        { ...input, profileId: otherProfile.id, transportId: agent.id },
        0,
      ),
    ).toThrow();
    expect(() =>
      store.createAuthorization({ ...input, transportId: agent.id }, 0),
    ).toThrow();
    expect(store.authorization(approval.id)?.scopes).toEqual(["mcp:read"]);
  });

  it("separates instance and agent keys and refuses replacement of a registered identity", () => {
    const { store } = fixture();
    expect(() =>
      store.putVerifiedInstance({
        id: "instance-a",
        publicKey: "different-key",
      }),
    ).toThrow();
    expect(() =>
      store.putVerifiedInstance({
        id: "instance-b",
        publicKey: "instance-a-key",
      }),
    ).toThrow();
    expect(() =>
      store.putVerifiedInstance({ id: "instance-b", publicKey: "agent-a-key" }),
    ).toThrow();
    expect(() =>
      store.addTransport("instance-a", {
        kind: "agent",
        publicKey: "instance-a-key",
      }),
    ).toThrow();
    expect(() =>
      store.putVerifiedInstance({
        id: "instance-a",
        publicKey: "instance-a-key",
      }),
    ).not.toThrow();
  });

  it("stores no credential for agent approvals and commits HTTPS credentials with their approval", () => {
    const { store, agent, input } = fixture();
    expect(() => store.createAuthorization(input, 0)).toThrow();
    expect(() =>
      store.createAuthorization(
        { ...input, transportId: agent.id },
        0,
        () => "envelope",
      ),
    ).toThrow();
    expect(() =>
      store.createAuthorization(input, 0, () => {
        throw new Error("seal failed");
      }),
    ).toThrow("seal failed");
    const approved = store.createAuthorization(
      input,
      0,
      (id) => `envelope-for-${id}`,
    );
    const agentApproval = store.createAuthorization(
      { ...input, localGrantId: "grant-agent", transportId: agent.id },
      0,
    );
    expect(store.httpsCredentials(approved.id, 0)).toEqual({
      envelope: `envelope-for-${approved.id}`,
      generation: 1,
    });
    expect(store.httpsCredentials(agentApproval.id, 0)).toBeUndefined();
  });

  it("rejects stale refreshes and persists revocation without altering another approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-mcp-connections-"));
    directories.push(dir);
    const path = join(dir, "gateway.sqlite");
    const { store, input } = fixture(open(path));
    const keys = new HttpsCredentialKeys(
      "key-one",
      new Map([["key-one", Buffer.alloc(32, 5)]]),
    );
    const credentials = {
      clientId: "local-client",
      accessToken: "private-access-token-for-test",
      refreshToken: "private-refresh-token-for-test",
      expiresAt: 90,
      scopes: [...input.scopes],
    };
    const first = store.createAuthorization(input, 0, (id) =>
      keys.seal(id, credentials),
    );
    const second = store.createAuthorization(
      { ...input, localGrantId: "grant-second" },
      0,
      (id) => keys.seal(id, credentials),
    );
    expect(
      store.replaceHttpsCredentials(
        first.id,
        keys.seal(first.id, credentials),
        1,
        1,
      ),
    ).toBe(true);
    expect(
      store.replaceHttpsCredentials(
        first.id,
        keys.seal(first.id, credentials),
        1,
        2,
      ),
    ).toBe(false);
    for (const file of await readdir(dir)) {
      const bytes = await readFile(join(dir, file));
      expect(bytes.includes(credentials.accessToken)).toBe(false);
      expect(bytes.includes(credentials.refreshToken)).toBe(false);
    }
    expect(store.revokeAuthorization(first.id, 3)).toBe(true);
    expect(store.revokeAuthorization(first.id, 4)).toBe(false);
    store.close();
    stores.delete(store);
    const reopened = open(path);
    expect(reopened.authorization(first.id)?.revokedAt).toBe(3);
    expect(reopened.httpsCredentials(first.id, 5)).toBeUndefined();
    expect(reopened.replaceHttpsCredentials(first.id, "envelope", 2, 5)).toBe(
      false,
    );
    expect(reopened.profile(first.profileId)?.id).toBe(first.profileId);
    expect(
      keys.open(
        second.id,
        reopened.httpsCredentials(second.id, 5)?.envelope ?? "",
      ),
    ).toEqual(credentials);
  });

  it("invalidates restored authorizations and keeps profiles for a new approval", () => {
    const { store, agent, profile, input } = fixture();
    const first = store.createAuthorization(input, 0, () => "envelope");
    const second = store.createAuthorization(
      { ...input, localGrantId: "grant-agent", transportId: agent.id },
      0,
    );
    expect(store.invalidateRestoredAuthorizations(20)).toBe(2);
    expect(store.invalidateRestoredAuthorizations(21)).toBe(0);
    expect(store.authorization(first.id)?.revokedAt).toBe(20);
    expect(store.authorization(second.id)?.revokedAt).toBe(20);
    expect(store.httpsCredentials(first.id, 21)).toBeUndefined();
    expect(
      store.profileFor(profile.instanceId, profile.localProfileId).id,
    ).toBe(profile.id);
    const reapproved = store.createAuthorization(
      { ...input, localGrantId: "new-grant" },
      22,
      () => "new-envelope",
    );
    expect(reapproved.id).not.toBe(first.id);
    expect(store.httpsCredentials(reapproved.id, 22)?.envelope).toBe(
      "new-envelope",
    );
  });

  it("rejects credentials for disabled, expired, or reauthentication-required connections", () => {
    const { store, https, input } = fixture();
    const first = store.createAuthorization(input, 0, () => "envelope");
    const second = store.createAuthorization(
      { ...input, localGrantId: "grant-second" },
      0,
      () => "envelope",
    );
    expect(store.httpsCredentials(first.id, 100)).toBeUndefined();
    expect(store.requireReauthentication(first.id)).toBe(true);
    expect(store.httpsCredentials(first.id, 1)).toBeUndefined();
    expect(store.disableTransport(https.id, 2)).toBe(true);
    expect(store.httpsCredentials(second.id, 2)).toBeUndefined();
    expect(store.authorization(second.id)?.revokedAt).toBeNull();
    expect(() =>
      store.createAuthorization(
        { ...input, localGrantId: "new-grant" },
        2,
        () => "envelope",
      ),
    ).toThrow();
  });

  it("rejects a database belonging to another application", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-mcp-other-database-"));
    directories.push(dir);
    const path = join(dir, "other.sqlite");
    const other = new DatabaseSync(path);
    other.exec("CREATE TABLE other_app (id TEXT)");
    other.close();
    expect(() => open(path)).toThrow("Unsupported public MCP gateway database");
  });
});

describe("HTTPS credential encryption", () => {
  const credentials = {
    clientId: "local-client",
    accessToken: "local-access",
    refreshToken: "local-refresh",
    expiresAt: 20,
    scopes: ["mcp:read" as const],
  };
  const original = new HttpsCredentialKeys(
    "original",
    new Map([["original", Buffer.alloc(32, 1)]]),
  );
  const rotated = new HttpsCredentialKeys(
    "current",
    new Map([
      ["original", Buffer.alloc(32, 1)],
      ["current", Buffer.alloc(32, 2)],
    ]),
  );

  it("authenticates the authorization binding and permits explicit key rotation", () => {
    const sealed = original.seal("approval-a", credentials);
    expect(original.seal("approval-a", credentials)).not.toEqual(sealed);
    expect(rotated.open("approval-a", sealed)).toEqual(credentials);
    expect(rotated.seal("approval-a", credentials)).toMatch(/^v1\.current\./);
    expect(() => rotated.open("approval-b", sealed)).toThrow();
    const tampered = sealed.slice(0, -1) + (sealed.endsWith("A") ? "B" : "A");
    expect(() => rotated.open("approval-a", tampered)).toThrow();
  });
});
