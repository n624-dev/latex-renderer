# Changelog

## Unreleased

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
