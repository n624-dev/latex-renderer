# Changelog

## Unreleased

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
