# Public MCP gateway

The gateway connects ChatGPT to a LaTeX Renderer installation over public HTTPS or an outbound agent. The selected installation retains ownership of projects, jobs, and files. The gateway database holds connection and authorization records in an independent SQLite database. Existing direct MCP, CLI, and Web connections continue to use the installation's own URL and credentials.

## Connection and authorization

- HTTPS uses the installation's public `/mcp` on port 443 and its same-origin OAuth endpoints. Browser sign-in at the installation can use an external identity provider. The gateway checks the resource, issuer and callback before sending a code for token exchange.
- New gateway connections require a release that supports the relay protocol. Earlier releases can use the existing direct connection. Keep the public gateway's origin stable once the plugin is submitted.
- An administrator can skip ChatGPT integration during setup and enable it later. Skipping requires neither gateway reachability nor local enrollment keys. The agent uses independent control and file connections, and its registration grants no access to a user's documents. For private installations, the user pairs the connection with an eight-digit code that expires after five minutes.
- Initial authorization requests default to `mcp:read` and `mcp:render`. Cancellation can be selected during consent. Deletion requires separate approval. Direct connections retain their existing `mcp` scope. Gateway access tokens last up to ten minutes, with a fixed thirty-day maximum for the authorization.
- DCR clients use approved callback URLs and PKCE. CIMD additionally verifies a signed client assertion against the approved key URL. Keep the DCR client registration valid while the connection is in use.
- Unused DCR registrations expire after seven days. Used registrations remain available while an authorization is active and for seven days after the last authorization ends. A browser can review or remove an expired connection for seven days. Automatic cleanup keeps only the profile identifier needed to recognize the same Renderer user upon reconnection.
- On a new installation or a deliberate clone, generate a new installation identity. The installation key and agent key serve different purposes. Loss of both keys requires new enrollment.

## Backups and deployment

Use a private backup directory and an age recipient dedicated to the gateway. Keep the credential encryption and token derivation keys with the gateway's separately managed secrets. Encrypted backups expire after seven days. When restoring a backup with incomplete revocation history, keep the saved profile IDs and require new user approvals before accepting commands. Disable restored agent transports and register fresh agent keys with the installations' existing identity keys. Never replace the Renderer DB with a gateway backup.

The gateway handles file bytes in transit so that it can transfer them to the authorized destination. The deployed reverse proxy, monitoring, and crash handling must preserve the same data boundary as the application. Keep request bodies, downloads, secrets and protected URLs out of persistent logs and caches.

## Install the gateway on a prepared host

For the project-operated gateway, set `GATEWAY_PUBLIC_ORIGIN=https://latex-mcp.n624.jp` and set the reverse proxy's `server_name` to `latex-mcp.n624.jp`. Use a certificate that covers this hostname at the origin and bypass the Cloudflare cache for the entire hostname. Verify `/health` and OAuth discovery through Cloudflare before registering `https://latex-mcp.n624.jp/mcp` with clients.

1. Install a compatible Renderer release that includes the gateway build. Create the dedicated system account and group `latex-renderer-mcp-gateway` without a login shell. Give this account read access to the gateway configuration. The service units use the Renderer group to read the signed release files and make the Renderer's configuration and data directories inaccessible inside the services.
2. Copy [the environment example](../deploy/public-mcp/gateway.env.example) to `/etc/latex-renderer-mcp-gateway/gateway.env`. Generate four independent 32-byte base64url keys for refresh, pairing, protected references, and downstream credential encryption. Keep key files readable only by the gateway account and root. Copy [the client example](../deploy/public-mcp/clients.json.example) and replace the example entries with verified DCR callback URLs and CIMD metadata and key URLs. Review the example resource limits for the host before enabling public traffic.
3. Install the gateway unit from `deploy/systemd/`. Bind the application to loopback and terminate TLS at your reverse proxy. The [nginx example](../deploy/reverse-proxy/public-mcp-gateway.nginx.conf.example) passes the exact host, replaces the client IP header and enables WebSocket upgrades. Apply equivalent request and response buffering, cache, access log and error log rules at every proxy or CDN layer. Check `/health` and the OAuth discovery endpoints over HTTPS.
4. Install the backup unit and timer if this gateway will hold active connections. Install `age` and supply a recipient file. Keep the corresponding private identity separately from the VPS. The timer backs up only the gateway database and removes backups older than seven days after a successful backup.

For ChatGPT with the gateway's exact issuer identification enabled, confirm the redirect in the MCP settings. The stable DCR callback is `https://chatgpt.com/connector_platform_oauth_redirect`. The stable CIMD client and key URLs are `https://chatgpt.com/oauth/client.json` and `https://chatgpt.com/oauth/jwks.json`. Only add approved exact URLs. Keep the origin listening on loopback and configure the reverse proxy to overwrite the client-address header used for registration rate limits.

## Monitor credential cleanup

Cleanup runs at startup and hourly. Each run writes one JSON log entry with the event `public_mcp_gateway.cleanup`, its `startedAt` timestamp and a `status` of `ok` or `failed`. `GET /health` is reachable from the internet, so it reports only readiness; read cleanup results from the log.

