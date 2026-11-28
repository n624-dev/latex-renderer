import { describe, expect, it, onTestFinished } from "vitest";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { AdminSystemService } from "../apps/admin-api/src/services/system.js";
import type {
  AdminActor,
  AdminDependencies,
} from "../apps/admin-api/src/types.js";

describe("resource policy effective baselines", () => {
  it.each([
    { key: "max_queue_length", baseline: 12 },
    { key: "max_user_storage_bytes", baseline: 256 * 1024 ** 2 },
    { key: "max_user_active_jobs", baseline: 20 },
    { key: "source_orphan_retention_minutes", baseline: 60 },
  ] as const)(
    "uses effective $key before the first override and audits only successful changes",
    ({ key, baseline }) => {
      const database = new RendererDatabase(":memory:");
      database.migrate();
      try {
        database.raw
          .prepare("DELETE FROM system_settings WHERE key=?")
          .run(key);
        const service = new AdminSystemService({
            database,
            maxQueueLength: 12,
            maxUserStorageBytes: 256 * 1024 ** 2,
          } as AdminDependencies),
          admin = {
            id: "admin",
            role: "admin",
            type: "admin_key",
          } as AdminActor,
          owner = {
            id: "owner",
            role: "owner",
            type: "admin_key",
          } as AdminActor;
        expect(() =>
          service.updateConfig(admin, {
            key,
            value: baseline + 1,
            reason: "review",
          }),
        ).toThrow("Only an owner");
        expect(database.settings.value(key, null)).toBeNull();
        expect(
          database.raw
            .prepare("SELECT COUNT(*) AS count FROM audit_logs")
            .get(),
        ).toMatchObject({ count: 0 });
        service.updateConfig(admin, {
          key,
          value: baseline,
          reason: "same limit",
        });
        service.updateConfig(owner, {
          key,
          value: baseline + 1,
          reason: "reviewed capacity",
        });
        expect(() =>
          service.updateConfig(admin, {
            key,
            value: baseline + 2,
            reason: "review",
          }),
        ).toThrow("Only an owner");
        service.updateConfig(admin, {
          key,
          value: baseline,
          reason: "tighten",
        });
        expect(database.settings.value(key, null)).toBe(baseline);
        expect(
          database.raw
            .prepare("SELECT COUNT(*) AS count FROM audit_logs")
            .get(),
        ).toMatchObject({ count: 3 });
      } finally {
        database.close();
      }
    },
  );
});

