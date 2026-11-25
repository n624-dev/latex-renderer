---
slug: api
category: API
title: Offentligt API
description: Send et ZIP-arkiv via HTTP, kontroller konverteringens status, og hent PDF-filen.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Arbejdsgang {#利用の流れ}

Klargør en API-nøgle til rendering (`lrk_...`) og et [understøttet ZIP-arkiv](/da/docs/projects/#構成). Du kan prøve hele forløbet med [curl-eksemplet](#curlの例).

1. **Reservér input.** Beregn ZIP-arkivets størrelse i byte og dets SHA-256. Reservér sættet af kildefiler (Source) med `POST /api/v1/source-tickets`.
2. **Upload ZIP-arkivet.** Kun hvis `uploadRequired` er `true`, skal du bruge den returnerede URL og det kortlivede `uploadTicket` til at sende ZIP-arkivet med `PUT`. Et identisk, gyldigt ZIP-arkiv fra samme bruger genbruges.
3. **Opret jobbet.** Brug det klargjorte `sourceId` og hoveddokumentets relative sti (`entrypoint`) i `POST /api/v1/render-tickets`. Til én konvertering kan du også bruge den [tidligere arbejdsgang](#ジョブ作成), der samler trin 1 til 3.
4. **Kontroller status og hent.** Brug det kortlivede `jobTicket` til regelmæssigt at forespørge `GET /api/v1/jobs/{jobId}` og hente PDF og øvrige filer efter afslutning.

OpenAPI-definitionerne dækker [reservation og oprettelse af job (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) samt [upload og download af resultater (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Godkendelse og adgangsomfang {#認証とスコープ}

Send alle loginoplysninger i HTTP-headeren `Authorization: Bearer <TOKEN>`.

- **API-nøgle (`lrk_...`).** Bruges til at reservere input, oprette job, arbejde med projekter, genudstede jobtokens (`job-tickets`) og forsøge SVG igen.
  - `render:create` giver adgang til at oprette job, oprette, omdøbe og slette projekter samt gemme revisioner.
  - `render:read:own` giver adgang til at forny kortlivede tokens til egne job og læse projekter og historik.
- **Kortlivede tokens (`uploadTicket` og `jobTicket`).** Bruges til at uploade ZIP, kontrollere status, annullere, hente filer eller slette et job.

> [!WARNING]
> Hold API-nøglen, `uploadTicket` og `jobTicket` ude af logfiler, URL-forespørgselsstrenge og input-ZIP'er.

> [!NOTE]
> **Jobbet tilhører den nøgle, der oprettede det.** En anden nøgle, selv for samme bruger eller tjenestekonto, kan ikke forny `job-tickets`, gentage oprettelsessvaret med samme `Idempotency-Key` eller forsøge SVG igen. Serveren returnerer `404`. Tilbagekaldelse af den oprindelige nøgle overfører ikke ejerskabet. Input og projekter deles dog mellem samme brugers nøgler. En anden nøgle kan oprette et **nyt job** fra delt input med en ny `Idempotency-Key`.

## API-endepunkter {#apiエンドポイント}

| Metode | Sti | Formål |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Reservér input, eller genbrug et ZIP-arkiv fra samme bruger |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Upload og verificer input-ZIP |
| `POST` | `/api/v1/render-tickets` | Opret et job fra input, prøv SVG igen, eller reservér upload til ét job |
| `POST` | `/api/v1/job-tickets/{jobId}` | Genudsted et `jobTicket` til et eget job |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Upload ZIP direkte i det tidligere forløb for ét job |
| `GET` | `/api/v1/jobs/{jobId}` | Hent jobbets status og fejl |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Annuller et job i kø eller under kørsel |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Hent PDF, logfiler, strukturerede fejl eller SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Hent en forhåndsvisning `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Markér et afsluttet job til sletning |
| `GET` / `POST` | `/api/v1/projects` | Vis eller opret gemte projekter |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Læs detaljer og revisioner, omdøb eller slet projektet (skjul posten) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Gem klargjort input som en uforanderlig revision |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Hent jobhistorikken for en revision |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Konvertér en revision igen |

> [!DETAILS] Gemte projekter og vedligeholdelsestilstande
>
> - **Projektparametre.** Brug `cursor` og `pageSize` til sideinddeling af lister, detaljer og jobhistorik. For at gemme en revision (`POST .../revisions`) sendes `sourceId`, `entrypoint` (relativ sti til en `.tex`), `displayName`, `originalFilename` og `outputs`. Revisionen genbruges, når projekt, input og startfil stemmer overens. Rendering af en revision (`POST .../render`) kræver en `Idempotency-Key` på 16–200 tegn. Udelades `outputs`, bruges de oprindelige indstillinger.
> - **Begrænsninger under vedligeholdelse**
>   - `reject-new-jobs` tillader visning, omdøbning og sletning af projekter, lagring af revisioner og klargøring af input. Nye job afvises.
>   - `read-only` og `lockdown` afviser projektændringer samt reservationer, uploads, ændringer og referencer til input. Allerede reserverede uploads kontrolleres igen før offentliggørelse. De afsluttes ikke, hvis den nye tilstand forbyder det.

## Opret et job {#ジョブ作成}

### Metode 1. Klargør genbrugeligt input, før du opretter jobbet (anbefalet) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reservér inputtet.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Upload kun ZIP-arkivet, hvis `uploadRequired: true`. Størrelse og SHA-256 skal stemme nøjagtigt med reservationen. Et vellykket svar er HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Opret jobbet med det klargjorte `sourceId`. Standardværdien for `entrypoint` er `main.tex` og for `outputs` er den `["pdf"]`. Det er ikke muligt kun at anmode om `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Svaret udelader `uploadTicket` og `uploadUrl`, da ZIP-arkivet allerede er tilgængeligt.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metode 2. Reservér og upload direkte til ét job {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Send ZIP-arkivet til den returnerede `uploadUrl` (`/api/v1/jobs/{jobId}/source`) med `uploadTicket` og metoden `PUT`. Et vellykket svar er HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Opbevaring af input og Idempotency-Key
>
> - **Forældreløst input og referencer.** Klargjort input uden referencer fra aktive revisioner eller job ryddes som standard efter 1 time. Afsluttede job tæller også, bortset fra `deleted` og `expired`. Administratoren kan sætte `source_orphan_retention_minutes` fra 5 minutter til 24 timer. En gyldig reference bevarer inputtet til genbrug ud over fristen for forældreløst input. Hvis fristen allerede er udløbet, når den sidste reference forsvinder, bliver inputtet utilgængeligt og kan ryddes. En reference gør ikke en uafsluttet upload eller et input under sletning klar igen.
> - **Betydningen af `expiresAt`.** Før upload angiver det, hvornår den uafsluttede reservation udløber (10 minutter). Efter klargøring angiver det, hvornår inputtet ville udløbe uden referencer. Det samme gælder webapp, HTTP-API og MCP. Et `sourceRef` i MCP er gyldigt i højst 15 minutter og forlænger ikke inputtets opbevaringstid.
> - **Håndtering af `Idempotency-Key`.** Ved genbrug af et identisk ZIP-arkiv registreres nøglen i 24 timer fra accept. Gentagen afsendelse forlænger ikke perioden. I perioden giver andet indhold `409`, udløbet oprindeligt input `410`, slettet input `404` og igangværende upload `409`. Efter 24 timer kan du genbruge nøglen uden at vente på periodisk oprydning. Det gendanner ikke det oprindelige input.

### Tidlig adgang til PDF og nye SVG-forsøg {#pdfの先行公開とsvgの再試行}

For webapp og CLI, se [Hent PDF, PNG og SVG](/da/docs/outputs/).

- **Tidlig adgang og `stages`.** I et PDF- og SVG-job kan verificeret PDF og forhåndsvisninger hentes, før SVG er færdig. Den overordnede `status` angiver resultatet for hele sættet. `stages.pdf` (med `sha256`) og `stages.svg` (med `attempt`) angiver status, afslutningstidspunkt og fejl for hver fase. Felterne udledes ikke for ældre job.
- **Prøv kun SVG igen.** Brug `POST /api/v1/render-tickets` med API-nøglegodkendelse (`jobTicket` accepteres ikke), indholdet `{"retrySvgJobId":"job_..."}` og en `Idempotency-Key`. Det oprindelige `jobTicket` returneres, og udtrækket gentages uden at genkompilere PDF eller forlænge opbevaringstiden. Højst 8 forsøg inklusive det første er tilladt, hvis input, PDF og kørselsmiljø stemmer overens. SVG-diagnostik findes i `svg/compile.log`, `svg/errors.json` og `svg/dependencies.json`.

> [!DETAILS] Koordinater og skema for `svg/manifest.json` (schemaVersion 2)
>
> SVG-filer gemmes som `svg/objects/math-NNNNNN.svg` eller `tikz-NNNNNN.svg` med `Content-Type: image/svg+xml` og `Content-Disposition: attachment`. Forkert antal objekter eller aktivt indhold (eksterne referencer, scripts eller hændelsesattributter) får hele jobbet til at fejle. `svg/manifest.json` beskriver tilknytningerne. Nye resultater bruger altid `schemaVersion: 2`, og version `1` kan stadig læses.
>
> - **Koordinater (`coordinateSystem`).** `id` og `page` begynder ved 1. Enheden er PDF-punkt (1/72 tomme), med nulpunkt øverst til venstre, x mod højre og y nedad.
> - **Kendt placering (`placementStatus: "known"`)**
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
> - **Ukendt placering (`placementStatus: "unknown"`).** Hvis SyncTeX f.eks. ikke kan skelne mellem flere udtryk på én linje, udelades `page`, `x` og `y` i stedet for at anslå koordinater. I så fald angiver `width` og `height` den udtrukne SVG-fils mål, ikke dens placering i PDF-filen. Kontroller `schemaVersion` og `placementStatus` før placering oven på PDF-filen.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Upload ZIP-arkivet {#zipアップロード}

Dette endepunkt uploader et ZIP-arkiv til et job reserveret i den tidligere arbejdsgang. Brug `PUT /api/v1/sources/{sourceId}/content` til separat klargjort input.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Jobstatusser {#ジョブ状態}

| Status | Betydning | Klientens handling |
| --- | --- | --- |
| `reserved` / `uploading` | Reserveret eller ved at uploade | Send ZIP inden udløb |
| `queued` / `validating` / `running` | I kø, validering eller kompilering | Vent mellem statusforespørgsler |
| `succeeded` | Gennemført | Hent PDF og de nødvendige filer |
| `failed` / `timeout` / `rejected` | Fejl, timeout eller afvisning | Kontroller fejlene |
| `canceled` | Annulleret | Opret om nødvendigt et nyt job |
| `deleting` / `deleted` / `expired` | Under sletning, slettet eller udløbet | Opret om nødvendigt et nyt job |

**Opbevaring og beskyttelse af igangværende downloads**
Efter `ARTIFACT_RETENTION_HOURS` (som standard 24 timer) fra afslutningen eller, for ældre job uden denne oplysning, fra sidste ændring, kan nye downloads ikke begynde, selvom filerne endnu ikke er ryddet. Det gælder for web, API, renderer og Remote MCP. Downloads, hentning af ZIP og MCP-læsninger, der begyndte i tide, fornyer kun en beskyttelse mod sletning under dataoverførslen. Den frigives ved afslutning eller afbrydelse af forbindelsen. Ved unormal afbrydelse udløber den 5 minutter efter seneste fornyelse. Mislykkes fornyelsen, standses overførslen uden at genaktivere udløbne filer.

## Almindelige fejl {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-status | Betydning | Hvornår kan du prøve igen? |
| --- | --- | --- |
| `400` | Ugyldigt input, headere eller ZIP-indhold | Ret data før ny afsendelse |
| `401` / `403` | Ugyldigt eller udløbet token eller utilstrækkeligt omfang | Kontroller loginoplysninger og rettigheder |
| `404` / `410` | Job eller fil mangler, tilhører en anden nøgle, eller input er udløbet | Opret eventuelt et nyt job |
| `409` | Uforenelig tilstand eller konflikt med `Idempotency-Key` | Kontroller aktuel status |
| `429` / `503` | Frekvensgrænse, kapacitetsmangel, fuld kø eller vedligeholdelse | Vent før nyt forsøg |

## Eksempel med curl {#curlの例}

Dette komplette Bash-eksempel til Linux reserverer input, uploader `source.zip`, kontrollerer status hvert 2. sekund op til 60 gange og gemmer PDF-filen. Kør det i mappen med ZIP-arkivet. Du skal have `curl`, `jq`, `sha256sum` og `uuidgen`. Ved egen drift skal du ændre `base`.

> [!DETAILS] Upload en ZIP og hent PDF-filen
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

Er jobbet stadig i gang efter 60 forespørgsler, kan du bruge det viste `jobId` til at kontrollere samme job senere. Hvis `jobTicket` udløber, skal du kalde `POST /api/v1/job-tickets/{jobId}` med API-nøglen, der oprettede jobbet. De følgende eksempler dækker reservation og upload af ZIP.

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
