PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
ALTER TABLE jobs ADD COLUMN engine TEXT NOT NULL DEFAULT 'lualatex'
CHECK(engine IN ('lualatex','pdflatex','xelatex','uplatex','platex'));
ALTER TABLE jobs ADD COLUMN runtime_digest TEXT;
CREATE TABLE project_revisions_v23 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 240),
  entrypoint TEXT NOT NULL CHECK(length(entrypoint) BETWEEN 1 AND 240),
  outputs_json TEXT NOT NULL DEFAULT '["pdf"]' CHECK(outputs_json IN ('["pdf"]','["pdf","svg"]')),
  engine TEXT NOT NULL DEFAULT 'lualatex' CHECK(engine IN ('lualatex','pdflatex','xelatex','uplatex','platex')),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,revision_number),
  UNIQUE(project_id,source_id,entrypoint,engine,outputs_json)
);
INSERT INTO project_revisions_v23
  (id,project_id,source_id,revision_number,display_name,original_filename,entrypoint,outputs_json,created_at)
SELECT id,project_id,source_id,revision_number,display_name,original_filename,entrypoint,
  CASE json(outputs_json) WHEN '["svg","pdf"]' THEN '["pdf","svg"]' ELSE json(outputs_json) END,
  created_at
FROM project_revisions;
DROP TABLE project_revisions;
ALTER TABLE project_revisions_v23 RENAME TO project_revisions;
CREATE INDEX idx_project_revisions_project_number ON project_revisions(project_id,revision_number DESC);
CREATE INDEX idx_project_revisions_source ON project_revisions(source_id);
CREATE TEMP TABLE migration_23_integrity (
  violation INTEGER CONSTRAINT migration_23_foreign_keys_valid CHECK(violation=0)
);
INSERT OR ROLLBACK INTO migration_23_integrity SELECT 1 FROM pragma_foreign_key_check LIMIT 1;
DROP TABLE migration_23_integrity;
INSERT INTO schema_migrations(version,applied_at)
VALUES (23,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
PRAGMA foreign_keys=ON;
