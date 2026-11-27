---
slug: api
category: API
title: Public API
description: Upload a ZIP over HTTP, monitor conversion, and retrieve the PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Workflow {#利用の流れ}

Get a rendering API key (`lrk_...`) and [prepare a supported ZIP](/en/docs/projects/#構成). For a complete example, see the [curl example](#curlの例).

1. **Reserve a source.** Calculate the ZIP’s size in bytes and SHA-256 locally, then call `POST /api/v1/source-tickets` to reserve the input bundle.
2. **Upload the ZIP.** Only if the response has `uploadRequired` set to `true`, send the ZIP with `PUT` to the returned URL using the short-lived `uploadTicket`. An identical valid ZIP belonging to the same user can be reused.
3. **Create a job.** Send the ready `sourceId` and the main document’s relative path (`entrypoint`) to `POST /api/v1/render-tickets`. For a one-off conversion, the [legacy flow](#ジョブ作成) combines steps 1–3.
4. **Monitor and download.** Use the returned short-lived `jobTicket` to poll `GET /api/v1/jobs/{jobId}`. Download the PDF and other artifacts when complete.

OpenAPI definitions cover [reservation and job creation (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) and [uploads and results (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Authentication and scopes {#認証とスコープ}

Send all credentials in the HTTP header `Authorization: Bearer <TOKEN>`.

- **API key (`lrk_...`).** Use it for source reservation, job creation, saved projects, reissuing job tokens (`job-tickets`), and retrying SVG extraction.
  - `render:create` permits job creation and creating, renaming, or deleting projects and saving revisions.
  - `render:read:own` permits refreshing short-lived tokens for your jobs and viewing projects and history.
  - `render:project:read` permits listing files and reading UTF-8 text from your saved project revisions. Select it explicitly when issuing a key.
  - `render:draft:read` — Read the shared draft metadata and files.
  - `render:draft:write` — Open, edit, and save shared drafts.
  - `render:pdf:inspect` — Request and read PDF inspections for jobs owned by that key.
- **Short-lived tokens (`uploadTicket` and `jobTicket`).** Use these to upload a ZIP, read job status, cancel a job, retrieve artifacts, or delete a job.

> [!WARNING]
> Keep API keys, `uploadTicket`, and `jobTicket` out of logs, URL query strings, and source ZIPs.

In the admin interface, rotating an API key lets its replacement renew tickets, recover a creation response with the same `Idempotency-Key`, and retry SVG extraction for existing jobs. The old key and its tickets expire immediately. Queued jobs can continue if the replacement has rendering permission. This applies to rotations performed after upgrading.

Independently issued keys receive `404` for these operations, even when they belong to the same service account. Revoke a key if it is compromised. Users share sources and saved projects across their keys and can create a new job from a shared source. If a history entry has `detailAccess: "different_connection"`, use the connection that owns the job to open its details.

## API endpoints {#apiエンドポイント}

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `HEAD` | `/api/v1/health` | Check whether the gateway responds. No authentication required. HEAD returns no body. |
| `GET` | `/api/v1/source-tickets` | Read current ZIP limits with a rendering API key |
| `POST` | `/api/v1/source-tickets` | Reserve a source or reuse an existing ZIP owned by the same user |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Upload and validate a source ZIP |
| `POST` | `/api/v1/render-tickets` | Create a job from a source, retry SVG extraction, or reserve a legacy single-job upload |
| `POST` | `/api/v1/job-tickets/{jobId}` | Reissue a `jobTicket` for an owned job |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Upload a ZIP directly in the legacy single-job flow |
| `GET` | `/api/v1/jobs/{jobId}` | Get job status and error details |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Cancel a queued or active job |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Get PDFs, logs, structured errors, or SVGs |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Get a `page-N.png` preview |
| `DELETE` | `/api/v1/jobs/{jobId}` | Mark a finished job for deletion |
| `GET` / `POST` | `/api/v1/projects` | List or create saved projects |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | View details and revisions, rename a project, or delete it (hide its record) |
| `GET` | `/api/v1/projects/{projectId}/draft` | Get shared draft metadata and the file list |
| `GET` | `/api/v1/projects/{projectId}/draft/file` | Read text from the specified draft version |
| `POST` | `/api/v1/projects/{projectId}/draft/open` | Open a shared draft |
| `POST` | `/api/v1/projects/{projectId}/draft/changes` | Apply a batch of changes to the exact draft version |
| `POST` | `/api/v1/projects/{projectId}/draft/save` | Save a draft as an immutable revision |
| `GET` / `POST` | `/api/v1/job-tickets/{jobId}/pdf-inspection` | Read or request an inspection for the specified PDF |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Save a ready source as an immutable revision |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Get the job history for a revision |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/files` | List saved revision files or read text by supplying `path` |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Render a revision again |

> [!DETAILS] Saved project API and maintenance modes
>
> - **Project parameters.** Use `cursor` and `pageSize` to page through lists, details, and job history. To save a revision (`POST .../revisions`), send `sourceId`, `entrypoint` (relative `.tex` path), `displayName`, `originalFilename`, and `outputs`. The same project, source, and entrypoint reuse the existing revision. Rendering a revision (`POST .../render`) requires an `Idempotency-Key` of 16–200 characters. Omitting `outputs` uses the revision’s initial settings.
> - **Maintenance restrictions**
>   - `reject-new-jobs` permits viewing, renaming, and deleting projects, saving revisions, and preparing sources. New jobs are rejected.
>   - `read-only` and `lockdown` reject project changes and all source reservations, uploads, revisions, and reference creation. Even reserved uploads check maintenance mode just before publication and cannot complete if the mode has changed to prohibit it.

## Create a job {#ジョブ作成}

### Prepare a reusable source, then create a job (recommended) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reserve a source.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Upload the ZIP only when `uploadRequired: true`. The size and SHA-256 must exactly match the reservation. Success returns HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Create a job from the ready `sourceId`. The default `entrypoint` is `main.tex` and the default `outputs` is `["pdf"]`. Requesting `["svg"]` alone is invalid.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

The response omits `uploadTicket` and `uploadUrl` because the ZIP is already available.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Legacy single-job flow (reserve, then upload) {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Send the ZIP with `PUT` to the returned `uploadUrl` (`/api/v1/jobs/{jobId}/source`) using the `uploadTicket`. Success returns HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Source retention and Idempotency-Key behavior
>
> - **Orphaned and referenced sources.** A ready source with no referencing job (including finished jobs, excluding `deleted` and `expired`) or active project revision is cleaned up after 1 hour by default. Administrators can set `source_orphan_retention_minutes` from 5 minutes to 24 hours. While a job or revision references the source, it remains available for reuse beyond this orphan deadline. If the deadline has passed when the final reference disappears, the source becomes unavailable and eligible for cleanup. References cannot return an uploading or deleting source to ready status.
> - **`expiresAt`.** Before upload, this is the incomplete reservation’s 10-minute deadline. Once ready, it is the deadline that applies if the source is unreferenced. The web app, HTTP API, and MCP use the same rule. An MCP `sourceRef` lasts at most 15 minutes and does not extend the source’s retention.
> - **`Idempotency-Key`.** When an identical ZIP is reused, its key is recorded for 24 hours from acceptance. Retransmission does not extend this window. Within the window, using the key for different content returns `409`. An expired original source returns `410`, a deleted one `404`, and an upload in progress `409`. After 24 hours the key can be reused without waiting for scheduled cleanup. Reusing it does not revive the original source.

### Early PDF availability and SVG retries {#pdfの先行公開とsvgの再試行}

For web and CLI instructions, see [Get PDF, PNG, and SVG output](/en/docs/outputs/).

- **Early PDF access and `stages`.** For PDF and SVG jobs, the verified PDF and previews are available before SVG extraction finishes. Overall `status` covers all requested outputs. `stages.pdf` (including `sha256`) and `stages.svg` (including `attempt`) report each stage’s status, completion time, and errors. Stage data is not inferred for older jobs.
- **Retry SVG only.** Using API key authentication, send `{"retrySvgJobId":"job_..."}` and an `Idempotency-Key` to `POST /api/v1/render-tickets`. This endpoint does not accept a `jobTicket` as authentication. It returns the original `jobTicket` and repeats only SVG extraction, preserving the PDF and retention deadline. Up to 8 attempts, including the first, are permitted when the original source, PDF, and runtime match. SVG diagnostics are in `svg/compile.log`, `svg/errors.json`, and `svg/dependencies.json`.

> [!DETAILS] Coordinates and schema for svg/manifest.json (schemaVersion 2)
>
> Extracted SVGs are saved as `svg/objects/math-NNNNNN.svg` or `tikz-NNNNNN.svg` with `Content-Type: image/svg+xml` and `Content-Disposition: attachment`. An object count mismatch or active content, such as external references, scripts, or event attributes, fails the entire job. `svg/manifest.json` maps the SVGs. New output always uses `schemaVersion: 2`, and version `1` remains readable.
>
> - **Coordinates (`coordinateSystem`).** `id` and `page` start at 1. Units are PDF points (1/72 inch). The origin is the top-left corner of the page, with x increasing to the right and y downward.
> - **Known position (`placementStatus: "known"`)**
>   ```json
>   {
>     "id": 1,
>     "kind": "math",
>     "artifact": "svg/objects/math-000001.svg",
>     "sourceFile": "chapters/formula.tex",
>     "sourceLine": 18,
>     "placementStatus": "known",
>     "page": 2,
>     "x": 123.4,
>     "y": 85.2,
>     "width": 210.6,
>     "height": 32.8
>   }
>   ```
> - **Unknown position (`placementStatus: "unknown"`).** If SyncTeX cannot establish separate positions, for example for multiple expressions on one line, the manifest omits `page`, `x`, and `y`. In this case `width` and `height` are the extracted SVG’s dimensions. Always check `schemaVersion` and `placementStatus` before overlaying it on the PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Upload a ZIP {#zipアップロード}

This endpoint uploads a ZIP to a job reserved using the legacy single-job flow. For a separate source, use `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Job status {#ジョブ状態}

| Status | Meaning | Client action |
| --- | --- | --- |
| `reserved` / `uploading` | Reserved or uploading | Upload the ZIP before the deadline |
| `queued` / `validating` / `running` | Waiting, validating, or compiling | Wait between status checks |
| `succeeded` | Successful | Retrieve the PDF and required artifacts |
| `failed` / `timeout` / `rejected` | Failed, timed out, or rejected | Check the error details |
| `canceled` | Canceled | Create a new job if needed |
| `deleting` / `deleted` / `expired` | Being deleted, deleted, or expired | Create a new job if needed |

**Retention and active downloads**
Once `ARTIFACT_RETENTION_HOURS` (24 hours by default) has elapsed from completion, or from the last update for older jobs without a completion time, no new download can start even if files await cleanup. This applies to the web app, API, renderer, and Remote MCP. Downloads, ZIP retrievals, and MCP reads started before expiry automatically renew a deletion-prevention reservation only during transfer and release it on completion or disconnect. After abnormal termination the reservation expires 5 minutes after its last renewal. Failure to renew aborts the transfer. Expired artifacts cannot be revived.

## Common errors {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP status | Meaning | When to retry |
| --- | --- | --- |
| `400` | Invalid input, headers, or ZIP contents | Correct the input first |
| `401` / `403` | Invalid or expired token, or insufficient scope | Check credentials and permissions |
| `404` / `410` | Job or artifact unavailable (including jobs owned by another key), or source data expired | Create a new job if needed |
| `409` | Incompatible job state or `Idempotency-Key` conflict | Inspect current state first |
| `429` / `503` | Rate limit, insufficient capacity, full queue, or maintenance | Wait before retrying |

## curl example {#curlの例}

This complete Linux Bash example reserves a job, uploads `source.zip`, polls every 2 seconds up to 60 times, and saves the PDF. Run it from the directory containing the ZIP. It requires `curl`, `jq`, `sha256sum`, and `uuidgen`. Change `base` for a self-hosted server.

> [!DETAILS] Upload a ZIP and download a PDF
>
> ```bash
> (
>   set -euo pipefail
>   base=https://latex-render.n624.jp
>   zip=source.zip
>   read -rs -p 'Rendering API key: ' api_key
>   printf '\n'
>   size=$(wc -c < "$zip")
>   digest=$(sha256sum "$zip")
>   idempotency_key=$(uuidgen)
>   request=$(jq -n --argjson size "$size" --arg sha "${digest%% *}" \
>     '{size: $size, sha256: $sha}')
>
>   reservation=$(curl -fsS "$base/api/v1/render-tickets" \
>     --header @- \
>     -H "Idempotency-Key: $idempotency_key" \
>     -H 'Content-Type: application/json' --data "$request" <<< "Authorization: Bearer $api_key")
>   job_id=$(jq -er '.jobId' <<< "$reservation")
>   token=$(jq -er '.jobTicket' <<< "$reservation")
>   upload_token=$(jq -er '.uploadTicket' <<< "$reservation")
>   printf 'Job ID: %s\n' "$job_id"
>
>   curl -fsS --upload-file "$zip" "$base/api/v1/jobs/$job_id/source" \
>     --header @- \
>     -H 'Content-Type: application/zip' <<< "Authorization: Bearer $upload_token"
>
>   for attempt in {1..60}; do
>     status=$(curl -fsS "$base/api/v1/jobs/$job_id" \
>       --header @- <<< "Authorization: Bearer $token" | jq -er '.status')
>     case "$status" in
>       succeeded)
>         curl -fsS "$base/api/v1/jobs/$job_id/artifacts/result.pdf" \
>           --header @- --output result.pdf <<< "Authorization: Bearer $token"
>         printf 'Saved result.pdf\n'
>         exit 0
>         ;;
>       reserved|uploading|queued|validating|running) sleep 2 ;;
>       *) printf 'Job %s: %s\n' "$job_id" "$status" >&2; exit 1 ;;
>     esac
>   done
>   printf 'Job %s is still pending; check the same job later.\n' "$job_id" >&2
>   exit 1
> )
> ```

If the job is still pending after 60 checks, use the displayed `jobId` to check the same job later. If `jobTicket` expires, call `POST /api/v1/job-tickets/{jobId}` with the API key that created it to obtain a fresh ticket. The following examples cover job reservation and ZIP upload.

## PowerShell {#powershell}

> [!DETAILS] PowerShell example
>
> ```powershell
> $zip = Resolve-Path .\source.zip
> $bytes = [IO.File]::ReadAllBytes($zip)
> $sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
> $headers = @{
>   Authorization = "Bearer $env:LATEX_RENDER_API_KEY"
>   "Idempotency-Key" = [guid]::NewGuid().ToString()
> }
> $ticket = Invoke-RestMethod -Method Post `
>   -Uri https://latex-render.n624.jp/api/v1/render-tickets `
>   -Headers $headers -ContentType application/json `
>   -Body (@{size=$bytes.Length;sha256=$sha} | ConvertTo-Json)
> Invoke-WebRequest -Method Put -Uri $ticket.uploadUrl `
>   -Headers @{Authorization="Bearer $($ticket.uploadTicket)"} `
>   -ContentType application/zip -InFile $zip
> ```

## JavaScript / TypeScript {#javascript-typescript}

> [!DETAILS] JavaScript / TypeScript example
>
> ```typescript
> import { readFile } from "node:fs/promises";
> import { createHash, randomUUID } from "node:crypto";
>
> const zip = await readFile("source.zip");
> const sha256 = createHash("sha256").update(zip).digest("hex");
> const response = await fetch(
>   "https://latex-render.n624.jp/api/v1/render-tickets",
>   {
>     method: "POST",
>     headers: {
>       Authorization: "Bearer " + process.env.LATEX_RENDER_API_KEY,
>       "Content-Type": "application/json",
>       "Idempotency-Key": randomUUID(),
>     },
>     body: JSON.stringify({ size: zip.length, sha256 }),
>   },
> );
> if (!response.ok) throw new Error(`Reservation failed: ${response.status}`);
> const ticket = await response.json();
> const upload = await fetch(ticket.uploadUrl, {
>   method: "PUT",
>   headers: {
>     Authorization: "Bearer " + ticket.uploadTicket,
>     "Content-Type": "application/zip",
>   },
>   body: zip,
> });
> if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
> ```

## Python {#python}

> [!DETAILS] Python example
>
> ```python
> import hashlib
> import os
> import pathlib
> import uuid
>
> import requests
>
> data = pathlib.Path("source.zip").read_bytes()
> headers = {
>     "Authorization": "Bearer " + os.environ["LATEX_RENDER_API_KEY"],
>     "Idempotency-Key": str(uuid.uuid4()),
> }
> response = requests.post(
>     "https://latex-render.n624.jp/api/v1/render-tickets",
>     headers=headers,
>     json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
> )
> response.raise_for_status()
> ticket = response.json()
> requests.put(
>     ticket["uploadUrl"],
>     headers={
>         "Authorization": "Bearer " + ticket["uploadTicket"],
>         "Content-Type": "application/zip",
>     },
>     data=data,
> ).raise_for_status()
> ```
