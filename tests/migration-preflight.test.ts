import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "latex-migration-preflight-test-"));
  roots.push(root);
  const path = join(root, "renderer.sqlite3");
  const database = new DatabaseSync(path);
  const directory = join(process.cwd(), "deploy/migrations");
  for (const name of readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    if (Number(name.slice(0, 3)) > 17) continue;
    database.exec(readFileSync(join(directory, name), "utf8"));
  }
  database
    .prepare(
      `INSERT INTO users
    (id,access_subject,email,display_name,role,status,created_by,created_at,updated_at)
    VALUES ('user_preflight_owner',NULL,NULL,'Existing owner','owner','active','test',?,?)`,
    )
    .run("2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO audit_logs
    (id,actor_type,actor_id,action,target_type,target_id,result,metadata_json,created_at)
    VALUES ('audit_preflight_existing','system','test','test.action','user','user_preflight_owner','success','{}',?)`,
    )
    .run("2026-09-01T00:00:00.000Z");
  database.close();
  return { root, path };
}

function run(path: string, temporaryRoot: string) {
  return spawnSync(
    process.execPath,
    ["deploy/scripts/preflight-users-migration.mjs", path],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, TMPDIR: temporaryRoot },
    },
  );
}

describe("real migration preflight", () => {
  it("validates a private copy through migration 18 without modifying the version 17 database", () => {
    const f = fixture();
    const before = createHash("sha256")
      .update(readFileSync(f.path))
      .digest("hex");
    const result = run(f.path, f.root);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      event: "migration.preflight_completed",
      users: 1,
      targetVersion: 18,
    });
    expect(
      createHash("sha256").update(readFileSync(f.path)).digest("hex"),
    ).toBe(before);
    const source = new DatabaseSync(f.path, { readOnly: true });
    try {
      expect(
        source
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get()?.version,
      ).toBe(17);
      expect(source.prepare("SELECT id,role,status FROM users").all()).toEqual([
        { id: "user_preflight_owner", role: "owner", status: "active" },
      ]);
      expect(
        source.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()?.count,
      ).toBe(1);
    } finally {
      source.close();
    }
    expect(
      readdirSync(f.root).filter((name) =>
        name.startsWith("latex-users-migration-"),
      ),
    ).toEqual([]);
  });

  it("rejects broken source references and removes the failed private migration copy", () => {
    const f = fixture();
    const source = new DatabaseSync(f.path);
    try {
      source.exec("PRAGMA foreign_keys=OFF");
      source
        .prepare(
          `INSERT INTO sources
        (id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at)
        VALUES (?,?,0,?,?,'ready',?,?,?)`,
        )
        .run(
          `source_${"a".repeat(32)}`,
          "user_missing",
          "0".repeat(64),
          `sources/source_${"a".repeat(32)}/source.zip`,
          "2026-09-01T00:00:00.000Z",
          "2026-09-01T00:00:00.000Z",
          "2099-01-01T00:00:00.000Z",
        );
    } finally {
      source.close();
    }
    const result = run(f.path, f.root);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("migration.preflight_completed");
    expect(result.stderr).toMatch(/foreign.key/i);
    expect(
      readdirSync(f.root).filter((name) =>
        name.startsWith("latex-users-migration-"),
      ),
    ).toEqual([]);
  });
});
