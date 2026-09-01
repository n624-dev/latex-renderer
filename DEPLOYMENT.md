# Deployment

## Build and validation

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
docker build -t latex-renderer:2026 renderer
```

Migrations through Migration 016 are required by the v1.3 authentication, lease-fencing, cleanup, admission, upload, pagination, Project-output, and durable API-key invariants. Before applying them, enter maintenance mode, drain active work, stop every database writer, and take the WAL-consistent encrypted backup required by [MIGRATIONS.md](MIGRATIONS.md). Older releases cannot safely enforce the post-migration invariants, so rollback requires restoring that backup. Releases remain immutable under `/opt/latex-renderer/releases/<release-id>` with `/opt/latex-renderer/current` pointing to the active release.

## Host services

Install the units in `deploy/systemd/` and enable:

```bash
sudo systemctl enable --now \
  latex-renderer-api.service \
  latex-renderer-internal-api.service \
  latex-renderer-admin-api.service \
  latex-renderer-web.service \
  latex-renderer-remote-mcp.service \
  latex-renderer-worker.service \
  latex-renderer-update-manager.service \
  latex-renderer-image-manager.service \
  latex-renderer-image-refresh.timer \
  latex-renderer-image-operation-watchdog.timer \
  latex-renderer-image-log-cleanup.timer \
  latex-renderer-update-refresh.timer \
  latex-renderer-cleanup.timer \
  latex-renderer-backup.timer \
  latex-renderer-audit-export.timer
```

`latex-renderer-admin-web.service` is a compatibility alias for `latex-renderer-web.service` during migration.

Before the first deployment, create host-local configuration from the public
examples and replace every placeholder. These configured files remain outside
the Git worktree. `renderer.env` and `update-manager.env` are common to both
profiles; the remaining files are Cloudflare-only:

```bash
sudo install -d -m 0750 /etc/latex-renderer /etc/cloudflared
sudo install -m 0640 .env.example /etc/latex-renderer/renderer.env
sudo install -m 0600 deploy/update-manager.env.example /etc/latex-renderer/update-manager.env
sudoedit /etc/latex-renderer/renderer.env \
  /etc/latex-renderer/update-manager.env

# DEPLOYMENT_MODE=cloudflare only
sudo install -m 0600 deploy/deployment.env.example /etc/latex-renderer/deployment.env
sudo install -m 0600 deploy/cloudflared/config.example.yml /etc/cloudflared/config.yml
sudo install -m 0600 apps/gateway-worker/wrangler.example.jsonc \
  /etc/latex-renderer/gateway-worker.wrangler.jsonc
sudoedit /etc/latex-renderer/deployment.env \
  /etc/cloudflared/config.yml \
  /etc/latex-renderer/gateway-worker.wrangler.jsonc
```

Set exact `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE=cloudflare|standalone`, and
`AUTH_MODE=cloudflare-access|oidc|password`; no production default is inferred.
Standalone rejects Cloudflare Access. For OIDC, configure the exact HTTPS issuer
and client ID in `renderer.env`, and put the client secret only in the documented
root-owned secret file. Password mode uses the independently generated
root-owned pepper.

For standalone, install one example from `deploy/reverse-proxy/`, replace the
hostname and certificate paths, validate its syntax, and expose no application
port directly. The proxy must strip incoming `CF-Access-*`, replace the trusted
client-IP header, enforce TLS/body/connection/rate/time limits, and send only the
small ticket routes to port 3105.

Bootstrap the first owner using the authentication mode already selected in
`renderer.env`. Email is optional and never links an identity. Read secrets
interactively rather than placing them in shell history:

```bash
# cloudflare-access or oidc
sudo env \
  LATEX_RENDER_OWNER_EMAIL=owner@example.com \
  LATEX_RENDER_OWNER_NAME='Owner' \
  LATEX_RENDER_OWNER_SUBJECT=REPLACE_WITH_STABLE_SUBJECT \
  sh deploy/scripts/bootstrap-owner.sh

# password
password_file=$(mktemp)
chmod 0600 "$password_file"
read -r -s -p 'Initial password: ' owner_password
printf '%s' "$owner_password" > "$password_file"
unset owner_password
sudo env \
  LATEX_RENDER_OWNER_EMAIL=owner@example.com \
  LATEX_RENDER_OWNER_NAME='Owner' \
  LATEX_RENDER_OWNER_LOGIN_NAME=owner \
  LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
  sh deploy/scripts/bootstrap-owner.sh
