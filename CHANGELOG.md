# Changelog

## Unreleased

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
