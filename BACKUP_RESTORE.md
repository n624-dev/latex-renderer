# Backup and restore

Target RPO is 24 hours and target RTO is 4 hours for the MVP. `latex-renderer-backup.timer` creates a WAL-consistent SQLite snapshot, manifest, and encrypted archive. Render source/artifact trees are excluded by default because normal retention must remain enforceable. Audit export is independently encrypted and uploaded to append-only/off-host storage.

Keep 14 daily and 3 monthly encrypted generations off-host. Alert if no successful backup or audit export appears within 30 hours. Encryption recipients/keys and upload credentials are systemd credentials, never repository files.

Quarterly, restore into a new temporary directory, decrypt, verify archive hashes and SQLite `PRAGMA integrity_check`, then start an isolated read-only Admin API against the restored DB. Record duration and row counts. Never overwrite the live DB during a test. A real restore requires stopped services, preserved failed media, atomic placement of the restored DB, correct ownership, migration verification, and health checks before the worker resumes.
