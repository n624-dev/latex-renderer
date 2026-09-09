# Changelog

## Unreleased

## 1.3.5-rc.1 - 2026-09-09

- Update Hono from locked version 4.13.0 to 4.13.5 across all seven consuming applications, including its Node server peer resolutions. No other dependency version or application behavior is intentionally changed.
- Include upstream fixes for fragment-aware query parsing, static site generation path containment and bounded dot-notation body parsing. Keep existing authentication, routing and request validation enabled.
- Candidate only: require signed-artifact update/recovery E2E and separate designated-host validation before Stable promotion. Stable 1.3.4 and its published assets remain unchanged.

## 1.3.4 - 2026-09-09

- Promote the published immutable `v1.3.4-rc.10` candidate with no functional changes. RC10 passed signed-artifact upgrade/recovery E2E and the designated VPS update from RC5, including English/Japanese PDF/PNG rendering, public Worker boundary checks and independent Updater activation.
- Add independently updatable, verified Updater slots with bounded retention and journaled activation/recovery. Preserve application data, immutable-release provenance, encrypted backup requirements and the existing authenticated update path.
- Add tagless pre-release update validation and release-only signed-artifact E2E gates. Fix shared SQLite file permissions and isolate rootless Docker account configuration.
- Include the opt-in CI TeX Live snapshot mirror, bounded verified download prefetch and canonical archive fallback; retain Base-only image publication and avoid Actions build caches.
- Stable artifacts must name RC10 as the validated candidate and pass source-equivalence and final signed-artifact E2E checks before publication. This preparation does not deploy Stable to a host.

## 1.3.4-rc.10 - 2026-09-09

- Prepare SQLite database and sidecar files with explicit shared-group write permissions before migration; preserve existing contents and refuse unsafe links or initial overwrite. Keep the unchanged signed RC.5 baseline compatible through exclusive database creation.
- Add a manual tagless update-validation workflow with separately pinned branch provenance, one-day artifacts and no build cache or production credentials. Run the same update/recovery E2E without creating a Release or consuming an RC tag.
- Disposable-host validation passed for commit `de5494988ae8dd3c7a162844309a43321e700279`: distinct service-user database access, RC.5 upgrade, owner/storage preservation, English/Japanese PDF/PNG rendering, failed Updater startup and interrupted activation recovery.
- Candidate only: RC.9 failed baseline database migration before publication. Preserve its tag. Branch validation does not replace the final tagged release E2E or separate post-publication validation on the designated host.

## 1.3.4-rc.9 - 2026-09-09

- Isolate rootless Docker setup from caller and PAM-injected XDG/Docker settings. Set worker-owned configuration paths after the user transition and verify the responding daemon is rootless before continuing.
- Prepare the disposable CI host's per-user environment and Docker service before deploying the unchanged signed RC.5 baseline. Production does not rewrite machine-wide environment defaults.
- Candidate only: RC.8 passed build and attestation but failed during baseline rootless Docker setup, before candidate deployment. Preserve its tag; require release-only update/recovery E2E and separate post-publication host validation before stable promotion.

## 1.3.4-rc.8 - 2026-09-09

- Use a validated standalone CI hostname consistently across TLS, proxy headers and application origins without bypassing production profile validation.
- Verify standalone client and MCPB downloads against client-dist metadata; generate static distribution assets as the build user for the frozen RC.5 baseline without modifying signed source or rebuilding signed clients.
- Prevent delayed automatic Updater activation from racing release E2E fixtures. Require actual broken-controller startup evidence, the expected health failure and complete state recovery; lock contention cannot count as a successful recovery test.
- Candidate only: RC.7 failed release E2E before publication. Preserve its tag and require release-only E2E plus separate post-publication validation on the designated host before stable promotion.

## 1.3.4-rc.7 - 2026-09-09

- Fix release E2E provisioning by registering Docker's signed Ubuntu APT repository before installing rootless extras. Production APT configuration is unchanged.
- Preserve the invoking non-root deployment user on first installation instead of assuming an ubuntu account.
- Avoid reacquiring the application deployment lock for clean Updater recovery; interrupted activation still requires exclusive recovery and verified state.
- Release the shared mutation lock when its owner terminates, including SIGKILL, by tying the lock helper to an owner-held pipe.
- Candidate only: RC.6 stopped during CI host provisioning and was not published. Keep its tag unchanged; require the release-only upgrade E2E and separate post-publication host validation before stable promotion.