On success, `expiredRecordsRemoved` counts expired credential and related records deleted directly by cleanup, and `expiredConnectionsRemoved` counts connection authorizations removed after their retention period. `dcrRegistrationsReclaimed` counts DCR clients deleted by this run. `dcrRegistrationsUsed` and `dcrRegistrationCapacityRemaining` report occupied and free DCR slots at the end of the cleanup transaction, based on `GATEWAY_MAX_REGISTRATIONS`. Registration can also reclaim expired clients between cleanup runs. A failed run reports its timestamp and status.

Registration and cleanup retry SQLite lock acquisition for up to five seconds. If registration cannot write, `/oauth/register` returns HTTP `503` with `temporarily_unavailable`.

## Enable a Renderer connection

For a public HTTPS installation, generate an Ed25519 installation key and a unique `instance_` identifier followed by 32 lower-case hexadecimal characters. Configure `RENDERER_RELAY_INSTANCE_ID` and `RENDERER_RELAY_INSTANCE_KEY_FILE` on the Remote MCP service, keeping the key private to that service. Preserve them for recovery or switching transport. At the gateway authorization page, enter the installation's public HTTPS `/mcp` URL, finish the Renderer approval, and confirm the connection back at the gateway. The same browser can later disconnect each grant at `/oauth/connection`.

For a private installation, the optional agent setup starts after Renderer setup succeeds:

- **Skip for now** in Web setup, or run `sudo n624-latex server chatgpt --skip` from the terminal. The setup can finish offline and the Renderer is ready for direct use.
- **Connect** with `sudo n624-latex server chatgpt --connect https://gateway.example.com`. This enrolls the agent and writes its configuration under `/etc/latex-renderer/chatgpt`. To preserve a previously configured HTTPS identity, provision its existing `instance-id` and `instance.pem` into this private directory before enrolling.

Create the restricted service account `latex-renderer-mcp-agent`. Copy [the agent limits](../deploy/public-mcp/agent-limits.env.example) into that directory as `agent-limits.env`, and install the [Remote MCP drop-in](../deploy/public-mcp/remote-mcp-agent.conf.example) under `/etc/systemd/system/latex-renderer-remote-mcp.service.d/`. Install the optional agent unit. Reload systemd configuration, enable the agent and restart the Remote MCP service so that it reads the installation identity and local pairing settings. The Renderer socket starts the enabled agent. The agent connects out to the gateway and communicates with Renderer over loopback.

To connect a user, choose a connection code in the gateway's approval flow, open `/oauth/relay` on the installation, approve the requested permissions, and confirm on the original device. The local page also disconnects individual grants. Pairing and registration leave existing projects and files in place. Use `sudo n624-latex server chatgpt --status` for the local service state and `--stop` to disable the local agent. Use `--retire-key` while connected to invalidate the agent key centrally and stop the service. Connect again with `--rotate-agent-key` to enroll a replacement key.

Both transports appear under `/oauth/connection` in the browser that approved them. Disconnect takes effect at the gateway immediately. If an agent is unavailable, the gateway retries delivery of the revocation when that agent reconnects, up to the local grant's expiry. Use **Forget connection** after disconnecting to remove the approval and any now-unused profile information. A pending agent revocation retains only the identifiers necessary to deliver it. An HTTPS installation that cannot be reached during disconnect may still hold its original authorization. Revoke that authorization on the installation itself.

## Interrupted operations

| Operation | After a lost response |
| --- | --- |
| Read a guide, Project file, Job, or artifact | Read again using the same gateway reference. |
| Upload a Source in chunks | Query the upload status and continue at the reported offset. |
| Submit a render or another operation that accepts a replay key | Use the same key and exactly the same input to recover the original operation. |
| Make a change with no replay key | Check the Project, Job, or operation result before issuing a fresh change. |
| Cancel a render | Check the Job state before trying again. |

The gateway never queues a disconnected user's document for later execution. A Job accepted by Renderer continues on that installation when the gateway or agent disconnects.

## Recover a gateway

1. Stop the gateway and backup timer. Preserve the current DB and its sidecars together until recovery is verified.
2. Run `node apps/public-mcp-gateway/dist/backup-cli.js prepare-restore BACKUP UNUSED_DATABASE AGE_IDENTITY` as the gateway account, with temporary read access to the verified release. Use absolute paths and a new database filename inside the private state directory. The restore validates integrity and disables recovered authorizations and agent transports before it writes the replacement. Remove temporary access to the age identity when the restore finishes.
3. Set the service's database path to the new file and start the gateway. Keep its configured public origin and the separately backed-up secrets. On each private Renderer, rerun `sudo n624-latex server chatgpt --connect GATEWAY_HTTPS_ORIGIN --rotate-agent-key` and restart the agent. This retains the installation identity and replaces the previous communications key. Each user then reapproves access.

Central download links expire after ten minutes. A link permits only reading the named artifact and becomes invalid when its authorization is revoked. Treat these URLs as credentials. Render results, files and download links are not persisted by the gateway.

## Verification scope

The example configuration uses a small concurrency limit and should be sized on the target server. Production proxy disk behavior, updates and rollback with the units installed, and enrollment and rendering from ChatGPT on real devices require acceptance testing.
