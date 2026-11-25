---
slug: api
category: API
title: Veřejné API
description: Odešlete ZIP přes HTTP, sledujte stav převodu a stáhněte PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Průběh zpracování {#利用の流れ}

Připravte si klíč vykreslovacího API (`lrk_...`) a [podporovaný ZIP](/cs/docs/projects/#構成). Celý postup si můžete vyzkoušet v [příkladu s curl](#curlの例).

1. **Rezervujte vstup.** Spočítejte velikost ZIP v bajtech a SHA-256. Pomocí `POST /api/v1/source-tickets` rezervujte sadu zdrojových souborů (Source).
2. **Nahrajte ZIP.** Pouze pokud `uploadRequired` má hodnotu `true`, odešlete ZIP na vrácenou adresu pomocí krátkodobého `uploadTicket` a metody `PUT`. Pokud již existuje totožný platný ZIP téhož uživatele, použije se znovu.
3. **Vytvořte úlohu.** Předejte připravené `sourceId` a relativní cestu hlavního dokumentu (`entrypoint`) do `POST /api/v1/render-tickets`. Pro jediný převod můžete použít i [starší postup](#ジョブ作成), který spojuje kroky 1 až 3.
4. **Sledujte stav a stáhněte výsledek.** S krátkodobým `jobTicket` se pravidelně dotazujte na `GET /api/v1/jobs/{jobId}` a po dokončení stáhněte PDF a další soubory.

Definice OpenAPI pokrývají [rezervaci a vytváření úloh (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) a [nahrávání a stahování výsledků (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Ověření a rozsahy oprávnění {#認証とスコープ}

Všechny přihlašovací údaje předávejte v hlavičce HTTP `Authorization: Bearer <TOKEN>`.

- **Klíč API (`lrk_...`).** Slouží k rezervaci vstupů, vytváření úloh, práci s projekty, opětovnému vydání tokenu úlohy (`job-tickets`) a opakování SVG.
  - `render:create` umožňuje vytvářet úlohy, vytvářet, přejmenovávat a mazat projekty a ukládat revize.
  - `render:read:own` umožňuje obnovovat krátkodobé tokeny vlastních úloh a číst projekty a historii.
- **Krátkodobé tokeny (`uploadTicket` a `jobTicket`).** Slouží k nahrání ZIP, čtení stavu, zrušení, stažení souborů nebo odstranění úlohy.

> [!WARNING]
> Klíč API, `uploadTicket` ani `jobTicket` nevkládejte do protokolů, řetězců dotazů URL ani vstupních ZIP.

> [!NOTE]
> **Úloha patří klíči, který ji vytvořil.** Jiný klíč, byť stejného uživatele nebo účtu služby, nemůže obnovit `job-tickets`, přehrát odpověď na vytvoření se stejným `Idempotency-Key` ani zopakovat SVG. Server vrátí `404`. Odvolání původního klíče nepřenáší vlastnictví. Vstupy a projekty však klíče stejného uživatele sdílejí. Jiný klíč může ze sdíleného vstupu s novým `Idempotency-Key` vytvořit **novou úlohu**.

## Koncové body API {#apiエンドポイント}

| Metoda | Cesta | Účel |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Rezervace vstupu nebo opětovné použití ZIP stejného uživatele |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Nahrání a ověření vstupního ZIP |
| `POST` | `/api/v1/render-tickets` | Vytvoření úlohy ze vstupu, opakování SVG nebo rezervace nahrávání pro jedinou úlohu |
| `POST` | `/api/v1/job-tickets/{jobId}` | Opětovné vydání `jobTicket` pro vlastní úlohu |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Přímé nahrání ZIP ve starším postupu pro jedinou úlohu |
| `GET` | `/api/v1/jobs/{jobId}` | Získání stavu a chyb úlohy |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Zrušení čekající či probíhající úlohy |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Získání PDF, protokolů, strukturovaných chyb nebo SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Získání náhledu `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Označení dokončené úlohy k odstranění |
| `GET` / `POST` | `/api/v1/projects` | Výpis nebo vytvoření uložených projektů |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Čtení podrobností a revizí, přejmenování nebo odstranění projektu (skrytí záznamu) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Uložení připraveného vstupu jako neměnné revize |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Získání historie úloh revize |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Opětovný převod revize |

> [!DETAILS] Uložené projekty a režimy údržby
>
> - **Parametry projektu.** Seznamy, podrobnosti a historii úloh stránkujte pomocí `cursor` a `pageSize`. Pro uložení revize (`POST .../revisions`) odešlete `sourceId`, `entrypoint` (relativní cesta k `.tex`), `displayName`, `originalFilename` a `outputs`. Při shodě projektu, vstupu a hlavního souboru se použije existující revize. Vykreslení revize (`POST .../render`) vyžaduje `Idempotency-Key` o délce 16 až 200 znaků. Pokud vynecháte `outputs`, použijí se počáteční nastavení.
> - **Omezení během údržby**
>   - `reject-new-jobs` povoluje čtení, přejmenování a odstranění projektů, ukládání revizí a přípravu vstupů. Nové úlohy se odmítají.
>   - `read-only` a `lockdown` odmítají změny projektů a rezervace, nahrávání, revize i odkazy na vstupy. U již rezervovaných vstupů se režim znovu ověřuje před zveřejněním. Nahrávání se nedokončí, pokud mezitím začal platit zakazující režim.

## Vytvoření úlohy {#ジョブ作成}

### Metoda 1. Příprava opakovaně použitelného vstupu před vytvořením úlohy (doporučeno) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Rezervujte vstup.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. ZIP nahrajte pouze při `uploadRequired: true`. Jeho velikost a SHA-256 musejí přesně odpovídat rezervaci. Úspěšná odpověď je HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Z připraveného `sourceId` vytvořte úlohu. Výchozí hodnotou `entrypoint` je `main.tex` a výchozí hodnotou `outputs` je `["pdf"]`. Samotné `["svg"]` nelze požadovat.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Odpověď vynechá `uploadTicket` a `uploadUrl`, protože ZIP je již k dispozici.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metoda 2. Rezervace a přímé nahrání pro jedinou úlohu {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Odešlete ZIP na vrácenou adresu `uploadUrl` (`/api/v1/jobs/{jobId}/source`) s `uploadTicket` pomocí metody `PUT`. Úspěšná odpověď je HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Uchování vstupů a Idempotency-Key
>
> - **Osiřelé vstupy a odkazy.** Připravený vstup bez odkazu z aktivních revizí nebo úloh se ve výchozím nastavení čistí po 1 hodině. Počítají se i dokončené úlohy kromě `deleted` a `expired`. Správce může nastavit `source_orphan_retention_minutes` od 5 minut do 24 hodin. Platný odkaz umožní vstup uchovat a opakovaně použít i po uplynutí lhůty pro osiřelé vstupy. Pokud tato lhůta již uplynula při zániku posledního odkazu, vstup bude nedostupný a může být vyčištěn. Odkaz nevrátí nedokončené nahrávání nebo odstraňovaný vstup do připraveného stavu.
> - **Význam `expiresAt`.** Před nahráním označuje konec nedokončené rezervace (10 minut). Po přípravě ukazuje, kdy by vstup vypršel bez odkazů. Platí to pro web, HTTP API i MCP. `sourceRef` v MCP platí až 15 minut a neprodlužuje uchování vstupu.
> - **Zpracování `Idempotency-Key`.** Při opětovném použití stejného ZIP se klíč zaznamená na 24 hodin od přijetí. Opakované odeslání tuto dobu neprodlouží. V tomto období jiný obsah vrátí `409`, vypršení původního vstupu `410`, odstraněný vstup `404` a probíhající nahrávání `409`. Po 24 hodinách můžete klíč znovu použít bez čekání na pravidelné čištění. Původní vstup se tím neobnoví.

### Včasná dostupnost PDF a opakování SVG {#pdfの先行公開とsvgの再試行}

Postup pro web a CLI popisuje [Získání PDF, PNG a SVG](/cs/docs/outputs/).

- **Dřívější přístup a `stages`.** U úlohy s PDF a SVG jsou ověřené PDF a náhledy dostupné před dokončením SVG. Celkové `status` označuje výsledek sady. `stages.pdf` (s `sha256`) a `stages.svg` (s `attempt`) uvádějí stav, čas dokončení a chyby každé fáze. U starších úloh se pole zpětně neodvozují.
- **Opakování pouze SVG.** Použijte `POST /api/v1/render-tickets` s ověřením klíčem API (`jobTicket` se nepřijímá), tělem `{"retrySvgJobId":"job_..."}` a `Idempotency-Key`. Vrátí se původní `jobTicket` a zopakuje se extrakce bez nového překladu PDF či prodloužení uchování. Pokud vstup, PDF a prostředí odpovídají, je povoleno nejvýše 8 pokusů včetně prvního. Diagnostiku SVG obsahují `svg/compile.log`, `svg/errors.json` a `svg/dependencies.json`.

> [!DETAILS] Souřadnice a schéma `svg/manifest.json` (schemaVersion 2)
>
> SVG se ukládají jako `svg/objects/math-NNNNNN.svg` nebo `tikz-NNNNNN.svg` spolu s `Content-Type: image/svg+xml` a `Content-Disposition: attachment`. Neshoda počtu objektů nebo aktivní obsah (externí odkazy, skripty či atributy událostí) způsobí selhání celé úlohy. `svg/manifest.json` popisuje přiřazení. Nové výstupy vždy používají `schemaVersion: 2`, ale čtení verze `1` je nadále podporováno.
>
> - **Souřadnice (`coordinateSystem`).** `id` i `page` začínají na 1. Jednotkou je bod PDF (1/72 palce). Počátek je vlevo nahoře, osa x směřuje doprava a osa y dolů.
> - **Známá poloha (`placementStatus: "known"`)**
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
> - **Neznámá poloha (`placementStatus: "unknown"`).** Pokud SyncTeX například nerozliší více výrazů na stejném řádku, `page`, `x` a `y` se vynechají bez odhadu souřadnic. Hodnoty `width` a `height` pak měří extrahované SVG a neurčují polohu v PDF. Než umístíte objekt přes PDF, zkontrolujte `schemaVersion` a `placementStatus`.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Nahrání ZIP {#zipアップロード}

Tento koncový bod nahrává ZIP k úloze rezervované starším postupem. Pro samostatně připravený vstup použijte `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Stavy úlohy {#ジョブ状態}

| Stav | Význam | Co má klient udělat |
| --- | --- | --- |
| `reserved` / `uploading` | Rezervováno nebo probíhá nahrávání | Odeslat ZIP před vypršením |
| `queued` / `validating` / `running` | Ve frontě, ověřování nebo překlad | Mezi dotazy vyčkat |
| `succeeded` | Úspěch | Stáhnout PDF a potřebné soubory |
| `failed` / `timeout` / `rejected` | Selhání, překročení času nebo odmítnutí | Zkontrolovat chyby |
| `canceled` | Zrušeno | V případě potřeby vytvořit novou úlohu |
| `deleting` / `deleted` / `expired` | Odstraňuje se, odstraněno nebo vypršelo | V případě potřeby vytvořit novou úlohu |

**Uchování a ochrana probíhajícího stahování**
Po uplynutí `ARTIFACT_RETENTION_HOURS` (výchozí hodnota 24 hodin) od dokončení nebo u starších úloh bez tohoto času od poslední aktualizace nelze začít stahovat, i když soubory ještě čekají na vyčištění. Platí to pro web, API, vykreslovací službu i Remote MCP. Včas zahájená stažení, načítání ZIP a čtení MCP obnovují ochranu proti smazání pouze během přenosu dat. Při dokončení nebo odpojení se ochrana uvolní. Při nestandardním přerušení přenosu vyprší 5 minut po posledním obnovení. Selhání obnovení zastaví přenos bez opětovného zpřístupnění vypršených souborů.

## Časté chyby {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Stav HTTP | Význam | Kdy opakovat |
| --- | --- | --- |
| `400` | Neplatný vstup, hlavičky nebo obsah ZIP | Opravit data před odesláním |
| `401` / `403` | Neplatný token, vypršení nebo chybějící oprávnění | Ověřit údaje a oprávnění |
| `404` / `410` | Chybějící úloha či soubor, jiný klíč vlastníka nebo vypršelý vstup | V případě potřeby vytvořit úlohu |
| `409` | Nekompatibilní stav nebo konflikt `Idempotency-Key` | Zkontrolovat aktuální stav |
| `429` / `503` | Omezení četnosti, nedostatek kapacity, plná fronta nebo údržba | Před dalším pokusem vyčkat |

## Příklad s curl {#curlの例}

Tento úplný příklad pro Bash v Linuxu rezervuje vstup, nahraje `source.zip`, zkontroluje stav nejvýše 60krát v intervalu 2 sekund a uloží PDF. Spusťte jej v adresáři se ZIP. Potřebujete `curl`, `jq`, `sha256sum` a `uuidgen`. Pro vlastní server změňte `base`.

> [!DETAILS] Nahrání ZIP a stažení PDF
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

Pokud po 60 dotazech úloha ještě neskončila, zkontrolujte ji později pomocí zobrazeného `jobId`. Vyprší-li `jobTicket`, zavolejte `POST /api/v1/job-tickets/{jobId}` s klíčem API, který úlohu vytvořil. Následující příklady zahrnují rezervaci a nahrání ZIP.

## PowerShell {#powershell}

> [!DETAILS] Příklad v PowerShellu
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

> [!DETAILS] Příklad v JavaScriptu / TypeScriptu
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

> [!DETAILS] Příklad v Pythonu
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