shred -u "$password_file"
```

### Changing `AUTH_MODE` without locking out the instance

An existing owner is never relinked by email and `bootstrap-owner.sh` never
changes credentials after the first owner exists. Before changing `AUTH_MODE`,
provision the target method locally against the owner's immutable `user_...`
ID. This recovery-only command accepts active owners, refuses to replace an
existing identity or password credential, records an audit event, and revokes
the owner's existing browser sessions.

Stop the Admin API while modifying authentication state, take a current
encrypted backup, and copy the owner ID from the Admin UI or the local
`users list` command. Then run exactly one target-mode command:

```bash
admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
common_env="DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 API_KEY_PEPPER_ID=v1 API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper"
sudo systemctl stop latex-renderer-admin-api.service

# cloudflare-access or oidc: enter the exact configured issuer and stable sub
IFS= read -r -p 'Owner user ID: ' owner_id
IFS= read -r -p 'Target auth mode: ' target_mode
IFS= read -r -p 'Exact issuer: ' target_issuer
IFS= read -r -p 'Stable subject: ' target_subject
sudo env $common_env /usr/local/bin/node "$admin_local" auth provision-owner \
  --owner-id "$owner_id" --auth-mode "$target_mode" \
  --issuer "$target_issuer" --subject "$target_subject" --yes

# password: keep the password out of argv and the environment
password_file=$(mktemp)
chmod 0600 "$password_file"
read -r -s -p 'Initial password: ' owner_password
printf '%s' "$owner_password" > "$password_file"
unset owner_password
sudo env $common_env \
  AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
  /usr/local/bin/node "$admin_local" auth provision-owner \
  --owner-id "$owner_id" --auth-mode password --login-name owner \
  --password-file "$password_file" --yes
