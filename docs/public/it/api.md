---
slug: api
category: API
title: API pubblica
description: Invia uno ZIP via HTTP, consulta lo stato della conversione e scarica il PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Flusso di lavoro {#利用の流れ}

Prepara una chiave API di rendering (`lrk_...`) e uno [ZIP compatibile](/it/docs/projects/#構成). Per provare il flusso completo, consulta l’[esempio con curl](#curlの例).

1. **Prenota l’input.** Calcola la dimensione in byte e lo SHA-256 dello ZIP. Prenota l’insieme dei file sorgente (Source) con `POST /api/v1/source-tickets`.
2. **Carica lo ZIP.** Solo se `uploadRequired` vale `true`, usa l’URL restituito e il `uploadTicket` di breve durata per inviare lo ZIP con `PUT`. Se esiste già uno ZIP identico e valido dello stesso utente, viene riutilizzato.
3. **Crea il processo.** Usa il `sourceId` preparato e il percorso relativo del documento principale (`entrypoint`) in `POST /api/v1/render-tickets`. Per una conversione singola puoi anche usare il [flusso precedente](#ジョブ作成) che riunisce i passaggi da 1 a 3.
4. **Controlla lo stato e scarica.** Usa il `jobTicket` di breve durata per interrogare `GET /api/v1/jobs/{jobId}` periodicamente e recuperare il PDF e gli altri file al termine.

Le definizioni OpenAPI coprono [prenotazioni e creazione dei processi (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) e [caricamento e download dei risultati (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Autenticazione e ambiti {#認証とスコープ}

Invia tutte le credenziali nell’intestazione HTTP `Authorization: Bearer <TOKEN>`.

- **Chiave API (`lrk_...`).** Usata per prenotare input, creare processi, gestire progetti, riemettere token di processo (`job-tickets`) e riprovare l’estrazione SVG.
  - `render:create` permette di creare processi, creare, rinominare ed eliminare progetti e salvare revisioni.
  - `render:read:own` permette di rinnovare token di breve durata per i propri processi e di consultare progetti e cronologia.
- **Token di breve durata (`uploadTicket` e `jobTicket`).** Usati per caricare lo ZIP, consultare lo stato, annullare, scaricare file o eliminare un processo.

> [!WARNING]
> Tieni la chiave API, `uploadTicket` e `jobTicket` fuori da log, stringhe di query degli URL e ZIP di input.

> [!NOTE]
> **Il processo appartiene alla chiave che l’ha creato.** Un’altra chiave, anche dello stesso utente o account di servizio, non può rinnovare `job-tickets`, ripetere la risposta di creazione con la stessa `Idempotency-Key` o riprovare gli SVG. Il server restituisce `404`. Revocare la chiave originale non trasferisce la proprietà. Input e progetti sono condivisi fra le chiavi dello stesso utente. Un’altra chiave può creare un **nuovo processo** da un input condiviso con una nuova `Idempotency-Key`.

## Endpoint dell’API {#apiエンドポイント}

| Metodo | Percorso | Scopo |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Prenotare un input o riutilizzare uno ZIP dello stesso utente |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Caricare e verificare lo ZIP di input |
| `POST` | `/api/v1/render-tickets` | Creare un processo da un input, riprovare gli SVG o prenotare un caricamento per un solo processo |
| `POST` | `/api/v1/job-tickets/{jobId}` | Riemettere un `jobTicket` per un proprio processo |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Caricare direttamente lo ZIP nel flusso precedente a processo singolo |
| `GET` | `/api/v1/jobs/{jobId}` | Ottenere stato ed errori del processo |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Annullare un processo in coda o in esecuzione |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Ottenere PDF, log, errori strutturati o SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Ottenere un’anteprima `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Contrassegnare per l’eliminazione un processo terminato |
| `GET` / `POST` | `/api/v1/projects` | Elencare o creare progetti salvati |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Consultare dettagli e revisioni, rinominare o eliminare il progetto (nascondere la registrazione) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Salvare un input pronto come revisione immutabile |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Ottenere la cronologia dei processi di una revisione |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Convertire di nuovo una revisione |

> [!DETAILS] Progetti salvati e modalità di manutenzione
>
> - **Parametri dei progetti.** Usa `cursor` e `pageSize` per impaginare elenchi, dettagli e cronologia dei processi. Per salvare una revisione (`POST .../revisions`), invia `sourceId`, `entrypoint` (percorso relativo a un file `.tex`), `displayName`, `originalFilename` e `outputs`. Se coincidono progetto, input e punto di ingresso, la revisione viene riutilizzata. Il rendering di una revisione (`POST .../render`) richiede una `Idempotency-Key` da 16 a 200 caratteri. Se ometti `outputs`, vengono usate le impostazioni iniziali.
> - **Restrizioni di manutenzione**
>   - `reject-new-jobs` permette di consultare, rinominare ed eliminare progetti, salvare revisioni e preparare input. I nuovi processi vengono rifiutati.
>   - `read-only` e `lockdown` rifiutano modifiche ai progetti, prenotazioni, caricamenti, revisioni e riferimenti agli input. I caricamenti già prenotati ricontrollano la modalità prima della pubblicazione e non si completano se la nuova modalità lo vieta.

## Creare un processo {#ジョブ作成}

### Metodo 1. Preparare un input riutilizzabile prima di creare il processo (consigliato) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Prenota l’input.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Carica lo ZIP solo quando `uploadRequired: true`. Dimensione e SHA-256 devono corrispondere esattamente alla prenotazione. La risposta di successo è HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Crea il processo con il `sourceId` pronto. Il valore predefinito di `entrypoint` è `main.tex` e quello di `outputs` è `["pdf"]`. Non è consentito richiedere solo `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

La risposta omette `uploadTicket` e `uploadUrl` perché lo ZIP è già disponibile.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metodo 2. Prenotare e caricare direttamente per un solo processo {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Invia lo ZIP all’`uploadUrl` restituito (`/api/v1/jobs/{jobId}/source`) usando il `uploadTicket` e il metodo `PUT`. La risposta di successo è HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Conservazione degli input e Idempotency-Key
>
> - **Input orfani e riferimenti.** Un input pronto senza revisioni attive o processi che lo referenzino viene rimosso per impostazione predefinita dopo 1 ora. Sono inclusi anche i processi terminati, tranne `deleted` e `expired`. L’amministratore può regolare `source_orphan_retention_minutes` tra 5 minuti e 24 ore. Un input con un riferimento valido rimane disponibile e riutilizzabile oltre il termine previsto per gli orfani. Se il termine è già trascorso alla scomparsa dell’ultimo riferimento, l’input diventa inaccessibile e può essere rimosso. Un riferimento non rende nuovamente pronto un input caricato solo in parte o in eliminazione.
> - **Significato di `expiresAt`.** Prima del caricamento indica la scadenza della prenotazione incompleta (10 minuti). Quando l’input è pronto, indica quando scadrebbe senza riferimenti. Il comportamento è uguale nel web, nell’API HTTP e in MCP. Un `sourceRef` MCP dura al massimo 15 minuti e non prolunga la conservazione dell’input.
> - **Gestione di `Idempotency-Key`.** Quando si riutilizza uno ZIP identico, la chiave viene registrata per 24 ore dall’accettazione. Le ritrasmissioni non prolungano la durata. Entro il termine, contenuti diversi restituiscono `409`, un input originale scaduto restituisce `410`, uno eliminato restituisce `404` e un caricamento in corso restituisce `409`. Dopo 24 ore puoi riutilizzare la chiave senza attendere la pulizia periodica. Questo non ripristina l’input originale.

### PDF disponibile in anticipo e nuovi tentativi SVG {#pdfの先行公開とsvgの再試行}

Per le istruzioni relative a web e CLI, consulta [Ottenere PDF, PNG e SVG](/it/docs/outputs/).

- **Accesso anticipato e `stages`.** In un processo PDF e SVG, il PDF verificato e le anteprime sono disponibili prima del completamento degli SVG. Il `status` globale indica il risultato complessivo. `stages.pdf` (con `sha256`) e `stages.svg` (con `attempt`) riportano stato, ora di completamento ed errori di ciascuna fase. Questi campi non vengono dedotti per i processi meno recenti.
- **Riprovare solo gli SVG.** Usa `POST /api/v1/render-tickets` con autenticazione tramite chiave API (non accetta `jobTicket`), corpo `{"retrySvgJobId":"job_..."}` e una `Idempotency-Key`. Restituisce il `jobTicket` originale e ripete l’estrazione senza ricompilare il PDF o prolungarne la conservazione. Sono ammessi fino a 8 tentativi incluso il primo se input, PDF e ambiente di esecuzione coincidono. La diagnostica SVG è disponibile in `svg/compile.log`, `svg/errors.json` e `svg/dependencies.json`.

> [!DETAILS] Coordinate e schema di `svg/manifest.json` (schemaVersion 2)
>
> Gli SVG vengono salvati come `svg/objects/math-NNNNNN.svg` o `tikz-NNNNNN.svg` con `Content-Type: image/svg+xml` e `Content-Disposition: attachment`. Se il numero di oggetti non corrisponde o viene rilevato contenuto attivo (riferimenti esterni, script o attributi di evento), fallisce l’intero processo. `svg/manifest.json` registra le corrispondenze. I nuovi output usano sempre `schemaVersion: 2` e resta supportata la lettura della versione `1`.
>
> - **Coordinate (`coordinateSystem`).** `id` e `page` iniziano da 1. L’unità è il punto PDF (1/72 di pollice), con origine nell’angolo in alto a sinistra, asse x verso destra e asse y verso il basso.
> - **Posizione nota (`placementStatus: "known"`)**
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
> - **Posizione sconosciuta (`placementStatus: "unknown"`).** Se SyncTeX non riesce a distinguere, per esempio, più espressioni sulla stessa riga, i campi `page`, `x` e `y` vengono omessi senza stimare le coordinate. In tal caso `width` e `height` misurano l’SVG estratto e non la sua posizione nel PDF. Verifica `schemaVersion` e `placementStatus` prima di sovrapporre l’oggetto al PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Caricare lo ZIP {#zipアップロード}

Questo endpoint carica uno ZIP per un processo prenotato con il flusso precedente. Per un input preparato separatamente usa `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Stati del processo {#ジョブ状態}

| Stato | Significato | Azione del client |
| --- | --- | --- |
| `reserved` / `uploading` | Prenotato o in caricamento | Inviare lo ZIP prima della scadenza |
| `queued` / `validating` / `running` | In coda, in validazione o in compilazione | Attendere fra le interrogazioni |
| `succeeded` | Riuscito | Scaricare il PDF e i file necessari |
| `failed` / `timeout` / `rejected` | Errore, tempo scaduto o rifiuto | Controllare gli errori |
| `canceled` | Annullato | Creare un nuovo processo se occorre |
| `deleting` / `deleted` / `expired` | In eliminazione, eliminato o scaduto | Creare un nuovo processo se occorre |

**Conservazione e protezione dei download in corso**
Trascorso `ARTIFACT_RETENTION_HOURS` (24 ore per impostazione predefinita) dal completamento o, per i processi precedenti privi di questo dato, dall’ultimo aggiornamento, non si possono iniziare download anche se restano file in attesa di pulizia. La regola vale per web, API, renderer e Remote MCP. Download, recuperi di ZIP e letture MCP iniziati in tempo rinnovano la protezione dall’eliminazione solo durante il trasferimento dei dati. La protezione viene rilasciata al termine o alla disconnessione. In caso di interruzione anomala scade 5 minuti dopo l’ultimo rinnovo. Se il rinnovo fallisce, il trasferimento viene interrotto senza riattivare file scaduti.

## Errori comuni {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Stato HTTP | Significato | Quando riprovare |
| --- | --- | --- |
| `400` | Input, intestazioni o contenuto ZIP non validi | Correggere i dati prima dell’invio |
| `401` / `403` | Token non valido, scaduto o con ambito insufficiente | Verificare credenziali e permessi |
| `404` / `410` | Processo o file assente, processo di un’altra chiave o input scaduto | Creare un processo se occorre |
| `409` | Stato incompatibile o conflitto di `Idempotency-Key` | Controllare lo stato corrente |
| `429` / `503` | Limite di frequenza, capacità insufficiente, coda piena o manutenzione | Attendere prima di riprovare |

## Esempio con curl {#curlの例}

Questo esempio completo per Bash su Linux prenota l’input, carica `source.zip`, interroga lo stato ogni 2 secondi per un massimo di 60 volte e salva il PDF. Eseguilo nella directory dello ZIP. Richiede `curl`, `jq`, `sha256sum` e `uuidgen`. Per l’hosting in proprio cambia `base`.

> [!DETAILS] Caricare uno ZIP e scaricare il PDF
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

Se dopo 60 interrogazioni il processo è ancora in sospeso, usa il `jobId` mostrato per controllare lo stesso processo in seguito. Se `jobTicket` scade, chiama `POST /api/v1/job-tickets/{jobId}` con la chiave API che ha creato il processo. Gli esempi seguenti mostrano la prenotazione e il caricamento dello ZIP.

## PowerShell {#powershell}

> [!DETAILS] Esempio PowerShell
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

> [!DETAILS] Esempio JavaScript / TypeScript
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

> [!DETAILS] Esempio Python
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
