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

## Administrative API migration for 0.3

This release changes administrative HTTP routes but does not require an additional database migration beyond the schema migrations documented above.

- Replace `POST /admin/api/v1/users/{id}/unlock` with the explicit `enable` or `disable` route. The compatibility prefix `/admin/v1` follows the same contract.
- Replace `DELETE /admin/api/v1/api-keys/{id}` with `POST /admin/api/v1/api-keys/{id}/revoke`.
- Stop consuming the removed `user.unlocked` and `api_key.deleted` audit actions. Use `user.enabled`, `user.disabled`, and `api_key.revoked`.

Both removed routes now return HTTP 404. Update administrative clients before deploying this release; there is no temporary compatibility alias because the old names misrepresented the persisted state transition.
