PRAGMA foreign_keys=OFF;
PRAGMA busy_timeout=30000;
BEGIN IMMEDIATE;

ALTER TABLE remote_mcp_authorization_codes
ADD COLUMN user_security_version INTEGER NOT NULL DEFAULT 1
CHECK(user_security_version > 0);

INSERT INTO schema_migrations(version,applied_at)
VALUES (12,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
