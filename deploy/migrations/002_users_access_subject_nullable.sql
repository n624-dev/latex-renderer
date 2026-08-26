PRAGMA foreign_keys=OFF;
PRAGMA busy_timeout=30000;
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS idx_users_access_subject_unique;
CREATE TABLE users_v2 (
  id TEXT PRIMARY KEY,
  access_subject TEXT,
  access_subject_linked_at TEXT,
  access_subject_generation INTEGER NOT NULL DEFAULT 0 CHECK(access_subject_generation >= 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users_v2 (
  id, access_subject, access_subject_linked_at, access_subject_generation,
  email, display_name, role, status, security_version, created_by,
  created_at, updated_at, last_login_at
)
SELECT
  id, access_subject,
  CASE WHEN access_subject IS NULL THEN NULL ELSE COALESCE(last_login_at, created_at) END,
  CASE WHEN access_subject IS NULL THEN 0 ELSE 1 END,
  email, display_name, role, status, security_version, created_by,
  created_at, updated_at, last_login_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
CREATE UNIQUE INDEX idx_users_access_subject_unique
  ON users(access_subject) WHERE access_subject IS NOT NULL;
INSERT INTO schema_migrations(version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
