# Migration 002 rollback

Migration 002 is rolled back by restoring the encrypted, WAL-consistent backup
created immediately before deployment. Do not attempt a reverse table migration:
unlinked users cannot be represented by the version 1 `NOT NULL` schema.

1. Stop all LaTeX Renderer application services that can access the database.
2. Decrypt the selected pre-migration `.tar.age` archive in a root-only temporary
   directory and verify its `manifest.json` size and SHA-256 with
   `deploy/scripts/restore-test.mjs`.
3. Move the current `renderer.sqlite3`, `-wal`, and `-shm` files to a timestamped
   quarantine directory. Do not delete them.
4. Install the verified snapshot as `/var/lib/latex-renderer/renderer.sqlite3`
   with owner/group `latex-renderer:latex-renderer` and mode `0660`.
5. Run `PRAGMA integrity_check`, confirm the latest `schema_migrations.version`
   is `1`, then restart the application services and run the production smoke
   test.

Only restore while the version 1 application release is active. Restoring a
version 1 database under version 2 code would immediately reapply migration 002.
