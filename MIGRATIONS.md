# Migrations

Migration 001 creates all current tables, constraints, and indexes and is idempotently applied by the database package. It is forward-only because dropping the initial schema would destroy data. A WAL-consistent backup is mandatory before every future schema change.

Future migrations must be numbered, transactional where SQLite permits, recorded in `schema_migrations`, tested against a copy of production data, and state whether the previous application version can read the new schema. Rollback normally means restoring the pre-migration backup; never edit the live SQLite file with a text or generic file-copy tool while services are active.

For each migration release, update `deploy/release-policy.json` as part of the
same pull request. `rollbackCompatible` may remain `true` only if the immediately
preceding release can safely use all post-upgrade schema and persisted data.
Otherwise set it to `false`; application-only rollback will be blocked and
recovery requires the migration's documented database restore procedure. Raise
`minimumSourceVersion` whenever skipping older releases would be unsafe.

## Migration 004: Remote MCP

Migration 004 adds OAuth client/code/token-family/token tables, an internal Remote MCP accounting principal, owner-scoped short-lived Source references, and per-tool rate windows. It is additive and the previous application version can read the database, but it does not know how to expire the new records. Rollback therefore means stopping the Remote MCP unit and restoring the encrypted pre-migration backup; do not drop these tables from a live database. The SQL and rollback checklist are in `deploy/migrations/004_remote_mcp.sql` and `deploy/migrations/004_remote_mcp.rollback.md`.

## Migration 005: Web application Projects

Migration 005 adds the persistent structures used by the signed-in Web application:

- `web_principals` links a Web user to the internal service account and API key used for render operations.
- `projects` stores owner-scoped Project metadata.
- `project_revisions` links immutable Source revisions and entrypoints to a Project.
- `jobs.project_revision_id` optionally links a Job to the Project revision that created it.
- indexes are added for owner Project listing, Project revision lookup, Source lookup, and Job linkage.

The SQL is `deploy/migrations/005_web_app_projects.sql`, and successful application records schema version `5` in `schema_migrations`. The migration is additive: it creates new tables and indexes and adds one nullable foreign-key column to `jobs`; it does not rewrite or delete existing Job, Source, user, or Remote MCP data. Previous application versions ignore the new structures, but rollback compatibility must still be verified before a release because new Web data created after migration will not be understood by older code.

Treat Migration 005 as forward-only in production. Take the required WAL-consistent backup before applying it. If schema rollback is required, stop all database writers and restore that backup rather than attempting to drop the new tables or column manually.

## Migration 006: SVG outputs

Migration 006 records each Job's requested output formats in `jobs.outputs_json`, defaulting existing and unspecified Jobs to `["pdf"]`. It also rebuilds the `artifacts` table constraint so workers can publish validated `svg` objects and an `svg_manifest` alongside the required PDF.

The SQL is `deploy/migrations/006_svg_outputs.sql`, and successful application records schema version `6` in `schema_migrations`. Apply it only after entering maintenance mode, draining active Jobs, stopping database writers, and taking a WAL-consistent encrypted backup. The application release that introduces SVG must not run against schema version 5 because it persists `outputs_json` and the new artifact types.

Treat Migration 006 as forward-only in production. To return to an older application, stop admission and workers and restore the pre-migration backup. The detailed data-preserving rebuild procedure for a controlled non-production rollback is in `deploy/migrations/006_svg_outputs.rollback.md`; do not manually alter the live tables while services are running.

## Migration 007: Browser authentication

Migration 007 generalizes browser authentication for the Cloudflare and standalone deployment profiles. It rebuilds `users` so `email` is nullable and no longer unique, preserves the internal immutable user ID and legacy Access columns, and adds:

- `user_identities`, uniquely keyed by provider, exact issuer, and subject;
- `local_credentials`, with one normalized unique login name and scrypt hash per user;
- `web_sessions`, containing only session-token and CSRF hashes with idle, absolute, revocation, and user-security-version checks;
- `auth_login_attempts`, containing keyed rate-limit counters rather than login names or IP addresses.