shred -u "$password_file"
```

Do not use both examples. Configure the target mode and its root-owned secret
files in `/etc/latex-renderer/renderer.env`, run
`validate-production-profile.mjs`, and only then restart the Admin API and Web
service. Confirm login in a private browser window before removing the old
identity or credential. On any failure, leave the old `AUTH_MODE` configured,
restore service availability, and investigate from the audit log; never create
an email-based recovery link.

## Managed TeX Live images

The public repository contains the reproducible Base and Runtime Dockerfiles,
language-profile generator, registry helpers, renderer smoke tests, and the
scheduled GHCR publication workflow. Pull-request image validation and daily
publication both use ephemeral GitHub-hosted runners. Pull requests receive
only read permission and never publish; only the scheduled/manual daily job has
job-scoped package-write permission. Production hosts and private
infrastructure configuration are not involved in public package builds.

For an existing personal-account package, repository linking and ordinary
**Manage access** roles do not grant a workflow access. In the package's
**Manage Actions access** settings, add the repository that owns the publishing
workflow and assign it the **Write** role. Before setting up Docker or
downloading TeX Live, the daily workflow asks GHCR to mount the config blob from
the package's existing single-platform `latest` manifest back into that same
package. The blob is already linked, so this proves push access while creating
no manifest, tag, layer, or package version. The workflow stops immediately if
GHCR denies that probe.
Do not replace this repository-scoped `GITHUB_TOKEN` flow with a long-lived
personal access token.

After changing package access, run the `ghcr-publish-access` workflow first. It
performs only the token-scope check and does not build or push an image. Start
`renderer-image-daily` only after that short workflow succeeds.

The public package is `ghcr.io/n624-dev/latex-renderer-texlive`. Its Base is
built from `renderer/Dockerfile.base` and intentionally excludes application
renderer files. The daily workflow also publishes both the language-neutral and
English/Japanese supported Runtime presets. Their immutable identities bind the exact Base image ID, renderer runtime
fingerprint, and normalized language collection set. Production validates its
OCI identity labels and PDF behavior under the production seccomp profile before
activation.

Both the Debian substrate and TeX Live inputs are pinned. Registry consumers
should select a dated tag or digest; `latest` is convenient for discovery but
must resolve to and be persisted as an immutable digest before activation.
Anonymous pull access is required for the managed-image feature. The Image
Manager keeps desired configuration separate from the active image and commits
a change only after build, validation, and activation succeed.

Both Web UI and `latex-render-admin tex ...` use the same Admin API and the same
loopback-only Image Manager. Desired image selector, optional language
collections, country override, and `latest` auto-follow state are stored outside
Docker images. New installations start with **no optional language selected in
the managed desired configuration**. The server-side country hint changes only
ordering: the mapped local language collection(s) are shown first, English
second unless already present, and remaining collections alphabetically. Nothing
is checked automatically. The country can be persistently overridden or cleared
from either Web UI or CLI; neither client has a private locale heuristic.

When applying a new image or language set, the Image Manager first reuses an
exact local Runtime, then pulls the exact prebuilt Runtime from public GHCR. It
builds from the clean selected Base only when no matching Runtime tag exists and
the administrator explicitly enabled the custom-language local-build fallback.
It does not accumulate `tlmgr install`/`remove` mutations in the active runtime. Language collection identifiers
are schema/syntax-validated before privileged execution, then `tlmgr` verifies
each requested collection against the **exact selected TeX Live snapshot** before
installing it. This means applying a historical Base is not gated on whatever
collections happen to exist in today's latest catalog. The state records the
user's selected collections separately from `effectiveLanguageCollections`,
which may also contain dependencies pulled by TeX Live (for example CJK
dependencies of a selected language).

An explicit apply is transactional: its requested selector, language set, and
auto-update setting become the persisted desired configuration only after the
new Runtime has passed validation and activation. A pull, build, or validation
failure leaves both the active Runtime and the previous desired configuration
unchanged, records the failure, and is shown as such by the Web UI and CLI.

If the live language catalog is unavailable, both Web and CLI use the same
degraded response and keep persisted choices visible. Existing selections can be
kept or cleared, but "select all" is deliberately disabled because the saved
subset is not a complete catalog and must never be misinterpreted as all
languages.

A dated image missing from GHCR can be rebuilt locally from that date's TeX Live
archive, but the Admin API enables that expensive fallback only after a successful
GHCR tag-list request confirms that the dated tag is absent. A DNS, TLS, registry,
or other transient lookup failure therefore returns an error instead of silently
starting a multi-gigabyte cold build. Before switching, the new runtime is
smoke-tested and its package/font inventory is generated.

A Runtime always contains the **currently installed renderer code** over the
selected TeX Live Base, even when zero optional languages are selected. A normal
application deployment compares the renderer runtime fingerprint, resolves the
exact Runtime identity, and uses the same local-cache/GHCR/explicit-local-fallback
order before renderer consumers start. The production release command then
reconciles the saved desired selector through the same Image Manager operation
used by Web and CLI. It does not build or activate a separate fixed bootstrap
image.

### Updating the TeX environment

Use either the administrator Web page at `/admin/tex-environment/` or
`latex-render-admin`; both call the same transactional operation and persist the
same desired state. In Web, choose the image selector, language collections,
and automatic-update setting, then select **Apply**. Keep the operation page
open until it reports success; closing the page does not cancel the server-side
operation.

For CLI administration, inspect the available images and languages first:

```bash
latex-render-admin tex status
latex-render-admin tex images
latex-render-admin tex languages --search japanese
```

Follow the newest published Base and install English and Japanese support:

```bash
latex-render-admin tex apply \
  --image latest \
  --language collection-langenglish collection-langjapanese \
  --auto-update on \
  --rebuild-if-missing off \
  --runtime-build-if-missing off \
  --reason "Enable Japanese document support" \
  --yes
```

Pin an archive date instead:

```bash
latex-render-admin tex apply \
  --image 2026-08-26 \
  --language collection-langenglish collection-langjapanese \
  --auto-update off \
  --rebuild-if-missing on \
  --runtime-build-if-missing off \
  --reason "Pin TeX Live for reproducible documents" \
  --yes
