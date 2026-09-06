import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { AdminSystemService } from "../apps/admin-api/src/services/system.js";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

describe("admin system status and dashboard contract", () => {
  it.each([
    [undefined, undefined, true, "正常", "通常運転", "稼働中"],
    ["normal", undefined, true, "正常", "通常運転", "稼働中"],
    ["normal", "running", true, "正常", "通常運転", "稼働中"],
    ["read-only", "running", true, "要確認", "読み取り専用", "稼働中"],
    ["lockdown", "running", true, "要確認", "緊急停止", "稼働中"],
    ["normal", "paused", true, "要確認", "通常運転", "停止中"],
    ["normal", "draining", true, "要確認", "通常運転", "ドレイン中"],
    ["normal", "running", false, "要確認", "通常運転", "稼働中"],
  ] as const)(
    "renders maintenance=%s worker=%s writes=%s correctly",
    async (
      maintenance,
      worker,
      writeEnabled,
      expected,
      maintenanceLabel,
      workerLabel,
    ) => {
      const database = new RendererDatabase(":memory:");
      database.migrate();
      try {
        database.raw
          .prepare(
            "DELETE FROM system_settings WHERE key IN ('maintenance_mode','worker_mode')",
          )
          .run();
        if (maintenance !== undefined)
          database.settings.upsert(
            "maintenance_mode",
            maintenance,
            "test",
            new Date().toISOString(),
          );
        if (worker !== undefined)
          database.settings.upsert(
            "worker_mode",
            worker,
            "test",
            new Date().toISOString(),
          );
        database.settings.upsert(
          "worker_heartbeat",
          { workerId: "test", at: new Date().toISOString() },
          "test",
          new Date().toISOString(),
        );
        const service = new AdminSystemService({
          database,
          writeEnabled,
        } as never);
        const status = JSON.parse(
          JSON.stringify(service.status()),
        ) as ReturnType<AdminSystemService["status"]>;
        expect(status.maintenance).toBe(maintenance ?? "normal");
        expect(status.worker).toBe(worker ?? "running");
        expect(status.worker).toBe(status.rendering.mode);
        expect(JSON.stringify(status)).not.toMatch(/value_json|updated_by/);
        // Exercise the actual shipped dashboard function with the serialized API payload.
        const dashboard = adminScript
          .split("\n")
          .find((line) => line.startsWith("async function dashboard()"));
        expect(dashboard).toBeDefined();
        const out = { innerHTML: "" };
        await new Script(`${dashboard}\ndashboard()`).runInNewContext({
          out,
          request: (path: string) =>
            Promise.resolve(
              path === "/system/status" ? status : { items: [], total: 0 },
            ),
          esc: (value: unknown) => String(value),
          section: () => "",
          table: () => "",
          bindAction: () => {},
        });
        expect(out.innerHTML).toContain(`>${expected}</span>`);
        expect(out.innerHTML).toContain(`<dd>${maintenanceLabel}</dd>`);
        expect(out.innerHTML).toContain(`<dd>${workerLabel}</dd>`);
        expect(out.innerHTML).not.toContain("[object Object]");
        // Reading status must not populate missing settings or change configured modes.
        expect(database.settings.value("worker_mode", null)).toBe(
          worker ?? null,
        );
        expect(database.settings.value("maintenance_mode", null)).toBe(
          maintenance ?? null,
        );
      } finally {
        database.close();
      }
    },
  );
});
