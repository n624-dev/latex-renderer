import type { DatabaseSync } from "node:sqlite";

const usersAccessSubjectV2Sql = `
DROP INDEX IF EXISTS idx_users_access_subject_unique;
CREATE TABLE users_v2 (
  id TEXT PRIMARY KEY,
  access_subject TEXT,
  access_subject_linked_at TEXT,
  access_subject_generation INTEGER NOT NULL DEFAULT 0 CHECK(access_subject_generation >= 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users_v2 (
  id, access_subject, access_subject_linked_at, access_subject_generation,
  email, display_name, role, status, security_version, created_by,
  created_at, updated_at, last_login_at
)
SELECT
  id, access_subject,
  CASE WHEN access_subject IS NULL THEN NULL ELSE COALESCE(last_login_at, created_at) END,
  CASE WHEN access_subject IS NULL THEN 0 ELSE 1 END,
  email, display_name, role, status, security_version, created_by,
  created_at, updated_at, last_login_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
CREATE UNIQUE INDEX idx_users_access_subject_unique
  ON users(access_subject) WHERE access_subject IS NOT NULL;
INSERT INTO schema_migrations(version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

export function applyDatabaseMigrations(db: DatabaseSync): void {
  applyUsersAccessSubjectV2(db);
  applySourcesV3(db);
  applyRemoteMcpV4(db);
  applyWebAppProjectsV5(db);
  applySvgOutputsV6(db);
}

const sourcesV3Sql = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('reserved','uploading','ready','deleting','deleted','expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uploaded_at TEXT,
  paths_json TEXT,
  dedupe_eligible INTEGER NOT NULL DEFAULT 1 CHECK(dedupe_eligible IN (0,1)),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS source_upload_nonces (
  nonce TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  state TEXT NOT NULL CHECK(state IN ('unused','claimed','consumed','released','expired')),
  claim_owner TEXT,
  claimed_at TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL
);
ALTER TABLE jobs ADD COLUMN source_id TEXT REFERENCES sources(id);
ALTER TABLE jobs ADD COLUMN entrypoint TEXT NOT NULL DEFAULT 'main.tex';
INSERT INTO sources(id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at,uploaded_at,dedupe_eligible)
SELECT 'source_' || substr(id,5),user_id,source_size,source_sha256,
       'jobs/' || id || '/input/source.zip',
       CASE WHEN status IN ('reserved','uploading') THEN 'reserved' ELSE 'ready' END,
       created_at,updated_at,
       CASE WHEN status IN ('reserved','uploading') THEN strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+10 minutes') ELSE strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 hour') END,
       CASE WHEN status IN ('reserved','uploading') THEN NULL ELSE updated_at END,0
FROM jobs;
UPDATE jobs SET source_id='source_' || substr(id,5) WHERE source_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_sources_owner_status ON sources(owner_user_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_sources_owner_content_ready ON sources(owner_user_id,sha256,size) WHERE status='ready' AND dedupe_eligible=1;
CREATE INDEX IF NOT EXISTS idx_source_nonces_expiry ON source_upload_nonces(state,expires_at);
INSERT OR IGNORE INTO system_settings(key,value_json,updated_by,updated_at)
VALUES ('source_orphan_retention_minutes','60','migration',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations(version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyUsersAccessSubjectV2(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get() !==
      undefined;
    if (!applied) {
      db.exec(usersAccessSubjectV2Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0) {
        throw new Error(
          `Database migration 2 introduced ${violations.length} foreign-key violation(s)`,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the migration error if SQLite already rolled back the transaction.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}

function applySourcesV3(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get() !==
      undefined;
    if (!applied) {
      db.exec(sourcesV3Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0)
        throw new Error(
          `Database migration 3 introduced ${violations.length} foreign-key violation(s)`,
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}

const remoteMcpV4Sql = `
CREATE TABLE IF NOT EXISTS remote_mcp_clients (
  client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS remote_mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES remote_mcp_clients(client_id),
  user_id TEXT NOT NULL REFERENCES users(id), redirect_uri TEXT NOT NULL,
  scopes_json TEXT NOT NULL, resource TEXT NOT NULL, code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS remote_mcp_token_families (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES remote_mcp_clients(client_id),
  user_id TEXT NOT NULL REFERENCES users(id), user_security_version INTEGER NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS remote_mcp_tokens (
  token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES remote_mcp_token_families(id),
  token_type TEXT NOT NULL CHECK(token_type IN ('access','refresh')),
  sequence INTEGER NOT NULL CHECK(sequence >= 0), created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS remote_mcp_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  service_account_id TEXT NOT NULL UNIQUE REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS remote_mcp_rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id), tool_name TEXT NOT NULL,
  window_start TEXT NOT NULL, request_count INTEGER NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(user_id,tool_name,window_start)
);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_codes_expiry ON remote_mcp_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_tokens_expiry ON remote_mcp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_tokens_family ON remote_mcp_tokens(family_id,token_type,sequence);
CREATE INDEX IF NOT EXISTS idx_source_refs_owner_expiry ON source_refs(owner_user_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_rate_window ON remote_mcp_rate_limits(window_start);
INSERT INTO schema_migrations(version,applied_at)
VALUES (4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyRemoteMcpV4(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get() !==
      undefined;
    if (!applied) {
      db.exec(remoteMcpV4Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0)
        throw new Error(
          `Database migration 4 introduced ${violations.length} foreign-key violation(s)`,
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the original migration error. */
    }
    throw error;
  }
}

const webAppProjectsV5Sql = `
CREATE TABLE IF NOT EXISTS web_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  service_account_id TEXT NOT NULL UNIQUE REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS project_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 240),
  entrypoint TEXT NOT NULL CHECK(length(entrypoint) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, revision_number),
  UNIQUE(project_id, source_id, entrypoint)
);
ALTER TABLE jobs ADD COLUMN project_revision_id TEXT REFERENCES project_revisions(id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_user_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_revisions_project_number ON project_revisions(project_id,revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_project_revisions_source ON project_revisions(source_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_revision ON jobs(project_revision_id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyWebAppProjectsV5(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get() !==
      undefined;
    if (!applied) {
      db.exec(webAppProjectsV5Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0)
        throw new Error(
          `Database migration 5 introduced ${violations.length} foreign-key violation(s)`,
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the original migration error. */
    }
    throw error;
  }
}

const svgOutputsV6Sql = `
ALTER TABLE jobs ADD COLUMN outputs_json TEXT NOT NULL DEFAULT '["pdf"]' CHECK(json_valid(outputs_json));
CREATE TABLE artifacts_v6 (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL CHECK(type IN ('source','pdf','log','errors','dependencies','preview','svg','svg_manifest')),
  relative_path TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, relative_path)
);
INSERT INTO artifacts_v6(id,job_id,type,relative_path,size,sha256,created_at)
SELECT id,job_id,type,relative_path,size,sha256,created_at FROM artifacts;
DROP TABLE artifacts;
ALTER TABLE artifacts_v6 RENAME TO artifacts;
CREATE INDEX idx_artifacts_job ON artifacts(job_id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applySvgOutputsV6(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=6").get() !==
      undefined;
    if (!applied) {
      db.exec(svgOutputsV6Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0)
        throw new Error(
          `Database migration 6 introduced ${violations.length} foreign-key violation(s)`,
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the original migration error. */
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}
