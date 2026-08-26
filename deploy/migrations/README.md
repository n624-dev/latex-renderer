# Database migrations

Application startup applies pending migrations through `RendererDatabase.migrate()`.
The numbered SQL files remain the auditable deployment form and are also used
by migration compatibility tests.

Before migrations on production:

1. Run the encrypted backup service and confirm it completed successfully.
2. Run `restore-test.mjs` against that new backup.
3. Build the database package and run the WAL-consistent copy preflight:

   ```bash
   pnpm --filter @latex-renderer/database build
   node deploy/scripts/preflight-users-migration.mjs /var/lib/latex-renderer/renderer.sqlite3
   ```

4. Confirm the preflight reports target version 6. Deploy the application; the
   first process holding `BEGIN IMMEDIATE` performs the migration and later
   processes observe it as already applied.
5. Verify `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, migration version,
   service health, and the production smoke test.

Do not run a numbered SQL migration if its version already exists in
`schema_migrations`. Use the corresponding rollback document when restoration
is required.