```

For `latest`, Image Manager pulls the public GHCR package and persists its
resolved digest. For a date, it pulls the matching dated GHCR tag when present.
With `--rebuild-if-missing on`, it starts the long local archive build only
after a successful registry listing proves that the dated tag is absent; a
registry or network failure does not silently trigger that fallback. Weekly and
digest selectors are pull-only. `--runtime-build-if-missing off` keeps Runtime
selection pull-only. Enable it only for a custom language combination that is
not one of the documented prebuilt presets; the Image Manager still requires a
successful GHCR absence check before building locally. Use the operation ID returned by `apply` to
inspect a long-running change:

```bash
latex-render-admin tex operation <operation-id>
```

Application releases preserve this desired selector, language list, and
automatic-update setting. Running `deploy-production-release.sh` after a code
update asks Image Manager to reconcile those saved values before renderer
consumers start: `latest` is checked for a new digest, pinned selectors remain
pinned, and changed renderer files are overlaid on the selected clean Base.
Credentials, `/etc/latex-renderer`, Image Manager state, databases, and
host-specific Worker/Tunnel configuration remain outside Git.

### Updating the application

System installations use a root-owned Update Manager over a permission-restricted
local Unix socket. The Web/API processes never run `sudo` and never receive a
general root shell. The one-time `install-host.sh` bootstrap creates the helper,
its random credential, durable operation state, and the root-owned
`/etc/latex-renderer/update-manager.env`. Set `UPDATE_DEPLOY_USER` there to the
non-root account that owns the pnpm and Wrangler login used for deployments.
The shared `/var/lib/latex-renderer` parent remains root-owned and group-writable
(`root:latex-renderer`, mode `2770`) so root-owned Manager state is never reached
through a service-user-owned parent. Service-owned storage remains in dedicated
children. The deployment builds `client-dist` before copying the immutable
release and waits for the Update Manager socket before continuing verification.

The default application policy is stable **notification only**. Check, apply,
and rollback from `/admin/updates/` or the equivalent CLI commands:

```bash
latex-render-admin update status
latex-render-admin update check
latex-render-admin update policy --mode notify --reason "Keep updates manual" --yes
latex-render-admin update apply v1.3.0 --reason "Apply verified stable release" --yes
latex-render-admin update rollback --reason "Recover previous known-good release" --yes
```

`latex-renderer-update-refresh.timer` performs the same stable check daily with
jitter. To opt in to unattended verified updates, use the Web policy control or
`latex-render-admin update policy --mode automatic --reason "Approve automatic verified updates" --yes`. Return to the safer
default with `--mode notify`. Automatic mode still refuses mutable releases,
missing/mismatched assets, invalid upgrade paths, or an already active update.

An apply accepts only `n624-dev/latex-renderer` semantic-version releases. It
requires GitHub to report the release as immutable, resolves the locked tag to
its commit, requires the exact `latex-renderer-server-<version>.tar.gz` asset,
and verifies the API-provided SHA-256 digest and embedded version/tag/commit
metadata, Node/pnpm requirements, renderer fingerprint, and available staging
and release filesystem capacity. Caller-supplied URLs, paths, repositories,
branches, service names, and commands are not accepted. Application and TeX
mutations share a non-blocking host lock; a concurrent request is rejected
instead of waiting behind a long-running build or deployment.

API keys use dedicated `admin:update:read/write` and
`admin:tex-environment:read/write` scopes; legacy `admin:system:read/write`
scopes authorize only system endpoints. The runtime-changing TeX operations and
application update policy, refresh, apply, and rollback require an owner and a
non-empty reason, retained as audit metadata. Reserve `admin:*` for emergency
compatibility keys.

The host must already provide the release's required Node major. When the
verified manifest pins a different pnpm patch/minor version, the helper updates
pnpm only in the configured non-root deployment user's pnpm home, verifies the
resulting version, and then performs the frozen-lockfile install.

After verification, the helper extracts the source as the configured non-root
deployment user, rejects paths outside the versioned archive root and source
symlinks, runs `pnpm install --frozen-lockfile` without root, takes the configured
backup, and invokes the existing guarded production deployment. Releases remain
immutable under `/opt/latex-renderer/releases`; configuration, credentials,
databases, storage, TeX desired state, and host-specific Cloudflare files remain
outside the bundle and outside Git. A failed deployment attempts to redeploy the
previous known-good release only when the embedded release policy declares that
rollback compatible; every result is recorded in a redacted durable log. For a
forward-only schema change, follow [MIGRATIONS.md](MIGRATIONS.md) and its backup
restore procedure instead of forcing an application-only rollback.

For a host where the privileged helper is intentionally unavailable, download
and verify the immutable server asset manually, then use the existing
`sudo sh deploy/scripts/deploy-production-release.sh <release-id>` procedure.
Rootless installations can check releases, but service/image activation must be
performed by their external administrator or orchestrator.

Maintainers must enable GitHub **immutable releases** before publishing an
updater-compatible release. Run the `server-release` workflow for an existing
protected `v*` tag; it validates the source and uploads the server bundle,
client ZIP, signed MCPB, and combined checksums to one draft. Review every asset
and the generated notes before publishing the draft, because publication locks
its tag and assets. The workflow's repository-scoped token cannot read the
administrative immutable-release setting, so a maintainer must verify that
setting with repository administration access before dispatch and again before
publication. The updater deliberately rejects older mutable releases, including
v1.0.0; v1.1.0 is the first updater-compatible server release.

The previous runtime is retained for rollback, including the legacy runtime that
was active before the first managed switch. Managed rollback re-derives the
previous Base/language selection using the current renderer code; the initial
legacy rollback target is retained as-is. Cleanup protects both current and
previous managed Runtime/Base image IDs even if the active target is temporarily
the legacy rollback image. If service restart or inventory activation fails,
`renderer.env` and the previous inventory are restored and the old consumers are
restarted.

The Image Manager runs as a separate localhost-only privileged service. The
Admin API does not receive the Docker socket or arbitrary command execution; it
can call only the Image Manager's allowlisted operations. The helper itself
connects only to the dedicated `latex-render-worker` rootless Docker daemon. Its
systemd sandbox uses `/var/lib/latex-renderer/image-manager/tmp` as the explicit
shared writable temporary root so paths passed to the separate rootless Docker
daemon remain visible while `ProtectSystem=strict` stays enabled. Worker,
Internal API, and Remote MCP require successful Image Manager startup/restoration
before they can start, preventing persisted managed state from silently falling
back to the legacy bootstrap image.

Image operations normally complete or fail through their retained operation
record. A five-minute watchdog checks for an operation that has remained running
for more than four hours. If one is stale, it restarts the Image Manager; startup
marks the interrupted operation failed and restores/revalidates the persisted
Runtime before the watchdog restarts renderer consumers that had been active.
This bounds the manager-side operation lock instead of allowing every later
apply/rollback to remain blocked indefinitely. Operation logs are retained for
30 days and temporary files for one day by tmpfiles policy plus a daily cleanup
timer. Image and language apply inputs are schema-validated by the common Admin
API and language collection identifiers are additionally validated by the
runtime build script before they can reach `tlmgr`. Mutating TeX-environment
requests are also recorded in the existing database audit log with the requesting
admin actor. Country changes are rejected while an image operation is active so
a long apply cannot overwrite a concurrently saved country override.

## Safe rollout order

1. Enable maintenance mode `reject-new-jobs`, let active work drain, stop the worker, and take the pre-migration database backup.
2. Verify exact `PUBLIC_ORIGIN`, deployment/authentication mode, root-owned secret files, and the selected external issuer/audience. Apply all pending migrations through Migration 016. Do not start an older release against schema 16.
3. Bootstrap or verify at least one active owner with an explicit provider/issuer/subject identity or password credential. Never claim an account by email. On a clean install, the first deployment defers only the authenticated render smoke test until this bootstrap is complete; run `smoke-test-production.sh` after the TeX environment is ready.
4. Start the common loopback services and verify their local health. Confirm ports 3100-3105 are unreachable from an external interface.
5. For Cloudflare, configure `/auth`, `/app`, `/admin`, and `/oauth/authorize` in the intended Access application when Access is the selected authentication mode; deploy the Gateway Worker, reconcile Tunnel paths, preview public Web, and apply only the explicit Worker Routes. For OIDC/password, do not create a conflicting Access policy in front of the login callbacks.
6. For standalone, enable the standalone gateway, validate and reload exactly one TLS reverse proxy example, verify that spoofed Cloudflare/client-IP headers are replaced, and confirm that Internal API and manager endpoints have no route.
7. Run unified-origin and public/private boundary smoke tests. In a signed-out browser, verify that `/app/` and `/admin/` enter the configured login flow while `/docs/` stays public. Sign in as a user and as an owner/admin, then verify logout and CSRF rejection.
8. Run a real English/Japanese PDF and SVG render, verify Remote MCP consent with the same browser session, start the worker, and disable maintenance mode. Retain the pre-Migration-007 backup until a restore drill succeeds.

## Public Web CI and preview

Every pull request runs `pnpm check` in `.github/workflows/ci.yml` with only
`contents: read`. The public Web workspace build performs all of the following
before the PR can merge:

1. Generate the deterministic client and public static asset tree.
2. Run a Wrangler deploy dry-run, including the Static Assets limits check.
3. Start `wrangler dev --local` on an ephemeral loopback port.
4. Probe representative HTML, CSS, OpenAPI, redirect, security-header, and 404
   behavior against that local Preview.

The workflow receives no Cloudflare secret and contains no deployment step, so
fork and external pull requests cannot publish a Worker or alter production
routes. For an interactive equivalent Preview, run:

```bash
pnpm --filter @latex-renderer/public-web dev
```

## Public Web production deploy

Use the guarded deployment command from a clean, up-to-date `main` checkout:

```bash
pnpm exec wrangler login
export PUBLIC_ORIGIN=https://latex.example.com
export CLOUDFLARE_ACCOUNT_ID=REPLACE_WITH_ACCOUNT_ID
export CLOUDFLARE_ZONE_NAME=example.com
export LATEX_RENDER_PUBLIC_PREVIEW_URL=https://REPLACE_WITH_WORKER_SUBDOMAIN.workers.dev
deploy/scripts/deploy-public-web-production.sh
```

The command rejects another branch, a dirty worktree, or a local commit that
does not exactly match `origin/main`. It records the active Worker version,
runs the complete repository check and local Preview before changing remote
state, uploads the Worker, verifies the `workers.dev` URL, applies the route
allowlist, and runs both production smoke suites. A failed build or Preview
therefore cannot update production. If post-cutover boundary verification
fails, the command removes the public routes and verifies the VPS fallback.

The operator credential needs only Account Workers Scripts Write, Zone Workers
Routes Write, and Zone Read for your deployment zone. Tunnel, Access, DNS, and
account administration permissions are not needed by this public-only deploy. Keep the
credential in Wrangler's user login or `CLOUDFLARE_API_TOKEN`; do not add it to
the pull-request workflow.

The production release command deploys and smoke-tests the local services and
Workers before reconciling the Tunnel routes. The invoking user must already be
logged in with Wrangler and have the required Worker, Route, and Tunnel access:

```bash
# Keep the configured Gateway Worker file outside the repository at
# /etc/latex-renderer/gateway-worker.wrangler.jsonc (root:root, mode 0600).
# Keep Account, Tunnel, and Zone identifiers in /etc/latex-renderer/deployment.env
# (root:root, mode 0600). Edit both host-local files with deployment values.
pnpm exec wrangler login
sudo sh deploy/scripts/deploy-production-release.sh <release-id>
```

After all production smoke tests pass, the command retains the three newest
immutable host releases (and always preserves the active release). For legacy
renderer mode it removes only dangling images after verifying that the tagged
renderer image still matches the immutable image ID in `renderer.env`. If either
the active or previous rollback target is a managed TeX Runtime, generic Docker
image pruning is skipped; cleanup is delegated to the Image Manager so the
current/previous Runtime and current/previous Base remain available for rollback.
Failed or partially verified deploys do not run this cleanup.

To inspect or apply only the remote Tunnel change, use:

```bash
export PUBLIC_ORIGIN=https://latex.example.com
export CLOUDFLARE_ACCOUNT_ID=REPLACE_WITH_ACCOUNT_ID
export CLOUDFLARE_TUNNEL_ID=REPLACE_WITH_TUNNEL_ID
node deploy/scripts/sync-cloudflare-tunnel-config.mjs
node deploy/scripts/sync-cloudflare-tunnel-config.mjs --apply
```

The script reads the current remote configuration, replaces only the exact
`latex.example.com` routes, preserves every unrelated shared-tunnel route,
and verifies the resulting Cloudflare configuration version by reading it back.

The public Worker remains route-free in `apps/public-web/wrangler.jsonc` so an upload cannot
accidentally claim the entire shared hostname. Inspect, apply, and verify its
path allowlist with:

```bash
export PUBLIC_ORIGIN=https://latex.example.com
export LATEX_RENDER_BASE_URL=$PUBLIC_ORIGIN
export CLOUDFLARE_ACCOUNT_ID=REPLACE_WITH_ACCOUNT_ID
export CLOUDFLARE_ZONE_NAME=example.com
pnpm --filter @latex-renderer/public-web run deploy
node deploy/scripts/sync-public-worker-routes.mjs
node deploy/scripts/sync-public-worker-routes.mjs --apply
deploy/scripts/smoke-test-public-worker-boundary.sh
```

The boundary smoke test retries public paths for up to two minutes because new
zone routes can become visible across Cloudflare edge servers incrementally.
Private and dynamic boundary violations still fail immediately.

The allowlist contains only `/`, `/docs`, `/downloads`, `/assets`, `/openapi`,
and `/client` route patterns. `/admin`, `/admin/api`, `/api`, `/status`, upload,
job, and artifact requests continue through the existing Gateway/Tunnel/VPS
boundary. The reconciler refuses to replace a matching pattern owned by another
Worker and preserves all unrelated zone routes.

Remote MCP and OAuth are not public Worker assets. Verify discovery and the bearer challenge after deployment:

```bash
curl --fail "$PUBLIC_ORIGIN/.well-known/oauth-protected-resource/mcp"
curl -i -X POST "$PUBLIC_ORIGIN/mcp"
```

The second request must return `401` with a `WWW-Authenticate` link to the protected-resource metadata. Then add the deployment's `/mcp` URL as a Claude custom Web connector and complete one user OAuth consent flow.

For a trusted MCPB release, set `MCPB_SIGNING_CERT_FILE` and `MCPB_SIGNING_KEY_FILE` to a code-signing certificate and its private key while running the client build. Builds without both variables use an ephemeral self-signed certificate so CI and local clean-install tests still verify cryptographic integrity, but Claude Desktop may show an untrusted-publisher warning.

## Rollback

The public-only emergency commands do not require a clean main checkout:

```bash
# Fastest recovery: return all public paths to the independently running VPS.
deploy/scripts/deploy-public-web-production.sh --rollback-vps

