# On-demand Worker and compact runtime

`classic` remains the default runtime mode. HTTP socket activation and Worker
activation can be selected independently. The opt-in `compact` mode additionally
allows the Image Manager, independent Updater and dedicated rootless Docker
service to stop between operations. The TLS ingress and the user's systemd
manager remain available. This does not promise a particular memory saving.

## Prerequisites and activation

Use a prepared Linux/systemd host with cgroup v2, Python 3 and the existing
dedicated rootless Docker installation. No partition, quota, additional engine
or machine-wide service change is required. Install the matching application
and independent Updater through the normal verified update path first. Check
that the update operation completed before changing its runtime configuration.

```sh
sudo node /usr/local/libexec/latex-renderer-updater-transport.mjs check
sudoedit /etc/latex-renderer/renderer.env
```

Select these settings:

```dotenv
HTTP_IDLE_ENABLED=true
HTTP_IDLE_TIMEOUT_SECONDS=900
WORKER_IDLE_ENABLED=true
WORKER_IDLE_TIMEOUT_SECONDS=900
RENDERER_RUNTIME_MODE=compact
MANAGER_IDLE_TIMEOUT_SECONDS=900
```

Each timeout accepts an integer from 30 through 86400 seconds. Boolean settings
accept exactly `true` or `false`; runtime mode accepts `classic` or `compact`.
Compact requires both HTTP and Worker activation and rejects rootful Docker.
The retained container CPU, PID, memory, swap, filesystem and network limits
continue to apply. A starting-memory threshold does not replace those limits.

Apply the environment-only change under the existing mutation lock:

```sh
sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs reconcile
```

The operation closes the Standalone Gateway listener and process before backend
listeners, preventing public requests from activating the previous dependencies
during cutover. Requests may need to retry while the listeners are closed. It
lets active rendering drain,
reconciles service definitions and boot links, and changes only the dedicated
worker user's Docker autostart policy. The separate engine idle timer releases
Docker after its consumers and containers have drained. It does not stop a
system-wide Docker installation or remove images. A configured Gateway retains
an enabled boot path and resumes on retry even if the previous attempt stopped
its process and listener. An interrupted reconciliation can be rerun; it does
not restore the database or discard user data.

For Worker activation without compact managers/engine, use
`WORKER_IDLE_ENABLED=true` with `RENDERER_RUNTIME_MODE=classic`. For ordinary
Worker startup, set `WORKER_IDLE_ENABLED=false`. Switching back to `classic`
through the same reconciliation restores ordinary manager startup and the
dedicated Docker service's boot link. HTTP activation remains independently
controlled by `HTTP_IDLE_ENABLED`.

## Queue, recovery and shutdown

SQLite remains authoritative. APIs send a small local Unix-socket notification
after committing work; a failed notification does not roll back a committed
Job. The socket is writable by the existing application group and exposes no
shell, service-control or rendering arguments. A timer rechecks durable work
once per minute, including after a crash, missed notification or reboot.
Before an idle exit, Worker consumes queued wake hints and finishes their
bounded acknowledgements. Maintenance-only activation follows the same path,
so a stale hint cannot repeatedly restart an empty Worker.

Queued/running Jobs, active leases, previews, canceled-container cleanup and
Source Tree readers prevent idle exit. Source Tree maintenance continues every
15 minutes. A maintenance-only activation can finish and exit without starting
Docker. Unfinished or failed cleanup does not count as an empty queue. A Job
committed while Worker is closing is recovered through the retained listener
and the independent reconciler. Deployment stops that listener before draining
Worker, retaining its 15-minute graceful-stop deadline.

The engine collector takes the mutation lock and a nonblocking exclusive
engine lock. Consumers retain shared kernel locks for their process lifetime.
Active/recovering managers, pending queue/cleanup work, any container (including
unknown names), unreadable state or an unreachable engine prevent shutdown.
The collector verifies the actual stopped service state. No apparent deletion
size or assumed free-memory value authorizes an engine shutdown.

Managers retain their durable operation journals. Long operations and their
final log/lock cleanup prevent idle exit even after an HTTP client disconnects.
Compact Image Manager startup omits automatic Runtime restoration for a read;
normal application deployment explicitly restores and verifies the Runtime.
The watchdog reads durable operation state before waking a manager. Corrupt
state is an error, never proof that there is no operation.
The manager checks due image cleanup before a shortened idle deadline, using
the existing retention policy and image/PDF protections. Unchanged default
timeouts retain the ordinary five-minute probe cadence; an entirely sleeping
manager is not woken just to probe image state.

## Independent Updater compatibility

The bootstrap-v1 files remain unchanged. Small, root-owned transport adapters
outside application releases verify the selected independent slot using that
bootstrap. They import the controller in the same process to preserve the
inherited descriptor; `execve` would discard it. The slot envelope includes the
controller's complete dependency closure and its socket-protocol marker.

Updater activation excludes its listener while switching slots. Recovery
reconciles the listener after the activation stop hook returns. If an independent
rollback selects an older controller, the pre-start guard disables its listener
and restores ordinary service startup before loading that verified controller.
This safety fallback can retain an idle Node process until a socket-capable
Updater is selected again. A stopped/failed manager is not reported as healthy
merely because its slot exists.

