import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "../packages/database/src/index.js";

const roots: string[] = [];
const initialSql = readFileSync(
  new URL("../deploy/migrations/001_initial.sql", import.meta.url),
  "utf8",
);
const deploymentMigration = readFileSync(
  new URL(
    "../deploy/migrations/002_users_access_subject_nullable.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourcesMigration = readFileSync(
  new URL("../deploy/migrations/003_sources.sql", import.meta.url),
  "utf8",
);
const remoteMcpMigration = readFileSync(
  new URL("../deploy/migrations/004_remote_mcp.sql", import.meta.url),
  "utf8",
);
const webAppMigration = readFileSync(
  new URL("../deploy/migrations/005_web_app_projects.sql", import.meta.url),
  "utf8",
);
const svgOutputsMigration = readFileSync(
  new URL("../deploy/migrations/006_svg_outputs.sql", import.meta.url),
  "utf8",
);
const browserAuthMigration = readFileSync(
  new URL("../deploy/migrations/007_browser_auth.sql", import.meta.url),
  "utf8",
);
const workerLeaseFencingMigration = readFileSync(
  new URL("../deploy/migrations/008_worker_lease_fencing.sql", import.meta.url),
  "utf8",
);
const cleanupStateMigration = readFileSync(
  new URL("../deploy/migrations/009_cleanup_state.sql", import.meta.url),
  "utf8",
);
const admissionReservationsMigration = readFileSync(
  new URL(
    "../deploy/migrations/010_admission_reservations.sql",
    import.meta.url,
  ),
  "utf8",
);
const uploadClaimLeasesMigration = readFileSync(
  new URL("../deploy/migrations/011_upload_claim_leases.sql", import.meta.url),
  "utf8",
);
const projectRevisionOutputsMigration = readFileSync(
  new URL(
    "../deploy/migrations/014_project_revision_outputs.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourceUploadConcurrencyMigration = readFileSync(
  new URL(
    "../deploy/migrations/015_source_upload_concurrency.sql",
    import.meta.url,
  ),
  "utf8",
);
const apiKeyKindMigration = readFileSync(
  new URL("../deploy/migrations/016_api_key_kind.sql", import.meta.url),
  "utf8",
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("database migration 002", () => {
  it("preserves legacy users and dependent rows through the runtime migration", () => {
    const { path, db: legacy } = legacyDatabase();
    seedLegacyUsers(legacy);
    legacy
      .prepare(
        `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
         VALUES ('sa_legacy','user_owner','Legacy','generic','active',1,?,?)`,
      )
      .run("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    legacy.close();

    const migrated = new RendererDatabase(path);
    migrated.migrate();

    expect(migrated.users.get("user_owner")).toMatchObject({
      access_subject: "subject-owner",
      access_subject_linked_at: "2026-01-01T00:00:00Z",
      access_subject_generation: 1,
      role: "owner",
      status: "active",
    });
    expect(migrated.users.get("user_disabled")).toMatchObject({
      access_subject: "subject-disabled",
      role: "admin",
      status: "disabled",
    });
    expect(migrated.raw.prepare("PRAGMA foreign_key_check").all()).toHaveLength(
      0,
    );
    expect(
      migrated.raw
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual(
      Array.from({ length: 16 }, (_, index) => ({ version: index + 1 })),
    );

    expect(() => migrated.migrate()).not.toThrow();
    migrated.close();
  });

  it("accepts multiple NULL subjects but rejects duplicate linked subjects", () => {
    const { path, db: legacy } = legacyDatabase();
    seedLegacyUsers(legacy);
    legacy.close();
    const migrated = new RendererDatabase(path);
    migrated.migrate();

    insertUser(migrated.raw, "user_invited_1", null, "invite1@example.com");
    insertUser(migrated.raw, "user_invited_2", null, "invite2@example.com");
    expect(
      migrated.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE access_subject IS NULL",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(() =>
      insertUser(
        migrated.raw,
        "user_duplicate",
        "subject-owner",
        "duplicate@example.com",
      ),
    ).toThrow(/UNIQUE constraint failed/);
    migrated.close();
  });

  it("keeps the standalone deployment migration compatible with schema version 1", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);

    db.exec(deploymentMigration);

    const subject = db
      .prepare("PRAGMA table_info(users)")
      .all()
      .find((column) => column.name === "access_subject");
    expect(subject).toMatchObject({ notnull: 0 });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({
      count: 2,
    });
    db.close();
  });

  it("backfills legacy jobs into immutable Sources in the standalone migration", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    const timestamp = "2026-01-06T00:00:00Z";
    db.prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
       VALUES ('sa_source','user_owner','Source','generic','active',1,?,?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
       VALUES ('key_source','sa_source','Source','prefix-source','hash','v1','["render:create"]',?,'test')`,
    ).run(timestamp);
    db.prepare(
      `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,queued_at)
       VALUES ('job_0123456789abcdef0123456789abcdef','user_owner','sa_source','key_source','queued','legacy',123,?, ?, ?, ?)`,
    ).run("a".repeat(64), timestamp, timestamp, timestamp);

    db.exec(deploymentMigration);
    db.exec(sourcesMigration);

    expect(
      db
        .prepare(
          "SELECT source_id,entrypoint FROM jobs WHERE id='job_0123456789abcdef0123456789abcdef'",
        )
        .get(),
    ).toEqual({
      source_id: "source_0123456789abcdef0123456789abcdef",
      entrypoint: "main.tex",
    });
    expect(
      db
        .prepare(
          "SELECT owner_user_id,size,sha256,storage_key,status,dedupe_eligible FROM sources",
        )
        .get(),
    ).toEqual({
      owner_user_id: "user_owner",
      size: 123,
      sha256: "a".repeat(64),
      storage_key: "jobs/job_0123456789abcdef0123456789abcdef/input/source.zip",
      status: "ready",
      dedupe_eligible: 0,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    expect(
      db
        .prepare(
          "SELECT value_json FROM system_settings WHERE key='source_orphan_retention_minutes'",
        )
        .get(),
    ).toEqual({ value_json: "60" });
    db.close();
  });

  it("adds the standalone Remote MCP schema without changing existing rows", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    db.exec(deploymentMigration);
    db.exec(sourcesMigration);
    const usersBefore = db.prepare("SELECT COUNT(*) AS count FROM users").get();

    db.exec(remoteMcpMigration);

    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual(
      usersBefore,
    );
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.close();
  });

  it("adds Web principals, Projects, revisions, and Job linkage", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    db.exec(deploymentMigration);
    db.exec(sourcesMigration);
    db.exec(remoteMcpMigration);
    db.exec(webAppMigration);

    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
    expect(
      db
        .prepare("PRAGMA table_info(jobs)")
        .all()
        .some((column) => column.name === "project_revision_id"),
    ).toBe(true);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.close();
  });

  it("adds opt-in output selection and SVG artifact types", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    db.exec(deploymentMigration);
    db.exec(sourcesMigration);
    db.exec(remoteMcpMigration);
    db.exec(webAppMigration);
    db.exec(svgOutputsMigration);

    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([1, 2, 3, 4, 5, 6].map((version) => ({ version })));
    const outputs = db
      .prepare("PRAGMA table_info(jobs)")
      .all()
      .find((column) => column.name === "outputs_json");
    expect(outputs).toMatchObject({ notnull: 1, dflt_value: "'[\"pdf\"]'" });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.close();
  });

  it("adds provider-neutral identities, credentials, and hashed sessions", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    db.exec(deploymentMigration);
    db.exec(sourcesMigration);
    db.exec(remoteMcpMigration);
    db.exec(webAppMigration);
    db.exec(svgOutputsMigration);
    db.exec(browserAuthMigration);

    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([1, 2, 3, 4, 5, 6, 7].map((version) => ({ version })));
    const email = db
      .prepare("PRAGMA table_info(users)")
      .all()
      .find((column) => column.name === "email");
    expect(email).toMatchObject({ notnull: 0 });
    db.prepare(
      `INSERT INTO users
       (id,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES ('user_no_email',NULL,'No email','user','active',1,'test',?,?)`,
    ).run("2026-08-30T00:00:00Z", "2026-08-30T00:00:00Z");
    db.prepare(
      `INSERT INTO users
       (id,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES ('user_same_email','owner@example.com','Duplicate attribute','user','active',1,'test',?,?)`,
    ).run("2026-08-30T00:00:00Z", "2026-08-30T00:00:00Z");
    db.prepare(
      `INSERT INTO user_identities
       (id,user_id,provider,issuer,subject,linked_at,last_seen_at)
       VALUES ('identity_owner','user_owner','oidc','https://id.example.test','stable-subject',?,?)`,
    ).run("2026-08-30T00:00:00Z", "2026-08-30T00:00:00Z");
    db.prepare(
      `INSERT INTO local_credentials
       (user_id,login_name,password_hash,password_updated_at)
       VALUES ('user_no_email','local-owner',?,?)`,
    ).run(
      "$scrypt$ln=17,r=8,p=1$" + "a".repeat(44) + "$" + "b".repeat(44),
      "2026-08-30T00:00:00Z",
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO user_identities
         (id,user_id,provider,issuer,subject,linked_at,last_seen_at)
         VALUES ('identity_duplicate','user_disabled','oidc','https://id.example.test','stable-subject',?,?)`,
        )
        .run("2026-08-30T00:00:00Z", "2026-08-30T00:00:00Z"),
    ).toThrow(/UNIQUE constraint failed/);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.close();
  });

  it("adds a monotonic Worker lease fencing generation", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    for (const migration of [
      deploymentMigration,
      sourcesMigration,
      remoteMcpMigration,
      webAppMigration,
      svgOutputsMigration,
      browserAuthMigration,
      workerLeaseFencingMigration,
    ])
      db.exec(migration);

    const generation = db
      .prepare("PRAGMA table_info(jobs)")
      .all()
      .find((column) => column.name === "lease_generation");
    expect(generation).toMatchObject({ notnull: 1, dflt_value: "0" });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((version) => ({ version })));
    db.close();
  });

  it("separates render results from cleanup retry state", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    for (const migration of [
      deploymentMigration,
      sourcesMigration,
      remoteMcpMigration,
      webAppMigration,
      svgOutputsMigration,
      browserAuthMigration,
      workerLeaseFencingMigration,
      cleanupStateMigration,
    ])
      db.exec(migration);

    const jobColumns = Object.fromEntries(
        db
          .prepare("PRAGMA table_info(jobs)")
          .all()
          .map((column) => [String(column.name), column]),
      ),
      sourceColumns = Object.fromEntries(
        db
          .prepare("PRAGMA table_info(sources)")
          .all()
          .map((column) => [String(column.name), column]),
      );
    expect(jobColumns.render_status).toBeDefined();
    expect(jobColumns.deletion_status).toMatchObject({
      notnull: 1,
      dflt_value: "'retained'",
    });
    expect(jobColumns.deletion_attempts).toMatchObject({
      notnull: 1,
      dflt_value: "0",
    });
    expect(sourceColumns.deletion_status).toMatchObject({
      notnull: 1,
      dflt_value: "'retained'",
    });
    expect(sourceColumns.deletion_next_attempt_at).toBeDefined();
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((version) => ({ version })));
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    db.close();
  });

  it("adds output reservations and a user-wide active Job policy", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    for (const migration of [
      deploymentMigration,
      sourcesMigration,
      remoteMcpMigration,
      webAppMigration,
      svgOutputsMigration,
      browserAuthMigration,
      workerLeaseFencingMigration,
      cleanupStateMigration,
    ])
      db.exec(migration);
    const timestamp = "2026-08-30T00:00:00.000Z";
    db.prepare(
      "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('sa_active','user_owner','active','generic','active',1,?,?)",
    ).run(timestamp, timestamp);
    db.prepare(
      "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key_active','sa_active','active','active-prefix','hash','v1','[]',?,'test')",
    ).run(timestamp);
    db.prepare(
      `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,
       source_size,source_sha256,created_at,updated_at)
       VALUES ('job_active00000000000000000000000000','user_owner','sa_active','key_active','queued','test',1,?,?,?)`,
    ).run("0".repeat(64), timestamp, timestamp);
    db.exec(admissionReservationsMigration);

    expect(
      db
        .prepare(
          "SELECT reserved_output_bytes FROM jobs WHERE id='job_active00000000000000000000000000'",
        )
        .get(),
    ).toEqual({ reserved_output_bytes: 209_715_200 });
    expect(
      db
        .prepare(
          "SELECT value_json FROM system_settings WHERE key='max_user_active_jobs'",
        )
        .get(),
    ).toEqual({ value_json: "20" });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((version) => ({ version })),
    );
    db.close();
  });

  it("separates upload ticket expiry from the active claim lease", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    for (const migration of [
      deploymentMigration,
      sourcesMigration,
      remoteMcpMigration,
      webAppMigration,
      svgOutputsMigration,
      browserAuthMigration,
      workerLeaseFencingMigration,
      cleanupStateMigration,
      admissionReservationsMigration,
      uploadClaimLeasesMigration,
    ])
      db.exec(migration);

    for (const table of ["used_nonces", "source_upload_nonces"]) {
      const claimExpiry = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .find((column) => column.name === "claim_expires_at");
      expect(claimExpiry).toMatchObject({ notnull: 0 });
    }
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((version) => ({ version })),
    );
    db.close();
  });

  it("stores the output selection on each Project revision", () => {
    const { db } = legacyDatabase();
    seedLegacyUsers(db);
    for (const migration of [
      deploymentMigration,
      sourcesMigration,
      remoteMcpMigration,
      webAppMigration,
      projectRevisionOutputsMigration,
    ])
      db.exec(migration);

    const outputs = db
      .prepare("PRAGMA table_info(project_revisions)")
      .all()
      .find((column) => column.name === "outputs_json");
    expect(outputs).toMatchObject({ notnull: 1, dflt_value: "'[\"pdf\"]'" });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([1, 2, 3, 4, 5, 14].map((version) => ({ version })));
    db.close();
  });

  it("adds upload leases and API-key kinds to a legacy database", () => {
    const { db, path } = legacyDatabase();
    seedLegacyUsers(db);
    db.exec(deploymentMigration);
    db.exec(sourcesMigration);
    const timestamp = "2026-08-31T00:00:00.000Z";
    db.prepare(
      "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('sa_kind','user_owner','kind','generic','active',1,?,?)",
    ).run(timestamp, timestamp);
    db.prepare(
      "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key_kind','sa_kind','kind','lra_legacy','hash','v1','[\"admin:*\"]',?,'test')",
    ).run(timestamp);

    db.exec(sourceUploadConcurrencyMigration);
    db.exec(apiKeyKindMigration);

    const sourceColumns = Object.fromEntries(
      db
        .prepare("PRAGMA table_info(sources)")
        .all()
        .map((column) => [String(column.name), column]),
    );
    expect(sourceColumns.upload_received_bytes).toMatchObject({
      notnull: 1,
      dflt_value: "0",
    });
    expect(sourceColumns.upload_lease_owner).toBeDefined();
    expect(sourceColumns.upload_lease_expires_at).toBeDefined();
    expect(
      db
        .prepare("SELECT kind FROM api_keys WHERE id='key_kind'")
        .get(),
    ).toEqual({ kind: "admin" });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sources_upload_lease'")
        .get(),
    ).toEqual({ name: "idx_sources_upload_lease" });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 15 },
      { version: 16 },
    ]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    db.prepare("UPDATE api_keys SET kind='render' WHERE id='key_kind'").run();
    db.close();

    const reopened = new RendererDatabase(path);
    reopened.migrate();
    expect(
      reopened.raw
        .prepare("SELECT kind FROM api_keys WHERE id='key_kind'")
        .get(),
    ).toEqual({ kind: "render" });
    reopened.close();
  });

  it("creates the new columns on a fresh runtime database before applying them again", () => {
    const db = new RendererDatabase(":memory:");
    db.migrate();
    expect(
      db
        .raw
        .prepare("PRAGMA table_info(sources)")
        .all()
        .some((column) => column.name === "upload_received_bytes"),
    ).toBe(true);
    expect(
      db
        .raw
        .prepare("PRAGMA table_info(api_keys)")
        .all()
        .some((column) => column.name === "kind"),
    ).toBe(true);
    expect(() => db.migrate()).not.toThrow();
    db.close();
  });
});

