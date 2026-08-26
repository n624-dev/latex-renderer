# Deployment

## Build and validation

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm build
docker build -t latex-renderer:2026 renderer
```

Migration 006 is required by the optional SVG output flow. Before applying a release that includes a new schema migration, enter maintenance mode, drain active work, stop database writers, and take the WAL-consistent backup required by [MIGRATIONS.md](MIGRATIONS.md). Migration 006 adds requested outputs to Jobs and permits the validated SVG artifact types. Releases remain immutable under `/opt/latex-renderer/releases/<release-id>` with `/opt/latex-renderer/current` pointing to the active release.

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
  latex-renderer-image-manager.service \
  latex-renderer-image-refresh.timer \
  latex-renderer-image-operation-watchdog.timer \
  latex-renderer-image-log-cleanup.timer \
  latex-renderer-cleanup.timer \
  latex-renderer-backup.timer \
  latex-renderer-audit-export.timer
```

`latex-renderer-admin-web.service` is a compatibility alias for `latex-renderer-web.service` during migration.

Before the first deployment, create host-local configuration from the public
examples and replace every placeholder. These configured files are deliberately
ignored by Git:

```bash
sudo install -d -m 0750 /etc/latex-renderer /etc/cloudflared
sudo install -m 0640 .env.example /etc/latex-renderer/renderer.env
sudo install -m 0600 deploy/cloudflared/config.example.yml /etc/cloudflared/config.yml
cp apps/gateway-worker/wrangler.example.jsonc apps/gateway-worker/wrangler.jsonc
sudoedit /etc/latex-renderer/renderer.env /etc/cloudflared/config.yml
# Edit apps/gateway-worker/wrangler.jsonc as the deployment user.
```

Bootstrap the first owner with values from your Cloudflare Access identity:

```bash
sudo env \
  LATEX_RENDER_OWNER_EMAIL=owner@example.com \
  LATEX_RENDER_OWNER_NAME='Owner' \
  LATEX_RENDER_OWNER_ACCESS_SUBJECT=REPLACE_WITH_ACCESS_SUBJECT \
  sh deploy/scripts/bootstrap-owner.sh
```

## Managed TeX Live images

The public repository contains the reproducible Base and Runtime Dockerfiles,
language-profile generator, registry helpers, renderer smoke tests, and the
scheduled GHCR publication workflow. Pull-request image validation and daily
publication both use ephemeral GitHub-hosted runners. Pull requests receive
only read permission and never publish; only the scheduled/manual daily job has
job-scoped package-write permission. Production hosts and private
infrastructure configuration are not involved in public package builds.

The public package is `ghcr.io/n624-dev/latex-renderer-texlive`. Its Base is
built from `renderer/Dockerfile.base` and intentionally excludes application
renderer files. A deployment derives a Runtime from an immutable Base, overlays
the renderer files from the checked-out release, installs only the requested
language collections, and validates the resulting PDF/SVG behavior under the
production seccomp profile before activation.

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

When applying a new image or language set, the Image Manager always starts from
a clean selected base and builds a new runtime. It does not accumulate `tlmgr
install`/`remove` mutations in the active runtime. Language collection identifiers
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

A runtime is always derived by overlaying the **currently installed renderer
code** on the selected TeX Live Base, even when zero optional languages are
selected. This keeps a dated selector tied to the requested TeX Live snapshot
without pinning the application code to the date on which the Base was
published. A normal application deployment compares the renderer runtime
fingerprint and re-derives the managed Runtime from the same clean Base and
persisted language selection before renderer consumers start when the renderer
code changed. The production release command then reconciles the saved desired
selector through the same Image Manager operation used by Web and CLI. It does
not build or activate a separate fixed bootstrap image.

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
  --yes
```

Pin an archive date instead:

```bash
latex-render-admin tex apply \
  --image 2026-08-26 \
  --language collection-langenglish collection-langjapanese \
  --auto-update off \
  --rebuild-if-missing on \
  --yes
```

For `latest`, Image Manager pulls the public GHCR package and persists its
resolved digest. For a date, it pulls the matching dated GHCR tag when present.
With `--rebuild-if-missing on`, it starts the long local archive build only
after a successful registry listing proves that the dated tag is absent; a
registry or network failure does not silently trigger that fallback. Weekly and
digest selectors are pull-only. Use the operation ID returned by `apply` to
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
2. Deploy code with legacy routes enabled, apply all pending database migrations through Migration 006, and provision one secretless Web accounting principal for every invited user before enabling Web Project writes or SVG output.
3. Start all loopback services and verify `/health`.
4. Configure `/app`, `/admin`, and `/oauth/authorize` in the same human-user Access application so they share one audience. Add the human Allow and Admin CLI Service Auth policies, then set `CLOUDFLARE_ADMIN_AUDIENCE` and `CLOUDFLARE_REMOTE_MCP_AUDIENCE` to that application audience.
5. Deploy Gateway Worker with its narrow API Worker Routes.
6. Reconcile the remotely managed Tunnel path rules in the documented order.
7. Deploy `@latex-renderer/public-web` without production routes and validate its `workers.dev` preview.
8. Apply only the explicit public Worker Routes with `sync-public-worker-routes.mjs --apply`.
9. Run both unified-origin and public/private boundary smoke tests.
10. In a signed-out browser, verify that `/app/` and `/admin/` redirect to Cloudflare Access while `/docs/` remains public. Sign in as an invited user and test `/app/`; then verify `/admin/` with an owner/admin and run a real Japanese/English render smoke test.
11. Start the worker, disable maintenance mode, and keep old hosts and route aliases through the compatibility release.

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
cp apps/gateway-worker/wrangler.example.jsonc apps/gateway-worker/wrangler.jsonc
# Edit /etc/latex-renderer/renderer.env and wrangler.jsonc with deployment values.
pnpm exec wrangler login
export CLOUDFLARE_ACCOUNT_ID=REPLACE_WITH_ACCOUNT_ID
export CLOUDFLARE_TUNNEL_ID=REPLACE_WITH_TUNNEL_ID
export CLOUDFLARE_ZONE_NAME=example.com
sudo --preserve-env=CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_TUNNEL_ID,CLOUDFLARE_ZONE_NAME,CLOUDFLARE_API_TOKEN \
  sh deploy/scripts/deploy-production-release.sh <release-id>
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
5. If the rollback also requires reverting database schema, stop all writers and restore the pre-migration backup. Do not manually rebuild Migration 006 tables or drop Migration 005 structures from the live database.

Migration 006 changes the Job and artifact contracts used by the worker. A public-Worker-only rollback does not require a database restore, but rolling the application or worker back across Migration 006 requires the pre-migration backup unless the controlled rollback procedure has been completed. Keep that backup until the rollback path has been exercised.

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
