# Migration 003 rollback

Migration 003 makes jobs reference immutable Sources and changes cleanup semantics. Do not downgrade the database in place after version 3 code has accepted an upload.

1. Stop API, worker, and cleanup services.
2. Preserve the database, WAL, storage tree, and the latest encrypted backup.
3. Restore the verified pre-migration backup as one unit.
4. Restore the matching application release.
5. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` before restarting services.

Removing only the version 3 migration row is not a rollback: version 3 code may have jobs whose only input is under `sources/`.
