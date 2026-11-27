---
slug: api
category: API
title: 公開API
description: HTTP リクエストで ZIP を送り、変換の状態を確認して PDF を取得します。
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## 利用の流れ

レンダリング用 API キー（`lrk_...`）と、[対応構成の ZIP](/docs/projects/#構成) を用意します。すぐに試したい場合は末尾の[curl の例](#curlの例)を参照してください。

1. **Source の予約**：手元で ZIP のバイトサイズと SHA-256 を計算し、`POST /api/v1/source-tickets` で Source（入力一式）を予約します。
2. **ZIP のアップロード**：応答の `uploadRequired` が `true` の場合のみ、返された URL と短時間の `uploadTicket` を使って ZIP を `PUT` 送信します（同一ユーザー内で同じ ZIP が有効な場合はアップロード不要で再利用されます）。
3. **ジョブの作成**：準備できた `sourceId` と本文の相対パス（`entrypoint`）を指定して `POST /api/v1/render-tickets` でジョブを作ります（単発変換なら 1〜3 をまとめた[従来フロー](#ジョブ作成)も使えます）。
4. **状態確認と成果物取得**：返された短時間の `jobTicket` で `GET /api/v1/jobs/{jobId}` をポーリングし、完了したら PDF 等を取得します。

OpenAPI 定義：[予約とジョブ作成（gateway.openapi.yaml）](/openapi/gateway.openapi.yaml) · [アップロードと結果取得（renderer.openapi.yaml）](/openapi/renderer.openapi.yaml)

## 認証とスコープ

すべての認証は HTTP ヘッダー `Authorization: Bearer <TOKEN>` で送ります。

- **API キー（`lrk_...`）を使う操作**：Source 予約、ジョブ作成、保存 Project 操作、ジョブ用トークンの再発行（`job-tickets`）、SVG 再試行
  - `render:create`：ジョブ作成、Project の作成・改名・削除・改訂保存
  - `render:read:own`：自分のジョブ用短時間トークンの更新、Project と履歴の閲覧
  - `render:project:read`：同じ利用者が所有するProjectの保存版で、ファイル一覧とUTF-8の本文を読む。キー発行時に明示的に選択する。
  - `render:draft:read` — 共有下書きの一覧と本文を読む。
  - `render:draft:write` — 共有下書きを開き、編集・保存する。
  - `render:pdf:inspect` — そのキーが所有するJobのPDF品質検査を要求し、結果を読む。
- **短時間トークン（`uploadTicket` / `jobTicket`）を使う操作**：ZIP アップロード、ジョブの状態取得・キャンセル・成果物取得・削除

> [!WARNING]
> API キー、`uploadTicket`、`jobTicket` をログ、URL クエリ、送信するソース ZIP 内に含めないでください。

> [!NOTE]
API キーで作成した Job は、そのキーにひも付きます。管理画面でキーをローテーションすると、交換先のキーで既存 Job のチケット更新、同じ `Idempotency-Key` での応答再取得、SVG 再試行ができます。交換元のキーと発行済みチケットは失効します。新しいキーに描画権限があれば、受付済みの待機 Job はそのまま進みます。この引き継ぎは対応版を導入した後のローテーションから適用されます。

独立して発行したキーから既存 Job を操作すると、同じ Service Account 内でも `404` が返ります。漏えい時はキーを失効させてください。Source と保存 Project は同じユーザー内で共有されるため、別キーでも共有 Source から新しい Job を作れます。保存版の履歴に `detailAccess: "different_connection"` がある Job は、その接続からは詳細を開けません。

## APIエンドポイント

| メソッド | パス | 用途 |
| --- | --- | --- |
| `GET` / `HEAD` | `/api/v1/health` | Gateway の応答を確認（認証不要。HEAD は本文なし） |
| `GET` | `/api/v1/source-tickets` | 描画用APIキーで現在のZIP上限を取得 |
| `POST` | `/api/v1/source-tickets` | Source を予約、または同一ユーザー内で既存 ZIP を再利用 |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Source ZIP を検証してアップロード |
| `POST` | `/api/v1/render-tickets` | 既存 Source から Job 作成、SVG 再試行、または 1 ジョブ従来フローの予約 |
| `POST` | `/api/v1/job-tickets/{jobId}` | 所有ジョブの操作用 `jobTicket` を再発行 |
| `PUT` | `/api/v1/jobs/{jobId}/source` | 1 ジョブ従来フローで ZIP を直接アップロード |
| `GET` | `/api/v1/jobs/{jobId}` | ジョブの状態とエラー情報を取得 |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | 待機中または処理中のジョブを中止 |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF、ログ、構造化エラー、SVG を取得 |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | `page-N.png` のページプレビューを取得 |
| `DELETE` | `/api/v1/jobs/{jobId}` | 終了済みジョブを削除対象へ移行 |
| `GET` / `POST` | `/api/v1/projects` | 保存 Project の一覧取得 / 新規作成 |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Project の詳細・改訂履歴 / 改名 / 削除（非表示化） |
| `GET` | `/api/v1/projects/{projectId}/draft` | 共有下書きの版とファイル一覧を取得 |
| `GET` | `/api/v1/projects/{projectId}/draft/file` | 指定版の本文を分割取得 |
| `POST` | `/api/v1/projects/{projectId}/draft/open` | 共有下書きを開く |
| `POST` | `/api/v1/projects/{projectId}/draft/changes` | 指定版に変更をまとめて適用 |
| `POST` | `/api/v1/projects/{projectId}/draft/save` | 共有下書きを保存版に保存 |
| `GET` / `POST` | `/api/v1/job-tickets/{jobId}/pdf-inspection` | 指定したPDFの品質検査を取得、または要求 |
| `POST` | `/api/v1/projects/{projectId}/revisions` | ready Source を不変の改訂として保存 |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | 指定した改訂の Job 履歴を取得 |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/files` | 保存版のファイル一覧を取得。 `path` を指定すると本文を取得 |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | 指定した改訂を再レンダリング |

> [!DETAILS] 保存 Project API と保守モード時の挙動を表示
>
> - **保存 Project のパラメータ**：一覧・詳細・Job 履歴は `cursor` と `pageSize` でページングします。改訂保存（`POST .../revisions`）には `sourceId`、`entrypoint`（相対 `.tex` パス）、`displayName`、`originalFilename`、`outputs` を送り、同一 Project・Source・entrypoint なら既存改訂を再利用します。改訂のレンダリング（`POST .../render`）には `Idempotency-Key`（16〜200 文字）が必須で、`outputs` 省略時はその改訂の初回設定を使います。
> - **保守モード時の制限**：
>   - `reject-new-jobs`：Project の閲覧・改名・削除・改訂保存と Source 準備は可能ですが、新規 Job 作成は拒否されます。
>   - `read-only` / `lockdown`：Project 変更に加え、Source の予約・アップロード・改訂・参照作成もすべて拒否されます（予約済みアップロードも公開直前に保守モードを再確認し、変更されていれば完成扱いにしません）。

## ジョブ作成

### 方法 1：Source を準備してからジョブを作る（推奨・再利用対応）

1. Source を予約します。

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"size":12345,"sha256":"64文字の小文字16進値"}
```

2. `uploadRequired: true` の場合のみ、ZIP をアップロードします（予約時のサイズ・SHA-256 と完全一致が必要。成功時は HTTP `204`）。

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIPサイズ>
```

3. ready になった `sourceId` からジョブを作成します（`entrypoint` 省略時は `main.tex`、`outputs` 省略時は `["pdf"]` のみ。`["svg"]` 単独指定は不可）。

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

応答（ZIP アップロード済みのため `uploadTicket` / `uploadUrl` は含まれません）：

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### 方法 2：1 ジョブ用の従来フロー（予約とアップロードを直結）

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"size":12345,"sha256":"64文字の小文字16進値","outputs":["pdf","svg"]}
```

応答に含まれる `uploadUrl`（`/api/v1/jobs/{jobId}/source`）へ、`uploadTicket` を使って ZIP を `PUT` 送信します（成功時は HTTP `204`）。

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Source の保持期限と Idempotency-Key の詳細仕様を表示
>
> - **孤立 Source と参照保持**：どの Job（`deleted` / `expired` 以外。終了済み Job も含む）にも有効な Project 改訂にも参照されない ready Source は既定 1 時間（管理画面の `source_orphan_retention_minutes` で 5 分〜24 時間に変更可）で cleanup されます。有効な Job または改訂から参照されている間は、この孤立期限を過ぎても保持・再利用できます（最後の参照が消えた時点で期限切れなら利用不可・cleanup 対象になります。参照によってアップロード途中・削除中の Source が ready に戻ることはありません）。
> - **`expiresAt` の意味**：アップロード前は「未完了予約の期限（10 分）」、ready 後は「参照がない場合の孤立期限」を表します（参照保持を含めた一律の期限ではありません）。この判定は Web・HTTP API・MCP で共通です（MCP の `sourceRef` は最大 15 分で、Source 自体の保持は延長しません）。
> - **`Idempotency-Key` の扱い**：同一 ZIP 再利用時のキーは受付から 24 時間記録されます（再送で延長なし）。有効期間中に同じキーを別内容へ使うと `409`、元 Source が期限切れなら `410`、削除済みなら `404`、アップロード進行中なら `409` になります。24 時間を過ぎたキーは定期 cleanup を待たず再利用できますが、元 Source を復活させることはありません。

### PDFの先行公開とSVGの再試行

Web・CLI での操作手順は[PDF・PNG・SVG を取得する](/docs/outputs/)を参照してください。

- **PDF の先行取得と `stages`**：PDF＋SVG ジョブでは、SVG 完了前でも検証済み PDF とプレビューを取得できます。Job 全体の `status` は全要求の成否を表し、`stages.pdf`（`sha256` 含む）と `stages.svg`（`attempt` 含む）に個別の状態・完了時刻・エラーが返ります（旧版の Job に推測で追加されることはありません）。
- **SVG だけの再試行**：`POST /api/v1/render-tickets` に API キー認証（`jobTicket` 不可）で `{"retrySvgJobId":"job_..."}` と `Idempotency-Key` を送ります。元の `jobTicket` が返り、PDF の再コンパイルや保持期限の延長をせずに SVG 抽出だけを再実行します（元 Source・PDF・Runtime が一致する場合に初回含め最大 8 回。SVG 専用診断は `svg/compile.log`・`svg/errors.json`・`svg/dependencies.json`）。

> [!DETAILS] `svg/manifest.json`（schemaVersion: 2）の座標・スキーマ仕様を表示
>
> 抽出された SVG は `svg/objects/math-NNNNNN.svg` または `tikz-NNNNNN.svg`（`Content-Type: image/svg+xml`、`Content-Disposition: attachment`。個数不一致や外部参照・script・イベント属性等の能動コンテンツがあれば Job 全体を失敗させます）として保存され、`svg/manifest.json`（新規出力は常に `schemaVersion: 2`、旧 `1` の読み取りも互換維持）で対応付けます。
>
> - **座標系（`coordinateSystem`）**：`id` と `page` は 1 始まり。単位は PDF point（$1/72\text{ inch}$）、原点はページ左上、x 軸は右向き、y 軸は下向きです。
> - **位置が特定できた場合（`placementStatus: "known"`）**：
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
> - **位置を確定できない場合（`placementStatus: "unknown"`）**：同一行に複数の数式があり SyncTeX から個別座標を確定できない場合などは推測座標を返さず、`page`・`x`・`y` を省略します（このときの `width`・`height` は抽出 SVG 自体の寸法であり、PDF 上の配置サイズではありません）。クライアントは必ず `schemaVersion` と `placementStatus` を確認してから PDF 上へ重ねてください。
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## ZIPアップロード

1 ジョブ従来フローで予約したジョブに ZIP を送るエンドポイントです（Source 分離フローでは `PUT /api/v1/sources/{sourceId}/content` を使用します）。

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIPサイズ>
```

## ジョブ状態

| 状態 | 意味 | クライアントの対応 |
| --- | --- | --- |
| `reserved` / `uploading` | 予約済み・アップロード中 | 期限内に ZIP を送信 |
| `queued` / `validating` / `running` | 待機・検証・変換中 | 間隔を空けて状態を再確認 |
| `succeeded` | 成功 | PDF と必要な成果物を取得 |
| `failed` / `timeout` / `rejected` | 失敗・時間超過・受付拒否 | エラー情報を確認 |
| `canceled` | キャンセル済み | 必要なら新しいジョブを作成 |
| `deleting` / `deleted` / `expired` | 削除中・削除済み・期限切れ | 必要なら再作成 |

**成果物の保持期限とダウンロード中の保護**：
完了時刻（旧 Job で未記録なら更新時刻）から `ARTIFACT_RETENTION_HOURS`（既定 24 時間）を過ぎると、cleanup 待ちで実ファイルが残っていても新規取得はできません（Web・API・Renderer・Remote MCP 共通）。期限内に開始されたダウンロード・ZIP 取得・MCP 読み取りは転送中のみ削除防止の予約を自動更新し、終了・切断時に解放します（異常終了時は最終更新から 5 分で失効。予約更新に失敗した転送は中止され、期限切れ成果物を復活させることはありません）。

## 共通エラー

```json
{ "error": { "code": "ERROR_CODE", "message": "説明", "requestId": "任意" } }
```

| HTTP ステータス | 意味 | 再試行の目安 |
| --- | --- | --- |
| `400` | 入力値、ヘッダー、または ZIP 内容が不正 | 入力内容を修正してから実行 |
| `401` / `403` | トークン不正・期限切れ、またはスコープ不足 | 資格情報・権限を確認後に実行 |
| `404` / `410` | ジョブ・成果物なし（別キー所有を含む）、または元データ期限切れ | 必要なら新規ジョブを作成 |
| `409` | ジョブ状態の不整合、または `Idempotency-Key` の競合 | 現在の状態を確認後に判断 |
| `429` / `503` | レート制限・容量不足・キュー上限・メンテナンス中 | 時間を置いて再試行可 |

## curlの例

Linux の Bash で、`source.zip` があるフォルダから予約・送信・2 秒間隔（最大 60 回）の待機・PDF 保存までを行う完全な例です（要 `curl`・`jq`・`sha256sum`・`uuidgen`。セルフホストの場合は `base` を変更してください）。

> [!DETAILS] ZIP を送信して PDF を取得する例を表示
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

60 回確認しても待機中の場合は、表示された `jobId` で後から同じジョブを確認してください（`jobTicket` が期限切れになった場合は、作成時と同じ API キーで `POST /api/v1/job-tickets/{jobId}` を呼んで再取得します）。以下の各言語サンプルはジョブ予約と ZIP 送信までを示します。

## PowerShell

> [!DETAILS] PowerShell の例を表示
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

## JavaScript / TypeScript

> [!DETAILS] JavaScript / TypeScript の例を表示
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

## Python

> [!DETAILS] Python の例を表示
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
