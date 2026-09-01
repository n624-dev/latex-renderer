PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

-- Keep the output contract selected when a Project revision is first created.
-- Rerendering a revision must not silently drop its optional SVG output.
ALTER TABLE project_revisions
  ADD COLUMN outputs_json TEXT NOT NULL DEFAULT '["pdf"]'
  CHECK(json_valid(outputs_json));

INSERT INTO schema_migrations(version,applied_at)
VALUES (14,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
