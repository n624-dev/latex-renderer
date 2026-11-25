---
slug: api
category: API
title: Publiczne API
description: Prześlij ZIP przez HTTP, sprawdź stan konwersji i pobierz PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Przebieg operacji {#利用の流れ}

Przygotuj klucz API renderowania (`lrk_...`) oraz [obsługiwane archiwum ZIP](/pl/docs/projects/#構成). Aby sprawdzić cały proces, zobacz [przykład z curl](#curlの例).

1. **Zarezerwuj wejście.** Oblicz rozmiar ZIP w bajtach i sumę SHA-256. Zarezerwuj zestaw plików źródłowych (Source) przez `POST /api/v1/source-tickets`.
2. **Prześlij ZIP.** Tylko gdy `uploadRequired` ma wartość `true`, użyj zwróconego adresu URL i krótkotrwałego `uploadTicket`, aby wysłać ZIP metodą `PUT`. Prawidłowe identyczne archiwum tego samego użytkownika zostanie użyte ponownie.
3. **Utwórz zadanie.** Użyj przygotowanego `sourceId` i ścieżki względnej głównego dokumentu (`entrypoint`) w `POST /api/v1/render-tickets`. Przy pojedynczej konwersji możesz również skorzystać z [wcześniejszej procedury](#ジョブ作成) łączącej kroki 1–3.
4. **Sprawdź stan i pobierz wynik.** Użyj krótkotrwałego `jobTicket`, aby regularnie odpytywać `GET /api/v1/jobs/{jobId}`, a po zakończeniu pobrać PDF i pozostałe pliki.

Definicje OpenAPI opisują [rezerwacje i tworzenie zadań (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) oraz [przesyłanie danych i pobieranie wyników (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Uwierzytelnianie i zakresy uprawnień {#認証とスコープ}

Wszystkie dane dostępowe przesyłaj w nagłówku HTTP `Authorization: Bearer <TOKEN>`.

- **Klucz API (`lrk_...`).** Służy do rezerwacji wejścia, tworzenia zadań, obsługi projektów, ponownego wydawania tokenów zadania (`job-tickets`) i ponawiania SVG.
  - `render:create` zezwala na tworzenie zadań, tworzenie i usuwanie projektów, zmianę ich nazw i zapis rewizji.
  - `render:read:own` zezwala na odnawianie krótkotrwałych tokenów własnych zadań i odczyt projektów oraz historii.
- **Krótkotrwałe tokeny (`uploadTicket` i `jobTicket`).** Służą do przesyłania ZIP, sprawdzania stanu, anulowania, pobierania plików lub usuwania zadania.

> [!WARNING]
> Nie umieszczaj klucza API, `uploadTicket` ani `jobTicket` w dziennikach, parametrach zapytań URL ani wejściowych ZIP.

> [!NOTE]
> **Zadanie należy do klucza, który je utworzył.** Inny klucz, nawet tego samego użytkownika lub konta usługi, nie może odnowić `job-tickets`, odtworzyć odpowiedzi na żądanie utworzenia z tym samym `Idempotency-Key` ani ponowić SVG. Serwer zwróci `404`. Unieważnienie pierwotnego klucza nie przenosi własności. Klucze tego samego użytkownika współdzielą jednak dane wejściowe i projekty. Innym kluczem można utworzyć **nowe zadanie** ze wspólnego wejścia za pomocą nowego `Idempotency-Key`.

## Punkty końcowe API {#apiエンドポイント}

| Metoda | Ścieżka | Cel |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Rezerwacja zestawu wejściowego lub ponowne użycie ZIP tego samego użytkownika |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Przesłanie i weryfikacja wejściowego ZIP |
| `POST` | `/api/v1/render-tickets` | Utworzenie zadania z wejścia, ponowienie SVG lub rezerwacja przesyłania dla pojedynczego zadania |
| `POST` | `/api/v1/job-tickets/{jobId}` | Ponowne wydanie `jobTicket` dla własnego zadania |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Bezpośrednie przesłanie ZIP w starszej procedurze dla pojedynczego zadania |
| `GET` | `/api/v1/jobs/{jobId}` | Pobranie stanu i błędów zadania |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Anulowanie zadania oczekującego lub wykonywanego |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Pobranie PDF, dzienników, ustrukturyzowanych błędów lub SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Pobranie podglądu `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Oznaczenie zakończonego zadania do usunięcia |
| `GET` / `POST` | `/api/v1/projects` | Wyświetlenie listy lub utworzenie zapisanego projektu |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Odczyt szczegółów i rewizji, zmiana nazwy lub usunięcie projektu (ukrycie wpisu) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Zapisanie gotowego wejścia jako niezmiennej rewizji |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Pobranie historii zadań rewizji |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Ponowna konwersja rewizji |

> [!DETAILS] Zapisane projekty i tryby konserwacji
>
> - **Parametry projektu.** Polecenia listy, szczegółów i historii zadań stronicuj przez `cursor` i `pageSize`. Aby zapisać rewizję (`POST .../revisions`), prześlij `sourceId`, `entrypoint` (ścieżka względna pliku `.tex`), `displayName`, `originalFilename` i `outputs`. Jeśli projekt, wejście i plik główny są takie same, używana jest istniejąca rewizja. Renderowanie rewizji (`POST .../render`) wymaga `Idempotency-Key` o długości od 16 do 200 znaków. Po pominięciu `outputs` są używane początkowe ustawienia.
> - **Ograniczenia konserwacji**
>   - `reject-new-jobs` zezwala na przeglądanie i usuwanie projektów, zmianę ich nazw, zapisywanie rewizji i przygotowanie wejść. Blokuje nowe zadania.
>   - `read-only` i `lockdown` blokują zmiany projektów oraz rezerwację, przesyłanie, modyfikacje i odwołania do wejść. Przed udostępnieniem wcześniej zarezerwowanego wejścia tryb jest ponownie sprawdzany. Przesyłanie nie zostanie zakończone, jeśli bieżący tryb na to nie zezwala.

## Tworzenie zadania {#ジョブ作成}

### Metoda 1. Przygotowanie wejścia wielokrotnego użytku przed utworzeniem zadania (zalecane) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Zarezerwuj wejście.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Prześlij ZIP tylko wtedy, gdy `uploadRequired: true`. Jego rozmiar i SHA-256 muszą dokładnie odpowiadać rezerwacji. Poprawna odpowiedź to HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Utwórz zadanie z gotowego `sourceId`. Domyślna wartość `entrypoint` to `main.tex`, a `outputs` to `["pdf"]`. Żądanie samego `["svg"]` jest niedozwolone.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Odpowiedź pomija `uploadTicket` i `uploadUrl`, ponieważ ZIP jest już dostępny.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Metoda 2. Rezerwacja i bezpośrednie przesłanie dla pojedynczego zadania {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Prześlij ZIP pod zwrócony adres `uploadUrl` (`/api/v1/jobs/{jobId}/source`) z użyciem `uploadTicket` i metody `PUT`. Poprawna odpowiedź to HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Przechowywanie wejść i Idempotency-Key
>
> - **Osierocone wejścia i odwołania.** Gotowe wejście bez odwołań z aktywnych rewizji lub zadań jest domyślnie usuwane po 1 godzinie. Zakończone zadania również są liczone, poza `deleted` i `expired`. Administrator może ustawić `source_orphan_retention_minutes` na wartość od 5 minut do 24 godzin. Jeśli istnieje prawidłowe odwołanie, wejście pozostaje dostępne do ponownego użycia po upływie terminu dla osieroconych wejść. Jeśli ten termin już upłynął, utrata ostatniego odwołania powoduje niedostępność wejścia i umożliwia jego usunięcie. Samo odwołanie nie przywraca gotowości wejścia w trakcie przesyłania lub usuwania.
> - **Znaczenie `expiresAt`.** Przed przesłaniem określa termin wygaśnięcia nieukończonej rezerwacji (10 minut). Po przygotowaniu wskazuje termin wygaśnięcia przy braku odwołań. Zasada jest taka sama dla strony, API HTTP i MCP. Token `sourceRef` w MCP jest ważny maksymalnie 15 minut i nie przedłuża przechowywania wejścia.
> - **Obsługa `Idempotency-Key`.** Przy ponownym użyciu identycznego ZIP klucz jest zapisywany na 24 godziny od przyjęcia. Ponowne wysłanie nie przedłuża tego okresu. W tym czasie inna treść zwraca `409`, wygaśnięcie pierwotnego wejścia `410`, usunięte wejście `404`, a przesyłanie w toku `409`. Po 24 godzinach możesz ponownie użyć klucza bez oczekiwania na okresowe czyszczenie. Nie przywraca to pierwotnego wejścia.

### Wcześniejszy dostęp do PDF i ponowienia SVG {#pdfの先行公開とsvgの再試行}

Instrukcje dla strony i CLI znajdziesz w [Pobieranie PDF, PNG i SVG](/pl/docs/outputs/).

- **Wcześniejszy dostęp i `stages`.** W zadaniu PDF i SVG można pobrać zweryfikowany PDF i podglądy przed zakończeniem SVG. Ogólne `status` opisuje wynik całego zestawu. `stages.pdf` (z `sha256`) oraz `stages.svg` (z `attempt`) podają stan, czas zakończenia i błędy poszczególnych etapów. Dla starszych zadań pola te nie są wyznaczane na podstawie innych danych.
- **Ponawianie tylko SVG.** Wywołaj `POST /api/v1/render-tickets` z uwierzytelnieniem kluczem API (`jobTicket` nie jest obsługiwany), treścią `{"retrySvgJobId":"job_..."}` i `Idempotency-Key`. Zwracany jest pierwotny `jobTicket`, a wyodrębnianie odbywa się ponownie bez kompilacji PDF ani przedłużenia czasu przechowywania. Dopuszczalnych jest do 8 prób łącznie z pierwszą, o ile wejście, PDF i środowisko wykonawcze są zgodne. Diagnostykę SVG zawierają `svg/compile.log`, `svg/errors.json` i `svg/dependencies.json`.

> [!DETAILS] Współrzędne i schemat `svg/manifest.json` (schemaVersion 2)
>
> SVG są zapisywane jako `svg/objects/math-NNNNNN.svg` lub `tikz-NNNNNN.svg` z `Content-Type: image/svg+xml` i `Content-Disposition: attachment`. Niezgodna liczba obiektów lub treść aktywna (odwołania zewnętrzne, skrypty, atrybuty zdarzeń) powodują niepowodzenie całego zadania. `svg/manifest.json` określa powiązania. Nowe wyniki zawsze używają `schemaVersion: 2`, a odczyt wersji `1` pozostaje obsługiwany.
>
> - **Współrzędne (`coordinateSystem`).** `id` i `page` są numerowane od 1. Jednostką jest punkt PDF (1/72 cala). Początek znajduje się w lewym górnym rogu, oś x biegnie w prawo, a y w dół.
> - **Znane położenie (`placementStatus: "known"`)**
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
> - **Nieznane położenie (`placementStatus: "unknown"`).** Jeśli SyncTeX nie rozróżnia np. kilku wyrażeń w jednym wierszu, pola `page`, `x` i `y` są pomijane bez szacowania współrzędnych. Wtedy `width` i `height` opisują wymiary wyodrębnionego SVG, a nie jego położenie w PDF. Przed nałożeniem obiektu na PDF sprawdź `schemaVersion` i `placementStatus`.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Przesyłanie ZIP {#zipアップロード}

Ten punkt końcowy przesyła ZIP do zadania zarezerwowanego starszą procedurą. Dla osobno przygotowanego wejścia użyj `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Stany zadania {#ジョブ状態}

| Stan | Znaczenie | Działanie klienta |
| --- | --- | --- |
| `reserved` / `uploading` | Zarezerwowano lub trwa przesyłanie | Wyślij ZIP przed wygaśnięciem |
| `queued` / `validating` / `running` | W kolejce, weryfikacja lub kompilacja | Odczekaj między zapytaniami |
| `succeeded` | Sukces | Pobierz PDF i potrzebne pliki |
| `failed` / `timeout` / `rejected` | Błąd, przekroczony czas lub odrzucenie | Sprawdź błędy |
| `canceled` | Anulowano | W razie potrzeby utwórz nowe zadanie |
| `deleting` / `deleted` / `expired` | Trwa usuwanie, usunięto lub wygasło | W razie potrzeby utwórz nowe zadanie |

**Przechowywanie i ochrona trwającego pobierania**
Po upływie `ARTIFACT_RETENTION_HOURS` (domyślnie 24 godziny) od zakończenia, a dla starych zadań bez tej informacji od ostatniej aktualizacji, nie można rozpocząć pobierania, nawet jeśli pliki czekają jeszcze na usunięcie. Dotyczy to strony, API, renderera i Remote MCP. Pobieranie, odzyskiwanie ZIP i odczyty MCP rozpoczęte w terminie odnawiają ochronę przed usunięciem wyłącznie podczas przesyłania danych. Ochrona kończy się po ukończeniu lub rozłączeniu. Jeśli przesyłanie zostanie nietypowo przerwane, ochrona wygasa 5 minut po ostatnim odnowieniu. Błąd odnowienia przerywa transfer bez przywracania wygasłych plików.

## Typowe błędy {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Stan HTTP | Znaczenie | Kiedy ponowić |
| --- | --- | --- |
| `400` | Niepoprawne dane wejściowe, nagłówki lub zawartość ZIP | Popraw dane przed ponownym wysłaniem |
| `401` / `403` | Niepoprawny lub wygasły token albo niedostateczny zakres | Sprawdź dane dostępowe i uprawnienia |
| `404` / `410` | Brak zadania lub pliku, inny klucz właściciela albo wygasłe wejście | W razie potrzeby utwórz zadanie |
| `409` | Niezgodny stan lub konflikt `Idempotency-Key` | Sprawdź bieżący stan |
| `429` / `503` | Limit żądań, brak zasobów, pełna kolejka lub konserwacja | Odczekaj przed ponowieniem |

## Przykład z curl {#curlの例}

Ten kompletny przykład dla Bash w systemie Linux rezerwuje wejście, przesyła `source.zip`, sprawdza stan co 2 sekundy do 60 razy i zapisuje PDF. Uruchom go w katalogu zawierającym ZIP. Wymaga `curl`, `jq`, `sha256sum` i `uuidgen`. W przypadku własnego serwera zmień `base`.

> [!DETAILS] Przesłanie ZIP i pobranie PDF
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

Jeśli po 60 zapytaniach zadanie nadal trwa, użyj wyświetlonego `jobId`, aby sprawdzić je później. Jeśli `jobTicket` wygaśnie, wywołaj `POST /api/v1/job-tickets/{jobId}` z kluczem API, który utworzył zadanie. Kolejne przykłady obejmują rezerwację i przesłanie ZIP.

## PowerShell {#powershell}

> [!DETAILS] Przykład w PowerShell
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

> [!DETAILS] Przykład w JavaScript / TypeScript
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

> [!DETAILS] Przykład w Pythonie
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