## 1.3.4-rc.6 - 2026-09-09

- Update gray-matter's js-yaml dependency to 3.15.2 to enforce the empty-merge CPU budget (GHSA-2883-xcg3-v3hh), without weakening dependency audits.
- Decouple the Updater from the application release directory using checksum-addressed, root-owned slots. Retain the previous controller, journal activation, restore controller state after failed startup, and recover interrupted cutovers at boot without rolling back application databases.
- Add an independent published-release bootstrap for future Updater changes. Keep the bootstrap protocol separate from application/database schemas, preserve mandatory immutable-release and Sigstore checks, and pin attestations to both tag and source commit.
- Gate RC and stable Draft uploads on a disposable standalone/password/TLS host upgrade E2E, using the same verified deployment pipeline and exact signed artifacts. Exercise English/Japanese PDF/PNG rendering, persistent owner/storage data, failed Updater startup and interrupted activation recovery. No production credentials or Actions build cache are used.
- Candidate only: release E2E and the post-publication production update remain distinct validation requirements. Do not promote before both have succeeded.

## 1.3.4-rc.5 - 2026-09-09

- Fix RC.3 Update Manager compatibility: retain its frozen five-file release metadata fingerprint and add a versioned six-file Runtime identity. Both new updater verification paths check the extended identity; whole-archive checksum and provenance verification remain mandatory for old and new updaters.
- Keep the language installation helper in Runtime identity, without modifying the installed updater or weakening validation. RC.4 failed before activation on the validation host; do not retry or replace its immutable assets.
- Candidate only: retain RC.4 changes and require a successful real-host update before Stable promotion.

## 1.3.4-rc.4 - 2026-09-09

- Candidate only: retain RC.3 fixes and validate an explicit update on the designated host before Stable promotion. This release does not deploy or reconfigure a host automatically.
- Add opt-in CI-only immutable TeX Live snapshots with authenticated leases, hardlink reuse, bounded retention and capacity-aware garbage collection. Preserve canonical archive fallback and Base-only image publication.
- Enable persistent LWP HTTPS downloads and four verified prefetch workers with a twenty-archive, 256MiB lookahead budget. Refill during extraction without parallel package installation or Actions build caches.
- Complete the mirror package selection, fail incomplete Base installations, and verify English/Japanese Runtime dependencies and files with one bounded recovery attempt. Preserve standalone fonts and documentation-disabled man links without downloading documentation payloads.

## 1.3.4-rc.3 - 2026-09-07

- Candidate only: preserve RC.2 cleanup fixes and validate this combined audit/OAuth update on the designated host before any Stable promotion.

- Fix OAuth consent form submissions sending `Origin: null` because of `no-referrer`. Use `same-origin` only on the consent document, retaining strict Origin/CSRF checks and preventing cross-origin referrer leakage without AI-vendor allowlists.

- Keep ready Sources reusable while an active owned Project references them, including after Job cleanup; release retention protection when the last Project is deleted. Record PDF/SVG choices per Job without adding revisions, and allow explicit output selection when rerendering from the Web.

- Fix upload claim/heartbeat cleanup and Remote MCP temporary-archive handling on filesystem and verification failures; preserve archives owned by another writer.
- Support retained zero-padded preview names across clients and result views, link Remote MCP results to the user-facing page, and correctly paginate Project selection and revisions.
- Preserve exact OIDC issuer identifiers and apply the specification's default only when token endpoint authentication metadata is omitted. Keep password session creation consistent with credential changes and support the documented scrypt cost boundary.
- Apply POSIX directory mode checks only on POSIX clients, preserve the final active Owner while allowing disabled-Owner demotion, and account for output published immediately before cancellation.

## 1.3.4-rc.2 - 2026-09-07

- Isolate the non-root Image Manager Docker client's Buildx metadata from root-run build scripts. Prevent root-owned Buildx files from blocking managed-image/build-cache cleanup; preserve current and rollback images and existing retention settings.
- Candidate release only; validate an actual host update before Stable promotion.

## 1.3.4-rc.1 - 2026-09-07

