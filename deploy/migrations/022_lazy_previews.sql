BEGIN IMMEDIATE;
CREATE TABLE internal_resource_tombstones (
  kind TEXT NOT NULL CHECK(kind IN ('job','source','service_account','api_key')),
  id TEXT NOT NULL,
  PRIMARY KEY(kind,id)
);
-- Retain only positively attributable identities; never infer from user names.
INSERT OR IGNORE INTO internal_resource_tombstones(kind,id)
SELECT 'job',a.target_id FROM audit_logs a JOIN service_accounts s
 ON a.actor_type='service_account' AND a.actor_id=s.id
 WHERE s.purpose='production-smoke' AND a.target_type IN ('job','render')
 AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=a.target_id);
CREATE TRIGGER internal_job_deleted BEFORE DELETE ON jobs
WHEN EXISTS (SELECT 1 FROM service_accounts s WHERE s.id=OLD.service_account_id AND s.purpose='production-smoke')
BEGIN INSERT OR IGNORE INTO internal_resource_tombstones VALUES ('job',OLD.id); END;
CREATE TRIGGER internal_source_deleted BEFORE DELETE ON sources
WHEN OLD.purpose='production-smoke'
BEGIN INSERT OR IGNORE INTO internal_resource_tombstones VALUES ('source',OLD.id); END;
CREATE TRIGGER internal_key_deleted BEFORE DELETE ON api_keys
WHEN EXISTS (SELECT 1 FROM service_accounts s WHERE s.id=OLD.service_account_id AND s.purpose='production-smoke')
BEGIN INSERT OR IGNORE INTO internal_resource_tombstones VALUES ('api_key',OLD.id); END;
CREATE TRIGGER internal_account_deleted BEFORE DELETE ON service_accounts
WHEN OLD.purpose='production-smoke'
BEGIN
  INSERT OR IGNORE INTO internal_resource_tombstones VALUES ('service_account',OLD.id);
  INSERT OR IGNORE INTO internal_resource_tombstones SELECT 'api_key',id FROM api_keys WHERE service_account_id=OLD.id;
  INSERT OR IGNORE INTO internal_resource_tombstones SELECT 'job',id FROM jobs WHERE service_account_id=OLD.id;
END;

CREATE TABLE source_trees (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('building','ready','invalid','deleting')),
  reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>0),
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX idx_source_trees_expiry ON source_trees(status,expires_at);
CREATE TABLE source_tree_readers (
  tree_id TEXT NOT NULL REFERENCES source_trees(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  PRIMARY KEY(tree_id,job_id,generation)
);
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
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
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
COMMIT;
