# Operations

Check `systemctl status` and JSON journal events for every application service enabled by [DEPLOYMENT.md](DEPLOYMENT.md):

- `latex-renderer-api.service`
- `latex-renderer-internal-api.service`
- `latex-renderer-admin-api.service`
- `latex-renderer-web.service`
- `latex-renderer-remote-mcp.service`
- `latex-renderer-worker.service`
- `latex-renderer-image-manager.service`
- `latex-renderer-update-manager.service`

Health endpoints are loopback `/health`; Renderer API also has `/ready`, which checks storage availability.

- Pause new work with maintenance mode `reject-new-jobs` before upgrades.
- Let active jobs drain, stop the worker, take the required database backup, deploy, migrate, start APIs/Web/Remote MCP, run health checks, then start the worker and disable maintenance.
- Alert on queue depth, free space, stale leases, render failure/timeout rate, audit export lag, backup failure, and Tunnel health.
- Cleanup runs hourly and must skip active artifact download leases. Backups and audit exports run daily; perform the documented restore test quarterly.
- Do not print credential files, request authorization headers, source ZIPs, PDFs, or raw unescaped logs during diagnosis.
- Application update state and redacted logs are available from `latex-render-admin update status` and `latex-render-admin update operation <id>`. The helper accepts only immutable public project releases; do not bypass that check with a mutable source archive.
- `latex-renderer-update-refresh.timer` checks stable releases daily with jitter. Its default `notify` policy never applies code; `automatic` must be explicitly selected in Web or with `latex-render-admin update policy --mode automatic --yes`.
- A daily image run that fails at **Verify GHCR package write access** must not be retried until the package's **Manage Actions access** list grants the workflow repository the **Write** role. Repository linking and ordinary package **Manage access** are separate settings.
- After changing that setting, run `gh workflow run ghcr-publish-access.yml --ref main` and require success before starting the long daily image workflow. This check mounts an already-linked config blob back into the same package; it creates no tag, layer, image, or package version.

Use `journalctl -u UNIT --since ... -o cat` and filter structured event names. Emergency containment is described in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
