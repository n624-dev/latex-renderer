---
slug: api
category: API
title: Publikt API
description: Skicka ett ZIP-arkiv via HTTP, kontrollera konverteringen och hämta PDF-filen.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Arbetsgång {#利用の流れ}

Förbered en API-nyckel för rendering (`lrk_...`) och ett [ZIP-arkiv som stöds](/sv/docs/projects/#構成). För att testa hela flödet, se [exemplet med curl](#curlの例).

1. **Reservera underlaget.** Beräkna ZIP-arkivets storlek i byte och dess SHA-256. Reservera källfilerna (Source) med `POST /api/v1/source-tickets`.
2. **Ladda upp ZIP-arkivet.** Endast om `uploadRequired` är `true` använder du den returnerade adressen och kortlivad `uploadTicket` för att skicka arkivet med `PUT`. Ett identiskt giltigt arkiv från samma användare återanvänds.
3. **Skapa jobbet.** Skicka förberett `sourceId` och huvuddokumentets relativa sökväg (`entrypoint`) till `POST /api/v1/render-tickets`. För en enda konvertering kan du även använda det [äldre flödet](#ジョブ作成) som förenar steg 1–3.
4. **Kontrollera status och hämta.** Använd den kortlivade `jobTicket` för att regelbundet fråga `GET /api/v1/jobs/{jobId}` och hämta PDF och övriga filer när jobbet är klart.

OpenAPI-definitionerna täcker [reservation och skapande av jobb (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) samt [uppladdning och hämtning av resultat (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Autentisering och behörighetsomfång {#認証とスコープ}

Skicka alla åtkomstuppgifter i HTTP-huvudet `Authorization: Bearer <TOKEN>`.

- **API-nyckel (`lrk_...`).** Används för att reservera underlag, skapa jobb, hantera projekt, utfärda jobbtoken på nytt (`job-tickets`) och göra nya SVG-försök.
  - `render:create` låter dig skapa jobb, skapa, byta namn på och ta bort projekt samt spara revisioner.
  - `render:read:own` låter dig förnya kortlivade token för egna jobb och läsa projekt och historik.
- **Kortlivade token (`uploadTicket` och `jobTicket`).** För att ladda upp ZIP, kontrollera status, avbryta, hämta filer eller ta bort ett jobb.

> [!WARNING]
> Håll API-nyckeln, `uploadTicket` och `jobTicket` borta från loggar, frågesträngar i webbadresser och ZIP-indata.

> [!NOTE]
> **Jobbet tillhör nyckeln som skapade det.** En annan nyckel, även för samma användare eller tjänstekonto, kan inte förnya `job-tickets`, hämta samma skapandesvar genom att skicka samma `Idempotency-Key` eller göra ett nytt SVG-försök. Servern returnerar `404`. Ägarskapet överförs inte när den ursprungliga nyckeln återkallas. Underlag och projekt delas däremot mellan samma användares nycklar. En annan nyckel kan skapa ett **nytt jobb** från delat underlag med ett nytt `Idempotency-Key`.

## API-ändpunkter {#apiエンドポイント}

| Metod | Sökväg | Syfte |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Reservera underlag eller återanvänd samma användares ZIP |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Ladda upp och verifiera ZIP-underlaget |
| `POST` | `/api/v1/render-tickets` | Skapa ett jobb från underlag, försök med SVG igen eller reservera en uppladdning för ett enda jobb |
| `POST` | `/api/v1/job-tickets/{jobId}` | Utfärda en ny `jobTicket` för ett eget jobb |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Ladda upp ZIP direkt i det äldre flödet för ett jobb |
| `GET` | `/api/v1/jobs/{jobId}` | Hämta jobbstatus och fel |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Avbryt ett jobb i kö eller under körning |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Hämta PDF, loggar, strukturerade fel eller SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Hämta en förhandsvisning `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Markera ett slutfört jobb för borttagning |
| `GET` / `POST` | `/api/v1/projects` | Lista eller skapa sparade projekt |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Visa detaljer och revisioner, byt namn på eller ta bort projektet (dölj posten) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Spara ett färdigt underlag som oföränderlig revision |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Hämta jobbhistoriken för en revision |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Konvertera en revision på nytt |

> [!DETAILS] Sparade projekt och underhållslägen
>
> - **Projektparametrar.** Använd `cursor` och `pageSize` för att bläddra i listor, detaljer och jobbhistorik. För att spara en revision (`POST .../revisions`) skickar du `sourceId`, `entrypoint` (relativ sökväg till en `.tex`), `displayName`, `originalFilename` och `outputs`. Revisionen återanvänds om projekt, underlag och startfil matchar. Rendering av en revision (`POST .../render`) kräver `Idempotency-Key` med 16–200 tecken. Utelämnas `outputs` används de ursprungliga inställningarna.
> - **Begränsningar vid underhåll**
>   - `reject-new-jobs` tillåter att visa, byta namn på och ta bort projekt, spara revisioner och förbereda underlag. Nya jobb avvisas.
>   - `read-only` och `lockdown` avvisar projektändringar samt reservationer, uppladdningar, ändringar och referenser till underlag. För redan reserverade uppladdningar kontrolleras läget igen före publicering. Uppladdningen slutförs inte om det nya läget förbjuder det.

## Skapa ett jobb {#ジョブ作成}

### Metod 1. Förbered återanvändbart underlag innan du skapar jobbet (rekommenderas) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reservera underlaget.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Ladda bara upp arkivet om `uploadRequired: true`. Storlek och SHA-256 måste exakt matcha reservationen. Ett lyckat svar är HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Skapa jobbet med färdigt `sourceId`. Standardvärdet för `entrypoint` är `main.tex` och för `outputs` är det `["pdf"]`. Det går inte att begära enbart `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Svaret utelämnar `uploadTicket` och `uploadUrl` eftersom ZIP-arkivet redan är tillgängligt.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metod 2. Reservera och ladda upp direkt för ett enda jobb {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Skicka arkivet till returnerad `uploadUrl` (`/api/v1/jobs/{jobId}/source`) med `uploadTicket` och metoden `PUT`. Ett lyckat svar är HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Lagring av underlag och Idempotency-Key
>
> - **Föräldralösa underlag och referenser.** Ett färdigt underlag utan referenser från aktiva revisioner eller jobb rensas normalt efter 1 timme. Även slutförda jobb räknas utom `deleted` och `expired`. Administratören kan ange `source_orphan_retention_minutes` från 5 minuter till 24 timmar. Med en giltig referens kan underlaget sparas och återanvändas även efter tidsgränsen för föräldralösa underlag. Om tiden redan gått ut när den sista referensen försvinner blir underlaget otillgängligt och kan rensas. En referens gör inte en ofullständig uppladdning eller ett underlag under borttagning redo igen.
> - **Betydelse av `expiresAt`.** Före uppladdning anger det när den oavslutade reservationen går ut (10 minuter). När underlaget är redo anger det när underlaget skulle gå ut utan referenser. Samma regler gäller för webb, HTTP-API och MCP. En `sourceRef` i MCP gäller i högst 15 minuter och förlänger inte underlagets lagringstid.
> - **Hantering av `Idempotency-Key`.** Vid återanvändning av ett identiskt ZIP-arkiv registreras nyckeln i 24 timmar från godtagandet. Upprepad sändning förlänger inte tiden. Under perioden ger annat innehåll `409`, utgånget ursprungsunderlag `410`, borttaget underlag `404` och pågående uppladdning `409`. Efter 24 timmar kan nyckeln återanvändas utan att invänta periodisk rensning. Det återställer inte ursprungsunderlaget.

### Tidig tillgång till PDF och nya SVG-försök {#pdfの先行公開とsvgの再試行}

För webb och CLI, se [Hämta PDF, PNG och SVG](/sv/docs/outputs/).

- **Tidig åtkomst och `stages`.** I ett jobb med PDF och SVG kan verifierad PDF och förhandsvisningar hämtas innan SVG är klart. Övergripande `status` anger hela uppsättningens resultat. `stages.pdf` (med `sha256`) och `stages.svg` (med `attempt`) anger status, sluttid och fel för respektive fas. Fälten härleds inte för äldre jobb.
- **Försök igen med endast SVG.** Använd `POST /api/v1/render-tickets` med API-nyckelautentisering (`jobTicket` godtas inte), innehållet `{"retrySvgJobId":"job_..."}` och en `Idempotency-Key`. Ursprungligt `jobTicket` returneras. Extraktionen körs om utan att kompilera PDF på nytt eller förlänga lagringstiden. Högst 8 försök inklusive det första tillåts om underlag, PDF och körmiljö matchar. SVG-diagnostik finns i `svg/compile.log`, `svg/errors.json` och `svg/dependencies.json`.

> [!DETAILS] Koordinater och schema för `svg/manifest.json` (schemaVersion 2)
>
> SVG-filer sparas som `svg/objects/math-NNNNNN.svg` eller `tikz-NNNNNN.svg` med `Content-Type: image/svg+xml` och `Content-Disposition: attachment`. Fel antal objekt eller aktivt innehåll (externa referenser, skript eller händelseattribut) gör att hela jobbet misslyckas. `svg/manifest.json` anger kopplingarna. Nya resultat använder alltid `schemaVersion: 2` och version `1` kan fortfarande läsas.
>
> - **Koordinater (`coordinateSystem`).** `id` och `page` börjar på 1. Enheten är PDF-punkter (1/72 tum). Origo är övre vänstra hörnet, med x åt höger och y nedåt.
> - **Känd position (`placementStatus: "known"`)**
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
> - **Okänd position (`placementStatus: "unknown"`).** Om SyncTeX till exempel inte kan skilja flera uttryck på samma rad utelämnas `page`, `x` och `y` utan att koordinater uppskattas. Då anger `width` och `height` måtten på den extraherade SVG-filen, inte positionen i PDF-filen. Kontrollera `schemaVersion` och `placementStatus` innan du lägger objektet ovanpå PDF-filen.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Ladda upp ZIP-arkivet {#zipアップロード}

Ändpunkten laddar upp ett ZIP-arkiv till ett jobb som reserverats med det äldre flödet. Använd `PUT /api/v1/sources/{sourceId}/content` för ett underlag som förberetts separat.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Jobbstatus {#ジョブ状態}

| Status | Betydelse | Klientåtgärd |
| --- | --- | --- |
| `reserved` / `uploading` | Reserverat eller under uppladdning | Skicka ZIP före utgångstiden |
| `queued` / `validating` / `running` | I kö, validering eller kompilering | Vänta mellan statusanropen |
| `succeeded` | Lyckades | Hämta PDF och önskade filer |
| `failed` / `timeout` / `rejected` | Fel, tidsgräns eller avvisning | Kontrollera felen |
| `canceled` | Avbrutet | Skapa ett nytt jobb vid behov |
| `deleting` / `deleted` / `expired` | Under borttagning, borttaget eller utgånget | Skapa ett nytt jobb vid behov |

**Lagring och skydd för pågående hämtningar**
När `ARTIFACT_RETENTION_HOURS` (normalt 24 timmar) gått sedan slutförandet eller, för gamla jobb utan sluttid, senaste uppdateringen, går det inte att påbörja en hämtning även om filer väntar på rensning. Det gäller webb, API, renderaren och Remote MCP. Hämtningar, återläsning av ZIP och MCP-läsningar som startats i tid förnyar ett skydd mot radering endast under dataöverföringen. Det släpps vid avslut eller frånkoppling. Vid onormalt avbrott går det ut 5 minuter efter senaste förnyelsen. Om förnyelsen misslyckas avbryts överföringen utan att utgångna filer återaktiveras.

## Vanliga fel {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-status | Betydelse | När ska klienten försöka igen? |
| --- | --- | --- |
| `400` | Ogiltiga indata, HTTP-huvuden eller ZIP-innehåll | Rätta data före omsändning |
| `401` / `403` | Ogiltig eller utgången token eller otillräcklig behörighet | Kontrollera inloggningsuppgifter och rättigheter |
| `404` / `410` | Jobbet eller filen saknas, tillhör en annan nyckel eller underlaget har gått ut | Skapa ett nytt jobb vid behov |
| `409` | Oförenligt tillstånd eller konflikt med `Idempotency-Key` | Kontrollera aktuell status |
| `429` / `503` | Frekvensgräns, kapacitetsbrist, full kö eller underhåll | Vänta före nästa försök |

## Exempel med curl {#curlの例}

Detta fullständiga Bash-exempel för Linux reserverar underlag, laddar upp `source.zip`, frågar efter status varannan sekund upp till 60 gånger och sparar PDF-filen. Kör det i ZIP-arkivets katalog. Du behöver `curl`, `jq`, `sha256sum` och `uuidgen`. För egen drift ändrar du `base`.

> [!DETAILS] Ladda upp ett ZIP-arkiv och hämta PDF-filen
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

Om jobbet fortfarande pågår efter 60 frågor kan du använda visat `jobId` för att kontrollera samma jobb senare. Om `jobTicket` går ut, anropa `POST /api/v1/job-tickets/{jobId}` med API-nyckeln som skapade jobbet. Följande exempel omfattar reservation och uppladdning av ZIP.

## PowerShell {#powershell}

> [!DETAILS] PowerShell-exempel
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

> [!DETAILS] Exempel i JavaScript / TypeScript
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

> [!DETAILS] Python-exempel
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
