BEGIN IMMEDIATE;
CREATE TABLE job_output_stages (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_id TEXT,
  entrypoint TEXT NOT NULL,
  project_revision_id TEXT,
  renderer_image TEXT NOT NULL,
  pdf_status TEXT NOT NULL DEFAULT 'queued' CHECK(pdf_status IN ('queued','running','succeeded','failed','timeout','canceled')),
  svg_status TEXT NOT NULL DEFAULT 'queued' CHECK(svg_status IN ('queued','running','succeeded','failed','timeout','canceled','skipped')),
  pdf_generation INTEGER CHECK(pdf_generation>0),
  svg_generation INTEGER CHECK(svg_generation>0),
  pdf_sha256 TEXT CHECK(length(pdf_sha256)=64),
  synctex_sha256 TEXT CHECK(length(synctex_sha256)=64),
  synctex_bytes INTEGER NOT NULL DEFAULT 0 CHECK(synctex_bytes>=0),
  pdf_completed_at TEXT,
  pdf_error_code TEXT,
  pdf_error_message TEXT,
  svg_completed_at TEXT,
  svg_error_code TEXT,
  svg_error_message TEXT,
  svg_attempt INTEGER NOT NULL DEFAULT 1 CHECK(svg_attempt BETWEEN 1 AND 8),
  CHECK(pdf_status<>'succeeded' OR (pdf_generation IS NOT NULL AND pdf_sha256 IS NOT NULL AND synctex_sha256 IS NOT NULL AND pdf_completed_at IS NOT NULL)),
  CHECK(svg_status<>'succeeded' OR svg_generation IS NOT NULL)
);
CREATE TRIGGER output_stages_terminal AFTER UPDATE OF status ON jobs
WHEN NEW.status IN ('failed','timeout','canceled','rejected')
BEGIN
  UPDATE job_output_stages SET
    svg_status=CASE WHEN pdf_status<>'succeeded' THEN 'skipped'
      WHEN NEW.status='rejected' THEN 'failed' ELSE NEW.status END,
    svg_completed_at=NEW.completed_at,
    svg_error_code=NEW.error_code,svg_error_message=NEW.error_message
    WHERE job_id=NEW.id AND svg_status IN ('queued','running');
  UPDATE job_output_stages SET
    pdf_status=CASE WHEN NEW.status='rejected' THEN 'failed' ELSE NEW.status END,
    pdf_completed_at=NEW.completed_at,
    pdf_error_code=NEW.error_code,pdf_error_message=NEW.error_message
    WHERE job_id=NEW.id AND pdf_status IN ('queued','running');
END;
CREATE TRIGGER output_stages_recover AFTER UPDATE OF status ON jobs
WHEN NEW.status='queued' AND OLD.status IN ('validating','running')
BEGIN
  UPDATE job_output_stages SET
    pdf_status=CASE WHEN pdf_status='running' THEN 'queued' ELSE pdf_status END,
    svg_status=CASE WHEN svg_status='running' THEN 'queued' ELSE svg_status END
    WHERE job_id=NEW.id;
END;
INSERT INTO schema_migrations(version,applied_at)
VALUES (21,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
