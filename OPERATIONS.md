# Operations

Check `systemctl status` and JSON journal events for every application service enabled by [DEPLOYMENT.md](DEPLOYMENT.md):

- `latex-renderer-api.service`
- `latex-renderer-internal-api.service`
- `latex-renderer-admin-api.service`
- `latex-renderer-web.service`
- `latex-renderer-remote-mcp.service`
- `latex-renderer-worker.service`
- `latex-renderer-image-manager.service`

Health endpoints are loopback `/health`; Renderer API also has `/ready`, which checks storage availability.

- Pause new work with maintenance mode `reject-new-jobs` before upgrades.
- Let active jobs drain, stop the worker, take the required database backup, deploy, migrate, start APIs/Web/Remote MCP, run health checks, then start the worker and disable maintenance.
- Alert on queue depth, free space, stale leases, render failure/timeout rate, audit export lag, backup failure, and Tunnel health.
- Cleanup runs hourly and must skip active artifact download leases. Backups and audit exports run daily; perform the documented restore test quarterly.
- Do not print credential files, request authorization headers, source ZIPs, PDFs, or raw unescaped logs during diagnosis.

Use `journalctl -u UNIT --since ... -o cat` and filter structured event names. Emergency containment is described in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
