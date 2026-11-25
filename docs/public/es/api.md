---
slug: api
category: API
title: API pública
description: Envía un ZIP por HTTP, consulta el estado de la conversión y descarga el PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Flujo de trabajo {#利用の流れ}

Prepara una clave de API de renderizado (`lrk_...`) y un [ZIP compatible](/es/docs/projects/#構成). Para probar el flujo completo, consulta el [ejemplo con curl](#curlの例).

1. **Reserva la entrada.** Calcula el tamaño del ZIP en bytes y su SHA-256. Reserva el conjunto de archivos (Source) con `POST /api/v1/source-tickets`.
2. **Sube el ZIP.** Solo si `uploadRequired` es `true`, usa la URL devuelta y el `uploadTicket` de corta duración para enviar el ZIP mediante `PUT`. Si ya existe un ZIP idéntico y válido del mismo usuario, se reutiliza.
3. **Crea el trabajo.** Usa el `sourceId` preparado y la ruta relativa del documento principal (`entrypoint`) en `POST /api/v1/render-tickets`. Para una sola conversión, también puedes usar el [flujo anterior](#ジョブ作成) que agrupa los pasos 1 a 3.
4. **Consulta el estado y descarga.** Usa el `jobTicket` de corta duración para consultar `GET /api/v1/jobs/{jobId}` periódicamente y obtener el PDF y demás archivos al finalizar.

Las definiciones OpenAPI cubren [reservas y creación de trabajos (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) y [cargas y descarga de resultados (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Autenticación y alcances {#認証とスコープ}

Envía todas las credenciales en la cabecera HTTP `Authorization: Bearer <TOKEN>`.

- **Clave de API (`lrk_...`).** Se usa para reservar entradas, crear trabajos, operar con proyectos, reemitir tokens de trabajo (`job-tickets`) y reintentar SVG.
  - `render:create` permite crear trabajos, crear, renombrar y eliminar proyectos y guardar revisiones.
  - `render:read:own` permite renovar tokens de corta duración de trabajos propios y consultar proyectos e historial.
- **Tokens de corta duración (`uploadTicket` y `jobTicket`).** Se usan para subir el ZIP, consultar estado, cancelar, descargar archivos o eliminar un trabajo.

> [!WARNING]
> Mantén la clave de API, `uploadTicket` y `jobTicket` fuera de registros, cadenas de consulta de URL y ZIP de entrada.

> [!NOTE]
> **El trabajo pertenece a la clave que lo creó.** Otra clave, aunque sea del mismo usuario o cuenta de servicio, no puede renovar `job-tickets`, repetir la respuesta de creación con la misma `Idempotency-Key` ni reintentar SVG: el servidor devuelve `404`. La propiedad no se transfiere si se revoca la clave original. Las entradas y los proyectos sí se comparten entre claves del mismo usuario. Otra clave puede crear un **trabajo nuevo** a partir de una entrada compartida usando una `Idempotency-Key` nueva.

## Endpoints de la API {#apiエンドポイント}

| Método | Ruta | Objetivo |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Reservar una entrada o reutilizar un ZIP del mismo usuario |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Subir y verificar el ZIP de entrada |
| `POST` | `/api/v1/render-tickets` | Crear un trabajo desde una entrada, reintentar SVG o reservar una carga para un único trabajo |
| `POST` | `/api/v1/job-tickets/{jobId}` | Reemitir un `jobTicket` para un trabajo propio |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Subir el ZIP directamente en el flujo anterior de un solo trabajo |
| `GET` | `/api/v1/jobs/{jobId}` | Obtener el estado y los errores del trabajo |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Cancelar un trabajo en cola o en curso |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Obtener PDF, registros, errores estructurados o SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Obtener una vista previa `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Marcar un trabajo finalizado para su eliminación |
| `GET` / `POST` | `/api/v1/projects` | Listar o crear proyectos guardados |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Consultar detalles y revisiones, renombrar o eliminar el proyecto (ocultar el registro) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Guardar una entrada lista como revisión inmutable |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Obtener el historial de trabajos de una revisión |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Volver a convertir una revisión |

> [!DETAILS] Proyectos guardados y modos de mantenimiento
>
> - **Parámetros de proyecto.** Usa `cursor` y `pageSize` para paginar listas, detalles e historial de trabajos. Para guardar una revisión (`POST .../revisions`), envía `sourceId`, `entrypoint` (ruta relativa a un `.tex`), `displayName`, `originalFilename` y `outputs`. Se reutiliza la revisión si coinciden proyecto, entrada y punto de entrada. El renderizado de una revisión (`POST .../render`) requiere una `Idempotency-Key` de 16 a 200 caracteres. Si omites `outputs`, se usan los ajustes iniciales.
> - **Restricciones de mantenimiento**
>   - `reject-new-jobs` permite ver, renombrar y eliminar proyectos, guardar revisiones y preparar entradas. Se rechazan los trabajos nuevos.
>   - `read-only` y `lockdown` rechazan cambios en proyectos, así como reservas, cargas, revisiones y referencias de entradas. Las cargas ya reservadas vuelven a comprobar el modo antes de publicarse y no finalizan si el modo ha pasado a prohibirlo.

## Crear un trabajo {#ジョブ作成}

### Método 1. Preparar una entrada reutilizable antes de crear el trabajo (recomendado) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reserva la entrada.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Sube el ZIP solo cuando `uploadRequired: true`. Debe coincidir exactamente con el tamaño y SHA-256 de la reserva. La respuesta correcta es HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Crea el trabajo con el `sourceId` listo. `entrypoint` toma por defecto `main.tex` y `outputs` toma `["pdf"]`. No se admite solicitar solo `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

La respuesta omite `uploadTicket` y `uploadUrl` porque el ZIP ya está disponible.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Método 2. Reservar y subir directamente para un solo trabajo {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Envía el ZIP a la `uploadUrl` devuelta (`/api/v1/jobs/{jobId}/source`) usando el `uploadTicket` y el método `PUT`. La respuesta correcta es HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Conservación de entradas e Idempotency-Key
>
> - **Entradas huérfanas y referencias.** Una entrada lista sin revisiones activas ni trabajos que la referencien se limpia después de 1 hora por defecto. También cuentan los trabajos terminados, salvo `deleted` y `expired`. El administrador puede ajustar `source_orphan_retention_minutes` entre 5 minutos y 24 horas. Con una referencia válida, la entrada se conserva y puede reutilizarse más allá del plazo de orfandad. Si este ya venció al desaparecer la última referencia, queda inaccesible y puede limpiarse. Una referencia no hace que una entrada a medio cargar o en eliminación vuelva a estar lista.
> - **Significado de `expiresAt`.** Antes de subir indica la caducidad de la reserva incompleta (10 minutos). Una vez lista, indica cuándo caducaría sin referencias. Se aplica igual a web, API HTTP y MCP. Un `sourceRef` de MCP dura hasta 15 minutos y no amplía la conservación de la entrada.
> - **Tratamiento de `Idempotency-Key`.** Al reutilizar un ZIP idéntico, la clave se registra durante 24 horas desde la aceptación. Retransmitir no amplía el plazo. Dentro del plazo, usar otro contenido devuelve `409`, una entrada original caducada devuelve `410`, una eliminada devuelve `404` y una carga en curso devuelve `409`. Tras 24 horas puedes reutilizar la clave sin esperar a la limpieza periódica. Esto no restaura la entrada original.

### Disponibilidad anticipada del PDF y reintentos de SVG {#pdfの先行公開とsvgの再試行}

Para instrucciones de web y CLI, consulta [Obtener PDF, PNG y SVG](/es/docs/outputs/).

- **Acceso anticipado y `stages`.** En un trabajo PDF y SVG se puede obtener el PDF verificado y las vistas previas antes de terminar SVG. El `status` global indica el resultado del conjunto. `stages.pdf` (con `sha256`) y `stages.svg` (con `attempt`) informan del estado, la hora de finalización y los errores de cada fase. No se infieren estos campos para trabajos antiguos.
- **Reintentar solo SVG.** Usa `POST /api/v1/render-tickets` con autenticación por clave de API (no admite `jobTicket`), el cuerpo `{"retrySvgJobId":"job_..."}` y una `Idempotency-Key`. Devuelve el `jobTicket` original y repite la extracción sin recompilar el PDF ni ampliar su conservación. Se admiten hasta 8 intentos incluido el inicial si coinciden entrada, PDF y entorno de ejecución. Los diagnósticos SVG están en `svg/compile.log`, `svg/errors.json` y `svg/dependencies.json`.

> [!DETAILS] Coordenadas y esquema de `svg/manifest.json` (schemaVersion 2)
>
> Los SVG se guardan como `svg/objects/math-NNNNNN.svg` o `tikz-NNNNNN.svg` con `Content-Type: image/svg+xml` y `Content-Disposition: attachment`. Si no coincide el número de objetos o hay contenido activo (referencias externas, scripts o atributos de eventos), falla el trabajo entero. `svg/manifest.json` establece las correspondencias. Las salidas nuevas usan siempre `schemaVersion: 2` y se mantiene la lectura de la versión `1`.
>
> - **Coordenadas (`coordinateSystem`).** `id` y `page` comienzan en 1. La unidad es el punto PDF (1/72 de pulgada), con origen en la esquina superior izquierda, eje x hacia la derecha e y hacia abajo.
> - **Posición conocida (`placementStatus: "known"`)**
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
> - **Posición desconocida (`placementStatus: "unknown"`).** Si SyncTeX no distingue, por ejemplo, varias expresiones en una línea, se omiten `page`, `x` e `y` en lugar de estimar coordenadas. En ese caso `width` y `height` miden el SVG extraído, no su posición en el PDF. Comprueba `schemaVersion` y `placementStatus` antes de superponer el objeto sobre el PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Subir el ZIP {#zipアップロード}

Este endpoint sube un ZIP a un trabajo reservado mediante el flujo anterior. Para una entrada preparada por separado usa `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Estados del trabajo {#ジョブ状態}

| Estado | Significado | Qué debe hacer el cliente |
| --- | --- | --- |
| `reserved` / `uploading` | Reservado o en carga | Enviar el ZIP antes de la caducidad |
| `queued` / `validating` / `running` | En cola, validación o compilación | Esperar entre consultas |
| `succeeded` | Correcto | Descargar el PDF y los archivos necesarios |
| `failed` / `timeout` / `rejected` | Fallo, tiempo agotado o rechazo | Comprobar los errores |
| `canceled` | Cancelado | Crear un trabajo nuevo si hace falta |
| `deleting` / `deleted` / `expired` | En eliminación, eliminado o caducado | Crear otro si hace falta |

**Conservación y protección de descargas en curso**
Transcurrido `ARTIFACT_RETENTION_HOURS` (24 horas por defecto) desde la finalización o, en trabajos antiguos sin ese dato, la última actualización, no se pueden iniciar descargas aunque sigan existiendo archivos pendientes de limpieza. Esto rige para la web, la API, el renderizador y Remote MCP. Las descargas, recuperaciones de ZIP y lecturas MCP iniciadas a tiempo renuevan una reserva contra eliminación solo mientras se transfieren datos. Se libera al terminar o desconectar. Si la transferencia se interrumpe de forma anómala, caduca a los 5 minutos de la última renovación. Si la renovación falla, se cancela la transferencia sin reactivar archivos caducados.

## Errores habituales {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Estado HTTP | Significado | Cuándo reintentar |
| --- | --- | --- |
| `400` | Entrada, cabeceras o contenido ZIP no válidos | Corregir los datos antes de enviar |
| `401` / `403` | Token no válido, caducado o sin alcance suficiente | Comprobar credenciales y permisos |
| `404` / `410` | Falta el trabajo o el archivo, pertenece a otra clave o ha caducado la entrada | Crear un trabajo si es necesario |
| `409` | Estado incompatible o conflicto de `Idempotency-Key` | Consultar el estado actual |
| `429` / `503` | Límite de frecuencia, falta de capacidad, cola llena o mantenimiento | Esperar antes de reintentar |

## Ejemplo con curl {#curlの例}

Este ejemplo completo para Bash en Linux reserva, sube `source.zip`, consulta el estado cada 2 segundos hasta 60 veces y guarda el PDF. Ejecútalo en el directorio del ZIP. Requiere `curl`, `jq`, `sha256sum` y `uuidgen`. Para alojamiento propio cambia `base`.

> [!DETAILS] Subir un ZIP y descargar el PDF
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

Si después de 60 consultas sigue pendiente, usa el `jobId` mostrado para consultar el mismo trabajo después. Si caduca `jobTicket`, llama a `POST /api/v1/job-tickets/{jobId}` con la clave de API que creó el trabajo. Los siguientes ejemplos cubren la reserva y la carga del ZIP.

## PowerShell {#powershell}

> [!DETAILS] Ejemplo de PowerShell
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

> [!DETAILS] Ejemplo de JavaScript / TypeScript
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

> [!DETAILS] Ejemplo de Python
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
