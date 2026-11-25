---
slug: api
category: API
title: Публичный API
description: Отправьте ZIP по HTTP, проверьте состояние преобразования и скачайте PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Порядок работы {#利用の流れ}

Подготовьте ключ API рендеринга (`lrk_...`) и [совместимый ZIP-архив](/ru/docs/projects/#構成). Полный процесс можно проверить с помощью [примера с curl](#curlの例).

1. **Зарезервируйте исходники.** Вычислите размер ZIP в байтах и его SHA-256. Зарезервируйте набор файлов (Source) с помощью `POST /api/v1/source-tickets`.
2. **Загрузите ZIP.** Только если `uploadRequired` имеет значение `true`, отправьте ZIP по возвращённому URL с краткоживущим `uploadTicket` методом `PUT`. Если у того же пользователя уже есть действительный идентичный ZIP, он будет использован повторно.
3. **Создайте задание.** Передайте в запрос подготовленный `sourceId` и относительный путь к главному документу (`entrypoint`) на `POST /api/v1/render-tickets`. Для разовой операции также подходит [прежний порядок](#ジョブ作成), объединяющий шаги с 1 по 3.
4. **Проверьте состояние и скачайте результат.** Используйте краткоживущий `jobTicket` для периодического опроса `GET /api/v1/jobs/{jobId}` и получения PDF и других файлов по завершении.

Определения OpenAPI описывают [резервирование и создание заданий (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) и [загрузку исходников и скачивание результатов (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Аутентификация и области доступа {#認証とスコープ}

Передавайте все учётные данные в HTTP-заголовке `Authorization: Bearer <TOKEN>`.

- **Ключ API (`lrk_...`).** Нужен для резервирования исходников, создания заданий, работы с проектами, повторной выдачи токенов заданий (`job-tickets`) и повторного извлечения SVG.
  - `render:create` позволяет создавать задания, создавать, переименовывать и удалять проекты и сохранять ревизии.
  - `render:read:own` позволяет обновлять краткоживущие токены собственных заданий и просматривать проекты и историю.
- **Краткоживущие токены (`uploadTicket` и `jobTicket`).** Используются для загрузки ZIP, проверки состояния, отмены, скачивания файлов и удаления задания.

> [!WARNING]
> Не включайте ключ API, `uploadTicket` и `jobTicket` в журналы, строки запросов URL и входные ZIP-архивы.

> [!NOTE]
> **Задание принадлежит создавшему его ключу.** Другой ключ даже того же пользователя или сервисной учётной записи не может обновить `job-tickets`, повторить ответ создания с тем же `Idempotency-Key` или повторно запросить SVG. Сервер вернёт `404`. Отзыв исходного ключа не передаёт право владения. Исходники и проекты доступны разным ключам одного пользователя. Другой ключ может создать **новое задание** из общих исходников, указав новый `Idempotency-Key`.

## Конечные точки API {#apiエンドポイント}

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Зарезервировать исходники или использовать имеющийся ZIP того же пользователя |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Загрузить и проверить входной ZIP |
| `POST` | `/api/v1/render-tickets` | Создать задание из подготовленных исходников, повторить SVG или зарезервировать загрузку для одного задания |
| `POST` | `/api/v1/job-tickets/{jobId}` | Повторно выдать `jobTicket` для своего задания |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Загрузить ZIP напрямую в прежнем процессе для одного задания |
| `GET` | `/api/v1/jobs/{jobId}` | Получить состояние и ошибки задания |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Отменить задание в очереди или в работе |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Получить PDF, журналы, структурированные ошибки или SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Получить изображение для предварительного просмотра `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Пометить завершённое задание для удаления |
| `GET` / `POST` | `/api/v1/projects` | Перечислить или создать сохранённые проекты |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Посмотреть детали и ревизии, переименовать или удалить проект (скрыть запись) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Сохранить подготовленные исходники как неизменяемую ревизию |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Получить историю заданий ревизии |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Повторно преобразовать ревизию |

> [!DETAILS] Сохранённые проекты и режимы обслуживания
>
> - **Параметры проектов.** Используйте `cursor` и `pageSize` для постраничного получения списков, подробностей и истории заданий. При сохранении ревизии (`POST .../revisions`) передайте `sourceId`, `entrypoint` (относительный путь к `.tex`), `displayName`, `originalFilename` и `outputs`. Если совпадают проект, исходники и точка входа, повторно используется та же ревизия. Рендеринг ревизии (`POST .../render`) требует `Idempotency-Key` длиной от 16 до 200 символов. Если `outputs` опущен, действуют начальные параметры.
> - **Ограничения при обслуживании**
>   - `reject-new-jobs` разрешает просматривать, переименовывать и удалять проекты, сохранять ревизии и подготавливать исходники. Новые задания отклоняются.
>   - `read-only` и `lockdown` запрещают изменения проектов, резервирование, загрузку, создание ревизий и ссылок на исходники. Для уже зарезервированной загрузки режим проверяется ещё раз перед публикацией. Если новый режим запрещает публикацию, загрузка не завершается.

## Создание задания {#ジョブ作成}

### Способ 1. Подготовить повторно используемые исходники перед созданием задания (рекомендуется) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Зарезервируйте исходники.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Загружайте ZIP только при `uploadRequired: true`. Размер и SHA-256 должны в точности совпасть с резервированием. Успешный ответ — HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Создайте задание с подготовленным `sourceId`. Значение `entrypoint` по умолчанию — `main.tex`, значение `outputs` — `["pdf"]`. Запрашивать только `["svg"]` нельзя.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Ответ не включает `uploadTicket` и `uploadUrl`, так как ZIP уже доступен.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Способ 2. Зарезервировать и загрузить напрямую для одного задания {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Отправьте ZIP по возвращённому `uploadUrl` (`/api/v1/jobs/{jobId}/source`) с помощью `uploadTicket` методом `PUT`. Успешный ответ — HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Хранение исходников и Idempotency-Key
>
> - **Исходники без ссылок.** Готовый набор, на который не ссылаются активные ревизии или задания, по умолчанию очищается через 1 час. Учитываются и завершённые задания, кроме `deleted` и `expired`. Администратор может установить `source_orphan_retention_minutes` в пределах от 5 минут до 24 часов. При наличии действующей ссылки исходники сохраняются и остаются доступными после окончания срока хранения без ссылок. Если срок уже истёк к моменту удаления последней ссылки, исходники становятся недоступны и могут быть удалены. Ссылка не возвращает частично загруженные или удаляемые исходники в состояние готовности.
> - **Значение `expiresAt`.** До загрузки указывает время истечения незавершённого резервирования (10 минут). После подготовки это момент, когда истёк бы срок хранения без ссылок. Так работают веб-приложение, HTTP API и MCP. Срок действия `sourceRef` MCP — до 15 минут. Он не продлевает хранение исходников.
> - **Обработка `Idempotency-Key`.** При повторном использовании идентичного ZIP ключ регистрируется на 24 часа с момента принятия. Повторный запрос не продлевает срок. В этот период запрос с другим содержимым возвращает `409`, для просроченных исходников возвращается `410`, для удалённых — `404`, для текущей загрузки — `409`. Через 24 часа ключ можно использовать заново, не дожидаясь периодической очистки. Исходные данные при этом не восстанавливаются.

### Доступность PDF до окончания задания и повторное извлечение SVG {#pdfの先行公開とsvgの再試行}

Для веб-приложения и CLI см. [Получение PDF, PNG и SVG](/ru/docs/outputs/).

- **Ранний доступ и `stages`.** В задании PDF и SVG проверенный PDF и предварительный просмотр доступны до окончания SVG. Общий `status` обозначает совокупный результат. `stages.pdf` (с `sha256`) и `stages.svg` (с `attempt`) указывают состояние, время завершения и ошибки каждого этапа. Для старых заданий эти поля не восстанавливаются по косвенным данным.
- **Повтор только SVG.** Используйте `POST /api/v1/render-tickets` с аутентификацией ключом API (`jobTicket` не принимается), телом `{"retrySvgJobId":"job_..."}` и `Idempotency-Key`. Возвращается исходный `jobTicket`. Извлечение повторяется без перекомпиляции PDF и без продления срока хранения. При совпадении исходников, PDF и среды выполнения разрешено до 8 попыток, включая первую. Диагностика SVG содержится в `svg/compile.log`, `svg/errors.json` и `svg/dependencies.json`.

> [!DETAILS] Координаты и схема `svg/manifest.json` (schemaVersion 2)
>
> SVG сохраняются как `svg/objects/math-NNNNNN.svg` или `tikz-NNNNNN.svg` с `Content-Type: image/svg+xml` и `Content-Disposition: attachment`. При несовпадении числа объектов или наличии активного содержимого (внешних ссылок, скриптов, атрибутов событий) всё задание завершается ошибкой. `svg/manifest.json` описывает соответствия. Новые результаты всегда используют `schemaVersion: 2`, чтение версии `1` сохраняется.
>
> - **Координаты (`coordinateSystem`).** `id` и `page` отсчитываются от 1. Единица — пункт PDF (1/72 дюйма), начало координат в левом верхнем углу, x растёт вправо, y — вниз.
> - **Позиция известна (`placementStatus: "known"`)**
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
> - **Позиция неизвестна (`placementStatus: "unknown"`).** Если SyncTeX не различает, например, несколько выражений на одной строке, поля `page`, `x` и `y` опускаются без оценки координат. В этом случае `width` и `height` обозначают размер извлечённого SVG, а не его положение в PDF. Перед наложением объекта на PDF проверьте `schemaVersion` и `placementStatus`.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Загрузка ZIP {#zipアップロード}

Эта конечная точка загружает ZIP для задания, зарезервированного по прежней схеме. Для отдельно подготовленных исходников используйте `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Состояния задания {#ジョブ状態}

| Состояние | Значение | Действие клиента |
| --- | --- | --- |
| `reserved` / `uploading` | Зарезервировано или загружается | Отправить ZIP до истечения срока |
| `queued` / `validating` / `running` | В очереди, проверяется или компилируется | Выдерживать интервал между запросами |
| `succeeded` | Успех | Скачать PDF и нужные файлы |
| `failed` / `timeout` / `rejected` | Ошибка, превышено время или отклонено | Проверить сведения об ошибке |
| `canceled` | Отменено | При необходимости создать новое задание |
| `deleting` / `deleted` / `expired` | Удаляется, удалено или срок истёк | При необходимости создать новое задание |

**Хранение и защита начатых скачиваний**
После истечения `ARTIFACT_RETENTION_HOURS` (по умолчанию 24 часа) со времени завершения или последнего изменения для старых заданий без времени завершения новые скачивания не начинаются, даже если файлы ещё ожидают очистки. Это касается веб-приложения, API, рендерера и Remote MCP. Начатые вовремя скачивания, получение ZIP и чтение ресурсов MCP продлевают защиту от удаления только во время передачи данных. Защита снимается при завершении или отключении. При аварийном обрыве она истекает через 5 минут после последнего продления. Если продление не удалось, передача прерывается без восстановления доступа к просроченным файлам.

## Распространённые ошибки {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Статус HTTP | Значение | Когда повторить |
| --- | --- | --- |
| `400` | Недопустимые данные, заголовки или содержимое ZIP | Исправить данные перед отправкой |
| `401` / `403` | Недействительный, просроченный или недостаточно полномочный токен | Проверить учётные данные и разрешения |
| `404` / `410` | Задание или файл отсутствует, задание принадлежит другому ключу либо просрочены исходники | При необходимости создать новое задание |
| `409` | Несовместимое состояние или конфликт `Idempotency-Key` | Узнать текущее состояние |
| `429` / `503` | Ограничение частоты, нехватка ресурсов, заполненная очередь или обслуживание | Подождать перед новой попыткой |

## Пример с curl {#curlの例}

Полный пример для Bash в Linux резервирует исходники, загружает `source.zip`, проверяет состояние каждые 2 секунды до 60 раз и сохраняет PDF. Запустите его в каталоге с ZIP. Понадобятся `curl`, `jq`, `sha256sum` и `uuidgen`. Для собственного сервера измените `base`.

> [!DETAILS] Загрузка ZIP и скачивание PDF
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

Если после 60 проверок задание не завершено, используйте отображённый `jobId`, чтобы проверить то же задание позднее. По истечении срока `jobTicket` вызовите `POST /api/v1/job-tickets/{jobId}` с ключом API, создавшим задание. Следующие примеры показывают резервирование и загрузку ZIP.

## PowerShell {#powershell}

> [!DETAILS] Пример PowerShell
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

> [!DETAILS] Пример JavaScript / TypeScript
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

> [!DETAILS] Пример Python
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
