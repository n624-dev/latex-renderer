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
