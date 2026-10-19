CREATE TABLE job_preview_documents (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  pdf_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  page_count INTEGER NOT NULL CHECK(page_count BETWEEN 1 AND 100),
  runtime_image TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE job_preview_requests (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES job_preview_documents(job_id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 3),
  lease_owner TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,page)
);
CREATE INDEX idx_job_preview_queue ON job_preview_requests(status,created_at,sequence);
INSERT INTO schema_migrations(version,applied_at)
VALUES (22,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
