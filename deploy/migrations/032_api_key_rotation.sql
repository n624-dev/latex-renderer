ALTER TABLE api_keys ADD COLUMN rotation_root_id TEXT REFERENCES api_keys(id);
CREATE UNIQUE INDEX idx_api_keys_active_rotation
  ON api_keys(COALESCE(rotation_root_id,id)) WHERE revoked_at IS NULL;
INSERT INTO schema_migrations(version,applied_at)
VALUES (32,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
