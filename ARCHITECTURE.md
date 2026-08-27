# Architecture

## External surface

```text
latex.example.com
├── /                         unified Web
├── /docs/                    documentation
├── /downloads/               client distribution
├── /mcp                      OAuth-protected Remote MCP Streamable HTTP
├── /oauth/*                  Remote MCP OAuth 2.1 endpoints
├── /.well-known/oauth-*      OAuth authorization/resource metadata
├── /app/                     user Web, Cloudflare Access protected
├── /app/api/v1/              user-scoped App API, Access protected
├── /admin/                   owner/admin Web, Cloudflare Access protected
├── /admin/api/v1/            Admin API, Access plus application authorization
└── /api/v1/
    ├── health                Gateway Worker
    ├── render-tickets        Gateway Worker
    ├── source-tickets        Gateway Worker
    ├── job-tickets/*         Gateway Worker
    ├── sources/*             Renderer API
    └── jobs/*                Renderer API
```

Internal API is deliberately absent from this public tree. It binds only to loopback port 3103 and is not published through DNS or a Cloudflare Access application. Gateway Worker reaches it through the least-privilege `INTERNAL_API` Workers VPC Service binding.

Remote MCP binds to loopback port 3104 behind Tunnel path routing. Only `/oauth/authorize` is protected by the human Cloudflare Access application; OAuth tokens protect `/mcp`. OAuth subjects map to existing users and to an internal, non-authenticatable accounting principal, so no long-lived `lrk_` key crosses the Remote MCP boundary.

## Request flow

1. CLI prepares a deterministic ZIP and SHA-256 locally. It may reserve a reusable Source first, or use the legacy one-Job upload flow.
2. Gateway Worker validates the narrow ticket request and forwards it to Internal API through the `INTERNAL_API` Workers VPC Service binding. No public Internal API hostname or Cloudflare Access service token is used on this hop.
3. Internal API authenticates the long-lived render key, applies quotas and idempotency, and returns only the short-lived ticket needed for the selected Source or Job flow.
4. For the reusable Source flow, the client uploads the ZIP directly to Renderer API with the Source upload ticket, then creates one or more Jobs from `sourceId + entrypoint` through Gateway Worker. For the compatibility flow, it uploads directly to the reserved Job with the Job-scoped upload ticket.
5. Renderer API verifies ticket scope, owner, ID, size, SHA-256, and nonce as applicable. Large ZIP/PDF/PNG/log traffic never traverses Gateway Worker.
6. Renderer Worker claims queued Jobs and runs a rootless container with no network, a read-only root filesystem, non-root UID/GID, dropped capabilities, seccomp, PID/CPU/memory limits, and bounded tmpfs. Docker rootless mode does not support AppArmor, so production does not claim that control; the checked-in profile is limited to explicitly approved rootful development tests.
7. Renderer API serves validated artifacts with download leases and integrity headers.

## Web application and administration

Cloudflare Access controls who can reach `/app/*` and `/admin/*`. App API
independently validates the Access JWT, requires an active invited user, and
scopes Projects, revisions, Jobs, tickets, and artifacts to that user. Admin API
additionally requires the database `owner` or `admin` role. Admin CLI uses an
`lra_` key and an Access service token. Browser mutations require an exact
allowed Origin and `X-CSRF-Token`.

`admin-local` is the intentional direct-SQL recovery exception. Normal runtime SQL is owned by database repositories and business operations live in services.

## Host update boundary

The unprivileged Admin API is the common control plane for Web and CLI update
operations. It has neither `sudo` nor Docker/systemd access. TeX changes are
forwarded to the loopback-only Image Manager; application changes are forwarded
over a group-restricted Unix socket to the root-owned Update Manager. Both use
independent random host credentials and declarative allowlisted operations.
Both privileged managers hold one non-blocking OS mutation lock for the full
operation, so an application update and a TeX environment mutation cannot run
concurrently even when they were requested from different interfaces.

The Update Manager trusts only immutable semantic-version releases from
`n624-dev/latex-renderer`, verifies the locked tag commit and GitHub-provided
asset digest, stages dependencies as a configured non-root deployment user, and
then invokes the fixed production deployment entry point. It cannot accept a
caller-supplied repository, URL, path, command, service name, or environment.
Host configuration, credentials, databases, and generated data remain outside
release bundles and Git. Durable redacted operation records allow Web/CLI clients
to reconnect while services or the Update Manager restart.
