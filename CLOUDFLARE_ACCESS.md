# Cloudflare Access and routing

## Access applications

When `AUTH_MODE=cloudflare-access`, configure one human-user Access application
to protect all of these paths with the same audience:

```text
latex.example.com/auth
latex.example.com/app
latex.example.com/admin
latex.example.com/oauth/authorize
```

Do not create a second application with a different audience. `/auth` is needed
because the origin exchanges the verified Access assertion for the common
server-side browser session. The Admin API and Remote MCP authorize handler
also verify the configured audience at the origin.

When `AUTH_MODE=oidc` or `password`, do not put an Access redirect in front of
`/auth`, `/app`, `/admin`, or `/oauth/authorize`; those paths use the configured
application login and session. Tunnel routing itself remains the same.

Do not protect `/oauth/token`, `/oauth/register`, `/mcp`, or OAuth discovery
with an Access redirect: Remote MCP clients must reach those endpoints and
authenticate with OAuth. The authorize handler still verifies
`Cf-Access-Jwt-Assertion` and rejects a subject that is not linked to an active
database user.

Policies:

1. Human users: Allow only approved identities/groups that may use `/app` or authorize Remote MCP.
2. Admin CLI: Service Auth for the dedicated service token.

In Access mode, the origin still verifies `Cf-Access-Jwt-Assertion`. Access is
the reachability layer; explicit external-identity provisioning, database role,
ownership checks, and API-key scopes remain the authorization layer. A `user`
can use only `/app`;
the Admin API independently rejects that identity from `/admin` unless its
database role is `owner` or `admin`.

A user record in the VPS database does not change the Cloudflare Access policy.
Human access requires both an Access Allow decision and an active user whose
explicit `provider + exact issuer + sub` identity matches; administration also
requires an `owner` or `admin` role. Email, username, and display name are only
attributes and never claim or merge an account. Removing either Access policy
permission or VPS authorization blocks its respective boundary.

Owner-triggered unlink deletes only the selected VPS identity, revokes that
user's application sessions, and increments the user security version. It does
not modify the IdP or its Access session. Re-entry requires an owner to
explicitly provision the identity again; email cannot reclaim it.

The Internal API is not published through DNS or an Access application. The Gateway Worker reaches `127.0.0.1:3103` through the least-privilege `INTERNAL_API` Workers VPC Service binding. Never add an Internal API route below `latex.example.com/api`.

Example VPC Service (replace both IDs):

```text
name: latex-renderer-internal-api
id: REPLACE_WITH_VPC_SERVICE_ID
tunnel: REPLACE_WITH_TUNNEL_ID
target: http://127.0.0.1:3103
```

The Internal API process binds only to loopback. API-key authentication and
scope checks remain enforced at the application layer.

## Worker Routes

Only these canonical routes belong to Gateway Worker:

```text
latex.example.com/api/v1/health
latex.example.com/api/v1/render-tickets
latex.example.com/api/v1/source-tickets
latex.example.com/api/v1/job-tickets/*
```

The Gateway has no direct custom domain. Client and smoke-test traffic uses the
single public origin `https://latex.example.com`.

Do not route `/api/v1/sources/*` or `/api/v1/jobs/*` through the Worker. Those paths contain Source/ZIP uploads and PDF/PNG/log downloads.

## Tunnel order

The remotely managed Tunnel is the production source of truth. Start from `deploy/cloudflared/config.example.yml`, then keep the configured copy outside Git with this order:

1. OAuth discovery metadata → Remote MCP, port 3104
2. `/oauth/*` and `/mcp` → Remote MCP, port 3104
3. `/auth/*` → Admin API, port 3102
4. `/admin/api/*` → Admin API, port 3102
5. `/admin/*` → Web, port 3101
6. `/app/api/*` → App API, port 3102
7. `/app/*` → Web, port 3101
8. `/api/*` → Renderer API, port 3100
9. hostname catch-all → Web, port 3101

Run `deploy/scripts/validate-unified-routing.sh` against a local copy before applying equivalent remote rules. Actual dashboard/API configuration is a deployment operation and is not changed merely by merging this repository.
