BEGIN IMMEDIATE;
CREATE TABLE project_drafts (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  entrypoint TEXT NOT NULL,
  engine TEXT NOT NULL CHECK(engine IN ('lualatex','pdflatex','xelatex','uplatex','platex')),
  outputs_json TEXT NOT NULL CHECK(outputs_json IN ('["pdf"]','["pdf","svg"]')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE project_draft_files (
  project_id TEXT NOT NULL REFERENCES project_drafts(project_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_path TEXT NOT NULL,
  PRIMARY KEY(project_id,path)
);
CREATE INDEX idx_project_draft_files_source ON project_draft_files(source_id,project_id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (24,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
