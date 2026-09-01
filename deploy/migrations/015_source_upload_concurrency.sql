-- Remote MCP chunk uploads use a database-backed lease and persisted offset.
-- The lease is deliberately separate from the upload's expiry timestamp so a
-- crashed instance can be replaced after the short lease timeout.
ALTER TABLE sources ADD COLUMN upload_received_bytes INTEGER NOT NULL DEFAULT 0
  CHECK(upload_received_bytes >= 0);
ALTER TABLE sources ADD COLUMN upload_lease_owner TEXT;
ALTER TABLE sources ADD COLUMN upload_lease_expires_at TEXT;
UPDATE sources SET upload_received_bytes=size WHERE status='ready';
CREATE INDEX idx_sources_upload_lease
  ON sources(status,upload_lease_expires_at);
INSERT INTO schema_migrations(version,applied_at)
VALUES (15,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