function legacyDatabase(): { path: string; db: DatabaseSync } {
  const root = mkdtempSync(join(tmpdir(), "latex-migration-test-"));
  roots.push(root);
  const path = join(root, "renderer.sqlite3");
  const db = new DatabaseSync(path);
  db.exec(initialSql);
  return { path, db };
}

function seedLegacyUsers(db: DatabaseSync): void {
  const insert = db.prepare(`INSERT INTO users
    (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at,last_login_at)
    VALUES (?,?,?,?,?,?,1,'test',?,?,?)`);
  insert.run(
    "user_owner",
    "subject-owner",
    "owner@example.com",
    "Owner",
    "owner",
    "active",
    "2026-01-01T00:00:00Z",
    "2026-01-02T00:00:00Z",
    null,
  );
  insert.run(
    "user_disabled",
    "subject-disabled",
    "disabled@example.com",
    "Disabled",
    "admin",
    "disabled",
    "2026-01-03T00:00:00Z",
    "2026-01-04T00:00:00Z",
    "2026-01-05T00:00:00Z",
  );
}

function insertUser(
  db: DatabaseSync,
  id: string,
  subject: string | null,
  email: string,
): void {
  db.prepare(
    `INSERT INTO users
    (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES (?,?,?,'Invited','user','active',1,'test','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  ).run(id, subject, email);
}
