---
slug: api
category: API
title: 公开 API
description: 通过 HTTP 上传 ZIP、查询转换状态并获取 PDF。
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## 使用流程 {#利用の流れ}

准备渲染 API 密钥（`lrk_...`）和[符合要求的 ZIP](/zh-CN/docs/projects/#構成)。若想直接试用，请参见文末的 [curl 示例](#curlの例)。

1. **预约输入包（Source）。** 在本机计算 ZIP 的字节数和 SHA-256，通过 `POST /api/v1/source-tickets` 预约输入包。
2. **上传 ZIP。** 仅当响应中的 `uploadRequired` 为 `true` 时，才使用返回的 URL 和短期 `uploadTicket` 通过 `PUT` 上传 ZIP。如果同一用户已有相同且有效的 ZIP，可直接复用。
3. **创建作业。** 指定就绪的 `sourceId` 和主文档的相对路径（`entrypoint`），通过 `POST /api/v1/render-tickets` 创建作业。单次转换也可使用将前三步合并的[旧版流程](#ジョブ作成)。
4. **查询状态并获取输出。** 使用返回的短期 `jobTicket` 轮询 `GET /api/v1/jobs/{jobId}`，完成后获取 PDF 等文件。

OpenAPI 定义见[预约与作业创建（gateway.openapi.yaml）](/openapi/gateway.openapi.yaml)及[上传与结果获取（renderer.openapi.yaml）](/openapi/renderer.openapi.yaml)。

## 身份验证和权限范围 {#認証とスコープ}

所有认证信息均通过 HTTP 请求头 `Authorization: Bearer <TOKEN>` 发送。

- **使用 API 密钥（`lrk_...`）的操作**包括预约输入、创建作业、操作已保存项目、重新签发作业令牌（`job-tickets`）及重试 SVG。
  - `render:create`：创建作业，创建、重命名和删除项目，以及保存修订版本。
  - `render:read:own`：刷新自有作业的短期令牌，查看项目及历史记录。
- **使用短期令牌（`uploadTicket` 和 `jobTicket`）的操作**包括上传 ZIP、查询作业状态、取消作业、获取输出和删除作业。

> [!WARNING]
> 请勿将 API 密钥、`uploadTicket` 或 `jobTicket` 放入日志、URL 查询参数或待上传的源 ZIP。

> [!NOTE]
> **作业绑定创建时使用的 API 密钥。** 即使属于同一用户或同一服务账号，其他密钥也不能为已有作业刷新 `job-tickets`、用相同 `Idempotency-Key` 重取创建响应或重试 SVG，这些请求会返回 `404`。原密钥失效后也不能转移作业。输入和已保存的项目由同一用户共享，因此其他密钥可使用共享输入和新的 `Idempotency-Key` **创建新作业**。

## API 端点 {#apiエンドポイント}

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | 预约输入包或复用同一用户的已有 ZIP |
| `PUT` | `/api/v1/sources/{sourceId}/content` | 上传并验证输入 ZIP |
| `POST` | `/api/v1/render-tickets` | 从已有输入创建作业、重试 SVG，或预约旧版单作业上传 |
| `POST` | `/api/v1/job-tickets/{jobId}` | 为自有作业重新签发 `jobTicket` |
| `PUT` | `/api/v1/jobs/{jobId}/source` | 在旧版单作业流程中直接上传 ZIP |
| `GET` | `/api/v1/jobs/{jobId}` | 查询作业状态和错误信息 |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | 取消排队或处理中的作业 |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | 获取 PDF、日志、结构化错误和 SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | 获取 `page-N.png` 页面预览 |
| `DELETE` | `/api/v1/jobs/{jobId}` | 将已结束的作业标记为待删除 |
| `GET` / `POST` | `/api/v1/projects` | 列出或创建已保存的项目 |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | 查看项目详情与版本历史、重命名或删除项目（隐藏记录） |
| `POST` | `/api/v1/projects/{projectId}/revisions` | 将就绪输入保存为不可变的修订版本 |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | 查看指定版本的作业历史 |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | 重新渲染指定版本 |

> [!DETAILS] 已保存项目的 API 及维护模式下的行为
>
> - **项目参数。** 列表、详情和作业历史使用 `cursor` 和 `pageSize` 分页。保存版本（`POST .../revisions`）时，发送 `sourceId`、`entrypoint`（相对 `.tex` 路径）、`displayName`、`originalFilename` 和 `outputs`。若项目、输入和入口相同，会复用已有版本。渲染版本（`POST .../render`）必须提供长度为 16 至 200 个字符的 `Idempotency-Key`。省略 `outputs` 时沿用该版本的初始设置。
> - **维护模式限制**
>   - `reject-new-jobs`：可查看、重命名和删除项目，保存版本并准备输入。不能创建新作业。
>   - `read-only` 或 `lockdown`：禁止修改项目，也禁止预约、上传、修订输入和创建引用。已预约的上传也会在发布前再次检查维护模式，若不再允许，则不会标记为完成。

## 创建作业 {#ジョブ作成}

### 方法一：先准备可复用的输入，再创建作业（推荐） {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. 预约输入包。

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. 仅当 `uploadRequired: true` 时上传 ZIP，大小和 SHA-256 必须与预约值完全一致。成功返回 HTTP `204`。

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. 使用就绪的 `sourceId` 创建作业。`entrypoint` 默认为 `main.tex`，`outputs` 默认为 `["pdf"]`，不允许单独请求 `["svg"]`。

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

ZIP 已上传，因此响应不含 `uploadTicket` 和 `uploadUrl`。

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### 方法二：旧版单作业流程（预约后直接上传） {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

向返回的 `uploadUrl`（`/api/v1/jobs/{jobId}/source`）发起上传，使用 `uploadTicket` 以 `PUT` 发送 ZIP。成功返回 HTTP `204`。

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] 输入保留期与 Idempotency-Key
>
> - **孤立输入与引用保护。** 就绪输入若未被任何有效项目版本或作业引用，将在默认 1 小时后清理。已结束的作业也算引用，但 `deleted` 和 `expired` 除外。管理员可将 `source_orphan_retention_minutes` 设为 5 分钟到 24 小时。只要仍有有效引用，超过孤立期限的输入仍可保留和复用。最后一个引用消失时，若已过期，就不可再使用并进入清理范围。引用不会让上传中或删除中的输入重新变为就绪。
> - **`expiresAt` 的含义。** 上传前表示未完成预约的过期时间（10 分钟），就绪后表示无引用时的孤立期限。Web、HTTP API 和 MCP 使用相同规则。MCP 的 `sourceRef` 最长 15 分钟，不会延长输入本身的保留期。
> - **`Idempotency-Key` 的处理。** 复用相同 ZIP 时，该键自受理起保留 24 小时，重发不会续期。有效期内用同一键提交不同内容返回 `409`；原输入过期返回 `410`，已删除返回 `404`，仍在上传返回 `409`。24 小时后可复用该键，无需等待定期清理，也不会恢复原输入。

### 提前获取 PDF 与重试 SVG {#pdfの先行公開とsvgの再試行}

Web 和 CLI 的具体步骤参见[获取 PDF、PNG 和 SVG](/zh-CN/docs/outputs/)。

- **提前获取 PDF 与 `stages`。** 对于 PDF 和 SVG 作业，在 SVG 完成前即可获取验证通过的 PDF 和预览。作业 `status` 表示所有请求输出的总体结果。`stages.pdf`（含 `sha256`）和 `stages.svg`（含 `attempt`）分别返回各阶段状态、完成时间和错误。旧版作业不会被推断补全这些字段。
- **仅重试 SVG。** 使用 API 密钥向 `POST /api/v1/render-tickets` 发送请求（不能用 `jobTicket` 认证），提供 `{"retrySvgJobId":"job_..."}` 和 `Idempotency-Key`。服务器返回原 `jobTicket`，仅重新执行 SVG 提取，不重新编译 PDF 或延长保留期。在原输入、PDF 和运行环境一致时，包括首次在内最多 8 次。SVG 诊断位于 `svg/compile.log`、`svg/errors.json` 和 `svg/dependencies.json`。

> [!DETAILS] `svg/manifest.json` 的坐标与结构（schemaVersion 2）
>
> SVG 保存为 `svg/objects/math-NNNNNN.svg` 或 `tikz-NNNNNN.svg`，带有 `Content-Type: image/svg+xml` 和 `Content-Disposition: attachment`。若对象数量不符，或含外部引用、脚本、事件属性等主动内容，整个作业将失败。`svg/manifest.json` 记录对应关系。新输出始终使用 `schemaVersion: 2`，同时保留对旧版本 `1` 的读取兼容。
>
> - **坐标系（`coordinateSystem`）。** `id` 和 `page` 从 1 开始。单位是 PDF 点（1/72 英寸），原点在页面左上角，x 向右、y 向下。
> - **位置已确定（`placementStatus: "known"`）**
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
> - **位置不确定（`placementStatus: "unknown"`）。** 如同一行有多个公式而 SyncTeX 无法区分位置，系统不会返回推测坐标，将省略 `page`、`x`、`y`。此时的 `width` 和 `height` 是提取出的 SVG 自身尺寸。在 PDF 上叠加前必须检查 `schemaVersion` 和 `placementStatus`。
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## 上传 ZIP {#zipアップロード}

此端点用于旧版单作业流程中已预约的作业。如果先准备独立输入，请使用 `PUT /api/v1/sources/{sourceId}/content`。

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## 作业状态 {#ジョブ状態}

| 状态 | 含义 | 客户端操作 |
| --- | --- | --- |
| `reserved` / `uploading` | 已预约或上传中 | 在有效期内发送 ZIP |
| `queued` / `validating` / `running` | 排队、验证或转换中 | 间隔一段时间后再次查询 |
| `succeeded` | 成功 | 获取 PDF 及其他所需文件 |
| `failed` / `timeout` / `rejected` | 失败、超时或拒绝 | 检查错误信息 |
| `canceled` | 已取消 | 必要时创建新作业 |
| `deleting` / `deleted` / `expired` | 删除中、已删除或已过期 | 必要时重新创建 |

**输出保留期与下载保护**
自完成时间（旧作业无记录时取更新时间）起经过 `ARTIFACT_RETENTION_HOURS`（默认 24 小时）后，即使磁盘文件仍待清理，也不能开始新下载。Web、API、渲染器和 Remote MCP 均遵循此规则。在过期前开始的下载、ZIP 获取和 MCP 读取仅在传输期间自动续订防删除保护，完成或断开后释放。异常退出时，保护自上次续订起 5 分钟后到期。如果续订失败，传输中止，不会恢复已过期的输出。

## 常见错误 {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP 状态 | 含义 | 何时重试 |
| --- | --- | --- |
| `400` | 输入、请求头或 ZIP 内容无效 | 修正输入后执行 |
| `401` / `403` | 令牌无效、过期或权限不足 | 检查凭据及权限后执行 |
| `404` / `410` | 作业或输出不存在（含其他密钥所有的作业），或原数据过期 | 必要时创建新作业 |
| `409` | 作业状态不允许或 `Idempotency-Key` 冲突 | 先检查当前状态 |
| `429` / `503` | 限流、容量不足、队列已满或正在维护 | 等待后可重试 |

## curl 示例 {#curlの例}

以下完整示例适用于 Linux Bash。在 `source.zip` 所在目录中运行，依次预约、上传、每 2 秒查询一次（最多 60 次）并保存 PDF。需要 `curl`、`jq`、`sha256sum` 及 `uuidgen`。使用自托管服务时，请修改 `base`。

> [!DETAILS] 上传 ZIP 并获取 PDF
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

查询 60 次后若仍在等待，可稍后使用显示的 `jobId` 检查同一作业。若 `jobTicket` 已过期，请使用创建作业时的 API 密钥调用 `POST /api/v1/job-tickets/{jobId}` 获取新票据。以下各语言示例演示预约作业和上传 ZIP。

## PowerShell {#powershell}

> [!DETAILS] PowerShell 示例
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

> [!DETAILS] JavaScript / TypeScript 示例
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

> [!DETAILS] Python 示例
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