During a self-update, host preparation preserves an already-active compatible
Updater listener while the old controller persists its operation. The later
independent cutover owns its restart. Stopping and reopening this socket while
its controller is still active is rejected by systemd. The signed acceptance
matrix includes an upgrade originating from a published compact installation
with both the real controller and its inherited listener active.
For a published helper that has already stopped systemd's socket, the deployment
keeps the same live controller serving its inherited descriptor and checks that
its PID survives preparation. Socket supervision is restored by the independent
cutover after operation commit; this temporary handoff is not reported as a
healthy idle listener. The signed test also requests the controller after host
preparation and verifies its final activation.
The independent activation gate stops supervision before the controller, under
the shared lock after operation commit. Its systemd unit has no socket conflict
edge, so resuming supervision during final cleanup cannot cancel activation.
Settings preparation also preserves an active compatible Image Manager listener:
compact MCP/Internal API consumers require that socket, and cannot reopen it
while its existing Manager still owns the inherited descriptor.
The supported passive-health listener also stays available through settings
preparation; its responder reads current state for each request. Legacy targets
without that responder still close and disable the listener.

## Static pages and passive health

Standalone Nginx uses the same public-static generator as the existing
Cloudflare static site for the home page, documentation and public downloads.
Authenticated pages, sources and Job artifacts continue through their APIs.
Legacy deployments without those generated files fall back to Web.
The managed standalone ingress uses the prepared API identity to read sealed
public assets. An external proxy under another identity must have narrowly
scoped read/traverse access to the public asset tree; otherwise static requests
fall back to Web and wake it. Do not add an unrelated web server to the
application group or change permissions on private application data.

`latex-renderer-status.socket` accepts bounded, read-only health requests and
starts one short-lived Python responder per connection. It exposes only
`/health`, `/api/v1/health`, `/health/rendering` and `/health/status`. It never
starts application services or Docker. SQLite is opened read-only; creating its
WAL/SHM bookkeeping after the last writer closes uses the existing API identity.
The response contains no users, credentials, Jobs or filesystem paths.

Standalone ingress routes these paths to the local Unix socket. The managed
Cloudflare route synchronizer selects it only when that listener is running;
compact routing refuses to apply without it. For locally managed Cloudflare,
add the optional specific ingress rule in
[`config.example.yml`](../deploy/cloudflared/config.example.yml) before the Web
fallback, after enabling the status socket. Keep existing static Worker routes.
Cloudflare supports HTTP forwarding to a Unix socket; see its
[routing documentation](https://developers.cloudflare.com/tunnel/concepts/routing/).
No public listening port or new application credential is needed.

Public health is passive. Explicit render, update, inventory-validation and
end-to-end smoke operations intentionally wake the required services. A pending
queue with an unavailable/sleeping Worker is not healthy rendering. A listening
socket with a successfully stopped, empty Worker is normal idle state.

## Verification

Run the ordinary tests with fixture databases and temporary directories:

```sh
pnpm test
python3 -B tests/passive_health_test.py
python3 -B experiments/compact-runtime/test_probe.py
```

The signed `server-update-validation` workflow also exercises the installed
services on disposable hosts: cold Japanese PDF/PNG, a three-Job burst, SVG
retry with the original PDF retained, lazy page-two preview, cancellation and
Worker crash/lease cleanup. Its synthetic SVG-stage fault is scoped to its own
completed test Job. The engine collector must leave an independent active
BuildKit build alone. These checks use the existing Runtime without an image
pull or a persistent cache.

Enable the workflow's `measure_idle` input for the longer comparison. It retains
the real 900-second deadlines and observes each of always-running, HTTP/Worker
activation and compact for a full hour. It records 15-minute/one-hour process
snapshots, PSS/RSS, service cgroup memory, maintenance invocations and dedicated
user auxiliary processes, then measures first API, management, cold/warm
PDF/PNG, SVG retry and lazy preview. Missing process samples are reported as
unmeasured. Run on a disposable GitHub-hosted runner only; allow roughly four
hours including provisioning and functional checks. Sanitized JSON artifacts
expire after one day. A failed or incomplete report is not measurement success.

The separate engine comparison imports the same immutable image into a new
disposable Podman account and checks the same sandbox/PDF probe twice per
engine. Unsupported or failed experimental isolation excludes Podman; it does
not enable a production backend. Account/container cleanup failure fails CI.

Real systemd/Docker/Podman tests belong on disposable hosts. Preserve sandbox
checks, signed release verification, existing PDF/PNG/SVG validation and native
architecture tests. Compare identical images and input across ordinary,
HTTP/Worker-activated and compact configurations. Measure the 15-minute and
one-hour quiet intervals, including timer activations and auxiliary processes;
report transient maintenance separately from steady-state memory. Test first
and warm requests, queued work, cancellation, preview/SVG recovery, independent
Updater rollback and ordinary-mode restoration before deploying compact mode.

The Podman probe is an experiment, not a supported production backend. Failed
or unsupported isolation checks exclude it; do not weaken confinement or install
it on an existing application host just to complete a comparison.
