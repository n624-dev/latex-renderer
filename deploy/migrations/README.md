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

Every release that adds a migration must also review `deploy/release-policy.json`.
Keep `rollbackCompatible` set to `true` only when the preceding application
release can safely run against every database and persisted object the new
release can create. Set it to `false` for a forward-only or otherwise
incompatible change; the Update Manager will then refuse an application-only
rollback. Raise `minimumSourceVersion` when the release cannot be safely applied
from every older supported installation. These values are copied into the
signed release manifest during the server release workflow, so changing them
after publication is intentionally impossible.
