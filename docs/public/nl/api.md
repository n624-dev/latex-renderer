---
slug: api
category: API
title: Openbare API
description: Verstuur een ZIP via HTTP, volg de conversie en download de PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Werkwijze {#利用の流れ}

Zorg voor een sleutel van de render-API (`lrk_...`) en een [ondersteund ZIP-archief](/nl/docs/projects/#構成). Zie het [curl-voorbeeld](#curlの例) om de volledige werkwijze te testen.

1. **Reserveer de invoer.** Bereken de ZIP-grootte in bytes en de SHA-256. Reserveer de set bronbestanden (Source) met `POST /api/v1/source-tickets`.
2. **Upload de ZIP.** Alleen als `uploadRequired` gelijk is aan `true`, gebruik je de geretourneerde URL met het kortlevende `uploadTicket` om de ZIP via `PUT` te versturen. Een identieke geldige ZIP van dezelfde gebruiker wordt hergebruikt.
3. **Maak de taak.** Gebruik de voorbereide `sourceId` en het relatieve pad van het hoofddocument (`entrypoint`) in `POST /api/v1/render-tickets`. Voor één conversie kun je ook de [oudere werkwijze](#ジョブ作成) gebruiken waarin stap 1 tot en met 3 zijn gecombineerd.
4. **Controleer de status en download de bestanden.** Vraag met het kortlevende `jobTicket` regelmatig `GET /api/v1/jobs/{jobId}` op en download na afloop de PDF en andere bestanden.

De OpenAPI-definities beschrijven [reserveringen en taken maken (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) en [bestanden uploaden en resultaten downloaden (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Authenticatie en scopes {#認証とスコープ}

Geef alle toegangsgegevens mee in de HTTP-header `Authorization: Bearer <TOKEN>`.

- **API-sleutel (`lrk_...`).** Voor invoer reserveren, taken aanmaken, projecten beheren, een taaktoken opnieuw uitgeven (`job-tickets`) en de SVG-extractie opnieuw proberen.
  - `render:create` staat toe om taken en projecten te maken, projecten te hernoemen of te verwijderen en revisies op te slaan.
  - `render:read:own` staat toe om kortlevende tokens van eigen taken te vernieuwen en projecten en geschiedenis op te vragen.
- **Kortlevende tokens (`uploadTicket` en `jobTicket`).** Voor het uploaden van een ZIP, status opvragen, annuleren, bestanden downloaden of een taak verwijderen.

> [!WARNING]
> Houd de API-sleutel, `uploadTicket` en `jobTicket` uit logbestanden, URL-querystrings en invoer-ZIP's.

> [!NOTE]
> **Een taak hoort bij de sleutel waarmee deze is gemaakt.** Met een andere sleutel, zelfs van dezelfde gebruiker of hetzelfde serviceaccount, kun je `job-tickets` niet vernieuwen, het aanmaakantwoord niet herhalen met dezelfde `Idempotency-Key` en SVG niet opnieuw proberen. De server geeft `404` terug. Intrekken van de oorspronkelijke sleutel draagt het eigendom niet over. Invoer en projecten worden wel gedeeld tussen sleutels van dezelfde gebruiker. Met een andere sleutel kun je voor gedeelde invoer een **nieuwe taak** maken met een nieuwe `Idempotency-Key`.

## API-endpoints {#apiエンドポイント}

| Methode | Pad | Doel |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Invoer reserveren of een ZIP van dezelfde gebruiker hergebruiken |
| `PUT` | `/api/v1/sources/{sourceId}/content` | De invoer-ZIP uploaden en verifiëren |
| `POST` | `/api/v1/render-tickets` | Een taak maken vanuit invoer, SVG opnieuw proberen of een upload voor één taak reserveren |
| `POST` | `/api/v1/job-tickets/{jobId}` | Een `jobTicket` opnieuw uitgeven voor een eigen taak |
| `PUT` | `/api/v1/jobs/{jobId}/source` | De ZIP rechtstreeks uploaden via de oudere werkwijze voor één taak |
| `GET` | `/api/v1/jobs/{jobId}` | Taakstatus en fouten opvragen |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Een wachtende of lopende taak annuleren |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF, logboeken, gestructureerde fouten of SVG ophalen |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Een voorbeeld `page-N.png` ophalen |
| `DELETE` | `/api/v1/jobs/{jobId}` | Een voltooide taak voor verwijdering markeren |
| `GET` / `POST` | `/api/v1/projects` | Opgeslagen projecten opvragen of maken |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Details en revisies opvragen, het project hernoemen of verwijderen (de vermelding verbergen) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Voorbereide invoer als onveranderlijke revisie opslaan |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Taakgeschiedenis van een revisie opvragen |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Een revisie opnieuw converteren |

> [!DETAILS] Opgeslagen projecten en onderhoudsmodi
>
> - **Projectparameters.** Gebruik `cursor` en `pageSize` om te bladeren in lijsten, details en taakgeschiedenis. Om een revisie op te slaan (`POST .../revisions`), verstuur je `sourceId`, `entrypoint` (relatief pad naar een `.tex`), `displayName`, `originalFilename` en `outputs`. Een revisie wordt hergebruikt als project, invoer en invoerbestand overeenkomen. Renderen van een revisie (`POST .../render`) vereist een `Idempotency-Key` van 16 tot 200 tekens. Laat je `outputs` weg, dan gelden de oorspronkelijke instellingen.
> - **Beperkingen tijdens onderhoud**
>   - `reject-new-jobs` staat het bekijken, hernoemen en verwijderen van projecten, het opslaan van revisies en het voorbereiden van invoer toe. Nieuwe taken worden geweigerd.
>   - `read-only` en `lockdown` weigeren projectwijzigingen en het reserveren, uploaden, wijzigen of refereren van invoer. Bij een eerder gereserveerde upload wordt de modus vóór publicatie opnieuw gecontroleerd. Staat die het niet meer toe, dan wordt de upload niet voltooid.

## Een taak maken {#ジョブ作成}

### Methode 1. Eerst herbruikbare invoer voorbereiden en dan een taak maken (aanbevolen) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reserveer de invoer.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Upload de ZIP alleen als `uploadRequired: true`. Grootte en SHA-256 moeten exact overeenkomen met de reservering. Een geslaagd antwoord is HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Maak een taak met de voorbereide `sourceId`. De standaardwaarde van `entrypoint` is `main.tex` en die van `outputs` is `["pdf"]`. Alleen `["svg"]` aanvragen is niet toegestaan.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Het antwoord bevat geen `uploadTicket` en `uploadUrl` omdat de ZIP al beschikbaar is.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Methode 2. Rechtstreeks reserveren en uploaden voor één taak {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Verstuur de ZIP naar de geretourneerde `uploadUrl` (`/api/v1/jobs/{jobId}/source`) met het `uploadTicket` en de methode `PUT`. Een geslaagd antwoord is HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Bewaartermijn van invoer en Idempotency-Key
>
> - **Verweesde invoer en verwijzingen.** Voorbereide invoer zonder verwijzing vanuit actieve revisies of taken wordt standaard na 1 uur opgeruimd. Voltooide taken tellen mee, behalve `deleted` en `expired`. De beheerder kan `source_orphan_retention_minutes` instellen van 5 minuten tot 24 uur. Een geldige verwijzing maakt de invoer ook na de termijn voor verweesde invoer beschikbaar voor hergebruik. Is die termijn al verstreken wanneer de laatste verwijzing vervalt, dan wordt de invoer ontoegankelijk en kan deze worden opgeruimd. Een verwijzing maakt een onvolledige upload of invoer die wordt verwijderd niet opnieuw beschikbaar.
> - **Betekenis van `expiresAt`.** Vóór de upload geeft dit aan wanneer de onvoltooide reservering verloopt (10 minuten). Na voorbereiding geeft het de vervaltijd zonder verwijzingen aan. Dit geldt voor de webapp, HTTP-API en MCP. Een `sourceRef` van MCP is maximaal 15 minuten geldig en verlengt de bewaartermijn van de invoer niet.
> - **Verwerking van `Idempotency-Key`.** Bij hergebruik van een identieke ZIP blijft de sleutel 24 uur vanaf acceptatie vastgelegd. Herhaald versturen verlengt dit niet. Binnen die termijn geeft andere inhoud `409`, verlopen oorspronkelijke invoer `410`, verwijderde invoer `404` en een nog lopende upload `409`. Na 24 uur kun je de sleutel weer gebruiken zonder te wachten op de periodieke opschoning. Dit herstelt de oorspronkelijke invoer niet.

### Vroegtijdig beschikbare PDF en nieuwe SVG-pogingen {#pdfの先行公開とsvgの再試行}

Zie [PDF, PNG en SVG downloaden](/nl/docs/outputs/) voor de werkwijze op het web en in de CLI.

- **Vroege toegang en `stages`.** Bij een taak met PDF en SVG zijn de geverifieerde PDF en voorbeelden al beschikbaar voordat de SVG's klaar zijn. De overkoepelende `status` geeft het resultaat van de set aan. `stages.pdf` (met `sha256`) en `stages.svg` (met `attempt`) geven de status, het voltooiingstijdstip en de fouten per fase. Voor oudere taken worden deze velden niet afgeleid.
- **Alleen SVG opnieuw proberen.** Gebruik `POST /api/v1/render-tickets` met API-sleutelauthenticatie (`jobTicket` wordt geweigerd), de inhoud `{"retrySvgJobId":"job_..."}` en een `Idempotency-Key`. De oorspronkelijke `jobTicket` wordt teruggegeven en de extractie wordt herhaald zonder de PDF opnieuw te compileren of de bewaartermijn te verlengen. Er zijn maximaal 8 pogingen inclusief de eerste mogelijk als invoer, PDF en uitvoeringsomgeving overeenkomen. SVG-diagnostiek staat in `svg/compile.log`, `svg/errors.json` en `svg/dependencies.json`.

> [!DETAILS] Coördinaten en schema van `svg/manifest.json` (schemaVersion 2)
>
> SVG's worden opgeslagen als `svg/objects/math-NNNNNN.svg` of `tikz-NNNNNN.svg` met `Content-Type: image/svg+xml` en `Content-Disposition: attachment`. Een afwijkend aantal objecten of actieve inhoud (externe verwijzingen, scripts of gebeurtenisattributen) laat de hele taak mislukken. `svg/manifest.json` legt de koppelingen vast. Nieuwe uitvoer gebruikt altijd `schemaVersion: 2`, terwijl versie `1` leesbaar blijft.
>
> - **Coördinaten (`coordinateSystem`).** `id` en `page` beginnen bij 1. De eenheid is het PDF-punt (1/72 inch). De oorsprong ligt linksboven, met x naar rechts en y naar beneden.
> - **Bekende positie (`placementStatus: "known"`)**
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
> - **Onbekende positie (`placementStatus: "unknown"`).** Als SyncTeX bijvoorbeeld meerdere uitdrukkingen op één regel niet kan onderscheiden, worden `page`, `x` en `y` weggelaten zonder coördinaten te schatten. In dat geval zijn `width` en `height` de afmetingen van de geëxtraheerde SVG, niet de plaats in de PDF. Controleer `schemaVersion` en `placementStatus` voordat je het object over de PDF legt.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## De ZIP uploaden {#zipアップロード}

Dit endpoint uploadt een ZIP naar een taak die via de oudere werkwijze is gereserveerd. Gebruik voor apart voorbereide invoer `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Taakstatussen {#ジョブ状態}

| Status | Betekenis | Actie van de client |
| --- | --- | --- |
| `reserved` / `uploading` | Gereserveerd of upload bezig | Verstuur de ZIP voor de vervaltijd |
| `queued` / `validating` / `running` | In de wachtrij, validatie of compilatie | Wacht tussen statusverzoeken |
| `succeeded` | Geslaagd | Download de PDF en benodigde bestanden |
| `failed` / `timeout` / `rejected` | Mislukt, tijd verstreken of geweigerd | Bekijk de fouten |
| `canceled` | Geannuleerd | Maak zo nodig een nieuwe taak |
| `deleting` / `deleted` / `expired` | Wordt verwijderd, is verwijderd of is verlopen | Maak zo nodig een nieuwe taak |

**Bewaartermijn en bescherming van lopende downloads**
Na `ARTIFACT_RETENTION_HOURS` (standaard 24 uur) vanaf voltooiing of, bij oude taken zonder dat tijdstip, sinds de laatste wijziging, kunnen geen downloads meer beginnen, ook als bestanden nog op opschoning wachten. Dit geldt voor de webapp, API, renderer en Remote MCP. Tijdig gestarte downloads, het ophalen van ZIP's en MCP-leesacties vernieuwen alleen tijdens de overdracht een reservering tegen verwijdering. Deze vervalt bij voltooiing of verbreken van de verbinding. Bij een abnormale onderbreking verloopt de reservering 5 minuten na de laatste vernieuwing. Mislukt de vernieuwing, dan wordt de overdracht gestopt zonder verlopen bestanden opnieuw beschikbaar te maken.

## Veelvoorkomende fouten {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-status | Betekenis | Wanneer opnieuw proberen? |
| --- | --- | --- |
| `400` | Ongeldige invoer, headers of ZIP-inhoud | Corrigeer de gegevens voordat je ze verstuurt |
| `401` / `403` | Ongeldig of verlopen token of onvoldoende scope | Controleer inloggegevens en rechten |
| `404` / `410` | Taak of bestand ontbreekt, andere eigenaarssleutel of verlopen invoer | Maak zo nodig een taak |
| `409` | Onverenigbare status of conflict met `Idempotency-Key` | Vraag de huidige status op |
| `429` / `503` | Frequentielimiet, onvoldoende capaciteit, volle wachtrij of onderhoud | Wacht voordat je het opnieuw probeert |

## Voorbeeld met curl {#curlの例}

Dit complete Bash-voorbeeld voor Linux reserveert de invoer, uploadt `source.zip`, vraagt om de 2 seconden maximaal 60 keer de status op en slaat de PDF op. Voer het uit in de map met de ZIP. Je hebt `curl`, `jq`, `sha256sum` en `uuidgen` nodig. Pas voor een eigen server `base` aan.

> [!DETAILS] Een ZIP uploaden en de PDF downloaden
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

Is de taak na 60 controles nog niet klaar, gebruik dan de weergegeven `jobId` om dezelfde taak later op te vragen. Verloopt `jobTicket`, roep dan `POST /api/v1/job-tickets/{jobId}` aan met de API-sleutel waarmee de taak is gemaakt. De volgende voorbeelden behandelen het reserveren en uploaden van de ZIP.

## PowerShell {#powershell}

> [!DETAILS] PowerShell-voorbeeld
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

> [!DETAILS] JavaScript-/TypeScript-voorbeeld
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

> [!DETAILS] Python-voorbeeld
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
