# Internal smoke visibility (migration 19)

This migration does not delete credentials, jobs, Sources or audit rows. It adds
server-owned purpose markers to locally created diagnostic principals and their
exclusive input. A similarly named ordinary client is not sufficient evidence;
user-shared and Project-retained legacy input stays visible.

Normal APIs cannot set these markers. The local `smoke-key` commands create,
revoke and clean up internal principals; all actual worker/storage/admission
accounting and the bounded local audit export still include them. Only the
ordinary resource and audit views are filtered. This is a visibility boundary,
not erasure of diagnostic evidence.

Before deploying, run the encrypted backup/restore test and migration-copy
preflight described in [the migration guide](README.md). Verify schema version
19, foreign keys, service health, ordinary resource access and a complete
production smoke invocation after updating all application services together.
Do not run old and new application consumers concurrently against this database.

The signed release policy remains `rollbackCompatible: false`: old code ignores
the new markers and would expose diagnostic resources again. To downgrade, use
the documented full verified recovery point procedure, including its database
and storage, rather than dropping columns on a running installation. Do not
delete audit rows or reclassify similarly named user resources to repair a view.
