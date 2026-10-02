# Reviewed authentication changes

This feature is in development source. Use only a verified versioned release
containing `configure-authentication.mjs` and the authentication recovery unit.
It does not change existing settings automatically and is not the completed
self-host CUI/Web wizard from issues #50/#51.

## Supported policies

Existing `AUTH_MODE=cloudflare-access|password|oidc` retains its original behavior.
New configuration uses either `AUTH_BACKEND=cloudflare-access`, or:

```dotenv
AUTH_BACKEND=native
AUTH_PASSWORD_ENABLED=true
AUTH_OIDC_ENABLED=true
OIDC_DISPLAY_NAME=School Account
```

At least one native method is required. Both flags must be explicit booleans;
`AUTH_MODE` and new keys cannot coexist. The display label is presentation text
only. Password-only, OIDC-only and both work with standalone or Cloudflare
hosting. Access still requires Cloudflare hosting and both verified audiences.
Cloudflare hosting is not itself an authentication backend.

With both methods enabled, first owner bootstrap uses Password. Provision OIDC
later with explicit issuer/subject on that same owner. Matching email never links
identities; no switch resets an owner or regenerates existing credentials.

## Prepare and review

First install a compatible verified release, provision required credentials and
identities using existing owner tooling, and verify the new login independently
where possible. Keep old credentials until private-window login succeeds. OIDC
redirect URI remains `PUBLIC_ORIGIN/auth/oidc/callback`. Provider registration,
Discovery, TLS and ingress changes are not performed by this auth-only command.

Store proposed **format-2** JSON as a root-owned `0600` file in a root-controlled
directory such as `/etc/latex-renderer/proposed-authentication.json`. It contains
non-secret metadata, never passwords, client secrets or pepper contents:

```json
{
  "format": 2,
  "deployment": {
    "mode": "standalone",
    "publicOrigin": "https://renderer.example.test",
    "rendererPublicUrl": "https://renderer.example.test"
  },
  "authentication": {
    "backend": "native",
    "passwordEnabled": true,
    "oidcEnabled": true,
    "oidc": {
      "issuer": "https://identity.example.test/tenant",
      "clientId": "configured-client-id",
      "allowedAlgorithms": ["RS256", "ES256"],
      "displayName": "School Account"
    }
  }
}
```

Use the existing deployment/origin, not the example. The transaction refuses to
change deployment or origin. Format-1 JSON can be explicitly converted with
`migrateServerSetupAuthenticationReview`; no installed file is silently migrated.

As root, using the existing privileged operator session:

```sh
umask 077
/usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/configure-authentication.mjs \
  --review /etc/latex-renderer/proposed-authentication.json \
  > /etc/latex-renderer/reviewed-authentication.json
```

Read the output and confirm methods, issuer/client ID, label, hosting and origin.
The envelope binds the **entire** current EnvironmentFile and candidate to SHA-256
hashes. Unrelated renderer/storage settings, comments and secret references are
preserved. Never replace `renderer.env` with the Core profile-key map. Regenerate
review after any edit; do not modify the envelope directly. Strict unquoted
EnvironmentFile output rejects quotes/backslashes rather than showing a value
different from what systemd loads. Spaces in a plain display label are allowed.

Required secrets retain their fixed paths and root/group `0440` permissions.
Both enabled native methods require both files. This command does not generate,
replace, rotate or store secret values in review output.

## Apply and confirm

```sh
/usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/configure-authentication.mjs \
  --apply /etc/latex-renderer/reviewed-authentication.json
```

This root-only command shares the application/TeX mutation lock. Both installed
Admin API and Remote MCP must already be active. Before stopping anything it
verifies required secrets, an active owner with an explicitly registered enabled
method, and both current local policy endpoints. These checks cannot prove an
external provider or password is usable: verify real login yourself. Do not edit
config, secret files or owner identities concurrently outside normal tooling.
Read-only owner checking never creates or repairs an account. No new command is
added to sudoers or exposed to CI/browser clients.

Order: durable private journal → stop both consumers → confirm stopped → atomic
EnvironmentFile replacement → start both → verify both `/auth/config` policies →
durable commit → remove journal. Unit execution and local HTTP readiness have
finite timeouts/retries. Errors and HTTP bodies are not copied into privileged
logs. Stale review, incomplete credentials or missing owner fail before stopping
services. A pending journal blocks release deployment and another apply.

Finally verify owner login with every enabled method in a private window. Only
then remove unused old credentials/identities through normal tooling. Each
consumer permanently retires incompatible cookies before starting its listener;
the other enabled method's valid sessions are retained.

## Failure, interruption and restart

Ordinary failure attempts a coordinated stop, old config restore and restart with
readiness checks. Incomplete recovery retains the private journal and refuses
further apply/deployment. Inspect only private host state and run:

```sh
/usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/configure-authentication.mjs --recover
```

`latex-renderer-authentication-recovery.service` is required/ordered before both
consumers. At boot a pending transaction restores the old config **before** either
listener starts; a durable committed transaction keeps the new config. With no
journal, startup recovery writes no configuration and does not recursively take
an updater's already-held mutation lock. Recovery refuses corrupt/unknown records,
unsafe permissions/links, running consumers during boot recovery, and outside
config edits. Resolve those manually; do not delete a journal to bypass the guard.

The journal is under `/etc/latex-renderer/authentication-transaction/` (`0700`),
with at most one bounded `0600` record and two bounded temporary files. It contains
private before/after EnvironmentFile contents: never upload or commit it. Records
are removed after commit/recovery and directory changes are fsynced. There is no
accumulated history. Known interrupted temporary files are collected on the next
operation, not by recursively deleting arbitrary directories. Finalized review
files can be removed by the operator after successful login verification.

**Recovery never restores the database.** Cookies retired while trying the new
policy stay revoked even when old config is restored. Log in again. A DB backup
restore could revive cookies and is not authentication rollback.

This command does not downgrade an application release. Older releases cannot
understand new host keys, and a dual-method policy cannot be represented by old
`AUTH_MODE`. Do not downgrade with a new-format EnvironmentFile or live consumers;
release/legacy-format migration requires a separate reviewed operator procedure.

## Test coverage and limits

Normal tests use temporary private files, actual SQLite and bounded injected
service adapters. They include failure before/after publication, ENOSPC, broken
recovery, stale config, corrupt state, unsafe links, durable commit cleanup and a
real SIGKILL followed by reopened-store recovery. Native Password/signed OIDC
login passes through the shared public environment factory and real Admin/Remote
MCP routes. Existing browser tests check method visibility and escaping.
No test certifies production root/systemd, a real external IdP, Cloudflare
policy, TLS, or the unfinished CUI/Web server wizard.