- Return decoded maintenance/worker modes from the Admin system status API, with the same defaults used by runtime enforcement. Fix the dashboard incorrectly showing attention required for an unset running worker or rendering setting records as objects, without changing production settings.

## 1.3.3 - 2026-09-06

- Promote the immutable v1.3.3-rc.6 candidate after a successful complete Update Manager upgrade and production checks on the validation host. Executable changes are limited to the exact version replacement.
- Publish only language-neutral TeX Live Base images; derive selected-language Runtimes locally and reuse the exact local cache. Daily Base publication is gated by English/Japanese rendering tests without publishing that test Runtime.
- Add configurable managed-image/build-cache retention and strict explicit RC installation with a same-source Stable promotion gate.
- Fix non-root deployment dependency preparation, Cloudflare authentication context, storage ACL inheritance, published MCPB verification, and bodyless client job-ticket renewal. Validate production rendering, deletion, client distribution and public boundaries before declaring an update successful.

## 1.3.3-rc.6 - 2026-09-06

- Validate the publicly rebuilt MCPB against its matching published metadata, instead of the older sealed assembly metadata, while retaining SHA-256 and detached-signature checks.
- Send job-ticket renewal requests without a JSON body, matching the strict Gateway contract so CLI job lookup, cancellation, deletion, and downloads can renew their operation tickets.
- Report production smoke job-deletion failures explicitly and verify the deletion result before declaring deployment successful.

## 1.3.3-rc.5 - 2026-09-06

- Run Cloudflare OAuth credential lookup and route synchronization from the prepared non-root build context, including its pinned pnpm store. Preflight both public Worker and Tunnel route plans before stopping services, while accepting valid plans that need changes and rejecting authentication/API failures.

## 1.3.3-rc.4 - 2026-09-06

- Prepare relocated deployment dependencies noninteractively with the release-pinned pnpm and a build-local store before stopping services. Preserve the frozen lockfile, propagate the same store into nested builds, and reject dependency drift instead of implicitly reinstalling during deployment.
- Fix production smoke credential creation against the current database schema and pass the service account's actual recovery group to every smoke administration command, including credential revocation.
- Install the production smoke input with explicit service-account ownership so it remains readable under a restrictive root umask, and fail the smoke check if credential revocation fails.
- Apply renderer storage default ACLs to existing directories as well as the root, so future jobs on upgraded hosts inherit access for the mapped rootless container identity.
- Exclude deployment-only package caches from installed releases and clean temporary smoke credentials when preflight checks fail.

## 1.3.3-rc.1 - 2026-09-02

- Add configurable daily managed-image cleanup with protected active/rollback images and an unused build-cache retention target. See the public self-hosting guide for settings.

- Treat root-owned pnpm workspace symlinks as sealed only when every link remains inside the immutable assembly, while continuing to reject non-root owners, writable regular entries, filesystem-boundary crossings, broken/escaping links, and special files.
- Add strict `X.Y.Z-rc.N` support for explicit, audited installation of immutable GitHub prereleases. Latest checks and automatic updates remain stable-only, and a stable release compares newer than every RC with the same core version.
- Require the server release workflow to publish and validate an immutable RC on the production validation host before a stable tag can be built. Stable promotion refuses executable changes beyond the exact RC-to-stable version replacement.
- Record the validated candidate tag in stable server metadata and document the candidate verification, service/smoke-test checklist, and same-source promotion gate.
- Publish only the language-neutral TeX Live Base to GHCR. Daily publication now derives an English/Japanese Runtime solely as a CI validation artifact and requires PDF, PNG, standard renderer, and SVG smoke tests before publishing the Base.
- Reuse exact derived Runtimes only from the server's local cache and otherwise build them locally from the verified Base, selected language collections, and current renderer code; remove the obsolete public-Runtime fallback from Web, CLI, API, and operations documentation.

## 1.3.2 - 2026-09-01

- Create an operation-private Corepack `pnpm` shim for both the one-time v1.2.x transition and normal application updates, so nested workspace builds keep the release-pinned package manager without relying on a user or global pnpm installation.
- Allow the transition helper to use a sufficiently recent, sealed, root-owned GitHub CLI from the fixed `/usr/local/bin/gh` or `/usr/bin/gh` allowlist, covering legacy hosts before the v1.3 host installer provisions `/usr/local/bin/gh`.
- Keep failed pre-cutover builds fail-safe: the active v1.2.x release, services, and mutation state remain unchanged, and the operation-private build tree is removed.

