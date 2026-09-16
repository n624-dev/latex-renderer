# Operations

Check `systemctl status` and JSON journal events for every application service enabled by [DEPLOYMENT.md](DEPLOYMENT.md):

- `latex-renderer-api.service`
- `latex-renderer-internal-api.service`
- `latex-renderer-admin-api.service`
- `latex-renderer-web.service`
- `latex-renderer-remote-mcp.service`
- `latex-renderer-worker.service`
- `latex-renderer-image-manager.service`
- `latex-renderer-update-manager.service`

Health endpoints are loopback `/health`; Renderer API also has `/ready`, which checks storage availability.

- Pause new work with maintenance mode `reject-new-jobs` before upgrades.
- Let active jobs drain, stop the worker, take the required database backup, deploy, migrate, start APIs/Web/Remote MCP, run health checks, then start the worker and disable maintenance.
- Alert on queue depth, free space, stale leases, render failure/timeout rate, audit export lag, backup failure, and Tunnel health.
- Cleanup runs hourly and must skip active artifact download leases. Backups and audit exports run daily; perform the documented restore test quarterly.
- Do not print credential files, request authorization headers, source ZIPs, PDFs, or raw unescaped logs during diagnosis.
- Application update state and redacted logs are available from `latex-render-admin update status` and `latex-render-admin update operation <id>`. The helper accepts only immutable public project releases; do not bypass that check with a mutable source archive.
- `latex-renderer-update-refresh.timer` checks stable releases daily with jitter. Its default `notify` policy never applies code; `automatic` must be explicitly selected in Web or with `latex-render-admin update policy --mode automatic --reason "Approve automatic verified updates" --yes`.
- A daily image run that fails at **Verify GHCR package write access** must not be retried until the package's **Manage Actions access** list grants the workflow repository the **Write** role. Repository linking and ordinary package **Manage access** are separate settings.
- After changing that setting, run `gh workflow run ghcr-publish-access.yml --ref main` and require success before starting the long daily image workflow. This check mounts an already-linked config blob back into the same package; it creates no tag, layer, image, or package version.

Use `journalctl -u UNIT --since ... -o cat` and filter structured event names. Emergency containment is described in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## Updater metadata retries and recovery versions

The application Update Manager and its independent privileged
helper retry **public GitHub JSON GETs only** (release, tag and attestation
metadata). Each request allows at most three attempts, 30 seconds per attempt
including the response body, a 95-second total time budget, and 8 MiB of response
data per attempt. Transient HTTP 408/500/502/503/504 and selected temporary
network/time-out failures use 1- then 2-second backoff. No persistent cache is
created. Failed attempt bodies are discarded, not combined.

Rate-limit responses honor `Retry-After` and `x-ratelimit-reset`; a requested wait
longer than five seconds, an unusable rate-limit hint, or an exhausted total
budget ends this operation for later retry rather than contacting GitHub early.
Authentication/permission/not-found errors, invalid JSON, oversized responses,
TLS certificate failures and checksum/provenance/identity failures are not
retried. `update.github_retry` events contain bounded attempt/reason/delay data,
not response bodies, credentials or URLs. See
[GitHub's rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).

This does **not** retry deployments, mutations, asset transfers, `gh` verification,
or the frozen bootstrap-v1 downloader. The already installed old Updater handles
the first transition; its behavior is not retroactively changed. If that update
fails, inspect the real operation and recovery state before explicitly retrying.
Do not edit sealed slots or bypass backup/signature checks to obtain the fix.

New full-recovery format-1 summaries and encrypted manifests record
`applicationSchemaVersion` from the copied DB's `schema_migrations` and
`sqliteUserVersion` from `PRAGMA user_version` separately. The old `schema` field
remains a legacy alias of `sqliteUserVersion`, **not** the application's migration
number. Missing migration tables produce `applicationSchemaVersion: null`
(unknown); an existing empty history produces zero. Invalid histories fail
closed. Private snapshot/decrypted copies undergo SQLite integrity and FK checks;
the live source retains read-only access. These metadata fields do not prove
code-only rollback compatibility.

Historical format-1 points lacking the new fields remain readable without
rewriting any summary or encrypted archive. Do not infer their application
version from `schema`; inspect a private decrypted DB copy if needed. Recovery
configuration must be a plain object containing only the documented own keys;
arrays and inherited-name keys such as `constructor` are rejected. Capacity and
retention defaults are unchanged, and recovery storage remains separate from the
TeX Live CI mirror's 15 GiB budget.

## Source retention and request replay

Ready Sources remain reusable while the same owner's Jobs (all states except
`deleted` and `expired`) or undeleted Project revisions reference them. The
stored `expires_at` is the orphan deadline, not a hard lifetime for retained
input. Removing the last reference does not grant a new retention window;
expired input is no longer reusable and the next cleanup may remove it. Failed
or completed Jobs still retain input until their normal deletion. Uploading,
deleting, deleted and expired Sources never become ready through a reference.

Lookup, deduplication, queued-Job admission and cleanup share the database
package's Source reference predicate. Cleanup conservatively protects even a
malformed cross-owner reference, but that reference does not extend reuse.
Do not repair such inconsistencies by deleting storage manually. Build the
database package before directly running `deploy/scripts/cleanup.mjs` from a
source checkout (`pnpm --filter @latex-renderer/database build`); normal CI and
production deployment already build it before starting cleanup services.

