# Prepared-host server setup and settings

CUI and Web share review, confirmation, privileged apply and recovery. Use a
**verified managed release**, not development source executed as root. OS
packages, service users/groups, Node, subordinate IDs and rootless Docker must
already be prepared. No wizard runs apt/useradd, reconfigures Docker or changes
firewalls, Cloudflare, partitions or quotas.

## Select scope and one frontend

Run from a trusted root terminal. Replace `--web` with `--cui` to finish entirely
in the terminal; no frontend handoff is required.

```sh
# Existing authentication/runtime limits; image/ingress identity stays fixed.
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
# First application install on prepared infrastructure.
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --initial
# Custom HTTPS change on an existing managed standalone installation.
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --ingress
```

Existing scope requires a configured database, enabled owner and healthy
services. It never creates/reset owners or keys. Provision new login credentials
before enabling a method. Use normal Updater flows for code/image updates.

Initial scope refuses existing configuration or an unattributable DB. It stages
application-only directories, fixed units/helper policy, seccomp, tmpfiles and
independent Updater from the verified release. Missing files are installed;
different existing files fail, not overwrite. Preparation precedes review but
creates no owner, environment or keys and starts no consumers. Only the
no-journal recovery dependency starts. Cancellation leaves these small application
files for retry, not a running or initialized server.

Prepared accounts: `latex-renderer`, `latex-renderer-web`, `latex-render-worker`,
`latex-renderer-backup`, `latex-renderer-update` and group `latex-renderer`.
Tooling includes Node at `/usr/local/bin/node`, age, Nginx, Docker, ACL tools,
runuser/flock, systemd, sudo/visudo and normal Updater verification/build tools.
The worker's rootless Docker must run and the chosen immutable renderer image
must already exist. Review does not pull/build an image. Choose an existing
non-root deployment user with a non-root primary group for later Updater builds.
The Docker worker must belong to the application service group. Missing
prerequisites fail; the wizard never changes group membership to repair them.

Ingress scope requires an existing dedicated managed standalone/custom TLS
service. Owner/auth/image/keys and unknown environment settings are preserved.
Legacy global Nginx migration and automatic certificate issuance are not
supported. Existing Cloudflare connector/Access settings are not rewritten.

## Review and secrets

Both frontends accept a full non-secret format-4 review. Web offers common
fields and advanced JSON; CUI accepts complete JSON plus hidden secret prompts.
Application limits use bytes/seconds, not OS quotas. Fixed DB/storage paths are
`/var/lib/latex-renderer/renderer.sqlite3` and `/var/lib/latex-renderer/storage`.
Worker timeout is at most 840 seconds within the existing drain budget.

Initial owner credentials, deployment user, enabled OIDC client secret and
custom TLS are separate transient inputs. Web accepts PEM contents; CUI reads
bounded regular PEM files without following symlinks. Password confirmation and
the actual runtime hashing/password policy apply. TLS checks hostname, validity
and matching certificate/key. Never put secrets in JSON, argv, URLs or logs.

Password + OIDC bootstraps with Password; register OIDC identity explicitly
afterwards. OIDC-only/Access use exact issuer + subject, never email auto-linking.
Cloudflare needs an existing working connector/HTTPS origin; no API token is
requested. Preview is read-only. Explicit confirmation applies the exact reviewed
candidate; editing invalidates approval.

Initial peppers/ticket keys are random 32-byte keys; management bearer tokens
are printable 64-digit hex. Valid existing keys are preserved, never rotated to
repair restore failures. Backup age identity/recipient must match. Owner
creation uses the actual atomic SQLite bootstrap, not a parallel implementation.

## Dedicated HTTPS and application activation

Standalone uses `latex-renderer-ingress.service` and
`/etc/latex-renderer/ingress-nginx.conf`, independent of co-hosted
`nginx.service`. TLS has fixed private slots under `/etc/latex-renderer/secrets`.
Access logging is off; HTTP stays on loopback behind verified HTTPS.
Socket inspection rejects occupied fresh ports, unavailable backends and any
unexpected non-loopback listener on internal application ports. Custom
certificate renewal is operator-managed and applied through a new review.
See [standalone ingress](standalone-ingress.md).