## 1.3.1 - 2026-09-01

- Add a one-time, fail-closed transition from the legacy v1.2.x root Update Manager to the v1.3 privilege-separated controller and short-lived helper. The transition re-downloads and re-verifies the immutable target as root, builds in a separate non-root tree, copies only allowlisted outputs into a sealed assembly, holds the shared mutation lock during cutover, and verifies the new service identity.
- Fetch public GitHub attestation bundles anonymously and pass them to offline `gh attestation verify --bundle` checks in both the controller and root helper, so verified application updates do not require a host GitHub login or token.
- Replace the legacy manual-update documentation that built and root-executed one writable tree with the dedicated transition command and add regression coverage for the upgrade boundary.

## 1.3.0 - 2026-09-01

- Separate application updates into a non-root controller and a short-lived, fixed-command root helper. Release installation now re-verifies immutable GitHub metadata, SHA-256 digests, Sigstore provenance, archive limits, sealed source files, and an allowlisted build-output assembly before privileged deployment.
- Add forward-only Migrations 008 through 016 for Worker lease generations, cleanup state, admission reservations, upload claims, OAuth authorization security versions, pagination indexes, Project revision outputs, Source upload concurrency, and durable API-key kinds. Restoring a pre-upgrade database backup is required to run a `1.2.x` release again.
- Include persistent Project revision Sources in backup and restore validation, make audit-export checkpoints atomic, isolate per-item cleanup failures, and preserve completed render status when later storage cleanup fails.
- Fence stale Workers and concurrent uploads with database compare-and-swap leases, use attempt-specific render staging, reject unsafe or oversized output trees, bound logs and artifact memory, and configure private rootless-container storage ACLs without world-writable directories.
- Replace fixed-window Job, Source, Project, user, service-account, and API-key scans with indexed cursor pagination and aggregate queries, while making idempotency, retention, quota, retry, and deletion lifecycle transitions atomic.
- Restrict local clients to approved roots and same-origin credentials, reject symlinked state/output targets and likely credential files by default, and stream large uploads, ZIP downloads, and setup assets within explicit limits.
- Harden browser and Remote MCP authentication with per-flow CSRF/OIDC cookies, bounded login and session state, security-version checks, atomic authorization-code and refresh rotation, replay rejection, and audited privileged mutation reasons.
- Improve responsive Web/Admin navigation, active-job polling, accessible preview controls, destructive-operation explanations, TeX cold-build warnings, and public self-hosting/update documentation.
- Add Dependabot, gitleaks, CodeQL, dependency review/audit, pinned tool and base-image inputs, container/configuration scans, CycloneDX SBOMs, and keyless release provenance verification.

## 1.2.2 - 2026-08-30

- Publish the browser-login controller with the public Worker assets so Cloudflare Access, OIDC, and password mode selection runs instead of exposing the inactive password form.
- Keep inactive login methods hidden before JavaScript loads, and verify the login controller in both the local Worker preview and final production boundary smoke test. This patch adds no database migration.

## 1.2.1 - 2026-08-30

- Treat an unauthenticated OAuth consent response as the expected browser-authentication boundary during final production verification, while retaining an authenticated cross-origin consent regression test.
- Allow deployments that already passed service smoke tests and public route publication to finish instead of reporting a false late failure; this patch does not add a database migration.

## 1.2.0 - 2026-08-30

- Add explicit Cloudflare and standalone deployment profiles with a shared admission gateway core and loopback-only Hono gateway for TLS reverse proxies.
- Add Cloudflare Access, strict OIDC Authorization Code + PKCE, and scrypt password browser authentication on one role/session model.
- Replace email-based identity linkage with explicit provider, exact issuer, and subject identities; make email optional and add owner-controlled identity/password lifecycle operations.
- Add an audited, local-only owner authentication provisioning command so an existing instance can change `AUTH_MODE` without email linking or administrator lockout.
- Store only browser session and CSRF hashes, enforce exact-origin per-session CSRF, preserve the original absolute/identity expiry during CSRF-cookie repair, revoke stale mode/issuer/security-version sessions, bound login state, and keep CLI Admin API keys independent.
- Add forward-only Migration 007, mode-aware owner bootstrap and systemd deployment, hardened nginx/Caddy/Apache examples, public self-hosting guidance, and provider-neutral Web/Remote MCP consent.
- Fail before service quiescing when profile values or secret-file permissions are unsafe, consume legacy Access subjects exactly once, bound JWT/JWKS inputs, and update the supported pnpm toolchain dependencies.

