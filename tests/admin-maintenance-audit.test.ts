import { describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { AdminSystemService } from "../apps/admin-api/src/services/system.js";

describe("Admin maintenance audit", () => {
  it("records the required enable reason in the same transaction", () => {
    const database = new RendererDatabase(":memory:");
    database.migrate();
    try {
      const service = new AdminSystemService({ database } as never);
      const actor = {
        type: "user" as const,
        id: "user_owner",
        userId: "user_owner",
        role: "owner" as const,
      };
      expect(() =>
        service.maintenance(
          actor,
          "enable",
          "read-only",
          "  incident containment  ",
        ),
      ).not.toThrow();
      const row = database.raw
        .prepare(
          "SELECT metadata_json FROM audit_logs WHERE action='maintenance.enabled' ORDER BY created_at DESC LIMIT 1",
        )
        .get() as { metadata_json: string };
      expect(JSON.parse(row.metadata_json)).toEqual({
        mode: "read-only",
        reason: "incident containment",
      });
      expect(() => service.maintenance(actor, "enable", "lockdown")).toThrow(
        "Maintenance reason is required",
      );
    } finally {
      database.close();
    }
  });
});
