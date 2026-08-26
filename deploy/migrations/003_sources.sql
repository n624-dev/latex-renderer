CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('reserved','uploading','ready','deleting','deleted','expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uploaded_at TEXT,
  paths_json TEXT,
  dedupe_eligible INTEGER NOT NULL DEFAULT 1 CHECK(dedupe_eligible IN (0,1)),
  deleted_at TEXT
);
CREATE TABLE source_upload_nonces (
  nonce TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  state TEXT NOT NULL CHECK(state IN ('unused','claimed','consumed','released','expired')),
  claim_owner TEXT,
  claimed_at TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL
);
ALTER TABLE jobs ADD COLUMN source_id TEXT REFERENCES sources(id);
ALTER TABLE jobs ADD COLUMN entrypoint TEXT NOT NULL DEFAULT 'main.tex';
INSERT INTO sources(id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at,uploaded_at,dedupe_eligible)
SELECT 'source_' || substr(id,5),user_id,source_size,source_sha256,'jobs/' || id || '/input/source.zip',
  CASE WHEN status IN ('reserved','uploading') THEN 'reserved' ELSE 'ready' END,created_at,updated_at,
  CASE WHEN status IN ('reserved','uploading') THEN strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+10 minutes') ELSE strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 hour') END,
  CASE WHEN status IN ('reserved','uploading') THEN NULL ELSE updated_at END,0 FROM jobs;
UPDATE jobs SET source_id='source_' || substr(id,5) WHERE source_id IS NULL;
CREATE INDEX idx_jobs_source ON jobs(source_id);
CREATE INDEX idx_sources_owner_status ON sources(owner_user_id,status,expires_at);
CREATE INDEX idx_sources_owner_content_ready ON sources(owner_user_id,sha256,size) WHERE status='ready' AND dedupe_eligible=1;
CREATE INDEX idx_source_nonces_expiry ON source_upload_nonces(state,expires_at);
INSERT OR IGNORE INTO system_settings(key,value_json,updated_by,updated_at)
VALUES ('source_orphan_retention_minutes','60','migration',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO schema_migrations(version, applied_at) VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
