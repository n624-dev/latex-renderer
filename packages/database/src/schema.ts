export const schemaSql = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS service_accounts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK(client_type IN ('codex','claude-code','mcp','ci','generic')),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  service_account_id TEXT NOT NULL REFERENCES service_accounts(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  pepper_id TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service_account_id TEXT NOT NULL REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  status TEXT NOT NULL CHECK(status IN ('reserved','uploading','queued','validating','running','succeeded','failed','timeout','canceled','rejected','deleting','deleted','expired')),
  renderer_version TEXT NOT NULL,
  source_size INTEGER NOT NULL CHECK(source_size >= 0),
  source_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  queued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  exit_code INTEGER,
  error_code TEXT,
  error_message TEXT,
  output_size INTEGER CHECK(output_size IS NULL OR output_size >= 0),
  cancel_requested_at TEXT,
  retry_of_job_id TEXT REFERENCES jobs(id),
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL CHECK(type IN ('source','pdf','log','errors','dependencies','preview')),
  relative_path TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, relative_path)
);

CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  state TEXT NOT NULL CHECK(state IN ('unused','claimed','consumed','released','expired')),
  claim_owner TEXT,
  claimed_at TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS revoked_tickets (
  selector_type TEXT NOT NULL CHECK(selector_type IN ('jti','kid')),
  selector_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(selector_type, selector_value)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT,
  response_code INTEGER,
  response_json TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_type, actor_id, operation, key_hash)
);

CREATE TABLE IF NOT EXISTS artifact_download_leases (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  result TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remote_mcp_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES remote_mcp_clients(client_id),
  user_id TEXT NOT NULL REFERENCES users(id),
  redirect_uri TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_mcp_token_families (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES remote_mcp_clients(client_id),
  user_id TEXT NOT NULL REFERENCES users(id),
  user_security_version INTEGER NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES remote_mcp_token_families(id),
  token_type TEXT NOT NULL CHECK(token_type IN ('access','refresh')),
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_mcp_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  service_account_id TEXT NOT NULL UNIQUE REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS remote_mcp_rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(user_id, tool_name, window_start)
);

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

CREATE INDEX IF NOT EXISTS idx_jobs_status_lease ON jobs(status, lease_expires_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_access_subject_unique ON users(access_subject) WHERE access_subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_sa_status ON jobs(service_account_id, status);
CREATE INDEX IF NOT EXISTS idx_sources_owner_status ON sources(owner_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_sources_owner_content_ready ON sources(owner_user_id, sha256, size) WHERE status='ready' AND dedupe_eligible=1;
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_nonces_expiry ON used_nonces(state, expires_at);
CREATE INDEX IF NOT EXISTS idx_source_nonces_expiry ON source_upload_nonces(state, expires_at);
CREATE INDEX IF NOT EXISTS idx_ticket_revocations_expiry ON revoked_tickets(expires_at);
CREATE INDEX IF NOT EXISTS idx_download_leases_expiry ON artifact_download_leases(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created ON audit_logs(actor_type, actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target_created ON audit_logs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_result_created ON audit_logs(result, created_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_codes_expiry ON remote_mcp_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_tokens_expiry ON remote_mcp_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_tokens_family ON remote_mcp_tokens(family_id,token_type,sequence);
CREATE INDEX IF NOT EXISTS idx_source_refs_owner_expiry ON source_refs(owner_user_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_remote_mcp_rate_window ON remote_mcp_rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_user_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_revisions_project_number ON project_revisions(project_id,revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_project_revisions_source ON project_revisions(source_id);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO system_settings(key, value_json, updated_by, updated_at)
VALUES ('maintenance_mode', '"normal"', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO system_settings(key, value_json, updated_by, updated_at)
VALUES ('source_orphan_retention_minutes', '60', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;
