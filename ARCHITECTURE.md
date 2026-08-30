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
├── /login/                   configured browser login entry point
├── /auth/*                   password, OIDC, or Access session endpoints
├── /app/                     authenticated user Web
├── /app/api/v1/              user-scoped App API
├── /admin/                   owner/admin Web
├── /admin/api/v1/            role-authorized Admin API or lra_ CLI key
└── /api/v1/
    ├── health                Gateway Worker
    ├── render-tickets        Gateway Worker
    ├── source-tickets        Gateway Worker
    ├── job-tickets/*         Gateway Worker
    ├── sources/*             Renderer API
    └── jobs/*                Renderer API
```

Internal API is deliberately absent from this public tree. It binds only to loopback port 3103 and is never published through DNS or the reverse proxy. In the Cloudflare profile, Gateway Worker reaches it through the least-privilege `INTERNAL_API` Workers VPC Service binding. In the standalone profile, the loopback-only Hono gateway reaches the same service directly.

Remote MCP binds to loopback port 3104 behind the selected trusted frontend. Its `/oauth/authorize` consent uses the same browser session as `/app` and `/admin`; OAuth tokens protect `/mcp`. OAuth subjects map to existing users and to an internal, non-authenticatable accounting principal, so no long-lived `lrk_` key crosses the Remote MCP boundary.

## Request flow

1. CLI prepares a deterministic ZIP and SHA-256 locally. It may reserve a reusable Source first, or use the legacy one-Job upload flow.
2. The selected gateway validates the narrow ticket request with `packages/gateway-core`. Gateway Worker uses its `INTERNAL_API` Workers VPC Service binding; standalone Hono uses loopback. Neither profile exposes an Internal API hostname or uses a browser credential on this hop.
3. Internal API authenticates the long-lived render key, applies quotas and idempotency, and returns only the short-lived ticket needed for the selected Source or Job flow.
4. For the reusable Source flow, the client uploads the ZIP directly to Renderer API with the Source upload ticket, then creates one or more Jobs from `sourceId + entrypoint` through Gateway Worker. For the compatibility flow, it uploads directly to the reserved Job with the Job-scoped upload ticket.
5. Renderer API verifies ticket scope, owner, ID, size, SHA-256, and nonce as applicable. Large ZIP/PDF/PNG/log traffic never traverses Gateway Worker.
6. Renderer Worker claims queued Jobs and runs a rootless container with no network, a read-only root filesystem, non-root UID/GID, dropped capabilities, seccomp, PID/CPU/memory limits, and bounded tmpfs. Docker rootless mode does not support AppArmor, so production does not claim that control; the checked-in profile is limited to explicitly approved rootful development tests.
7. Renderer API serves validated artifacts with download leases and integrity headers.

## Web application and administration

`DEPLOYMENT_MODE=cloudflare|standalone` selects only the public boundary.
`AUTH_MODE=cloudflare-access|oidc|password` selects browser authentication;
standalone deliberately rejects Cloudflare Access because it cannot establish
the required edge assertion boundary. External users are identified only by
provider, exact issuer, and subject. Local passwords are bound to a normalized
login name. Email and display name are non-authoritative attributes, and every
identity or credential is explicitly provisioned.

After authentication, all browser modes use the same hashed server-side session,
active-user/security-version check, user role, and owner-scoped resource model.
Cookies are host-only, Secure, HttpOnly where applicable, and SameSite-restricted;
browser mutations require exact `PUBLIC_ORIGIN` and a per-session CSRF secret.
Admin API additionally requires `owner` or `admin`. Admin CLI authenticates with
an independent `lra_` key before browser logic, so it does not depend on an IdP,
cookies, or Cloudflare headers.

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