# Restore a known Worker version while leaving the public route allowlist on.
deploy/scripts/deploy-public-web-production.sh --rollback-version <version-id>
```

`wrangler rollback` creates a new deployment of the selected version at 100%
but does not change route associations. Use the exact previous version printed
by the production deploy command. The VPS rollback is the safer first action
when the failure mode or Worker version is uncertain.

1. Restore the previous `/opt/latex-renderer/current` symlink.
2. Restart the previous service units.
3. Disable only the public Worker Routes and verify that the old VPS pages answer again:

   ```bash
   node deploy/scripts/sync-public-worker-routes.mjs --disable
   curl --fail --silent --show-error https://latex.example.com/ | grep -F 'LaTeX Renderer'
   curl --fail --silent --show-error https://latex.example.com/downloads/ | grep -F '最新版ZIP'
   ```

   A Worker version rollback alone does not remove its route associations;
   `--disable` is the production-origin rollback switch. Reapply the verified
   routes with `--apply` after the incident is resolved.

4. Restore the prior remote Tunnel and Access configuration.
5. If rollback crosses Migration 007 through Migration 016, stop admission and every database writer and restore the pre-migration backup. Do not run an older release against schema 16 or manually rebuild live tables.

Migration 006 changes the Job and artifact contracts, Migration 007 changes user and authentication contracts, and Migrations 008 through 016 add invariants that older Workers and APIs do not enforce. A public-Worker-only rollback does not require a database restore. Rolling the application back across these incompatible migrations requires its pre-migration backup unless a documented controlled non-production rebuild has been completed. Keep the backups until the rollback paths have been exercised.

## Health and logs

Run the combined route and endpoint health check after deploys and during an
incident:

```bash
deploy/scripts/check-public-web-health.sh
```

It verifies route ownership, public Worker responses, Access/no-store
boundaries, Gateway endpoints, Renderer routes, uploads/artifacts, and the VPS
status surface. For diagnosis, inspect the active version and live Worker logs,
then check the independently hosted VPS services:

```bash
pnpm --filter @latex-renderer/public-web exec wrangler deployments list
pnpm --filter @latex-renderer/public-web exec wrangler tail --format=json
sudo systemctl --no-pager --full status latex-renderer-web latex-renderer-api latex-renderer-admin-api
sudo journalctl -u latex-renderer-web -u latex-renderer-api -u latex-renderer-admin-api --since '30 minutes ago'
```

The Worker has persistent invocation logs enabled in `apps/public-web/wrangler.jsonc`; `tail`
is for immediate rollout/incident feedback. Cloudflare logs and VPS journals
must be checked separately because the public Worker and private services have
independent failure and recovery paths.