The SQL is `deploy/migrations/007_browser_auth.sql`, and successful application records schema version `7` in `schema_migrations`. Existing Cloudflare Access subjects are copied into the new identity table only after startup has an explicit, valid Access issuer, then cleared from the legacy columns. This is a one-time consumption: explicitly unlinking the new identity cannot recreate it on restart. Email and display-name values never link identities automatically. The first password or OIDC owner must be explicitly bootstrapped on the host.

Migration 007 is forward-only in production. Version 1.1 cannot safely administer the nullable-email and provider-neutral identity model. Before upgrading, enter maintenance mode, drain Jobs, stop every SQLite writer, and take a WAL-consistent encrypted backup. To return to 1.1, stop admission and all writers and restore that backup; do not merely point `current` at an older release. The non-production inspection and rebuild notes are in `deploy/migrations/007_browser_auth.rollback.md`.

## Migration 008: Worker lease fencing

Migration 008 adds `jobs.lease_generation`, which is incremented whenever a Worker or recovery claimant takes ownership. Every heartbeat, transition, artifact publication, failure, and recovery update must match both the owner and generation. This prevents a stale Worker from changing a Job after a replacement Worker has recovered it.

## Migration 009: Cleanup state

Migration 009 separates the terminal Render result from physical deletion state for Jobs and Sources. It adds retry count, bounded error, and next-attempt fields plus indexes for cleanup retries. A failed filesystem deletion no longer rewrites a successful Render result, and one permanently bad item no longer blocks later cleanup candidates.

## Migration 010: Admission reservations

Migration 010 adds `jobs.reserved_output_bytes` and a user-active-Job index. Admission now reserves the configured maximum future output size and enforces a user-wide active Job limit across service accounts. Existing terminal Jobs are backfilled with no reservation.

## Migration 011: Upload claim leases

Migration 011 gives Job and Source upload nonces an independently renewable `claim_expires_at`. Slow uploads heartbeat the claim, and cleanup can recover an abandoned claim after its lease expires without extending the ticket's original lifetime.

## Migration 012: OAuth authorization security version

Migration 012 records the user's `security_version` on every Remote MCP authorization code. Code exchange atomically rechecks that version before consuming the code and issuing a token family, so disabling a user or changing security state invalidates already issued codes.

## Migration 013: Keyset pagination indexes

Migration 013 adds deterministic timestamp-and-ID indexes for user, service-account, API-key, Job, Source, Project, revision, and related-Job pages. List/search endpoints use keyset cursors and database-side counts rather than fixed recent-row windows.

## Migration 014: Project revision outputs

Migration 014 persists each Project revision's requested output formats in `project_revisions.outputs_json`. Re-rendering an existing revision therefore preserves optional SVG output instead of silently reverting to PDF-only.

## Migration 015: Source upload concurrency

Migration 015 stores the durable received-byte offset and renewable writer lease for Remote MCP chunk uploads. Chunk creation is immutable, append/finalize operations are fenced across processes, and a crashed instance can be recovered after the short lease expires.

## Migration 016: Durable API key kind

Migration 016 adds the validated `api_keys.kind` invariant. Existing `lra_` keys are backfilled once as admin keys; all other existing keys remain render keys. Authentication and rotation thereafter require the credential prefix, stored prefix, stored kind, and allowed scopes to agree instead of inferring authority solely from attacker-presented credential text.

Migrations 008 through 016 are additive but change the ownership, cleanup, admission, OAuth, upload, pagination, Project output, and credential invariants used by v1.2. Apply them only through the application migrator after the normal maintenance/drain/backup sequence. Treat the combined upgrade as forward-only: an older release does not enforce these invariants and must not be started on schema 16. Rollback requires stopping admission and every database writer, then restoring the WAL-consistent encrypted pre-migration backup.

