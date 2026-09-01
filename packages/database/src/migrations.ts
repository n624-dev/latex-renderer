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
  applyBrowserAuthV7(db);
  applyWorkerLeaseFencingV8(db);
  applyCleanupStateV9(db);
  applyAdmissionReservationsV10(db);
  applyUploadClaimLeasesV11(db);
  applyAuthorizationCodeSecurityVersionV12(db);
  applyListPaginationIndexesV13(db);
  applyProjectRevisionOutputsV14(db);
  applySourceUploadConcurrencyV15(db);
  applyApiKeyKindV16(db);
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
  user_id TEXT NOT NULL REFERENCES users(id),
  user_security_version INTEGER NOT NULL DEFAULT 1 CHECK(user_security_version > 0),
  redirect_uri TEXT NOT NULL,
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
  outputs_json TEXT NOT NULL DEFAULT '["pdf"]' CHECK(json_valid(outputs_json)),
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

const browserAuthV7Sql = `
DROP INDEX IF EXISTS idx_users_access_subject_unique;
CREATE TABLE users_v7 (
  id TEXT PRIMARY KEY,
  access_subject TEXT,
  access_subject_linked_at TEXT,
  access_subject_generation INTEGER NOT NULL DEFAULT 0 CHECK(access_subject_generation >= 0),
  email TEXT COLLATE NOCASE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users_v7 (
  id,access_subject,access_subject_linked_at,access_subject_generation,email,
  display_name,role,status,security_version,created_by,created_at,updated_at,last_login_at
)
SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,
       display_name,role,status,security_version,created_by,created_at,updated_at,last_login_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v7 RENAME TO users;
CREATE UNIQUE INDEX idx_users_access_subject_unique
  ON users(access_subject) WHERE access_subject IS NOT NULL;
CREATE INDEX idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('cloudflare-access','oidc')),
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 8 AND 2048),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 500),
  preferred_username TEXT CHECK(preferred_username IS NULL OR length(preferred_username) <= 500),
  email_at_provider TEXT CHECK(email_at_provider IS NULL OR length(email_at_provider) <= 320),
  linked_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(provider,issuer,subject),
  UNIQUE(user_id,provider,issuer)
);
CREATE INDEX idx_user_identities_user ON user_identities(user_id);

CREATE TABLE local_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  login_name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(login_name) BETWEEN 3 AND 64),
  password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 80 AND 512),
  password_updated_at TEXT NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES users(id),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('cloudflare-access','oidc','password')),
  identity_id TEXT REFERENCES user_identities(id) ON DELETE SET NULL,
  user_security_version INTEGER NOT NULL CHECK(user_security_version > 0),
  csrf_hash TEXT NOT NULL CHECK(length(csrf_hash)=64),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id,revoked_at,absolute_expires_at);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(idle_expires_at,absolute_expires_at);

CREATE TABLE auth_login_attempts (
  key_hash TEXT PRIMARY KEY CHECK(length(key_hash)=64),
  failure_count INTEGER NOT NULL CHECK(failure_count > 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_auth_login_attempts_updated ON auth_login_attempts(updated_at);

INSERT INTO schema_migrations(version,applied_at)
VALUES (7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyBrowserAuthV7(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=7").get() !==
      undefined;
    if (!applied) {
      db.exec(browserAuthV7Sql);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length !== 0)
        throw new Error(
          `Database migration 7 introduced ${violations.length} foreign-key violation(s)`,
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

const workerLeaseFencingV8Sql = `
ALTER TABLE jobs
ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0
CHECK(lease_generation >= 0);
INSERT INTO schema_migrations(version,applied_at)
VALUES (8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyWorkerLeaseFencingV8(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=8").get() !==
      undefined;
    if (!applied) db.exec(workerLeaseFencingV8Sql);
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

const cleanupStateV9Sql = `
ALTER TABLE jobs ADD COLUMN render_status TEXT
CHECK(render_status IS NULL OR render_status IN ('succeeded','failed','timeout','canceled','rejected','expired'));
ALTER TABLE jobs ADD COLUMN deletion_status TEXT NOT NULL DEFAULT 'retained'
CHECK(deletion_status IN ('retained','pending','deleting','retry','failed','deleted'));
ALTER TABLE jobs ADD COLUMN deletion_attempts INTEGER NOT NULL DEFAULT 0
CHECK(deletion_attempts >= 0);
ALTER TABLE jobs ADD COLUMN deletion_error TEXT;
ALTER TABLE jobs ADD COLUMN deletion_next_attempt_at TEXT;
UPDATE jobs SET render_status=status
WHERE status IN ('succeeded','failed','timeout','canceled','rejected','expired');
UPDATE jobs SET deletion_status='deleting' WHERE status='deleting';
UPDATE jobs SET deletion_status='deleted' WHERE status='deleted';
CREATE INDEX idx_jobs_deletion_retry
ON jobs(deletion_status,deletion_next_attempt_at,updated_at);

ALTER TABLE sources ADD COLUMN deletion_status TEXT NOT NULL DEFAULT 'retained'
CHECK(deletion_status IN ('retained','pending','deleting','retry','failed','deleted'));
ALTER TABLE sources ADD COLUMN deletion_attempts INTEGER NOT NULL DEFAULT 0
CHECK(deletion_attempts >= 0);
ALTER TABLE sources ADD COLUMN deletion_error TEXT;
ALTER TABLE sources ADD COLUMN deletion_next_attempt_at TEXT;
UPDATE sources SET deletion_status='deleting' WHERE status='deleting';
UPDATE sources SET deletion_status='deleted' WHERE status='deleted';
CREATE INDEX idx_sources_deletion_retry
ON sources(deletion_status,deletion_next_attempt_at,updated_at);

INSERT INTO schema_migrations(version,applied_at)
VALUES (9,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyCleanupStateV9(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=9").get() !==
      undefined;
    if (!applied) db.exec(cleanupStateV9Sql);
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

const admissionReservationsV10Sql = `
ALTER TABLE jobs ADD COLUMN reserved_output_bytes INTEGER NOT NULL DEFAULT 209715200
CHECK(reserved_output_bytes >= 0);
UPDATE jobs SET reserved_output_bytes=0
WHERE status IN ('succeeded','failed','timeout','canceled','rejected','deleting','deleted','expired');

INSERT OR IGNORE INTO system_settings(key,value_json,updated_by,updated_at)
VALUES ('max_user_active_jobs','20','migration',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE INDEX idx_jobs_user_active
ON jobs(user_id,status);

INSERT INTO schema_migrations(version,applied_at)
VALUES (10,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyAdmissionReservationsV10(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get() !==
      undefined;
    if (!applied) db.exec(admissionReservationsV10Sql);
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

const uploadClaimLeasesV11Sql = `
ALTER TABLE used_nonces ADD COLUMN claim_expires_at TEXT;
UPDATE used_nonces SET claim_expires_at=expires_at WHERE state='claimed';

ALTER TABLE source_upload_nonces ADD COLUMN claim_expires_at TEXT;
UPDATE source_upload_nonces SET claim_expires_at=expires_at WHERE state='claimed';

CREATE INDEX idx_nonces_claim_expiry
ON used_nonces(state,claim_expires_at);
CREATE INDEX idx_source_nonces_claim_expiry
ON source_upload_nonces(state,claim_expires_at);

INSERT INTO schema_migrations(version,applied_at)
VALUES (11,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyUploadClaimLeasesV11(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=11").get() !==
      undefined;
    if (!applied) db.exec(uploadClaimLeasesV11Sql);
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

const listPaginationIndexesV13Sql = `
CREATE INDEX IF NOT EXISTS idx_users_created_id
  ON users(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_service_accounts_created_id
  ON service_accounts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_id
  ON api_keys(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created_id
  ON jobs(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created_id
  ON jobs(user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_source_created_id
  ON jobs(source_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_revision_created_id
  ON jobs(project_revision_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sources_created_id
  ON sources(created_at DESC,id DESC) WHERE status!='deleted';
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated_id
  ON projects(owner_user_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
INSERT INTO schema_migrations(version,applied_at)
VALUES (13,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyListPaginationIndexesV13(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=13").get() !==
      undefined;
    if (!applied) db.exec(listPaginationIndexesV13Sql);
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

const projectRevisionOutputsV14Sql = `
ALTER TABLE project_revisions
ADD COLUMN outputs_json TEXT NOT NULL DEFAULT '["pdf"]'
CHECK(json_valid(outputs_json));
INSERT INTO schema_migrations(version,applied_at)
VALUES (14,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

function applyProjectRevisionOutputsV14(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get() !==
      undefined;
    if (!applied) {
      const columns = db
        .prepare("PRAGMA table_info(project_revisions)")
        .all() as Array<{ name?: unknown }>;
      if (!columns.some((column) => column.name === "outputs_json"))
        db.exec(projectRevisionOutputsV14Sql);
      else
        db.exec(
          "INSERT INTO schema_migrations(version,applied_at) VALUES (14,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        );
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* Preserve the migration error. */
    }
    throw error;
  }
}

function applySourceUploadConcurrencyV15(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=15").get() !==
      undefined;
    const columns = db.prepare("PRAGMA table_info(sources)").all() as Array<{
      name?: unknown;
    }>;
    const names = new Set(columns.map((column) => column.name));
    // New schemas already contain these columns; legacy schemas do not. Check
    // the actual schema even when a marker was restored independently.
    if (!names.has("upload_received_bytes"))
      db.exec(
        "ALTER TABLE sources ADD COLUMN upload_received_bytes INTEGER NOT NULL DEFAULT 0 CHECK(upload_received_bytes >= 0)",
      );
    if (!names.has("upload_lease_owner"))
      db.exec("ALTER TABLE sources ADD COLUMN upload_lease_owner TEXT");
    if (!names.has("upload_lease_expires_at"))
      db.exec("ALTER TABLE sources ADD COLUMN upload_lease_expires_at TEXT");
    db.exec(
      "UPDATE sources SET upload_received_bytes=size WHERE status='ready' AND upload_received_bytes=0",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sources_upload_lease ON sources(status,upload_lease_expires_at)",
    );
    if (!applied) {
      db.exec(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (15,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
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

function applyApiKeyKindV16(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=16").get() !==
      undefined;
    const columns = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{
        name?: unknown;
      }>,
      hadKindColumn = columns.some((column) => column.name === "kind");
    if (!hadKindColumn)
      db.exec(
        "ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'render' CHECK(kind IN ('render','admin'))",
      );
    // Prefixes are consulted only once to backfill legacy rows. Runtime
    // authorization uses api_keys.kind.
    if (!applied || !hadKindColumn)
      db.exec("UPDATE api_keys SET kind='admin' WHERE prefix GLOB 'lra_*'");
    if (!applied) {
      db.exec(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (16,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
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

function applyAuthorizationCodeSecurityVersionV12(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const applied =
      db.prepare("SELECT 1 FROM schema_migrations WHERE version=12").get() !==
      undefined;
    if (!applied) {
      const columns = db
        .prepare("PRAGMA table_info(remote_mcp_authorization_codes)")
        .all() as Array<{ name?: unknown }>;
      if (!columns.some((column) => column.name === "user_security_version"))
        db.exec(
          "ALTER TABLE remote_mcp_authorization_codes ADD COLUMN user_security_version INTEGER NOT NULL DEFAULT 1 CHECK(user_security_version > 0)",
        );
      db.exec(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (12,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
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
