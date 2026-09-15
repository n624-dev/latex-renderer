import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RendererDatabase } from "../packages/database/src/index.js";
import { auditExportSequenceSql } from "../packages/database/src/schema.js";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
const migration = readFileSync(
  new URL(
    "../deploy/migrations/018_audit_export_sequence.sql",
    import.meta.url,
  ),
  "utf8",
);
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("keeps standalone and runtime sequence migration SQL identical", () => {
  expect(migration.trim()).toBe(
    `BEGIN IMMEDIATE;\n${auditExportSequenceSql.trim()}\nCOMMIT;`,
  );
});

it.each(["runtime", "standalone"])(
  "backfills v17 audit rows atomically and reapplies safely (%s)",
  (mode) => {
    const path = databasePath();
    const seed = new RendererDatabase(path);
    seed.migrate();
    seed.raw
      .exec(`DROP TRIGGER audit_export_insert; DROP TRIGGER audit_export_delete; DROP TRIGGER audit_export_immutable;
    DROP TABLE audit_export_sequence; DROP TABLE audit_export_state; DELETE FROM schema_migrations WHERE version=18;`);
    insert(seed.raw, "audit_z");
    insert(seed.raw, "audit_a");
    seed.close();
    const db = new RendererDatabase(path);
    if (mode === "runtime") db.migrate();
    else db.raw.exec(migration);
    const identity = db.raw.prepare("SELECT * FROM audit_export_state").get();
    const rows = db.raw
      .prepare("SELECT * FROM audit_export_sequence ORDER BY sequence")
      .all();
    expect(rows).toMatchObject([
      { sequence: 1, audit_id: "audit_a" },
      { sequence: 2, audit_id: "audit_z" },
    ]);
    if (mode === "runtime") db.migrate();
    else db.raw.exec(migration);
    expect(db.raw.prepare("SELECT * FROM audit_export_state").get()).toEqual(
      identity,
    );
    expect(
      db.raw
        .prepare("SELECT * FROM audit_export_sequence ORDER BY sequence")
        .all(),
    ).toEqual(rows);
    expect(db.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.raw.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
    db.close();
  },
);

it("never reuses committed sequence after all audit and ledger rows are deleted, VACUUM and restart", () => {
  const path = databasePath(),
    db = new RendererDatabase(path);
  db.migrate();
  insert(db.raw, "first");
  insert(db.raw, "second");
  db.raw.exec(
    "DELETE FROM audit_logs; DELETE FROM audit_export_sequence; VACUUM;",
  );
  db.close();
  const reopened = new RendererDatabase(path);
  reopened.migrate();
  insert(reopened.raw, "third");
  expect(
    reopened.raw.prepare("SELECT sequence FROM audit_export_sequence").get(),
  ).toEqual({ sequence: 3 });
  reopened.close();
});

it("covers independent raw SQL writers and rolls sequence allocation back with the audit transaction", () => {
  const path = databasePath(),
    db = new RendererDatabase(path);
  db.migrate();
  db.close();
  const raw = new DatabaseSync(path);
  insert(raw, "first");
  raw.exec("BEGIN IMMEDIATE");
  insert(raw, "rolled_back");
  raw.exec("ROLLBACK");
  insert(raw, "second");
  expect(
    raw
      .prepare("SELECT audit_id FROM audit_export_sequence ORDER BY sequence")
      .all(),
  ).toEqual([{ audit_id: "first" }, { audit_id: "second" }]);
  expect(() =>
    raw.exec("UPDATE audit_logs SET created_at='1900-01-01' WHERE id='first'"),
  ).toThrow("append-only");
  raw.exec("PRAGMA foreign_keys=OFF; DELETE FROM audit_logs WHERE id='first'");
  expect(
    raw
      .prepare("SELECT audit_id FROM audit_export_sequence WHERE sequence=1")
      .get(),
  ).toEqual({ audit_id: null });
  raw.close();
});

function databasePath() {
  const root = mkdtempSync(join(tmpdir(), "audit-sequence-"));
  roots.push(root);
  return join(root, "database.sqlite3");
}
function insert(db: DatabaseSync, id: string) {
  db.prepare(
    `INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,result,metadata_json,created_at)
    VALUES (?,'system','test','test.action','test','test','success','{}','2020-01-01T00:00:00.000Z')`,
  ).run(id);
}
