ALTER TABLE pdf_source_maps ADD COLUMN paths_json TEXT
  CHECK(paths_json IS NULL OR (json_valid(paths_json) AND json_type(paths_json)='array'));
INSERT INTO schema_migrations(version,applied_at)
VALUES (30,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
