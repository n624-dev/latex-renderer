-- Make the credential kind a durable database invariant.  Existing generated
-- admin keys are identified once from their legacy lra_ prefix; authentication
-- thereafter trusts this column and rejects any prefix mismatch.
ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'render'
  CHECK(kind IN ('render','admin'));
UPDATE api_keys SET kind='admin' WHERE prefix GLOB 'lra_*';
INSERT INTO schema_migrations(version,applied_at)
VALUES (16,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
