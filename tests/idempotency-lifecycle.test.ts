import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { AdminJobsService } from "../apps/admin-api/src/services/jobs.js";

describe("idempotency resource lifecycle", () => {
  it("does not replay a deleted Admin Retry Job as a success", async () => {
    const database = new RendererDatabase(":memory:");
    database.migrate();
    try {
      const actor = {
          type: "user" as const,
          id: "user_owner",
          userId: "user_owner",
          role: "owner" as const,
          scopes: ["admin:jobs:write"],
        },
        idempotencyKey = "retry-resource-gone-123456";
      database.security.insertIdempotency({
        actorType: actor.type,
        actorId: actor.id,
        operation: "render.retry",
        keyHash: createHash("sha256").update(idempotencyKey).digest("hex"),
        requestHash: createHash("sha256").update("job_original").digest("hex"),
        resourceId: "job_deleted",
        responseCode: 202,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      await expect(
        new AdminJobsService({ database } as never).retry(
          actor,
          "job_original",
          idempotencyKey,
        ),
      ).rejects.toMatchObject({
        code: "IDEMPOTENT_RESOURCE_GONE",
        status: 410,
      });
    } finally {
      database.close();
    }
  });

  it("counts logically expired Sources until physical deletion completes", () => {
    const database = new RendererDatabase(":memory:");
    database.migrate();
    try {
      const timestamp = new Date().toISOString();
      database.users.insertInvitation({
        id: "user_owner",
        displayName: "Owner",
        role: "owner",
        createdBy: "test",
        timestamp,
      });
      database.sources.insertReserved({
        id: "source_expired",
        ownerUserId: "user_owner",
        size: 123,
        sha256: "a".repeat(64),
        storageKey: "sources/source_expired/source.zip",
        timestamp,
        expiresAt: timestamp,
      });
      database.sources.transition(
        "source_expired",
        ["reserved"],
        "expired",
        timestamp,
      );
      expect(database.sources.storageUsageForUser("user_owner")).toBe(123);
      expect(database.jobs.storageUsageForUser("user_owner")).toBe(123);
    } finally {
      database.close();
    }
  });
});
