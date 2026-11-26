import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { NewAuthorization } from "../apps/public-mcp-gateway/src/connections.js";
import { HttpsCredentialKeys } from "../apps/public-mcp-gateway/src/https-credential-keys.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

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
