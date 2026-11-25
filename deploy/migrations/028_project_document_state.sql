ALTER TABLE project_drafts ADD COLUMN base_revision_id TEXT REFERENCES project_revisions(id) ON DELETE SET NULL;
CREATE TABLE project_protected_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  PRIMARY KEY(project_id,revision_id)
);
CREATE TABLE project_document_conditions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>0),
  conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, version)
);
CREATE TABLE project_revision_changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  parent_revision_id TEXT,
  draft_version INTEGER NOT NULL CHECK(draft_version>0),
  conditions_version INTEGER,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,conditions_version)
    REFERENCES project_document_conditions(project_id,version)
);
CREATE INDEX idx_project_revision_changes_page ON project_revision_changes(project_id, revision_id, created_at, id);
CREATE TABLE project_adopted_revisions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);
CREATE TABLE project_pdf_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES project_revisions(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  runtime_digest TEXT,
  conditions_version INTEGER,
  review_json TEXT NOT NULL CHECK(json_valid(review_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,conditions_version)
    REFERENCES project_document_conditions(project_id,version)
);
CREATE INDEX idx_project_pdf_reviews_project ON project_pdf_reviews(project_id, created_at, id);
CREATE TABLE pdf_inspections (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  inspector_version INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  crop_json TEXT CHECK(crop_json IS NULL OR json_valid(crop_json)),
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_until TEXT,
  result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=65536)),
  error_code TEXT,
  UNIQUE(job_id,artifact_id,pdf_sha256,inspector_version,request_key)
);
CREATE INDEX idx_pdf_inspections_queue ON pdf_inspections(status,requested_at,id);
CREATE TABLE job_reproducibility (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('fixed','latest')),
  epoch_seconds INTEGER NOT NULL CHECK(epoch_seconds>=0)
);
INSERT INTO schema_migrations(version,applied_at)
VALUES (28,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