## 1.1.6 - 2026-08-29

- Preserve the shared privileged-manager runtime directory across service restarts so the Update Manager and Image Manager sockets remain reachable.
- Avoid nested mutation-lock acquisition during application updates, restore quiesced services after failures, and stage readable rollback copies without weakening immutable installed releases.
- Report safe, actionable Update Manager transport failures and document the temporary Admin API reconnect window during Web updates.

## 1.1.5 - 2026-08-29

- Publish the supported sudo recovery path for legacy Update Managers that fail before verified release code can take over, without granting Web or API processes elevated privileges.
- Prepare a fresh immutable release bundle with its manifest-pinned pnpm and frozen lockfile instead of retrying failed legacy staging or weakening protected host paths.

## 1.1.4 - 2026-08-28

- Run deployment-user update and build commands from the verified private stage instead of inheriting a protected service working directory.
- Provision the manifest-pinned pnpm through Corepack instead of `pnpm self-update`, then verify the activated version before installing the release.

## 1.1.3 - 2026-08-28

- Stage verified application bundles in a deployment-user-reachable private directory without granting that user access to protected application state.

## 1.1.2 - 2026-08-28

- Release the actual `flock` lock holder after application or TeX mutations, preventing completed operations from leaving all later updates blocked.

## 1.1.1 - 2026-08-28

- Keep the shared application state parent root-owned so `systemd-tmpfiles` can safely manage root-owned Image and Update Manager directories.
- Build `client-dist` before copying an immutable production release, preventing Unified Admin Web from starting without its manifest.
- Wait for the Update Manager Unix socket after service activation and again before remote deployment verification.

## 1.1.0 - 2026-08-28

- Publish an updater-compatible server source bundle together with the client ZIP, signed MCPB, and checksums from one protected release workflow.
- Enable the Remote MCP systemd service during production deployment so it returns after a host reboot.
- Clear inherited setgid bits on image-manager temporary build trees without weakening the systemd sandbox.
- Use the deployment user's pinned pnpm instead of an older system-wide Corepack shim.
- Accept an active remotely managed Cloudflare Tunnel when no host-local ingress file exists.
- Reconcile the saved TeX image selector and languages through Image Manager during production deployment, using GHCR before any verified dated fallback build.
- Keep rootless Docker CLI state in the Image Manager's writable sandbox directory.
- Preserve the immutable GHCR digest reference while deriving a Runtime with Docker's containerd image store.
- Wait for the Image Manager HTTP endpoint before deployment reconciliation begins.
- Publish daily TeX Base packages transparently from a GitHub-hosted workflow in the public repository.
- Load derived Runtime images into container-backed Buildx image stores and verify Image Manager HTTP readiness without reading its credential from `ExecStartPost`.
- Read the production Gateway Worker configuration from a root-only host file instead of the Git worktree.
- Load Cloudflare deployment identifiers from a validated root-only host environment file before changing production state.

## 1.0.0 - 2026-08-26

Initial public release.

- Web, CLI, HTTP API, local MCP, and OAuth-based Remote MCP interfaces
- PDF rendering and optional per-object SVG extraction for math and TikZ
- Networkless rootless-Docker TeX sandbox with resource limits, seccomp, and validated artifact export
- API-key hashing, short-lived scoped tickets, Cloudflare Access verification, quotas, audit events, backup, and incident operations
- Pinned TeX Live 2026 and Debian inputs with managed language Runtime support
- GitHub-hosted CI and generic Cloudflare Tunnel, Worker, VPC Service, and systemd deployment examples

The supported self-hosted profile in v1.0 uses Cloudflare Tunnel, Access, Workers, and a Linux host. Production credentials and infrastructure-specific configuration are intentionally maintained outside this repository.
