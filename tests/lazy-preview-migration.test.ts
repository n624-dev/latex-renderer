import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RendererDatabase } from "../packages/database/src/index.js";
import { lazyPreviewsV22Sql } from "../packages/database/src/schema.js";
const numbered = readFileSync(
  "deploy/migrations/022_lazy_previews.sql",
  "utf8",
);
const normalize = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
describe("migration 22 deployment/application parity", () => {
  it("keeps all reservations, cache tables and internal audit protections in the numbered transactional form", () => {
    expect(normalize(numbered)).toBe(
      normalize(`BEGIN IMMEDIATE; ${lazyPreviewsV22Sql} COMMIT;`),
    );
  });
  it.each(["application", "numbered"])(
    "supports normal startup and quota queries after %s migration",
    (mode) => {
      const db = new RendererDatabase(":memory:");
      try {
        db.migrate();
        db.raw
          .exec(`DROP TABLE job_preview_requests; DROP TABLE job_preview_documents; DROP TABLE source_tree_readers; DROP TABLE source_trees;
        DROP TRIGGER internal_job_deleted; DROP TRIGGER internal_source_deleted; DROP TRIGGER internal_key_deleted; DROP TRIGGER internal_account_deleted;
        DROP TABLE internal_resource_tombstones; DELETE FROM schema_migrations WHERE version=22;`);
        if (mode === "numbered") db.raw.exec(numbered);
        db.migrate();
        expect(db.jobs.storageUsageForUser("missing")).toBe(0);
        expect(
          db.raw
            .prepare("SELECT reserved_bytes FROM job_preview_requests")
            .all(),
        ).toEqual([]);
        expect(
          db.raw.prepare("SELECT * FROM internal_resource_tombstones").all(),
        ).toEqual([]);
        expect(db.raw.prepare("SELECT * FROM source_trees").all()).toEqual([]);
        expect(db.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(db.raw.prepare("PRAGMA integrity_check").get()).toMatchObject({
          integrity_check: "ok",
        });
      } finally {
        db.close();
      }
    },
  );
});
