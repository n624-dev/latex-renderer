# Artifact generation storage (migration 17)

Existing artifacts retain `storage_generation = NULL` and continue to resolve
under `jobs/<id>/output/`. New workers write only their own
`jobs/<id>/outputs/<lease-generation>/` directory. Artifact rows select this
generation in the same transaction as the fenced final Job transition. Public
artifact names and URLs do not change. No existing output tree is moved.

Both normal rendering and failure-report publication use this layout. A fenced
writer removes only its own uncommitted generation. A crash before commit can
leave an unreferenced directory; it is never selected by a reader and normal
Job deletion removes it together with attempts and other outputs. Legacy
Project-retained Job input is preserved by cleanup while both output layouts
are removed. This does not introduce a permanent artifact cache.

Stop/drain workers and application readers before upgrading them together.
Do not run older workers/readers alongside generation-aware ones: older readers
ignore the generation and assume the legacy output path. Merely dropping the
column is therefore NOT a safe rollback once new artifacts have been created.
The release policy already has `rollbackCompatible: false`; keep it false.
Rollback requires the established maintenance restore procedure using the
pre-upgrade database and corresponding storage backup, not an application-only
switch. Verify the backup's scope; a database-only copy is not an artifact backup.

The migration is additive, applies under the normal migration transaction and
does not require a disk layout change, host privilege change or production data
deletion. Run the existing migration preflight on a disposable database copy;
check migration 17, integrity and foreign keys. Automated tests cover runtime
and numbered-SQL migration followed by idempotent startup and legacy downloads.

Release validation must exercise new rendering and artifact downloads after
upgrade. Unit fixtures reproduce stale worker publication and archive stat
failure; they do not replace a production-equivalent TeX/container upgrade E2E.
