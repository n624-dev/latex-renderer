ALTER TABLE pdf_inspections ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0);
ALTER TABLE pdf_inspections ADD COLUMN retry_at TEXT;
INSERT INTO schema_migrations(version,applied_at)
VALUES (31,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
