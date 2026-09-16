import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { AdminJobsService } from "../apps/admin-api/src/services/jobs.js";

describe("idempotency resource lifecycle", () => {
  it("atomically replaces only expired keys, without renewing active requests or crossing actor boundaries", () => {
    const database = new RendererDatabase(":memory:");
    database.migrate();
    try {
      const start = "2026-09-16T00:00:00.000Z",
        deadline = "2026-09-17T00:00:00.000Z";
      const record = {
        actorType: "user",
        actorId: "first",
        operation: "source.create",
        keyHash: "key",
        requestHash: "request",
        resourceId: "source_first",
        responseCode: 200,
        createdAt: start,
        expiresAt: deadline,
      };
      database.security.insertIdempotency(record);
      expect(() =>
        database.security.insertIdempotency({
          ...record,
          resourceId: "source_second",
          createdAt: "2026-09-16T23:59:59.999Z",
          expiresAt: "2026-09-18T00:00:00.000Z",
        }),
      ).toThrow(/already active/);
      expect(
        database.raw
          .prepare(
            "SELECT created_at,expires_at,resource_id FROM idempotency_records",
          )
          .get(),
      ).toMatchObject({
        created_at: start,
        expires_at: deadline,
        resource_id: "source_first",
      });
      database.security.insertIdempotency({ ...record, actorId: "second" });
      database.security.insertIdempotency({
        ...record,
        operation: "another.operation",
      });
      expect(
        database.security.idempotency(
          "user",
          "first",
          "source.create",
          "key",
          deadline,
        ),
      ).toBeUndefined();
      database.security.insertIdempotency({
        ...record,
        resourceId: "source_second",
        createdAt: deadline,
        expiresAt: "2026-09-18T00:00:00.000Z",
      });
      expect(
        database.security.idempotency(
          "user",
          "first",
          "source.create",
          "key",
          deadline,
        )?.resource_id,
      ).toBe("source_second");
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS n FROM idempotency_records")
          .get()?.n,
      ).toBe(3);
      expect(() =>
        database.security.insertIdempotency({ ...record, createdAt: deadline }),
      ).toThrow(/lifetime/);
    } finally {
      database.close();
    }
  });

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
