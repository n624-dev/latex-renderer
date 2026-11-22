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

HTTP API を使うには、レンダリング用 API キー（`lrk_`）と、本文や画像をまとめた ZIP が必要です。初めて試す場合は[ZIP の作り方](/docs/projects/#構成)に従って `main.tex` を含む ZIP を作り、[curl の例](#curlの例)で PDF を取得できます。

1. ZIP のサイズと SHA-256 を計算し、Source（変換に使う入力ファイル一式）を予約します。
2. アップロードが必要な場合は、応答に含まれる URL とアップロード用トークンで ZIP を送ります。
3. 準備できた Source の ID と変換する本文のパスから、ジョブを作ります。
4. ジョブ用トークンで状態を確認し、成果物を取得します。

同じ ZIP から複数文書を作る場合は Source を再利用できます。1 回の変換には、[ジョブ作成と同時に ZIP を予約する方法](#ジョブ作成)も使えます。

[予約とジョブ作成の OpenAPI](/openapi/gateway.openapi.yaml) · [アップロードと結果取得の OpenAPI](/openapi/renderer.openapi.yaml)

## 認証とスコープ

ジョブ作成、保存Project操作、操作用トークン更新はAPIキー、アップロードとジョブ操作は応答で返された短時間トークンをBearer認証で送ります。同じユーザーが所有する別のAPIキー／Service Accountは同じ保存Projectを扱えます。他のユーザーには公開されません。

APIキーで作成したJobの操作用トークンは、作成時のAPIキーに固定されます。同じService Accountの別キーでも、既存Jobのチケット更新・同じ `Idempotency-Key` による作成応答の再取得・SVG再試行は404で拒否されます。元のキーが失効しても別キーへ所有権は移りません。Source・保存Projectの同一ユーザー内共有は別の仕組みであり、共有Sourceから別キーで新しいJobを作成することはできます。その場合は新しい `Idempotency-Key` を使ってください。

```http
Authorization: Bearer <TOKEN>
```

- `render:create`：ジョブ作成、Project作成・改名・削除・改訂保存
- `render:read:own`：自分のジョブ用短時間トークンの更新、Projectと履歴の閲覧

> [!WARNING]
> APIキー、uploadTicket、jobTicketをログ、URL、ソースZIPへ含めないでください。

## APIエンドポイント

| メソッド | パス                                                         | 用途                                                                 |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| POST     | `/api/v1/render-tickets`                                     | 既存SourceからJobを作成、または従来フローのJobとuploadTicket等を作成 |
| POST     | `/api/v1/source-tickets`                                     | Sourceを予約または同一ユーザー内で再利用                             |
| GET      | `/api/v1/projects`                                           | 保存Projectの一覧                                                    |
| POST     | `/api/v1/projects`                                           | 保存Projectの作成                                                    |
| GET      | `/api/v1/projects/{projectId}`                               | Projectの詳細・改訂履歴                                              |
| PATCH    | `/api/v1/projects/{projectId}`                               | Projectの改名                                                        |
| DELETE   | `/api/v1/projects/{projectId}`                               | Projectの削除                                                        |
| POST     | `/api/v1/projects/{projectId}/revisions`                     | ready Sourceを不変の改訂として保存                                   |
| GET      | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs`   | 改訂のJob履歴を取得                                                  |
| POST     | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | 指定した改訂を再レンダリング                                         |
| PUT      | `/api/v1/sources/{sourceId}/content`                         | Source ZIPを検証してアップロード                                     |
| POST     | `/api/v1/job-tickets/{jobId}`                                | 所有ジョブの操作用トークンを更新                                     |
| PUT      | `/api/v1/jobs/{jobId}/source`                                | ZIPを直接Renderer APIへアップロード                                  |
| GET      | `/api/v1/jobs/{jobId}`                                       | 状態とエラーを取得                                                   |
| POST     | `/api/v1/jobs/{jobId}/cancel`                                | 待機中または処理中のジョブを中止                                     |
| GET      | `/api/v1/jobs/{jobId}/artifacts/{path}`                      | PDF、ログ、構造化エラー、SVGを取得                                   |
| GET      | `/api/v1/jobs/{jobId}/previews/{page}`                       | `page-N.png` のページプレビューを取得                                |
| DELETE   | `/api/v1/jobs/{jobId}`                                       | 終了済みジョブを削除対象へ移行                                       |

Projectの一覧・詳細・Job履歴は `cursor` と `pageSize` でページングできます。改訂保存は `sourceId`、Source内の相対 `.tex` パスである `entrypoint`、`displayName`、`originalFilename`、`outputs` を送ります。同じProject・Source・entrypointなら改訂を再利用します。改訂のレンダリングは `Idempotency-Key`（16〜200文字）が必須で、本文の `outputs` を省略するとその改訂の初回設定を使います。返された固定の `projectId`／`revisionId` で履歴を参照してください。従来の一時的なSource→Jobフローも引き続き利用できます。

保守モードが `reject-new-jobs` の間はProjectの閲覧・改名・削除・改訂保存とSourceの準備は可能ですが、新しいJobは作成できません。`read-only` と `lockdown` ではProjectの変更に加え、Sourceの予約・アップロード・改訂・参照作成も拒否されます。予約済みのアップロードも公開直前に再確認し、保守モードが変更された場合は完成扱いにしません。Project削除は記録の非表示であり、SourceやJobの即時完全削除ではありません。

## ジョブ作成

複数のエントリポイントで同じZIPを使う場合は、先にSourceを1回だけアップロードします。

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"size":12345,"sha256":"64文字の小文字16進値"}
```

`uploadRequired` が `true` の場合だけ、次のURLへZIPを送ります。

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIPサイズ>
```

Sourceがreadyになったら、ZIP内に存在する相対 `.tex` パスを指定します。省略時は `main.tex` です。
Jobにも有効なProject改訂にも参照されないready Sourceは初期値1時間でcleanupされ、管理画面の `source_orphan_retention_minutes`（5分〜24時間）で保持時間を変更できます。
同じ所有者のJob（`deleted`・`expired`以外）または削除されていないProject改訂が保持するready Sourceは、この孤立時の期限を過ぎても再利用・再描画できます。終了済みJobも保持に含まれます。最後の参照がなくなると、期限を過ぎたSourceは利用できず、cleanup対象になります。参照によってアップロード途中・削除中のSourceがreadyへ戻ることはありません。

Source応答の `expiresAt` は、アップロード前なら予約の期限、readyなら参照がない場合の期限です。ready Sourceの保持期限を一律に表す値ではありません。同じZIPの再利用に対する `Idempotency-Key` は受付から24時間記録され、再送で延長されません。未完了アップロードの予約は従来どおり10分です。同じ有効キーを別の内容へ使うと409、元のSourceの期限切れは410、削除済みは404になります。アップロード等が進行中なら409で再開を拒否します。期限切れのキーは定期cleanupを待たず再利用できますが、元のSourceを復活させるものではありません。

この保持判定はWeb・HTTP API・MCPで共通です。MCPの重複アップロード開始・完了も保持済みready Sourceを使い、ZIPを書き換えません。MCPのSource参照は最大15分で、参照自体はSourceの保持を延長しません。未完了アップロードの期限・検証・同時書込み制御は引き続き適用されます。

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

`outputs` を省略すると従来どおりPDFだけを生成します。`["pdf","svg"]` を指定すると、PDFに加えて外側の数式と最上位のTikZ図を自己完結SVGとして抽出します。SVGだけの指定はできません。

既存SourceからJobを作成した場合のレスポンスは、Job操作に必要な値だけを返します。

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

このフローではZIPを再アップロードしないため、`uploadTicket` と `uploadUrl` は返りません。

従来の1ジョブ用フローも引き続き利用できます。

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16〜200文字>

{"size":12345,"sha256":"64文字の小文字16進値","outputs":["pdf","svg"]}
```

従来フローではJob予約と同時に、そのJobへZIPを送るための値を返します。

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

ZIP送信時は `Content-Length` と予約時のサイズ・SHA-256が一致する必要があります。正常時はHTTP 204です。

### PDFの先行公開とSVGの再試行

Web・CLI から操作する場合は[PDF・PNG・SVG の取得手順](/docs/outputs/)を参照してください。

新しいPDF＋SVGのJobは、検証済みPDFとプレビューをSVG完了前に取得できます。Jobの `status` は要求全体の成否のままです。任意項目 `stages.pdf` / `stages.svg` に個別の状態・完了時刻・エラーを返し、PDFには `sha256`、SVGには `attempt` も含めます。PDF成功・SVG失敗でもPDFは利用可能です。

SVGだけの再試行は `POST /api/v1/render-tickets` に `{"retrySvgJobId":"job_..."}` と `Idempotency-Key` を送信します。元のJob用ticketを返し、PDFの再コンパイルや保持期限の延長はしません。初回を含め最大8回で、元Source・PDF・Runtimeが一致する必要があります。認証には通常のAPIキーを使い、Job ticketでは再試行できません。SVG専用診断は `svg/compile.log`、`svg/errors.json`、`svg/dependencies.json` です。旧Jobには個別状態を推測して追加しません。

SVG出力は `svg/objects/math-NNNNNN.svg` または `tikz-NNNNNN.svg` として保存され、`svg/manifest.json` が実行順、ソースファイル・行、特定できた場合のPDFページ上の座標を対応付けます。新しいmanifestは `schemaVersion: 2` です。位置を特定できるオブジェクトは次の形式です。

```json
{
  "id": 1,
  "kind": "math",
  "artifact": "svg/objects/math-000001.svg",
  "sourceFile": "chapters/formula.tex",
  "sourceLine": 18,
  "placementStatus": "known",
  "page": 2,
  "x": 123.4,
  "y": 85.2,
  "width": 210.6,
  "height": 32.8
}
```

同じソース行の複数の数式など、SyncTeXから個々の位置を確定できない場合もSVG画像は生成しますが、推測座標は返しません。そのオブジェクトは `placementStatus: "unknown"` とし、`page`・`x`・`y` を省略します。例えば `{"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}` です。このとき `width`・`height` は抽出したSVG自体の寸法であり、PDF上の配置を意味しません。

`id` は文書の実行順に1から始まります。位置が既知なら `page` も1始まりです。座標単位はPDF point（1/72 inch）、原点はページ左上、x軸は右向き、y軸は下向きです。この規約はmanifest直下の `coordinateSystem` にも記録されます。クライアントは `schemaVersion` と `placementStatus` を確認してからPDF上へ重ねてください。既存の `schemaVersion: 1` 成果物の読取りは引き続き受け付けますが、新しい出力には常にバージョン2を使用します。

SVG取得時のContent-Typeは `image/svg+xml`、Content-Dispositionは `attachment` です。個数不一致、外部参照、scriptやイベント属性などの能動コンテンツがあればJob全体が失敗します。

## ZIPアップロード

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIPサイズ>
```

## ジョブ状態

| 状態                          | 意味                       | 利用者の対応               |
| ----------------------------- | -------------------------- | -------------------------- |
| reserved / uploading          | 予約済み・アップロード中   | 期限内にZIPを送信          |
| queued / validating / running | 待機・検証・変換中         | 間隔を空けて確認           |
| succeeded                     | 成功                       | PDFと必要な成果物を取得    |
| failed / timeout / rejected   | 失敗・時間超過・受付拒否   | エラー情報を確認           |
| canceled                      | キャンセル済み             | 必要なら新しいジョブを作成 |
| deleting / deleted / expired  | 削除中・削除済み・期限切れ | 必要なら再作成             |

通常は完了したジョブから成果物を取得します。PDF＋SVG では[先に確定した PDF](#pdfの先行公開とsvgの再試行)を取得できます。完了時刻（旧Jobで未記録なら更新時刻）から
`ARTIFACT_RETENTION_HOURS`（既定24時間）を過ぎると、実ファイルがcleanup待ちで残っていても
新規取得できません。Job応答・Admin/App・Renderer・Remote MCPで同じ期限を使います。
期限内に始まった直接ダウンロード・ZIP・MCP読み取りは、処理中だけ削除防止の予約を更新します。
終了/切断時に解放し、異常終了で残った予約は最後の更新から5分で失効します。
予約更新に失敗した転送は中止し、期限切れの成果物を自動で復活させません。

## 共通エラー

```json
{ "error": { "code": "ERROR_CODE", "message": "説明", "requestId": "任意" } }
```

| HTTP      | 意味                                 | 再試行         |
| --------- | ------------------------------------ | -------------- |
| 400       | 入力、ヘッダー、ZIPが不正            | 修正後         |
| 401 / 403 | トークン不正または権限不足           | 資格情報確認後 |
| 404 / 410 | ジョブ・成果物なし、元データ期限切れ | 必要なら再作成 |
| 409       | 状態またはIdempotency-Key競合        | 状態確認後     |
| 429 / 503 | 容量、キュー、メンテナンス           | 時間を置いて可 |

## curlの例

Linux の Bash で、`source.zip` があるフォルダから実行します。必要なコマンドは `curl`、`jq`、`sha256sum`、`uuidgen` です。キーは非表示で入力します。セルフホストの場合は `base` を使用するサーバーの HTTPS URL に変更してください。

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

この例は 2 秒間隔で最大 60 回、状態を確認します。まだ待機中なら、表示されたジョブ ID で後から同じジョブを確認してください。ジョブ用トークンが期限切れの場合は、作成時と同じ API キーで `POST /api/v1/job-tickets/{jobId}` を呼び、取得したトークンを使います。

他の言語の例は、ジョブの予約と ZIP の送信までを示します。その後は同様にジョブ用トークンで状態と成果物を取得してください。

## PowerShell

> [!DETAILS] PowerShellを表示
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

> [!DETAILS] JavaScript / TypeScriptを表示
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

> [!DETAILS] Pythonを表示
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
