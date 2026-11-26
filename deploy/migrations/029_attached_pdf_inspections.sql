BEGIN IMMEDIATE;
CREATE TABLE pdf_inspection_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  file_hash TEXT NOT NULL CHECK(length(file_hash)=64),
  pdf_sha256 TEXT CHECK(pdf_sha256 IS NULL OR length(pdf_sha256)=64),
  size INTEGER CHECK(size IS NULL OR size>0),
  expires_at TEXT NOT NULL,
  CHECK((pdf_sha256 IS NULL)=(size IS NULL)),
  UNIQUE(user_id,request_hash)
);
CREATE INDEX idx_pdf_inspection_uploads_expiry ON pdf_inspection_uploads(expires_at);
ALTER TABLE pdf_inspections RENAME TO pdf_inspections_v28;
CREATE TABLE pdf_inspections (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  artifact_id TEXT,
  upload_id TEXT REFERENCES pdf_inspection_uploads(id) ON DELETE CASCADE,
  pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64),
  inspector_version INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  params_json TEXT CHECK(params_json IS NULL OR json_valid(params_json)),
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_until TEXT,
  result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=65536)),
  error_code TEXT,
  CHECK((job_id IS NOT NULL AND artifact_id IS NOT NULL AND upload_id IS NULL)
     OR (job_id IS NULL AND artifact_id IS NULL AND upload_id IS NOT NULL AND result_json IS NULL)),
  UNIQUE(job_id,artifact_id,pdf_sha256,inspector_version,request_key),
  UNIQUE(upload_id,pdf_sha256,inspector_version,request_key)
);
INSERT INTO pdf_inspections (
  id,job_id,artifact_id,pdf_sha256,inspector_version,request_key,params_json,
  status,requested_at,expires_at,lease_owner,lease_until,result_json,error_code
)
SELECT id,job_id,artifact_id,pdf_sha256,inspector_version,request_key,params_json,
  status,requested_at,expires_at,lease_owner,lease_until,result_json,error_code
FROM pdf_inspections_v28;
DROP TABLE pdf_inspections_v28;
CREATE INDEX idx_pdf_inspections_queue ON pdf_inspections(status,requested_at,id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (29,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
