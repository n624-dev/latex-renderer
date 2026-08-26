#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RendererDatabase } from "../../packages/database/dist/index.js";

const sourcePath = process.argv[2];
if (!sourcePath)
  throw new Error("usage: preflight-users-migration.mjs DATABASE_PATH");

const work = await mkdtemp(join(tmpdir(), "latex-users-migration-"));
const snapshotPath = join(work, "renderer.sqlite3");
try {
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true });
  source.exec("PRAGMA busy_timeout=30000");
  const beforeUsers = usersSnapshot(source);
  const beforeCounts = tableCounts(source);
  source.prepare("VACUUM INTO ?").run(snapshotPath);
  source.close();

  const migrated = new RendererDatabase(snapshotPath);
  migrated.migrate();
  const afterUsers = usersSnapshot(migrated.raw);
  const afterCounts = tableCounts(migrated.raw);
  if (JSON.stringify(afterUsers) !== JSON.stringify(beforeUsers))
    throw new Error("Existing user identity, role, or status data changed");
  for (const [table, count] of beforeCounts) {
    if (table !== "schema_migrations" && afterCounts.get(table) !== count)
      throw new Error(`Row count changed for ${table}`);
  }
  assertSchema(migrated.raw);
  assertNullAndUniqueBehavior(migrated.raw);
  migrated.close();
  process.stdout.write(
    `${JSON.stringify({ event: "migration.preflight_completed", users: beforeUsers.length, tables: beforeCounts.size, targetVersion: 6 })}\n`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

function usersSnapshot(db) {
  return db
    .prepare(
      `SELECT id,access_subject,email,display_name,role,status,security_version,
       created_by,created_at,updated_at,last_login_at FROM users ORDER BY id`,
    )
    .all();
}

function tableCounts(db) {
  const result = new Map();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  for (const { name } of tables) {
    if (typeof name !== "string" || !/^[a-z_]+$/.test(name))
      throw new Error("Unexpected SQLite table name");
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get();
    result.set(name, Number(row.count));
  }
  return result;
}

function assertSchema(db) {
  const subject = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .find(({ name }) => name === "access_subject");
  if (subject?.notnull !== 0)
    throw new Error("access_subject is still NOT NULL");
  const migration = db
    .prepare("SELECT 1 FROM schema_migrations WHERE version=2")
    .get();
  if (migration === undefined) throw new Error("Migration version 2 is absent");
  if (
    db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get() ===
    undefined
  )
    throw new Error("Migration version 3 is absent");
  if (
    db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get() ===
    undefined
  )
    throw new Error("Migration version 4 is absent");
  for (const version of [5, 6]) {
    if (
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version) ===
      undefined
    )
      throw new Error(`Migration version ${version} is absent`);
  }
  const outputs = db
    .prepare("PRAGMA table_info(jobs)")
    .all()
    .find(({ name }) => name === "outputs_json");
  if (outputs?.notnull !== 1)
    throw new Error("jobs.outputs_json is absent or nullable");
  for (const table of [
    "remote_mcp_clients",
    "remote_mcp_authorization_codes",
    "remote_mcp_token_families",
    "remote_mcp_tokens",
    "remote_mcp_principals",
    "source_refs",
    "remote_mcp_rate_limits",
  ]) {
    if (
      db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
        .get(table) === undefined
    )
      throw new Error(`Remote MCP table ${table} is absent`);
  }
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
    throw new Error("SQLite integrity_check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length !== 0)
    throw new Error("SQLite foreign_key_check failed");
}

function assertNullAndUniqueBehavior(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare(`INSERT INTO users
      (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES (?,NULL,?,?,'user','active',1,'migration-preflight','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    insert.run(
      "user_preflight_null_1",
      "preflight-null-1@example.invalid",
      "Preflight 1",
    );
    insert.run(
      "user_preflight_null_2",
      "preflight-null-2@example.invalid",
      "Preflight 2",
    );
    const linked = db.prepare(`INSERT INTO users
      (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES (?,'preflight-subject',?,?,'user','active',1,'migration-preflight','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    linked.run(
      "user_preflight_linked_1",
      "preflight-linked-1@example.invalid",
      "Linked 1",
    );
    let duplicateRejected = false;
    try {
      linked.run(
        "user_preflight_linked_2",
        "preflight-linked-2@example.invalid",
        "Linked 2",
      );
    } catch {
      duplicateRejected = true;
    }
    if (!duplicateRejected)
      throw new Error("Duplicate non-NULL subject was accepted");
  } finally {
    db.exec("ROLLBACK");
  }
}
