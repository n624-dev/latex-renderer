CREATE TABLE job_draft_inputs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id),
  draft_version INTEGER NOT NULL CHECK(draft_version>0),
  requested_runtime TEXT
);
CREATE INDEX idx_job_draft_inputs_project ON job_draft_inputs(project_id,draft_version);
CREATE TABLE job_draft_input_files (
  job_id TEXT NOT NULL REFERENCES job_draft_inputs(job_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_path TEXT NOT NULL,
  PRIMARY KEY(job_id,path)
);
CREATE INDEX idx_job_draft_input_files_source ON job_draft_input_files(source_id,job_id);
CREATE TRIGGER job_draft_input_release
AFTER UPDATE OF status,lease_owner ON jobs
WHEN NEW.status NOT IN ('queued','validating','running') AND NEW.lease_owner IS NULL
BEGIN
  DELETE FROM job_draft_input_files WHERE job_id=NEW.id;
END;
INSERT INTO schema_migrations(version,applied_at)
VALUES (26,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
