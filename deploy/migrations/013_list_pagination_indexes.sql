PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;

-- Keyset list endpoints all use the same deterministic timestamp + id order.
-- Keep these partial indexes small by excluding rows that are no longer visible.
CREATE INDEX IF NOT EXISTS idx_users_created_id
  ON users(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_service_accounts_created_id
  ON service_accounts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_id
  ON api_keys(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created_id
  ON jobs(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created_id
  ON jobs(user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_source_created_id
  ON jobs(source_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_revision_created_id
  ON jobs(project_revision_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sources_created_id
  ON sources(created_at DESC,id DESC) WHERE status!='deleted';
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated_id
  ON projects(owner_user_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;

INSERT INTO schema_migrations(version,applied_at)
VALUES (13,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