Completed-Source request deduplication is remembered for a fixed 24 hours in
Web/Internal API; an unfinished upload reservation still lasts ten minutes.
Replay does not renew either deadline or pin Source bytes. Expired request keys
can be atomically replaced without waiting for scheduled metadata cleanup;
unexpired keys remain actor/operation-scoped and cannot be overwritten. Source
availability is rechecked inside the request-record write transaction. No DB
migration, physical ZIP rewrite, quota change or retention extension is needed.

MCP deduplicated begin/finalize returns the retained ready Source without
rewriting it. Unfinished upload expiry, integrity validation and writer leases
remain mandatory. A Source reference lasts at most 15 minutes and is not itself
a retaining reference; resolving it rechecks the Source's availability.

## Backup and restore boundaries

The scheduled format-2 backup includes a WAL-consistent database and every Source
referenced by an undeleted Project revision, not all Job artifacts or storage.
It accepts both current `sources/<source_id>/source.zip` and migration-3 legacy
`jobs/job_<matching-source-suffix>/input/source.zip` keys. Repeated revisions of
one Source share one archive entry. Arbitrary database-supplied paths are refused.
The independent Updater's full DB/storage recovery points remain a separate system.

Both backup and `restore-test.mjs` require Linux `/proc/self/fd`, GNU tar and age.
Directory descriptors pin the Source path; symbolic links, hardlinks, special
files, size/hash mismatches and SQLite integrity/foreign-key failures are errors.
The live database remains read-only. Integrity checks use only a private writable
snapshot/decrypted copy: Node 24.15.0 / SQLite 3.51.3 was observed to omit CHECK
constraint failures when opened read-only. No live schema or data is repaired.

Backup and restore check the same tar name/type/duplicate-entry boundary before
encryption or extraction, respectively. Each tar listing is limited to 16 MiB;
oversized inventories fail instead of creating an archive this verifier cannot
check. This is an inventory bound, not a limit on Source ZIP sizes. Successful
encryption alone does not prove recoverability: run the actual decrypt/restore
test before migration and periodically thereafter. Format 1 remains DB-only.

During an operator-approved restore, stop writers and validate the archive first.
Restore its DB and Source ZIPs as one recovery point. The archive's canonical
`project-sources/<source_id>/source.zip` entry must go to that Source's **validated
database `storage_key`**, including the matching legacy Job input path; do not
blindly move all ZIPs to the current layout. Preserve configuration, secrets and
any separately required full storage backup.

An installed older backup script may already reject legacy Source keys. Since
the Updater runs the installed backup before switching application releases, such
a host can stop before receiving this fix. Do not bypass the backup gate or edit
sealed releases. Stop the update and arrange an explicitly reviewed, complete and
decrypt-verified recovery point plus a supported deployment/recovery procedure.

## Audit export sequence and recovery

Migration 18 gives each audit INSERT a durable increasing sequence, database
identity and row token; wall-clock timestamps and random audit IDs are no longer
export positions. Audit rows are append-only. Export adds `export_sequence`
(decimal string), `export_token` and `export_database_id` to the existing JSONL
fields. Consumers can use this tuple to recognize retries, including DB forks.

On the first run after migration, a valid legacy checkpoint causes **all retained
DB audit rows to be replayed once**. Some may duplicate previous exports. Missing
checkpoints also start from zero; corrupt checkpoints fail closed. No timestamp
can safely recover the old export position. Ordinary successful retries do not
replay acknowledged rows, but a crash or upload/checkpoint failure after durable
export can duplicate a batch: delivery is at-least-once, not exactly-once.

The exporter retains read-only DB access and uses a kernel `flock` in the audit
directory to reject concurrent runs. Do not unlink `export.lock`; the kernel
releases the lock when all owning descriptors close, including on process death.
Encrypted output and its directory are synced before checkpoint advancement;
the configured uploader must also report success first. Keep the uploader bounded
and idempotent. Existing batch/count bounds still apply; check `backlogMayRemain`
and `legacyReplay` in completion events when draining the migration backlog.

Audit pruning requires a validated format-3 checkpoint. It deletes only exported
rows older than `AUDIT_LOG_RETENTION_DAYS` (default 365), up to
`AUDIT_PRUNE_BATCH_SIZE` per run. Unexported rows remain protected even with old
timestamps. Obsolete sequence entries are reclaimed in bounded batches, retaining
live rows and the current checkpoint token; no permanent sequence history is kept.
An invalid checkpoint records an `audit-prune` failure without pruning audit rows.

The DB and external checkpoint are separate recovery state. After restoring an
older/different DB, a future position or mismatched token/identity stops export
and audit pruning. Do not hand-edit a sequence or checksum to make it pass:

1. Stop audit export and cleanup timers/services while reviewing the recovery.
2. Preserve the DB, existing encrypted exports and both current and legacy
   checkpoint files as evidence. Confirm the restored DB integrity, foreign keys
   and migration 18 using the private-copy preflight.
3. If the matching checkpoint is not trustworthy, explicitly approve replay of
   all audit rows **still present** in the restored DB. Move the current checkpoint
   and the old `BACKUP_DIRECTORY/audit-export.checkpoint` out of their active paths;
   account for any configured `AUDIT_EXPORT_CHECKPOINT`. Do not delete audit rows,
   reset SQLite sequence state, or remove the kernel lock file.
4. Run export with the installed service credentials, decrypt-check the new
   output and confirm the format-3 checkpoint. Resume timers and check completion
   events. Reconcile duplicate exports by database/sequence/token, not timestamps.

This cannot reconstruct rows absent from the restored DB; retain the older
encrypted exports according to the existing backup policy. Checkpoint replay does
not disable backup retention or create a permanent cache. Migration rollback is
described in [018_audit_export_sequence.rollback.md](deploy/migrations/018_audit_export_sequence.rollback.md).
