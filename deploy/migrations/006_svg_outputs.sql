PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
ALTER TABLE jobs ADD COLUMN outputs_json TEXT NOT NULL DEFAULT '["pdf"]' CHECK(json_valid(outputs_json));
CREATE TABLE artifacts_v6 (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL CHECK(type IN ('source','pdf','log','errors','dependencies','preview','svg','svg_manifest')),
  relative_path TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, relative_path)
);
INSERT INTO artifacts_v6 SELECT * FROM artifacts;
DROP TABLE artifacts;
ALTER TABLE artifacts_v6 RENAME TO artifacts;
CREATE INDEX idx_artifacts_job ON artifacts(job_id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
PRAGMA foreign_keys=ON;
