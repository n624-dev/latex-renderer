---
slug: api
category: API
title: 公開API
description: Source共有、ジョブ作成、ZIPアップロード、状態確認、成果物取得をHTTPから行います。
navOrder: 70
updated: "2026-08-18"
since: "v1.0.0"
---

## 利用の流れ

1. ZIPのバイト数とSHA-256を計算し、Sourceを予約します。
2. 必要な場合だけ、返されたURLへZIPをアップロードします。
3. Sourceとエントリポイントを指定してジョブを作成します。
4. ジョブ状態を確認し、成果物を取得します。

[ジョブ作成API仕様](/openapi/gateway.openapi.yaml) / [アップロード・結果取得API仕様](/openapi/renderer.openapi.yaml)

## 認証とスコープ

ジョブ作成と操作用トークン更新はAPIキー、アップロードとジョブ操作は応答で返された短時間トークンをBearer認証で送ります。

```http
Authorization: Bearer <TOKEN>
```

- `render:create`：ジョブ作成
- `render:read:own`：自分のジョブ用短時間トークンの更新

> [!WARNING]
> APIキー、uploadTicket、jobTicketをログ、URL、ソースZIPへ含めないでください。

## APIエンドポイント

| メソッド | パス                                    | 用途                                                                 |
| -------- | --------------------------------------- | -------------------------------------------------------------------- |
| POST     | `/api/v1/render-tickets`                | 既存SourceからJobを作成、または従来フローのJobとuploadTicket等を作成 |
| POST     | `/api/v1/source-tickets`                | Sourceを予約または同一ユーザー内で再利用                             |
| PUT      | `/api/v1/sources/{sourceId}/content`    | Source ZIPを検証してアップロード                                     |
| POST     | `/api/v1/job-tickets/{jobId}`           | 所有ジョブの操作用トークンを更新                                     |
| PUT      | `/api/v1/jobs/{jobId}/source`           | ZIPを直接Renderer APIへアップロード                                  |
| GET      | `/api/v1/jobs/{jobId}`                  | 状態とエラーを取得                                                   |
| POST     | `/api/v1/jobs/{jobId}/cancel`           | 待機中または処理中のジョブを中止                                     |
| GET      | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF、ログ、構造化エラー、SVGを取得                                   |
| GET      | `/api/v1/jobs/{jobId}/previews/{page}`  | `page-N.png` のページプレビューを取得                                |
| DELETE   | `/api/v1/jobs/{jobId}`                  | 終了済みジョブを削除対象へ移行                                       |

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
Jobから参照されないready Sourceは初期値1時間でcleanupされ、管理画面の `source_orphan_retention_minutes`（5分〜24時間）で保持時間を変更できます。

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

SVG出力は `svg/objects/math-NNNNNN.svg` または `tikz-NNNNNN.svg` として保存され、`svg/manifest.json` が実行順、ソースファイル・行、PDFページ上の座標を対応付けます。各オブジェクトは次の形式です。

```json
{
  "id": 1,
  "kind": "math",
  "artifact": "svg/objects/math-000001.svg",
  "sourceFile": "chapters/formula.tex",
  "sourceLine": 18,
  "page": 2,
  "x": 123.4,
  "y": 85.2,
  "width": 210.6,
  "height": 32.8
}
```

`id` は文書の実行順に1から始まります。`page` も1始まりです。座標単位はPDF point（1/72 inch）、原点はページ左上、x軸は右向き、y軸は下向きで、`x`・`y`・`width`・`height` は `result.pdf` 上の描画範囲を表します。この規約はmanifest直下の `coordinateSystem` にも記録されます。

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

```bash
SIZE=$(wc -c < source.zip)
SHA=$(sha256sum source.zip | cut -d' ' -f1)
curl -sS -X POST https://latex-render.n624.jp/api/v1/render-tickets \
  -H "Authorization: Bearer $LATEX_RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"size":'$SIZE',"sha256":"'$SHA'"}'
```

## PowerShell

```powershell
$zip = Resolve-Path .\source.zip
$bytes = [IO.File]::ReadAllBytes($zip)
$sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
$headers = @{
  Authorization = "Bearer $env:LATEX_RENDER_API_KEY"
  "Idempotency-Key" = [guid]::NewGuid().ToString()
}
$ticket = Invoke-RestMethod -Method Post `
  -Uri https://latex-render.n624.jp/api/v1/render-tickets `
  -Headers $headers -ContentType application/json `
  -Body (@{size=$bytes.Length;sha256=$sha} | ConvertTo-Json)
Invoke-WebRequest -Method Put -Uri $ticket.uploadUrl `
  -Headers @{Authorization="Bearer $($ticket.uploadTicket)"} `
  -ContentType application/zip -InFile $zip
```

## JavaScript / TypeScript

```typescript
const zip = await readFile("source.zip");
const sha256 = createHash("sha256").update(zip).digest("hex");
const response = await fetch(
  "https://latex-render.n624.jp/api/v1/render-tickets",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.LATEX_RENDER_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ size: zip.length, sha256 }),
  },
);
const ticket = await response.json();
await fetch(ticket.uploadUrl, {
  method: "PUT",
  headers: {
    Authorization: "Bearer " + ticket.uploadTicket,
    "Content-Type": "application/zip",
  },
  body: zip,
});
```

## Python

```python
data = pathlib.Path("source.zip").read_bytes()
headers = {
    "Authorization": "Bearer " + os.environ["LATEX_RENDER_API_KEY"],
    "Idempotency-Key": str(uuid.uuid4()),
}
ticket = requests.post(
    "https://latex-render.n624.jp/api/v1/render-tickets",
    headers=headers,
    json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
).json()
requests.put(
    ticket["uploadUrl"],
    headers={
        "Authorization": "Bearer " + ticket["uploadTicket"],
        "Content-Type": "application/zip",
    },
    data=data,
).raise_for_status()
```
