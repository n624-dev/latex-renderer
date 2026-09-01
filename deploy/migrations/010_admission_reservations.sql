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
