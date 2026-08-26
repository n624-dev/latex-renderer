PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

CREATE TABLE web_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  service_account_id TEXT NOT NULL UNIQUE REFERENCES service_accounts(id),
  api_key_id TEXT NOT NULL UNIQUE REFERENCES api_keys(id),
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE project_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  original_filename TEXT NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 240),
  entrypoint TEXT NOT NULL CHECK(length(entrypoint) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, revision_number),
  UNIQUE(project_id, source_id, entrypoint)
);

ALTER TABLE jobs ADD COLUMN project_revision_id TEXT REFERENCES project_revisions(id);

CREATE INDEX idx_projects_owner_updated
  ON projects(owner_user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_project_revisions_project_number
  ON project_revisions(project_id, revision_number DESC);
CREATE INDEX idx_project_revisions_source ON project_revisions(source_id);
CREATE INDEX idx_jobs_project_revision ON jobs(project_revision_id);

INSERT INTO schema_migrations(version,applied_at)
VALUES (5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
