BEGIN IMMEDIATE;
CREATE TABLE remote_mcp_login_continuations (
  handle_hash TEXT PRIMARY KEY CHECK(length(handle_hash)=64),
  browser_hash TEXT NOT NULL CHECK(length(browser_hash)=64),
  client_id TEXT NOT NULL REFERENCES remote_mcp_clients(client_id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK(length(target) BETWEEN 1 AND 65536),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_remote_mcp_login_expiry ON remote_mcp_login_continuations(expires_at);
INSERT INTO schema_migrations(version,applied_at)
VALUES (20,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
