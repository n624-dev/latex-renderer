BEGIN IMMEDIATE;
ALTER TABLE users ADD COLUMN display_locale TEXT
CHECK(display_locale IN ('en','ja','zh-CN','ko','es','pt','fr','de','it','ru','tr','pl','cs','nl','sv','no','da','fi'));
INSERT INTO schema_migrations(version,applied_at)
VALUES (25,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
