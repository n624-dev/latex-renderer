ALTER TABLE jobs
ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0
CHECK(lease_generation >= 0);

INSERT INTO schema_migrations(version,applied_at)
VALUES (8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
