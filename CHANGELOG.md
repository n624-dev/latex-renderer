# Changelog

## 1.0.0 - 2026-08-26

Initial public release.

- Web, CLI, HTTP API, local MCP, and OAuth-based Remote MCP interfaces
- PDF rendering and optional per-object SVG extraction for math and TikZ
- Networkless rootless-Docker TeX sandbox with resource limits, seccomp, and validated artifact export
- API-key hashing, short-lived scoped tickets, Cloudflare Access verification, quotas, audit events, backup, and incident operations
- Pinned TeX Live 2026 and Debian inputs with managed language Runtime support
- GitHub-hosted CI and generic Cloudflare Tunnel, Worker, VPC Service, and systemd deployment examples

The supported self-hosted profile in v1.0 uses Cloudflare Tunnel, Access, Workers, and a Linux host. Production credentials and infrastructure-specific configuration are intentionally maintained outside this repository.
