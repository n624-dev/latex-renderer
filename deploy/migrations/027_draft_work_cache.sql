CREATE TABLE draft_work_cache (
  job_id TEXT NOT NULL REFERENCES job_draft_inputs(job_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK(generation>0),
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  cache_key TEXT NOT NULL CHECK(length(cache_key)=64),
  bytes INTEGER NOT NULL CHECK(bytes>0),
  PRIMARY KEY(job_id,generation)
);
CREATE INDEX idx_draft_work_cache_lookup ON draft_work_cache(user_id,project_id,cache_key);
INSERT INTO schema_migrations(version,applied_at)
VALUES (27,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
