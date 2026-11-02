# HTTP services on demand

The managed Linux installation can release HTTP process memory between requests.
Web (3101), Remote MCP (3104), Admin API (3102), Internal API (3103), and Renderer
API (3100) use loopback-only systemd sockets. The listener remains open when its
Node process exits; the next request starts that process and waits for readiness.
Public URLs, credentials, permission boundaries, and rendering results do not
change. First access after sleep includes the cost of starting Node and opening
the database.

Worker, rootless Docker, Image Manager, Update Manager, and the standalone
gateway remain running. Worker still processes leases, previews, and Source
cleanup. This change does not implement Worker sleep.

## Settings

Set these non-secret values in `/etc/latex-renderer/renderer.env`:

```dotenv
HTTP_IDLE_ENABLED=true
HTTP_IDLE_TIMEOUT_SECONDS=900
```

The default timeout is 900 seconds, with an accepted range of 30–86400 integer
seconds. `HTTP_IDLE_ENABLED` accepts exactly `true` or `false`. Missing values
use the defaults; invalid values fail preparation/startup. With `false`, managed
services use ordinary service startup and stay running. Local development
without inherited systemd descriptors also stays running.

Change settings through the existing reviewed server settings procedure after
editing the host environment file. It quiesces consumers and reconciles the
listener, service boot links, and standalone gateway dependency together. Do not
change only one boot link or manually restart a backend against its active
listener. See [server settings](server-settings-wizard.md).

The timeout starts after the last real response and request body have finished.
An active upload, download, or stream prevents sleep. An idle keep-alive
connection does not. OAuth authorization state remains in SQLite; short-lived
refresh retry replies and anonymous registration rate-limit windows also hold
the process awake until their existing expiry. Sleep does not revoke sessions
or add an authentication requirement.

## Status and monitoring

The management page distinguishes running, waiting for access, starting, and
unavailable HTTP services. A listening socket with an inactive, successful
service is healthy waiting. A failed service, start-limit failure, missing
listener, or failed listener is unavailable. `Type=notify` keeps starting
separate from a process that has actually opened its endpoint.

Inspect status without waking a backend:

```bash
node /opt/latex-renderer/current/deploy/scripts/http-services.mjs status \
  latex-renderer-web.service latex-renderer-remote-mcp.service \
  latex-renderer-api.service latex-renderer-admin-api.service \
  latex-renderer-internal-api.service
```

The public status probe reads systemd and the bounded Worker heartbeat at
`/run/latex-renderer-worker-health/state.json` when backends are asleep. The
heartbeat contains only PID, timestamp, mode and stopping status; its dedicated
directory is writable only by Worker. It is volatile and removed on Worker
shutdown. Existing SQLite heartbeat and rendering health checks remain.

`GET`/`HEAD` health probes do not extend the real-request idle deadline. Repeated
HTTP probes against a sleeping endpoint still wake it, so external monitoring
should inspect socket/service state rather than poll all five HTTP endpoints.
An actively viewed page or API client can legitimately keep a service awake.

Lifecycle logs contain service identity, activation mode, configured timeout,
and `http_service.idle_exit` or `http_service.idle_cleanup_failed`. They contain
no authorization headers, cookies, request query strings, or tokens.

## Deployment and recovery

Use the standard release updater and recovery commands. HTTP consumers are
stopped together with their listeners before database/configuration cutover,
so a new request cannot reactivate a writer during recovery. Resume starts the
listener without requiring a sleeping process to run. Boot authentication
recovery completes before listeners become available.

The historic `latex-renderer-admin-web` name remains supported. Only one of
that listener and `latex-renderer-web.socket` owns port 3101. Existing hosts
keep their selected Web name; status and reviewed configuration use the same
logical Web role.

Restoring a release that predates socket activation restores its own service
definitions and ordinary service boot links, and stops/disables the new sockets
before the older code binds the ports. Never restore only application files
while leaving mismatched unit definitions. Recovery journals and protected
recovery points retain their existing review requirements.

For deliberate HTTP maintenance, use the privileged logical control entrypoint
with explicit service names rather than `systemctl stop` on a service alone:

```bash
sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop \
  latex-renderer-api.service
sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs start \
  latex-renderer-api.service
```

Stopping only `.service` allows the still-active `.socket` to start it again.
Do not grant these privileged commands to untrusted clients.

## Validation and measurement

Unit fixtures retain a real inherited listener across child-process exits and
exercise queued first requests, unfinished bodies, streams, passive health,
invalid descriptors, disabled mode, OAuth activity leases, and the Hono/MCP
transport. The `http-idle` workflow additionally exercises actual systemd on
native AMD64 and ARM64 disposable runners, including parallel wake, readiness,
crash-loop detection, quiescence, and restoration of an older ordinary service.

Existing authentication, upload/download, rendering, and signed release update
validation remain required. A tiny transport fixture is not a full deployment
acceptance result.

Measure the same host/configuration after wake, after the full configured idle
period, on first access, and after a completed rendering job. Record process
PSS/RSS, swap PSS, actual PID disappearance, listener state, first-response and
job-start latency. Do not sum RSS as a physical-memory guarantee or treat old
measurements as promised savings. Active connections and ordinary service
activity can delay the idle period; low available memory alone is not a failed
idle test.