describe("POST /system/config/reset", () => {
  it.each([
    {
      key: "max_queue_length",
      override: 100,
      value: 77,
      source: "host",
      unit: "jobs",
      minimum: 1,
      maximum: 10_000,
      environment: "MAX_QUEUE_LENGTH",
    },
    {
      key: "source_orphan_retention_minutes",
      override: 90,
      value: 60,
      source: "default",
      unit: "minutes",
      minimum: 5,
      maximum: 1_440,
      environment: null,
    },
  ])(
    "clears $key, returns its $source value, and audits the reset",
    async ({ override, ...entry }) => {
      const { database, app, reset, createKey, timestamp } = resetFixture();
      const key = createKey("admin");
      database.settings.upsert(entry.key, override, "test", timestamp);
      const reason = "Restore the baseline";
      const response = await reset(key.token, { key: entry.key, reason });
      const expected = { ...entry, fallback: entry.value };
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expected);
      expect(database.settings.get(entry.key)).toBeUndefined();
      expect(database.auditLogs.list()).toEqual([
        expect.objectContaining({
          actor_type: "admin_key",
          actor_id: key.id,
          action: "system.config.reset",
          target_type: "system_setting",
          target_id: entry.key,
          result: "success",
          metadata_json: JSON.stringify({
            oldValue: override,
            newValue: entry.value,
            reason,
            restartRequired: false,
          }),
        }),
      ]);

      database.migrate();
      expect(database.settings.get(entry.key)).toBeUndefined();
      const config = await app.request("/admin/api/v1/system/config", {
        headers: { Authorization: `Bearer ${key.token}` },
      });
      expect(config.status).toBe(200);
      const { effective } = (await config.json()) as { effective: unknown[] };
      expect(effective).toContainEqual(expected);
    },
  );

  it("requires an owner when reset raises the effective limit", async () => {
    const { database, reset, createKey, timestamp } = resetFixture();
    const key = "max_queue_length";
    database.settings.upsert(key, 31, "test", timestamp);
    const body = { key, reason: "Restore queue capacity" };

    const denied = await reset(createKey("admin").token, body);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "OWNER_REQUIRED" },
    });
    expect(database.settings.value(key, null)).toBe(31);
    expect(database.auditLogs.list()).toEqual([]);

    const allowed = await reset(createKey("owner").token, body);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      key,
      value: 77,
      source: "host",
    });
    expect(database.settings.get(key)).toBeUndefined();
  });

  it("returns the current effective value and audits a reset with no override", async () => {
    const { database, reset, createKey } = resetFixture();
    const key = "max_queue_length";
    const reason = "Confirm the baseline";
    expect(database.settings.get(key)).toBeUndefined();
    const response = await reset(createKey("admin").token, { key, reason });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      key,
      value: 77,
      source: "host",
    });
    expect(database.settings.get(key)).toBeUndefined();
    expect(database.auditLogs.list()).toEqual([
      expect.objectContaining({
        action: "system.config.reset",
        target_id: key,
        metadata_json: JSON.stringify({
          oldValue: 77,
          newValue: 77,
          reason,
          restartRequired: false,
        }),
      }),
    ]);
  });

  it("requires the system write scope even for owners", async () => {
    const { database, reset, createKey } = resetFixture();
    const response = await reset(
      createKey("owner", ["admin:system:read"]).token,
      {
        key: "max_queue_length",
        reason: "Restore the baseline",
      },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INSUFFICIENT_SCOPE" },
    });
    expect(database.auditLogs.list()).toEqual([]);
  });

  it.each([
    ["a non-runtime key", { key: "maintenance_mode", reason: "test" }],
    ["a missing reason", { key: "max_queue_length" }],
    ["an empty reason", { key: "max_queue_length", reason: "" }],
    ["a long reason", { key: "max_queue_length", reason: "x".repeat(501) }],
    [
      "an extra property",
      { key: "max_queue_length", reason: "test", value: 77 },
    ],
  ])("rejects %s", async (_label, body) => {
    const { database, reset, createKey, timestamp } = resetFixture();
    database.settings.upsert("max_queue_length", 100, "test", timestamp);
    const response = await reset(createKey("admin").token, body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(database.settings.value("max_queue_length", null)).toBe(100);
    expect(database.settings.value("maintenance_mode", null)).toBe("normal");
    expect(database.auditLogs.list()).toEqual([]);
  });
});

function resetFixture() {
  const database = new RendererDatabase(":memory:");
  onTestFinished(() => database.close());
  database.migrate();
  const timestamp = new Date().toISOString();
  const apiKeys = new ApiKeyService(
    database,
    new Map([["v1", Buffer.alloc(32, 1)]]),
    "v1",
  );
  const app = createAdminApp({
    database,
    apiKeys,
    browserAuth: {} as never,
    deploymentMode: "standalone",
    publicOrigin: "https://latex.example.com",
    allowedOrigins: new Set(),
    writeEnabled: true,
    storageRoot: process.cwd(),
    rendererVersion: "test",
    maxOutputBytes: 1,
    maxQueueLength: 77,
    maxUserStorageBytes: 256 * 1024 ** 2,
    minFreeStorageBytes: 1,
    activeTicketKid: "v1",
    verificationTicketKids: [],
  });
  function createKey(
    role: AdminActor["role"],
    scopes = ["admin:system:read", "admin:system:write"],
  ) {
    const userId = `user_${role}`;
    const serviceAccountId = `sa_${role}`;
    database.users.insertInvitation({
      id: userId,
      displayName: role,
      role,
      createdBy: "test",
      timestamp,
    });
    database.serviceAccounts.insert({
      id: serviceAccountId,
      ownerUserId: userId,
      name: role,
      clientType: "generic",
      timestamp,
    });
    const key = apiKeys.create("admin");
    database.apiKeys.insert({
      ...key,
      serviceAccountId,
      name: role,
      scopes,
      createdAt: timestamp,
      createdBy: "test",
    });
    return key;
  }
  const reset = (token: string, body: unknown) =>
    app.request("/admin/api/v1/system/config/reset", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { database, app, createKey, reset, timestamp };
}
