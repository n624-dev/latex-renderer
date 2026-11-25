---
slug: api
category: API
title: Offentlig API
description: Send et ZIP-arkiv via HTTP, kontroller konverteringsstatusen og last ned PDF-filen.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Arbeidsflyt {#利用の流れ}

Klargjør en API-nøkkel for rendering (`lrk_...`) og et [støttet ZIP-arkiv](/no/docs/projects/#構成). Prøv hele prosessen med [curl-eksempelet](#curlの例).

1. **Reserver inndata.** Beregn ZIP-arkivets størrelse i byte og SHA-256. Reserver settet med kildefiler (Source) med `POST /api/v1/source-tickets`.
2. **Last opp arkivet.** Bare hvis `uploadRequired` er `true`, bruk den returnerte adressen og det kortlivede `uploadTicket` for å sende ZIP-arkivet med `PUT`. Et identisk gyldig arkiv fra samme bruker gjenbrukes.
3. **Opprett jobben.** Bruk klargjort `sourceId` og relativ sti til hoveddokumentet (`entrypoint`) i `POST /api/v1/render-tickets`. For én konvertering kan du også bruke den [eldre arbeidsflyten](#ジョブ作成) som kombinerer trinn 1–3.
4. **Sjekk status og last ned.** Bruk det kortlivede `jobTicket` til å spørre `GET /api/v1/jobs/{jobId}` jevnlig og laste ned PDF og andre filer når jobben er ferdig.

OpenAPI-definisjonene dekker [reservasjon og oppretting av jobber (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) og [opplasting og nedlasting av resultater (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Autentisering og tilgangsomfang {#認証とスコープ}

Send alle påloggingsopplysninger i HTTP-hodet `Authorization: Bearer <TOKEN>`.

- **API-nøkkel (`lrk_...`).** Brukes til å reservere inndata, opprette jobber, arbeide med prosjekter, utstede nytt jobbtoken (`job-tickets`) og prøve SVG på nytt.
  - `render:create` gir tilgang til å opprette jobber, opprette, endre navn på og slette prosjekter og lagre revisjoner.
  - `render:read:own` gir tilgang til å fornye kortlivede token for egne jobber og lese prosjekter og historikk.
- **Kortlivede token (`uploadTicket` og `jobTicket`).** Brukes til å laste opp ZIP, sjekke status, avbryte, laste ned filer eller slette en jobb.

> [!WARNING]
> Hold API-nøkkelen, `uploadTicket` og `jobTicket` utenfor logger, spørringsstrenger i nettadresser og ZIP-inndata.

> [!NOTE]
> **Jobben tilhører nøkkelen som opprettet den.** En annen nøkkel, selv for samme bruker eller tjenestekonto, kan ikke fornye `job-tickets`, gjenta opprettingssvaret med samme `Idempotency-Key` eller prøve SVG på nytt. Serveren returnerer `404`. Eierskapet overføres ikke når den opprinnelige nøkkelen trekkes tilbake. Inndata og prosjekter deles derimot mellom nøkler for samme bruker. En annen nøkkel kan opprette en **ny jobb** fra delte inndata med en ny `Idempotency-Key`.

## API-endepunkter {#apiエンドポイント}

| Metode | Sti | Formål |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Reservere inndata eller gjenbruke en ZIP fra samme bruker |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Laste opp og kontrollere ZIP-inndata |
| `POST` | `/api/v1/render-tickets` | Opprette jobb fra inndata, prøve SVG på nytt eller reservere opplasting for én jobb |
| `POST` | `/api/v1/job-tickets/{jobId}` | Utstede et nytt `jobTicket` for egen jobb |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Laste opp ZIP direkte i den eldre flyten for én jobb |
| `GET` | `/api/v1/jobs/{jobId}` | Hente status og feil for jobben |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Avbryte en jobb i kø eller under kjøring |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Hente PDF, logger, strukturerte feil eller SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Hente en forhåndsvisning `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Merke en avsluttet jobb for sletting |
| `GET` / `POST` | `/api/v1/projects` | Liste opp eller opprette lagrede prosjekter |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Lese detaljer og revisjoner, endre navn eller slette prosjektet (skjule oppføringen) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Lagre klargjorte inndata som uforanderlig revisjon |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Hente jobbhistorikken for en revisjon |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Konvertere en revisjon på nytt |

> [!DETAILS] Lagrede prosjekter og vedlikeholdsmoduser
>
> - **Prosjektparametere.** Bruk `cursor` og `pageSize` til sideinndeling i lister, detaljer og jobbhistorikk. For å lagre en revisjon (`POST .../revisions`) sender du `sourceId`, `entrypoint` (relativ sti til en `.tex`), `displayName`, `originalFilename` og `outputs`. Revisjonen gjenbrukes ved samsvar i prosjekt, inndata og startfil. Rendering av en revisjon (`POST .../render`) krever `Idempotency-Key` på 16–200 tegn. Utelater du `outputs`, brukes de opprinnelige innstillingene.
> - **Begrensninger ved vedlikehold**
>   - `reject-new-jobs` tillater visning, endring av navn og sletting av prosjekter, lagring av revisjoner og klargjøring av inndata. Nye jobber avvises.
>   - `read-only` og `lockdown` avviser endringer i prosjekter og reservasjon, opplasting, endring og referanser til inndata. Ved en allerede reservert opplasting sjekkes modusen på nytt før publisering. Opplastingen fullføres ikke hvis ny modus forbyr det.

## Opprett en jobb {#ジョブ作成}

### Metode 1. Klargjør gjenbrukbare inndata før jobben opprettes (anbefalt) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reserver inndataene.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Last bare opp ZIP når `uploadRequired: true`. Størrelse og SHA-256 må stemme nøyaktig med reservasjonen. Vellykket svar er HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Opprett jobben med klargjort `sourceId`. Standardverdien for `entrypoint` er `main.tex` og for `outputs` er den `["pdf"]`. Du kan ikke be om bare `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Svaret utelater `uploadTicket` og `uploadUrl` fordi ZIP-arkivet allerede er tilgjengelig.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metode 2. Reserver og last opp direkte for én jobb {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Send ZIP til den returnerte `uploadUrl` (`/api/v1/jobs/{jobId}/source`) med `uploadTicket` og metoden `PUT`. Vellykket svar er HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Lagring av inndata og Idempotency-Key
>
> - **Foreldreløse inndata og referanser.** Klargjorte inndata uten referanser fra aktive revisjoner eller jobber ryddes normalt etter 1 time. Også avsluttede jobber teller, unntatt `deleted` og `expired`. Administratoren kan sette `source_orphan_retention_minutes` fra 5 minutter til 24 timer. Med en gyldig referanse kan inndataene beholdes og gjenbrukes etter fristen for foreldreløse inndata. Har fristen allerede gått ut når siste referanse forsvinner, blir inndataene utilgjengelige og kan ryddes. En referanse gjør ikke en ufullført opplasting eller inndata under sletting klare igjen.
> - **Betydningen av `expiresAt`.** Før opplasting viser dette når en ufullført reservasjon utløper (10 minutter). Etter klargjøring viser det når inndataene ville utløpt uten referanser. Dette gjelder nettappen, HTTP-API-et og MCP. Et `sourceRef` fra MCP varer i høyst 15 minutter og forlenger ikke lagringstiden for inndataene.
> - **Behandling av `Idempotency-Key`.** Ved gjenbruk av en identisk ZIP registreres nøkkelen i 24 timer fra aksept. Gjentatt sending forlenger ikke fristen. I perioden gir annet innhold `409`, utløpte opprinnelige inndata `410`, slettede inndata `404` og pågående opplasting `409`. Etter 24 timer kan nøkkelen gjenbrukes uten å vente på periodisk opprydding. Dette gjenoppretter ikke de opprinnelige inndataene.

### Tidlig tilgang til PDF og nye SVG-forsøk {#pdfの先行公開とsvgの再試行}

For nettappen og CLI, se [Hent PDF, PNG og SVG](/no/docs/outputs/).

- **Tidlig tilgang og `stages`.** I en jobb med PDF og SVG kan den verifiserte PDF-filen og forhåndsvisningene hentes før SVG er ferdig. Overordnet `status` angir resultatet for hele settet. `stages.pdf` (med `sha256`) og `stages.svg` (med `attempt`) angir status, sluttid og feil i hver fase. Disse feltene utledes ikke for eldre jobber.
- **Prøv bare SVG på nytt.** Bruk `POST /api/v1/render-tickets` med autentisering via API-nøkkel (`jobTicket` godtas ikke), innholdet `{"retrySvgJobId":"job_..."}` og en `Idempotency-Key`. Opprinnelig `jobTicket` returneres, og uthentingen gjentas uten ny PDF-kompilering eller lengre lagringstid. Høyst 8 forsøk inkludert det første tillates når inndata, PDF og kjøremiljø stemmer. SVG-diagnostikk finnes i `svg/compile.log`, `svg/errors.json` og `svg/dependencies.json`.

> [!DETAILS] Koordinater og skjema for `svg/manifest.json` (schemaVersion 2)
>
> SVG-filene lagres som `svg/objects/math-NNNNNN.svg` eller `tikz-NNNNNN.svg` med `Content-Type: image/svg+xml` og `Content-Disposition: attachment`. Feil antall objekter eller aktivt innhold (eksterne referanser, skript eller hendelsesattributter) gjør at hele jobben mislykkes. `svg/manifest.json` beskriver koblingene. Nye utdata bruker alltid `schemaVersion: 2`, og lesing av versjon `1` støttes fortsatt.
>
> - **Koordinater (`coordinateSystem`).** `id` og `page` begynner på 1. Enheten er PDF-punkt (1/72 tomme), med origo øverst til venstre, x mot høyre og y nedover.
> - **Kjent posisjon (`placementStatus: "known"`)**
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
> - **Ukjent posisjon (`placementStatus: "unknown"`).** Hvis SyncTeX for eksempel ikke kan skille mellom flere uttrykk på én linje, utelates `page`, `x` og `y` i stedet for å anslå koordinater. Da angir `width` og `height` størrelsen på den uthentede SVG-filen, ikke plasseringen i PDF-filen. Kontroller `schemaVersion` og `placementStatus` før du legger objektet over PDF-filen.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Last opp ZIP-arkivet {#zipアップロード}

Dette endepunktet laster opp ZIP til en jobb som ble reservert i den eldre flyten. Bruk `PUT /api/v1/sources/{sourceId}/content` for separat klargjorte inndata.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Jobbstatuser {#ジョブ状態}

| Status | Betydning | Hva bør klienten gjøre? |
| --- | --- | --- |
| `reserved` / `uploading` | Reservert eller under opplasting | Send ZIP før utløp |
| `queued` / `validating` / `running` | I kø, validering eller kompilering | Vent mellom statusforespørslene |
| `succeeded` | Vellykket | Last ned PDF og nødvendige filer |
| `failed` / `timeout` / `rejected` | Feil, tidsavbrudd eller avvisning | Kontroller feilene |
| `canceled` | Avbrutt | Opprett en ny jobb ved behov |
| `deleting` / `deleted` / `expired` | Under sletting, slettet eller utløpt | Opprett en ny jobb ved behov |

**Lagring og beskyttelse av aktive nedlastinger**
Etter `ARTIFACT_RETENTION_HOURS` (normalt 24 timer) fra fullføring eller, hvis eldre jobber mangler tidspunktet, fra siste endring, kan ingen nedlasting startes selv om filer fortsatt venter på opprydding. Dette gjelder nettapp, API, renderer og Remote MCP. Nedlastinger, henting av ZIP og MCP-lesinger som starter i tide, fornyer beskyttelsen mot sletting bare mens data overføres. Den frigjøres ved fullføring eller frakobling. Ved unormalt avbrudd utløper den 5 minutter etter siste fornyelse. Mislykkes fornyelsen, avbrytes overføringen uten å gjøre utløpte filer tilgjengelige igjen.

## Vanlige feil {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-status | Betydning | Når kan du prøve igjen? |
| --- | --- | --- |
| `400` | Ugyldige inndata, HTTP-hoder eller ZIP-innhold | Rett dataene før ny innsending |
| `401` / `403` | Ugyldig eller utløpt token eller utilstrekkelig tilgang | Kontroller påloggingsopplysninger og rettigheter |
| `404` / `410` | Jobb eller fil mangler, tilhører annen nøkkel eller inndataene har utløpt | Opprett ny jobb ved behov |
| `409` | Uforenlig tilstand eller konflikt med `Idempotency-Key` | Kontroller gjeldende status |
| `429` / `503` | Frekvensgrense, kapasitetsmangel, full kø eller vedlikehold | Vent før nytt forsøk |

## Eksempel med curl {#curlの例}

Dette fullstendige Bash-eksempelet for Linux reserverer inndata, laster opp `source.zip`, spør etter status hvert 2. sekund opptil 60 ganger og lagrer PDF-filen. Kjør det i mappen med ZIP-arkivet. Du trenger `curl`, `jq`, `sha256sum` og `uuidgen`. Endre `base` for egen drift.

> [!DETAILS] Last opp ZIP og hent PDF
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

Hvis jobben fortsatt pågår etter 60 forespørsler, bruk den viste `jobId` til å sjekke samme jobb senere. Hvis `jobTicket` utløper, kall `POST /api/v1/job-tickets/{jobId}` med API-nøkkelen som opprettet jobben. Eksemplene nedenfor dekker reservasjon og opplasting av ZIP.

## PowerShell {#powershell}

> [!DETAILS] PowerShell-eksempel
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

> [!DETAILS] Eksempel i JavaScript / TypeScript
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

> [!DETAILS] Python-eksempel
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
