---
slug: reference
category: Operations and development
title: Operations and developer reference
description: Look up client storage and recovery behavior, MCP authentication, and migration procedures for older releases.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Artifact storage and recovery {#成果物の保存-復旧の仕様}

> [!DETAILS] Specifications and procedures
>
> - **Atomic directory replacement.** The CLI and Local MCP keep paths such as `.render/result.pdf`, `job.json`, and previews stable. They verify every advertised size and SHA-256 and switch directories only when the complete set is ready. The directory may be briefly absent during the switch. External programs should read it after the command finishes.
> - **Automatic recovery.** A sibling directory named `<output-name>.latex-renderer-state` holds recovery state and is automatically excluded from source collection. Temporary data is removed on normal exit. After a forced exit, the next download restores the old set if the switch was uncommitted or retains the new set and cleans up the old one if committed. Leave the state directory in place during processing and before recovery.
> - **Locking and anomaly detection.** Concurrent saves to one destination stop with `OUTPUT_BUSY`. Elapsed time alone cannot displace an active process, and a reused PID causes a safe stop. Damaged metadata, unknown files, and external links require review before cleanup.
> - **User files and operating limits.** Ordinary user files are copied into the new set. If an edit is detected during download, publication stops and the edit is preserved. Use a dedicated destination when possible. Old and new sets are each limited to 1 GiB and 10,000 entries. Allow space for both sets and temporary files. Only local filesystems are supported. Paths containing symbolic links, hard links, or mounts from another filesystem are rejected. Locking on network shares and full atomicity during power loss are outside the guarantees. On Windows, an open file that blocks replacement leaves the old set intact.

## Web authentication boundaries {#web認証の境界}

> [!DETAILS] Specifications and procedures
>
> Server-side sessions protect `/app/`, `/admin/`, and their APIs. These paths are excluded from the public search index. Ordinary users can access `/app/`. Only admins and owners can access `/admin/`. Identity is based on the external provider’s `issuer + subject` or the password account’s `login name`. Email addresses and display names are unsuitable as authentication keys. ZIP uploads, jobs, artifacts, and TeX compilation are handled by the server-side renderer.
>
> > [!NOTE]
> > The browser does not persist short-lived job tickets. It obtains fresh tickets from the server-side session when needed. Never copy or share session cookies, CSRF tokens, or short-lived tickets.

## Remote MCP registration and diagnostics {#remote-mcpの登録-診断}

> [!DETAILS] Specifications and procedures
>
> - **Dynamic client registration (DCR).** Incomplete or inactive registrations are normally cleaned up after 30 days. Registrations referenced by valid authorization codes or token families are protected. The overall limit is 10,000. If cleanup causes `invalid_client`, register again from the AI client. Standard DCR requests may omit the client name. Name and redirect URI validation still apply.
> - **Temporary authorization requests (schema 20).** Requests interrupted by browser sign-in are saved under a short random ID so the server can restore the request without embedding a long OAuth `state` in the return URL. Requests expire after 10 minutes and can be used once when the authenticated browser and dedicated cookie match. Parallel tabs use separate IDs. The limits are 1,000 requests overall and 8 continuation cookies per browser. At capacity, the server returns `503` and preserves existing requests. The database stores only ID and cookie hashes. Restarting or restoring a backup does not extend expiration.
> - **IP rate limits and source headers.** DCR permits 10 registrations per trusted source IP in 15 minutes. Clients sharing a proxy egress IP share the limit. From the 11th request, the server returns HTTP `429`, `temporarily_unavailable`, and `Retry-After`. Invalid registration metadata does not consume quota. Missing or invalid source IPs return `503` so the operator can correct the proxy, without pooling unidentified clients. Keep the backend on loopback and configure the proxy to overwrite `X-Latex-Renderer-Client-IP` with the actual source IP. Arbitrary `X-Forwarded-For` values are ignored. The Cloudflare route also handles `CF-Connecting-IP` inside its trust boundary.
> - **Administrator connectivity check.** The command below tests public discovery and the `401` Bearer challenge without sending credentials, changing configuration, following redirects, or printing bodies, cookies, or secrets.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Correlating logs.** A `200` discovery response and a `401` challenge verify only those stages. For login or ChatGPT tool discovery failures, correlate the stage, time, and `X-Request-ID` with `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error`, and `remote_mcp.rpc_result`. Keep OAuth codes, tokens, cookies, PKCE verifiers, source data, and user IDs out of logs and issues.
> - **Authentication succeeds but action discovery fails.** Check `initialize`, the initialization notification, and `tools/list` separately after token issuance. A JSON-RPC `error` is a failure even with HTTP `200`. `remote_mcp.rpc_result` records HTTP status, success classification, protocol version, tool count, response size, and the basic shape of the list. The inspection buffer is limited to 256 KiB. Larger responses are marked `inspection_limited` and pass through unchanged. An SSE response or a `405` to `GET` alone does not establish a fault. Check `Accept`, `Content-Type`, protocol negotiation, and whether requests reach the server through the proxy. External OIDC, Cloudflare policy, and a real ChatGPT account require separate verification in the deployed environment.

## MCP results and resources {#mcpの結果とresource}

> [!DETAILS] Specifications and procedures
>
> Remote MCP responses have three layers.
> 1. **Standard `content`** includes the source ID, job ID, status, offset, cursor, availability, and bounded diagnostics needed for the AI’s next decision and tool call. Clients that lack `structuredContent` or custom resource support can still create, correct, and rerender a document.
> 2. **`structuredContent`** contains the full validated machine-readable result object.
> 3. **MCP resources (`latex-renderer://jobs/...`)** carry larger outputs such as the PDF, complete `compile.log`, raw JSON, `svg/manifest.json`, and `svg/objects/*.svg`. Only the same OAuth owner can read them, subject to ordinary artifact size and retention limits. All layers exclude API keys, OAuth tokens, tickets, source text, and raw base64.

## CLI waiting and retries {#cliの待機と再試行}

> [!DETAILS] Specifications and procedures
>
> While waiting for a job, the CLI retries temporary HTTP `502`, `503`, `504`, and invalid JSON responses only for status checks on the same job. It retries **up to 5 times** after 1, 2, 4, 8, and 8 seconds without extending the overall timeout. Job creation, uploads, token renewal, and artifact verification are not retried automatically. Authentication and authorization errors are returned immediately. A CLI wait error may leave the server job running.

## CLI JSON format {#cliのjson形式}

> [!DETAILS] Specifications and procedures
>
> With `--json`, standard output uses the following formats. Responses exclude API keys, `uploadTicket`, and `jobTicket`.
>
> - **Success (exit code `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI or API error (exit code `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Completed job with an error such as failed LaTeX compilation (exit code `2`).** Returns `success: false` with job information and saved paths in `result`.

## Migration and special recovery procedures {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrate an older updater or recover from extraction errors
>
> ### Migrate the v1.2.x root updater to the privilege-separated updater {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Through v1.2.x the Update Manager ran as a root daemon. Since v1.3.0, its persistent controller runs as `latex-renderer-update` and a short-lived root helper accepts fixed verbs. A web update from the old updater can stop with `Application Update Manager must use a separate non-root build tree`. Do not repeat that web operation.
>
> Use the [v1.3.6 server distribution](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6) for this one-time migration. As a regular user, follow [Download and verify the release](/en/docs/self-hosting/#v1-6-9をダウンロードして検証), changing the initial `version=` line to `version=1.3.6`. Stay in the same terminal to reuse the `bundle_root` set during verification and extraction.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> The script retrieves the same immutable release again as root and rechecks its digest, tag/commit, Sigstore bundle, archive limits, and metadata. It accepts `gh` only at `/usr/local/bin/gh` or `/usr/bin/gh`, owned by root and not writable by group or others. Builds use separate root-owned `verified`, non-root `bootstrap-build` (pinned pnpm through a dedicated Corepack shim), and root-owned `assembly` trees. The old manager stops only after the shared mutation lock is acquired and restarts on failure. On success, use the following commands to confirm `User=latex-renderer-update` and `active` for each service. Afterward use normal web or Admin CLI updates.
> The web interface and API receive neither sudo privileges nor GitHub tokens.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar extraction stops with Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> On Ubuntu systems where GNU `tar` uses `openat2`, the updater’s `RestrictSUIDSGID=true` setting can cause nested archive extraction to fail with `ENOSYS` (Function not implemented). The fixed updater retains GNU `tar` inspection and signature verification, then extracts with `/usr/bin/bsdtar` into an empty private staging directory without importing owners, ACLs, or extended attributes. It keeps `RestrictSUIDSGID` enabled and preserves the system `tar`.
>
> The old updater can fail while unpacking its own fix. First confirm there are no active operations, the application and database are healthy, and an encrypted backup has been verified. Then use the installed `bootstrap-v1` to **update only the independent updater to a published release containing the fix**.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Check the new updater version and `ready` / `pending=false`, then apply the same version to the application with the normal web or Admin CLI `update apply` operation.
>
> The `v1.4.0-rc.3` updater has a known issue where a bundle copied as root retains non-root ownership, causing `Release extraction requires a private regular bundle`. Keep the checks enabled, update only the updater to a newer published release containing the ownership fix, then apply the application. To test extraction under root and systemd separately, run `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Investigate locks on updates or TeX changes
>
> ### The mutation lock is busy {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` prevents application updates and TeX changes from running concurrently. Wait for active work to finish. **Never delete `/run/latex-renderer/mutation.lock` itself.** Doing so allows two independent locks to coexist. If the error occurs during internal TeX runtime restoration within an application update, it may be self-contention. Inspect logs and stopped services before trying again.
>
> Only when no operation is running and logs show the previous operation completed, stop both managers and inspect the process holding the lock.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Terminate the process and restart the managers only after confirming it is an orphaned lock helper from a completed operation.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Renderer identity in earlier release candidates {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　v1.3.4 release candidates
>
> The update from `v1.3.4-rc.3` to `v1.3.4-rc.4` failed before the service switchover because the renderer identity hash began covering 6 files instead of 5. For this migration, use `v1.3.4-rc.5`, which includes compatibility information for the old version. The full distribution checksum and provenance signature also verify the added file.

## Updater execution environments {#updaterの実行領域}

> [!DETAILS] Specifications and procedures
>
> The Update Manager separates the root-owned `verified` tree containing the verified release, the non-root `build` tree for dependency installation and builds, and the root-owned `assembly` tree containing only allowed outputs. Root always runs the verified deployment script from `assembly`. Operations such as Cloudflare publication under the deployment user use a temporary `deployment-build` copy after root checks. Rollback follows the same rules.

## Windows installation paths and protection {#windowsの配置と保護}

> [!DETAILS] Specifications and procedures
>
> Changing the installation path on Windows moves the default command directory to its `bin` subfolder. Set `LATEX_RENDER_BIN_DIRECTORY` to place managed launchers elsewhere. The user PATH and Local MCP both use this location. Setup preserves existing alternative launchers. `setup repair` can correct the previous installation’s recorded path while retaining the old PATH entry for other programs. Use an absolute path without semicolons, quotes, or control characters. If `--open` or GUI launch cannot open a viewer or browser, the saved PDF remains available.

## Saved project sharing and retention {#保存プロジェクトの共有-保持}

> [!DETAILS] Sharing and retention rules
>
> - The web app (`/app/`), CLI, public API, Local MCP, and Remote MCP share each user’s saved projects and immutable revision history. Multiple API keys or service accounts belonging to the same user can view and update them. Temporary source and job workflows can operate independently of projects.
> - A revision is identified by its input, main document, engine, and output formats. Revisions with different output formats may share input. Outputs chosen in **Convert again** apply only to that run. Choose the initial settings to use the revision’s stored formats.
> - A source referenced by an active project revision is retained past its standalone expiration time and counts against the user’s storage quota. Deleting a project hides its record. Once the last referencing project has been deleted and no jobs reference the source, protection ends. Scheduled cleanup then reclaims it after expiry. Contact an administrator for immediate full deletion.

## Display language {#表示言語}

The editor saves **Display language** to your account. If unset, it checks your browser’s languages in order and falls back to English if none match. Configure the document’s engine and text encoding separately.

| Area | Translation coverage |
| --- | --- |
| Web and setup | Actions, operation status, confirmations and diagnostics. |
| CLI and MCP | CLI help and prompts use the terminal language. Remote MCP descriptions use the account language. |
| Editor | Editing, search and replace, saving and conflicts, compilation status, and preview controls are available in 18 languages. |
| Public guides | All guides are available in the 18 languages listed below. Use Display language at the top of the page to switch. |

The editor supports English, Japanese, Simplified Chinese, Korean, Spanish, Portuguese, French, German, Italian, Russian, Turkish, Polish, Czech, Dutch, Swedish, Norwegian Bokmål, Danish, and Finnish. Messages from TeX itself and third-party packages keep their original wording for troubleshooting.

## Recover audit logs {#監査ログの復旧}

After a database restore, the audit export position (`export_database_id`, row sequence `export_sequence`, and `export_token`) may no longer match the database. Audit log export and cleanup stop to protect the data.

1. Stop the audit export and cleanup services and timers during investigation and recovery.
2. Copy the restored database, existing encrypted exports, and all current and legacy checkpoint files to separate storage. Verify database integrity, foreign keys, and migration state.
3. If no compatible checkpoint exists and you decide to export the audit rows remaining in the database again, move the checkpoint files out of their active paths. Check `AUDIT_EXPORT_CHECKPOINT` if set. Preserve the audit rows, SQLite sequences, and `export.lock`.
4. Run one manual export using the production service credentials. Verify that the encrypted output can be decrypted and a new format 3 checkpoint exists, then restart the timers.

Only rows still present in the restored database are exported again. To match duplicates with past output, use the combination of `export_database_id`, `export_sequence`, and `export_token`. Timestamps alone cannot identify duplicates.