Initial apply configures only the new application's fixed storage ACL, publishes
settings, starts fixed services/maintenance timers and verifies internal/public
health. Persistent unit enabling follows durable health-verified commit;
interrupted enabling resumes from the committed journal, never owner reset.
The TeX mirror, its 15GiB limit, GHCR retention, shared Nginx and Cloudflare
Tunnel are untouched.

## Temporary Web bootstrap

Default is an ephemeral **127.0.0.1-only HTTP** port. Prefer same-host browsing
or SSH forwarding. It is not application HTTP/HTTPS fallback; never publish it
in Nginx, Cloudflare or a permanent service.

Private LAN requires an explicit exceptional operator choice:

```sh
node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --initial \
  --lan 192.168.1.10 --allow-network 192.168.1.0/24 --acknowledge-plaintext-lan
```

Passwords/private keys then travel over plaintext HTTP. Use SSH forwarding on
untrusted networks. The private IPv4 must be assigned locally, canonical private
CIDRs limit actual socket peers, and no wildcard/public address or forwarded
header grants access. This option opens no firewall ports.

The printed one-use fragment token expires in five minutes. The browser removes
it and uses memory-only session/CSRF tokens, not localStorage/sessionStorage.
Exact socket/Host/Origin checks, bounded JSON, fixed actions, eight failed
bootstrap attempts, CSP and no-store responses apply. Session expiry is 30
minutes, idle timeout ten minutes. Apply suspends idle timeout, not absolute
expiry. Success/close/expiry/signals stop the listener. Browser disconnection
never cancels a durable host apply; do not blindly retry a lost response.

## Recovery

All mutations share the host lock and fixed file/unit slots. Frontend errors are
fixed codes, not secret/provider stderr. Existing settings recovery is described
in [authentication cutover](authentication-cutover.md#runtime-settings-on-an-existing-host).
Restoring config never rolls back DB/session retirement.

Initial/ingress recovery has one bounded 0600 journal in the root-only 0700
`/etc/latex-renderer/installation-transaction` directory. It contains reviewed
file snapshots including TLS/OIDC secrets, **not the owner password**. Never
upload it. Atomic publication uses fsync. Unexpected links/permissions, corrupt
state and unrelated file/owner edits stop recovery rather than being repaired.
Success removes the journal; interrupted operations retain it for recovery, not
an unbounded diagnostic history.

Use Recover in the same Web frontend or `RECOVER` in CUI. Relaunch the original
scope after process termination. Boot recovery precedes all consumers.

- Before owner commit: restore prior file slots, preserve keys/attributable
  migrated DB, retain journal, request the same settings and credentials.
  Boot refuses to start consumers until credentials return.
- After owner commit: recover **forward**, never recreate/reset owner or
  delete/restore DB. DB marker + audit identify owner commit even if the process
  died before updating its journal. Boot publishes files but retains the journal
  until explicit foreground recovery proves health.
- Existing ingress failure: restore old file set, restart and verify old public
  HTTPS and active services, then remove journal.
- Committed cleanup/enabling interruption: keep the new files, retry finalization;
  never restore already-committed old settings.

Missing referenced keys, corrupt/unattributable DB or mismatched owner/file state
require operator investigation. No automatic DB deletion, credential rotation,
owner reset, TLS bypass or unbounded retries exist.

## Acceptance

Fixtures and Chromium checks do not certify real fresh-host OS/systemd/Docker,
physical Windows/macOS GUI or provider-specific sign-in. Follow
[prepared-host acceptance](server-setup-acceptance.md) on a disposable host before
using initial install in production. Check owner login, representative render,
restart and interrupted recovery. Never test fresh setup on a production DB.