## Migration 017: Generation-selected artifact storage

Migration 017 adds nullable `artifacts.storage_generation`. Existing rows remain
NULL and keep the legacy `jobs/<id>/output/` location. New normal and failure
outputs use `jobs/<id>/outputs/<lease-generation>/`; their generation is selected
in the same fenced database transaction as Job finalization. A stale worker
cannot replace the files selected by a newer worker. Public artifact paths and
URLs do not change. Admin, Renderer API and Remote MCP resolve the selected
generation, and normal Job cleanup removes both output layouts.

Upgrade all readers and workers together after maintenance/drain and backup.
Do not mix old readers with new generation-aware writers. Keep release
`rollbackCompatible: false`: dropping the column or switching only application
code back would make newer artifacts unreadable. See
[migration 017 recovery](deploy/migrations/017_artifact_generation.rollback.md)
for legacy compatibility, crash cleanup and restoration requirements.

## Migration 018: Durable audit export sequence

Migration 018 assigns each audit INSERT a persistent AUTOINCREMENT sequence and
random token, with a separate singleton database identity. Existing rows are
backfilled once, without deleting or changing their audit fields. New inserts
are ordered by sequence regardless of timestamp or ID; audit UPDATE is rejected.
Format-3 export checkpoints bind that sequence to the database and row token.

On migration from a valid legacy checkpoint, re-export all audit rows still in
the DB once: duplicates with older encrypted exports are possible, but the old
timestamp position cannot safely distinguish omissions. Cleanup only prunes
expired, acknowledged rows and reclaims obsolete ledger entries in bounded
batches while retaining the checkpoint anchor. Corrupt or restored/forked
checkpoint state stops audit export and pruning instead of skipping data.

