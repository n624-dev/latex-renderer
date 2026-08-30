# LaTeX Renderer

[![CI](https://github.com/n624-dev/latex-renderer/actions/workflows/ci.yml/badge.svg)](https://github.com/n624-dev/latex-renderer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

A security-oriented LuaLaTeX rendering platform with Web, CLI, HTTP API, and MCP interfaces. Untrusted TeX runs in a networkless, read-only, non-root Docker sandbox with explicit resource limits. Jobs produce PDF by default and can also extract self-contained SVG objects for math and TikZ output.

The hosted service is available at [latex-render.n624.jp](https://latex-render.n624.jp/), with documentation at [latex-render.n624.jp/docs/](https://latex-render.n624.jp/docs/). Version 1.2 supports either Cloudflare Tunnel/Workers or a conventional TLS reverse proxy. Browser authentication is an explicit choice of Cloudflare Access, OIDC, or a local password.

The hostname `latex.example.com` used by deployment examples and tests is a placeholder. The hosted-service URL above is intentionally public, but this repository does not contain its production credentials or infrastructure-specific configuration.

## Get started

- Use the hosted service: [public documentation](https://latex-render.n624.jp/docs/)
- Install the CLI, MCP, and AI integrations: [client setup](https://latex-render.n624.jp/docs/client/)
- Prepare a self-hosted server: [self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/) or [SETUP.md](SETUP.md)
- Develop or contribute: [CONTRIBUTING.md](CONTRIBUTING.md)

Self-hosted installation starts with the immutable
[`v1.2.2` release](https://github.com/n624-dev/latex-renderer/releases/tag/v1.2.2),
which includes a digest-labelled server bundle. Do not deploy the changeable
`main` branch as a substitute. Follow the self-hosting guide for the supported
profile, host prerequisites, checksum verification, and configuration steps.

## Components

- `apps/gateway-worker`: small JSON ticket gateway
- `apps/standalone-gateway`: loopback-only equivalent for reverse-proxy deployments
- `packages/gateway-core`: shared admission and route validation for both gateways
- `apps/internal-api`: API-key authentication, quotas, reservations, and ticket issuance
- `apps/renderer-api`: uploads, job operations, and artifact downloads
- `apps/renderer-worker`: queue processing and sandbox execution
- `apps/admin-api` and `apps/admin-web`: administration and public Web surfaces
- `apps/cli` and `apps/mcp-server`: local client interfaces
- `apps/remote-mcp`: OAuth 2.1 Streamable HTTP MCP server
- `renderer`: pinned TeX Live 2026 container

## Development

Development setup and contribution requirements are in
[CONTRIBUTING.md](CONTRIBUTING.md). Production internals and advanced operator
procedures are in [DEPLOYMENT.md](DEPLOYMENT.md); general users should start
with the Web-visible self-hosting guide instead.

## Security and support

Read [SECURITY.md](SECURITY.md) before deploying. Vulnerabilities must be reported through GitHub Private Vulnerability Reporting, not a public issue. The supported Cloudflare and standalone profiles, their deliberately different network-level protections, and the required authentication configuration are documented in the [self-hosting guide](https://latex-render.n624.jp/docs/self-hosting/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
