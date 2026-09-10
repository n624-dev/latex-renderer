BEGIN IMMEDIATE;
ALTER TABLE artifacts ADD COLUMN storage_generation INTEGER
  CHECK(storage_generation IS NULL OR storage_generation > 0);
INSERT INTO schema_migrations(version,applied_at)
VALUES (17,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