Stop export/cleanup timers and application writers during migration; deploy the
application, exporter and cleanup together after the verified backup/preflight.
Keep `rollbackCompatible: false`. Do not drop the ledger or use an old exporter
with the new checkpoint. Restore the pre-upgrade DB/storage and corresponding
application when rollback is required, preserving newer encrypted exports.
See [migration 018 recovery](deploy/migrations/018_audit_export_sequence.rollback.md)
and [audit operations](OPERATIONS.md#audit-export-sequence-and-recovery) for the
explicit retained-row replay procedure after DB restoration.

## Migration 019: Internal production smoke resources

Migration 019 adds a server-owned purpose classification to service accounts
and Sources. Locally issued diagnostic clients and their exclusive Sources are
excluded from ordinary client/key/job/input/audit views, search, pagination and
direct-ID management. Legacy local creation markers are required: a matching
client name alone never hides user data. Previously shared and Project-retained
input stays visible. Workers, admission/storage accounting and local bounded
audit export still process internal diagnostics normally.

Apply all new consumers together after the encrypted backup, restore test and
WAL-consistent migration-copy preflight. The target database version is 19.
No rows are deleted, but old application code ignores the visibility boundary;
`rollbackCompatible` therefore remains false. Downgrades require the verified
full recovery point, not an application-only rollback or live column removal.
See [the migration and recovery guide](deploy/migrations/019_internal_smoke_visibility.rollback.md).

## Migration 022: PDF-bound preview requests

The same migration adds bounded `source_trees` and `source_tree_readers` for
owner-bound, read-only validated input reuse. Reservations include filesystem
blocks and metadata and remain charged until deletion completes. Reader pins
survive process restarts and require exact daemon-stop confirmation before
recovery. Deploy the application, Worker and common timer collector together;
see [Source input reuse](docs/source-input-reuse.md). The numbered SQL is tested
against the canonical application SQL, including byte reservations and the
internal audit tombstones below.

Migration 022 adds `job_preview_documents` and `job_preview_requests` for
page counts bound to an immutable PDF artifact and deduplicated, bounded page
requests. Queuing a request must not extend the PDF retention deadline or
change the Job result. Conversion remains the responsibility of a sandboxed
Worker, never an HTTP request handler. The migration is infrastructure: it does
not by itself switch an existing Runtime from eager to on-demand previews.
Historical previews remain available without backfilling or rerendering.
The same migration retains positively classified internal-smoke resource IDs
after physical Job/Source/key/account deletion, so their audit records do not
reappear in user-facing views. Raw diagnostic export remains unfiltered.
Classification IDs are collected only once no retained audit row refers to them;
unattributable historical records are not hidden by name-based guesses.
Running conversions reserve bounded bytes in per-user storage accounting;
cleanup protects them even after a lease expires until daemon recovery has
verified the old container stopped. Updated six-file Runtimes emit page metadata
and generate page 1 initially. See [the preview contract](docs/lazy-previews.md).

Deploy database consumers and cleanup together after an encrypted backup,
restore test and private-copy migration preflight, and verify schema 22.
`rollbackCompatible` remains false; downgrade requires the verified full
recovery point. Do not remove live tables or replay expired page requests.
See [migration 22 recovery](deploy/migrations/022_lazy_previews.rollback.md).

## Migration 021: Independent output stages

Migration 021 adds `job_output_stages` and terminal/recovery triggers. New
PDF+SVG Jobs use separate fenced, immutable output generations. PDF publication
persists its digest, SyncTeX checkpoint and retention start independently of SVG.
SVG-only retries reuse the same Job, increment a bounded attempt counter, and
never extend the PDF deadline. Legacy and PDF-only Jobs keep their existing
execution and response contracts; no historical Job is rerendered or backfilled.

The [output-stage contract](docs/independent-output-stages.md) describes partial
success and compatibility. Apply all consumers together after a verified encrypted
backup, restore test and migration-copy preflight. The target schema is 21.
`rollbackCompatible` remains false: downgrading only the application would ignore
stage publication and retention semantics. Recovery requires the verified full
recovery point, not live table removal.

## Migration 020: Bounded OAuth login continuations

Migration 020 adds `remote_mcp_login_continuations` and its expiry index. Long
authorization requests are retained behind a short random handle instead of
being embedded in the browser login URL. The handle and browser-binding cookie
are independent server-generated 32-byte secrets. Only their SHA-256 lookup
hashes are stored; these are not user-selected passwords. Actual password
authentication continues to use salted scrypt.

Continuations expire after ten minutes, are consumed atomically once, and
require both the browser-binding cookie and a valid authenticated session.
The original authorization request is then validated again, including redirect
URI, PKCE and consent/CSRF checks. At most 1,000 pending records are retained
globally; a request already carrying eight continuation cookies cannot start
another flow. Expired records are removed during access and scheduled cleanup.
Restarting or restoring a database does not extend their original expiry.

Apply the application migrator after the verified backup, restore test and
private-copy preflight; the target database version is 20. Deploy the updated
cleanup script with the application. Existing users, grants, Projects and Sources
are unchanged. Keep `rollbackCompatible: false` because the earlier audit and
internal-resource migrations still require a full recovery point for downgrade.
Do not drop live tables or rewrite pending credentials to work around a failed
login: restart the login flow instead. See the [migration procedure](deploy/migrations/README.md).

## Administrative API migration for 0.3

This release changes administrative HTTP routes but does not require an additional database migration beyond the schema migrations documented above.

- Replace `POST /admin/api/v1/users/{id}/unlock` with the explicit `enable` or `disable` route. The compatibility prefix `/admin/v1` follows the same contract.
- Replace `DELETE /admin/api/v1/api-keys/{id}` with `POST /admin/api/v1/api-keys/{id}/revoke`.
- Stop consuming the removed `user.unlocked` and `api_key.deleted` audit actions. Use `user.enabled`, `user.disabled`, and `api_key.revoked`.

Both removed routes now return HTTP 404. Update administrative clients before deploying this release; there is no temporary compatibility alias because the old names misrepresented the persisted state transition.
