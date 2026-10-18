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

4. Confirm the preflight reports target version 20. Deploy the application; the
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

Migration 18 replaces timestamp-based audit export positions with durable
sequences. Upgrade export and cleanup scripts together with application code;
do not run older timestamp-based cleanup against the migrated database. Valid
legacy checkpoints replay retained audit rows once, with possible duplicates.
The external checkpoint must be reconciled separately after DB restoration.
Keep `rollbackCompatible: false`; see
[migration 18 recovery](018_audit_export_sequence.rollback.md) and
[audit operations](../../OPERATIONS.md#audit-export-sequence-and-recovery).

Migration 19 marks locally issued production smoke principals and their exclusive
Sources as internal diagnostics. Ordinary resource APIs exclude their keys, jobs,
Sources and audit entries, including direct-ID access. Local diagnostic export,
worker cleanup, storage and admission accounting still include them. Existing
clients are never classified by name alone, and previously shared Project inputs
remain visible. Keep `rollbackCompatible: false`: older code does not enforce this
visibility boundary. Restore a verified full recovery point to downgrade; see
[migration 19 recovery](019_internal_smoke_visibility.rollback.md).

Migration 20 adds bounded, browser-bound pending OAuth logins. It does not change
existing users, grants, Projects or Sources. Pending records expire after ten
minutes and are removed by ordinary cleanup; expiration or a restored, expired
record requires restarting login, not reconstructing authorization parameters.
Deploy the application and cleanup script together. The additive table does not
relax the migration 18/19 recovery restrictions: `rollbackCompatible` remains
`false`, and application-only downgrade is still unsupported. Use a verified full
recovery point when restoring an earlier release; do not drop the table or edit
live authorization records manually.
