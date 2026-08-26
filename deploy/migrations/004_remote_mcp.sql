PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

CREATE TABLE remote_mcp_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE remote_mcp_authorization_codes (
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
CREATE TABLE remote_mcp_token_families (
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
CREATE TABLE remote_mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES remote_mcp_token_families(id),
  token_type TEXT NOT NULL CHECK(token_type IN ('access','refresh')),
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE remote_mcp_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  service_account_id TEXT NOT NULL UNIQUE REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id),
  created_at TEXT NOT NULL
);
CREATE TABLE source_refs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE remote_mcp_rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(user_id,tool_name,window_start)
);

CREATE INDEX idx_remote_mcp_codes_expiry ON remote_mcp_authorization_codes(expires_at);
CREATE INDEX idx_remote_mcp_tokens_expiry ON remote_mcp_tokens(expires_at);
CREATE INDEX idx_remote_mcp_tokens_family ON remote_mcp_tokens(family_id,token_type,sequence);
CREATE INDEX idx_source_refs_owner_expiry ON source_refs(owner_user_id,expires_at);
CREATE INDEX idx_remote_mcp_rate_window ON remote_mcp_rate_limits(window_start);

INSERT INTO schema_migrations(version,applied_at)
VALUES (4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
