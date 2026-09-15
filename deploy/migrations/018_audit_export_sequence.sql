BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS audit_export_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  database_id TEXT NOT NULL CHECK(length(database_id) = 64)
);
CREATE TABLE IF NOT EXISTS audit_export_sequence (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT UNIQUE REFERENCES audit_logs(id) ON DELETE SET NULL,
  token TEXT NOT NULL DEFAULT (lower(hex(randomblob(32)))) CHECK(length(token) = 64)
);
INSERT INTO audit_export_state(singleton,database_id)
SELECT 1,lower(hex(randomblob(32)))
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=18);
INSERT INTO audit_export_sequence(audit_id)
SELECT id FROM audit_logs
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=18)
ORDER BY created_at,id;
CREATE TRIGGER IF NOT EXISTS audit_export_insert AFTER INSERT ON audit_logs
BEGIN
  INSERT INTO audit_export_sequence(audit_id) VALUES (NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS audit_export_delete AFTER DELETE ON audit_logs
BEGIN
  UPDATE audit_export_sequence SET audit_id=NULL WHERE audit_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS audit_export_immutable BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT,'Audit logs are append-only');
END;
INSERT OR IGNORE INTO schema_migrations(version,applied_at)
VALUES (18,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
