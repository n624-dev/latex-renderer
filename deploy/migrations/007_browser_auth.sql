PRAGMA foreign_keys=OFF;
PRAGMA busy_timeout=30000;
BEGIN IMMEDIATE;

DROP INDEX IF EXISTS idx_users_access_subject_unique;
CREATE TABLE users_v7 (
  id TEXT PRIMARY KEY,
  access_subject TEXT,
  access_subject_linked_at TEXT,
  access_subject_generation INTEGER NOT NULL DEFAULT 0 CHECK(access_subject_generation >= 0),
  email TEXT COLLATE NOCASE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active',
  security_version INTEGER NOT NULL DEFAULT 1 CHECK(security_version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
INSERT INTO users_v7 (
  id,access_subject,access_subject_linked_at,access_subject_generation,email,
  display_name,role,status,security_version,created_by,created_at,updated_at,last_login_at
)
SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,
       display_name,role,status,security_version,created_by,created_at,updated_at,last_login_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v7 RENAME TO users;
CREATE UNIQUE INDEX idx_users_access_subject_unique
  ON users(access_subject) WHERE access_subject IS NOT NULL;
CREATE INDEX idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('cloudflare-access','oidc')),
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 8 AND 2048),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 500),
  preferred_username TEXT CHECK(preferred_username IS NULL OR length(preferred_username) <= 500),
  email_at_provider TEXT CHECK(email_at_provider IS NULL OR length(email_at_provider) <= 320),
  linked_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(provider,issuer,subject),
  UNIQUE(user_id,provider,issuer)
);
CREATE INDEX idx_user_identities_user ON user_identities(user_id);

CREATE TABLE local_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  login_name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(login_name) BETWEEN 3 AND 64),
  password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 80 AND 512),
  password_updated_at TEXT NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES users(id),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('cloudflare-access','oidc','password')),
  identity_id TEXT REFERENCES user_identities(id) ON DELETE SET NULL,
  user_security_version INTEGER NOT NULL CHECK(user_security_version > 0),
  csrf_hash TEXT NOT NULL CHECK(length(csrf_hash)=64),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id,revoked_at,absolute_expires_at);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(idle_expires_at,absolute_expires_at);

CREATE TABLE auth_login_attempts (
  key_hash TEXT PRIMARY KEY CHECK(length(key_hash)=64),
  failure_count INTEGER NOT NULL CHECK(failure_count > 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_auth_login_attempts_updated ON auth_login_attempts(updated_at);

INSERT INTO schema_migrations(version,applied_at)
VALUES (7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
