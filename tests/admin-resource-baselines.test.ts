import { describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
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
