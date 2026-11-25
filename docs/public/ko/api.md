---
slug: api
category: API
title: 공개 API
description: HTTP로 ZIP을 업로드하고 변환 상태를 확인한 뒤 PDF를 받습니다.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## 사용 흐름 {#利用の流れ}

렌더링 API 키(`lrk_...`)와 [지원 형식의 ZIP](/ko/docs/projects/#構成)을 준비합니다. 바로 시험하려면 아래 [curl 예제](#curlの例)를 참고하세요.

1. **소스 예약.** 로컬에서 ZIP의 바이트 크기와 SHA-256을 구한 뒤 `POST /api/v1/source-tickets`로 입력 묶음인 소스(Source)를 예약합니다.
2. **ZIP 업로드.** 응답의 `uploadRequired`가 `true`일 때만 반환된 URL과 단기 `uploadTicket`으로 `PUT` 요청을 보냅니다. 같은 사용자가 이미 같은 유효한 ZIP을 보유하고 있다면 재사용합니다.
3. **작업 생성.** 준비된 `sourceId`와 본문 상대 경로(`entrypoint`)를 지정하여 `POST /api/v1/render-tickets`로 작업을 만듭니다. 일회성 변환에는 1~3단계를 합친 [기존 흐름](#ジョブ作成)도 사용할 수 있습니다.
4. **상태 조회 및 결과 다운로드.** 반환된 단기 `jobTicket`으로 `GET /api/v1/jobs/{jobId}`를 주기적으로 조회하고 완료되면 PDF 등의 결과를 받습니다.

OpenAPI 정의는 [예약과 작업 생성(gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) 및 [업로드와 결과 조회(renderer.openapi.yaml)](/openapi/renderer.openapi.yaml)를 참고하세요.

## 인증과 권한 범위 {#認証とスコープ}

모든 인증 정보는 HTTP 헤더 `Authorization: Bearer <TOKEN>`로 보냅니다.

- **API 키(`lrk_...`) 사용.** 소스 예약, 작업 생성, 저장 프로젝트 관리, 작업 토큰 재발행(`job-tickets`), SVG 재시도에 사용합니다.
  - `render:create`는 작업 생성, 프로젝트 생성·이름 변경·삭제 및 버전 저장을 허용합니다.
  - `render:read:own`는 자신의 작업을 위한 단기 토큰 갱신 및 프로젝트와 기록 조회를 허용합니다.
- **단기 토큰(`uploadTicket`, `jobTicket`) 사용.** ZIP 업로드, 작업 상태 조회, 취소, 결과 다운로드 및 삭제에 사용합니다.

> [!WARNING]
> API 키, `uploadTicket` 및 `jobTicket`을 로그, URL 쿼리 또는 업로드할 소스 ZIP에 포함하지 마세요.

> [!NOTE]
> **작업은 생성한 API 키에 귀속됩니다.** 같은 사용자나 같은 서비스 계정의 다른 키로 기존 작업의 `job-tickets` 갱신, 같은 `Idempotency-Key`를 사용한 생성 응답 재조회 또는 SVG 재시도를 요청하면 `404`가 반환됩니다. 원래 키를 폐기해도 소유권이 넘어가지는 않습니다. 소스와 저장 프로젝트는 같은 사용자 안에서 공유되므로 다른 키와 새 `Idempotency-Key`로 공유 소스에서 **새 작업**을 만들 수 있습니다.

## API 엔드포인트 {#apiエンドポイント}

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | 소스 예약 또는 같은 사용자의 기존 ZIP 재사용 |
| `PUT` | `/api/v1/sources/{sourceId}/content` | 소스 ZIP 업로드 및 검증 |
| `POST` | `/api/v1/render-tickets` | 기존 소스에서 작업 생성, SVG 재시도 또는 기존 단일 작업 흐름 예약 |
| `POST` | `/api/v1/job-tickets/{jobId}` | 소유 작업의 `jobTicket` 재발행 |
| `PUT` | `/api/v1/jobs/{jobId}/source` | 기존 단일 작업 흐름에서 ZIP 직접 업로드 |
| `GET` | `/api/v1/jobs/{jobId}` | 작업 상태 및 오류 정보 조회 |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | 대기 또는 처리 중인 작업 취소 |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF, 로그, 구조화된 오류 및 SVG 조회 |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | `page-N.png` 페이지 미리 보기 조회 |
| `DELETE` | `/api/v1/jobs/{jobId}` | 종료된 작업을 삭제 대상으로 전환 |
| `GET` / `POST` | `/api/v1/projects` | 저장 프로젝트 목록 조회 또는 생성 |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | 프로젝트 상세 및 버전 기록 조회, 이름 변경 또는 삭제(기록 숨김) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | 준비된 소스를 변경 불가능한 버전으로 저장 |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | 특정 버전의 작업 기록 조회 |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | 특정 버전 다시 렌더링 |

> [!DETAILS] 저장 프로젝트 API와 유지보수 모드
>
> - **프로젝트 매개변수.** 목록, 상세 정보 및 작업 기록은 `cursor`와 `pageSize`로 페이지를 나눕니다. 버전 저장(`POST .../revisions`)에는 `sourceId`, `entrypoint`(상대 `.tex` 경로), `displayName`, `originalFilename`, `outputs`를 보냅니다. 프로젝트·소스·진입점이 같으면 기존 버전을 재사용합니다. 버전 렌더링(`POST .../render`)에는 16~200자의 `Idempotency-Key`가 필수이며 `outputs`을 생략하면 해당 버전의 초기 설정을 사용합니다.
> - **유지보수 제한**
>   - `reject-new-jobs`에서는 프로젝트 조회·이름 변경·삭제·버전 저장 및 소스 준비가 가능하며 새 작업은 거부합니다.
>   - `read-only`와 `lockdown`에서는 프로젝트 변경뿐 아니라 소스 예약·업로드·버전 및 참조 생성도 거부합니다. 예약된 업로드도 공개 직전에 유지보수 모드를 다시 확인하며 금지된 상태로 변경됐다면 완료 처리하지 않습니다.

## 작업 만들기 {#ジョブ作成}

### 방법 1. 재사용할 소스를 먼저 준비하고 작업 생성(권장) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. 소스를 예약합니다.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. `uploadRequired: true`일 때만 ZIP을 업로드합니다. 예약한 크기 및 SHA-256과 정확히 일치해야 하며 성공 시 HTTP `204`를 반환합니다.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. 준비된 `sourceId`에서 작업을 생성합니다. `entrypoint`의 기본값은 `main.tex`, `outputs`의 기본값은 `["pdf"]`이며 `["svg"]`만 단독으로 요청할 수 없습니다.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

ZIP이 이미 업로드되어 있으므로 응답에 `uploadTicket`이나 `uploadUrl`이 포함되지 않습니다.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### 방법 2. 단일 작업용 기존 흐름으로 예약 후 업로드 {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

반환된 `uploadUrl`(`/api/v1/jobs/{jobId}/source`)에 `uploadTicket`을 사용해 ZIP을 `PUT`로 보냅니다. 성공 시 HTTP `204`를 반환합니다.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] 소스 보관 기한과 Idempotency-Key
>
> - **고립 소스와 참조 보호.** 유효한 프로젝트 버전이나 작업에서 참조하지 않는 준비 상태 소스는 기본 1시간 후 정리됩니다. 종료된 작업도 참조에 포함되며 `deleted` 또는 `expired`인 작업은 제외됩니다. 관리자는 `source_orphan_retention_minutes`를 5분~24시간으로 설정할 수 있습니다. 참조가 남아 있으면 고립 기한을 지나도 보존 및 재사용할 수 있습니다. 마지막 참조가 사라질 때 이미 기한을 넘겼다면 사용 불가 및 정리 대상이 됩니다. 참조를 만들어도 업로드 중이거나 삭제 중인 소스가 준비 상태로 돌아가지는 않습니다.
> - **`expiresAt`의 의미.** 업로드 전에는 미완료 예약의 만료 시각(10분), 준비 후에는 참조가 없을 경우의 고립 기한입니다. 웹, HTTP API 및 MCP가 같은 기준을 사용합니다. MCP `sourceRef`는 최대 15분간 유효하며 소스 자체의 보관을 연장하지 않습니다.
> - **`Idempotency-Key`의 처리.** 같은 ZIP을 재사용할 때 키는 접수 후 24시간 기록되며 재전송해도 늘어나지 않습니다. 유효 기간에 다른 내용으로 같은 키를 사용하면 `409`, 원본 소스가 만료됐으면 `410`, 삭제됐으면 `404`, 업로드 중이면 `409`를 반환합니다. 24시간 후에는 정기 정리를 기다리지 않고 키를 재사용할 수 있지만 원본 소스는 복원되지 않습니다.

### PDF 조기 제공과 SVG 재시도 {#pdfの先行公開とsvgの再試行}

웹과 CLI 사용 절차는 [PDF, PNG, SVG 받기](/ko/docs/outputs/)를 참고하세요.

- **PDF 먼저 받기 및 `stages`.** PDF와 SVG를 요청한 작업은 SVG 완료 전 검증된 PDF와 미리 보기를 받을 수 있습니다. 전체 `status`는 요청한 모든 출력의 결과이며 `stages.pdf`(`sha256` 포함)와 `stages.svg`(`attempt` 포함)에 단계별 상태, 완료 시각, 오류가 담깁니다. 이전 작업의 정보를 추정하여 추가하지 않습니다.
- **SVG만 재시도.** `POST /api/v1/render-tickets`에 API 키로 인증하여(`jobTicket` 인증 불가) `{"retrySvgJobId":"job_..."}`와 `Idempotency-Key`를 보냅니다. 원래 `jobTicket`이 반환되며 PDF를 재컴파일하거나 보관 기한을 늘리지 않고 SVG만 다시 추출합니다. 원본 소스·PDF·런타임이 일치하면 최초 시도를 포함해 최대 8회입니다. SVG 전용 진단은 `svg/compile.log`, `svg/errors.json`, `svg/dependencies.json`에 있습니다.

> [!DETAILS] `svg/manifest.json` 좌표 및 스키마(schemaVersion 2)
>
> 추출된 SVG는 `svg/objects/math-NNNNNN.svg` 또는 `tikz-NNNNNN.svg`로 저장하며 응답은 `Content-Type: image/svg+xml`와 `Content-Disposition: attachment`을 사용합니다. 개수가 일치하지 않거나 외부 참조·스크립트·이벤트 속성 등 능동 콘텐츠가 있으면 작업 전체가 실패합니다. 대응 정보는 `svg/manifest.json`에 있습니다. 신규 출력은 항상 `schemaVersion: 2`이며 기존 `1` 읽기도 지원합니다.
>
> - **좌표계(`coordinateSystem`).** `id`와 `page`는 1부터 시작합니다. 단위는 PDF 포인트(1/72인치)이며 원점은 페이지 왼쪽 위, x축은 오른쪽, y축은 아래쪽입니다.
> - **위치를 확인한 경우(`placementStatus: "known"`)**
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
> - **위치를 확정할 수 없는 경우(`placementStatus: "unknown"`).** 같은 줄의 여러 수식을 SyncTeX로 구별할 수 없는 경우 등에는 위치를 추측하지 않고 `page`, `x`, `y`를 생략합니다. 이때 `width`와 `height`는 추출한 SVG 자체의 크기입니다. PDF에 겹쳐 표시하기 전에 항상 `schemaVersion`과 `placementStatus`를 확인하세요.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## ZIP 업로드 {#zipアップロード}

기존 단일 작업 흐름에서 예약한 작업에 ZIP을 보내는 엔드포인트입니다. 소스를 먼저 준비하는 흐름에서는 `PUT /api/v1/sources/{sourceId}/content`를 사용합니다.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## 작업 상태 {#ジョブ状態}

| 상태 | 의미 | 클라이언트 처리 |
| --- | --- | --- |
| `reserved` / `uploading` | 예약됨 또는 업로드 중 | 기한 내 ZIP 전송 |
| `queued` / `validating` / `running` | 대기·검증·변환 중 | 간격을 두고 상태 조회 |
| `succeeded` | 성공 | PDF 및 필요한 결과 파일 받기 |
| `failed` / `timeout` / `rejected` | 실패, 시간 초과 또는 거부 | 오류 정보 확인 |
| `canceled` | 취소됨 | 필요하면 새 작업 생성 |
| `deleting` / `deleted` / `expired` | 삭제 중, 삭제됨 또는 만료됨 | 필요하면 새로 생성 |

**결과 보관 기한과 전송 중 보호**
완료 시각(이전 작업에 기록이 없으면 업데이트 시각)부터 `ARTIFACT_RETENTION_HOURS`(기본 24시간)가 지나면 정리 전이라 파일이 남아 있어도 새로 받을 수 없습니다. 웹, API, 렌더러, Remote MCP 모두에 적용됩니다. 기한 안에 시작한 다운로드, ZIP 조회, MCP 읽기는 전송 중에만 삭제 방지 예약을 자동 갱신하고 완료·연결 해제 시 해제합니다. 비정상 종료 시 마지막 갱신 후 5분에 만료됩니다. 예약 갱신에 실패하면 전송을 중단하며 만료된 결과를 되살리지 않습니다.

## 공통 오류 {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP 상태 | 의미 | 재시도 기준 |
| --- | --- | --- |
| `400` | 잘못된 입력값, 헤더 또는 ZIP 내용 | 입력 수정 후 실행 |
| `401` / `403` | 토큰이 잘못됐거나 만료됨, 또는 범위 부족 | 자격 증명과 권한 확인 |
| `404` / `410` | 작업이나 결과 없음(다른 키가 소유한 경우 포함), 또는 원본 데이터 만료 | 필요하면 새 작업 생성 |
| `409` | 작업 상태 불일치 또는 `Idempotency-Key` 충돌 | 현재 상태를 확인한 뒤 결정 |
| `429` / `503` | 속도 제한, 용량 부족, 큐 포화 또는 유지보수 | 잠시 뒤 재시도 |

## curl 예제 {#curlの例}

다음 Linux Bash 예제는 `source.zip`가 있는 폴더에서 예약, 업로드, 2초 간격 상태 확인(최대 60회), PDF 저장까지 수행합니다. `curl`, `jq`, `sha256sum`, `uuidgen`가 필요합니다. 자체 호스팅이면 `base`를 변경하세요.

> [!DETAILS] ZIP을 업로드하고 PDF 내려받기
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

60번 확인한 뒤에도 대기 중이면 표시된 `jobId`로 나중에 같은 작업을 조회합니다. `jobTicket`이 만료됐다면 원래 API 키로 `POST /api/v1/job-tickets/{jobId}`를 호출해 새로 받습니다. 아래 언어별 예제는 작업 예약과 ZIP 업로드까지 보여 줍니다.

## PowerShell {#powershell}

> [!DETAILS] PowerShell 예제
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

> [!DETAILS] JavaScript / TypeScript 예제
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

> [!DETAILS] Python 예제
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
