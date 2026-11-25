---
slug: api
category: API
title: Öffentliche API
description: Senden Sie ein ZIP über HTTP, fragen Sie den Status der Umwandlung ab und laden Sie das PDF herunter.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Ablauf {#利用の流れ}

Bereiten Sie einen Render-API-Schlüssel (`lrk_...`) und eine [kompatible ZIP-Datei](/de/docs/projects/#構成) vor. Den gesamten Ablauf können Sie mit dem [curl-Beispiel](#curlの例) testen.

1. **Quellen reservieren.** Berechnen Sie die ZIP-Größe in Byte und den SHA-256-Wert. Reservieren Sie den Quelldatensatz (Source) mit `POST /api/v1/source-tickets`.
2. **ZIP hochladen.** Nur wenn `uploadRequired` den Wert `true` hat, senden Sie das ZIP mit der zurückgegebenen URL und dem kurzlebigen `uploadTicket` per `PUT`. Liegt bereits ein identisches gültiges ZIP desselben Benutzers vor, wird es wiederverwendet.
3. **Auftrag erstellen.** Geben Sie die vorbereitete `sourceId` und den relativen Pfad des Hauptdokuments (`entrypoint`) in `POST /api/v1/render-tickets` an. Für eine einmalige Umwandlung können Sie auch den [früheren Ablauf](#ジョブ作成) verwenden, der die Schritte 1 bis 3 zusammenfasst.
4. **Status prüfen und herunterladen.** Fragen Sie mit dem kurzlebigen `jobTicket` regelmäßig `GET /api/v1/jobs/{jobId}` ab und rufen Sie nach Abschluss das PDF und weitere Dateien ab.

OpenAPI-Definitionen beschreiben [Reservierungen und Auftragserstellung (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) sowie [Uploads und Download der Ergebnisse (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Authentifizierung und Berechtigungsbereiche {#認証とスコープ}

Übermitteln Sie alle Zugangsdaten im HTTP-Header `Authorization: Bearer <TOKEN>`.

- **API-Schlüssel (`lrk_...`).** Für Reservierung von Quellen, Auftragserstellung, Projektverwaltung, erneute Ausstellung von Auftragstoken (`job-tickets`) und SVG-Wiederholungen.
  - `render:create` erlaubt das Erstellen von Aufträgen sowie das Anlegen, Umbenennen und Entfernen von Projekten und Speichern von Revisionen.
  - `render:read:own` erlaubt die Erneuerung kurzlebiger Token für eigene Aufträge und das Abrufen von Projekten und Verlauf.
- **Kurzlebige Token (`uploadTicket` und `jobTicket`).** Für ZIP-Upload, Statusabfrage, Abbruch, Dateidownload und Löschung eines Auftrags.

> [!WARNING]
> Halten Sie API-Schlüssel, `uploadTicket` und `jobTicket` aus Protokollen, URL-Abfrageparametern und Eingabe-ZIPs heraus.

> [!NOTE]
> **Ein Auftrag gehört dem Schlüssel, der ihn erstellt hat.** Ein anderer Schlüssel kann selbst beim selben Benutzer oder Dienstkonto weder `job-tickets` erneuern noch die Erstellungsantwort mit derselben `Idempotency-Key` erneut abrufen oder SVG wiederholen. Der Server gibt `404` zurück. Durch Widerruf des ursprünglichen Schlüssels wird das Eigentum nicht übertragen. Quellen und Projekte werden von Schlüsseln desselben Benutzers gemeinsam genutzt. Ein anderer Schlüssel kann mit einer neuen `Idempotency-Key` einen **neuen Auftrag** aus gemeinsamen Quellen anlegen.

## API-Endpunkte {#apiエンドポイント}

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Quellen reservieren oder ein ZIP desselben Benutzers wiederverwenden |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Eingabe-ZIP hochladen und prüfen |
| `POST` | `/api/v1/render-tickets` | Auftrag aus Quellen erstellen, SVG wiederholen oder Upload für einen einzelnen Auftrag reservieren |
| `POST` | `/api/v1/job-tickets/{jobId}` | `jobTicket` für einen eigenen Auftrag neu ausstellen |
| `PUT` | `/api/v1/jobs/{jobId}/source` | ZIP im früheren Einzelauftragsablauf direkt hochladen |
| `GET` | `/api/v1/jobs/{jobId}` | Status und Fehler des Auftrags abrufen |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Wartenden oder laufenden Auftrag abbrechen |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF, Protokolle, strukturierte Fehler oder SVG abrufen |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Vorschau `page-N.png` abrufen |
| `DELETE` | `/api/v1/jobs/{jobId}` | Abgeschlossenen Auftrag zum Löschen vormerken |
| `GET` / `POST` | `/api/v1/projects` | Gespeicherte Projekte auflisten oder anlegen |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Details und Revisionen abrufen, Projekt umbenennen oder entfernen (Eintrag ausblenden) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Vorbereitete Quellen als unveränderliche Revision speichern |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Auftragsverlauf einer Revision abrufen |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Revision erneut umwandeln |

> [!DETAILS] Gespeicherte Projekte und Wartungsmodi
>
> - **Projektparameter.** Mit `cursor` und `pageSize` blättern Sie durch Listen, Details und Auftragsverlauf. Zum Speichern einer Revision (`POST .../revisions`) senden Sie `sourceId`, `entrypoint` (relativer Pfad zu einer `.tex`), `displayName`, `originalFilename` und `outputs`. Stimmen Projekt, Quellen und Einstiegspunkt überein, wird die Revision wiederverwendet. Das Rendern einer Revision (`POST .../render`) erfordert eine `Idempotency-Key` mit 16 bis 200 Zeichen. Fehlt `outputs`, gelten die anfänglichen Einstellungen.
> - **Einschränkungen bei Wartung**
>   - `reject-new-jobs` erlaubt das Anzeigen, Umbenennen und Entfernen von Projekten, das Speichern von Revisionen und das Vorbereiten von Quellen. Neue Aufträge werden abgewiesen.
>   - `read-only` und `lockdown` lehnen Projektänderungen sowie Reservierungen, Uploads, Revisionen und Referenzen von Quellen ab. Bereits reservierte Uploads prüfen den Modus vor Veröffentlichung erneut und werden nicht abgeschlossen, wenn der neue Modus dies verbietet.

## Auftrag erstellen {#ジョブ作成}

### Methode 1. Wiederverwendbare Quellen vor dem Auftrag vorbereiten (empfohlen) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reservieren Sie die Quellen.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Laden Sie das ZIP nur bei `uploadRequired: true` hoch. Größe und SHA-256 müssen der Reservierung exakt entsprechen. Die Erfolgsantwort ist HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Erstellen Sie den Auftrag mit der bereitstehenden `sourceId`. Der Standard für `entrypoint` ist `main.tex`, für `outputs` ist es `["pdf"]`. Ausschließlich `["svg"]` anzufordern ist nicht zulässig.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Die Antwort enthält weder `uploadTicket` noch `uploadUrl`, da das ZIP bereits vorhanden ist.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Methode 2. Direkt für einen einzelnen Auftrag reservieren und hochladen {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Senden Sie das ZIP an die zurückgegebene `uploadUrl` (`/api/v1/jobs/{jobId}/source`) mit dem `uploadTicket` und der Methode `PUT`. Die Erfolgsantwort ist HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Quellenaufbewahrung und Idempotency-Key
>
> - **Verwaiste Quellen und Referenzen.** Vorbereitete Quellen ohne Verweis durch eine aktive Revision oder einen Auftrag werden standardmäßig nach 1 Stunde bereinigt. Abgeschlossene Aufträge zählen ebenfalls, außer `deleted` und `expired`. Die Administration kann `source_orphan_retention_minutes` zwischen 5 Minuten und 24 Stunden einstellen. Gültig referenzierte Quellen werden über die Frist für verwaiste Quellen hinaus aufbewahrt und bleiben nutzbar. Ist die Frist beim Wegfall der letzten Referenz bereits abgelaufen, werden die Quellen unzugänglich und können bereinigt werden. Eine Referenz macht nur teilweise hochgeladene oder in Löschung befindliche Quellen nicht wieder bereit.
> - **Bedeutung von `expiresAt`.** Vor dem Upload ist dies der Ablaufzeitpunkt der unvollständigen Reservierung (10 Minuten). Bei fertigen Quellen gibt der Wert den Ablaufzeitpunkt ohne Referenzen an. Das gilt für Web, HTTP-API und MCP. Ein `sourceRef` von MCP ist höchstens 15 Minuten gültig und verlängert die Aufbewahrung der Quellen nicht.
> - **Verhalten von `Idempotency-Key`.** Bei Wiederverwendung eines identischen ZIP wird der Schlüssel ab Annahme für 24 Stunden registriert. Erneutes Senden verlängert die Frist nicht. Innerhalb der Frist liefert abweichender Inhalt `409`, abgelaufene ursprüngliche Quellen liefern `410`, gelöschte Quellen `404` und ein laufender Upload `409`. Nach 24 Stunden lässt sich der Schlüssel ohne Warten auf die Bereinigung wiederverwenden. Die ursprünglichen Quellen werden dadurch nicht wiederhergestellt.

### Frühe PDF-Verfügbarkeit und SVG-Wiederholungen {#pdfの先行公開とsvgの再試行}

Hinweise für Web und CLI stehen unter [PDF, PNG und SVG abrufen](/de/docs/outputs/).

- **Vorabzugriff und `stages`.** Bei einem Auftrag für PDF und SVG sind geprüftes PDF und Vorschauen schon vor Abschluss der SVGs verfügbar. Der globale `status` beschreibt das Gesamtergebnis. `stages.pdf` (mit `sha256`) und `stages.svg` (mit `attempt`) geben Status, Abschlusszeit und Fehler der einzelnen Phasen an. Für ältere Aufträge werden die Felder nicht nachträglich abgeleitet.
- **Nur SVG wiederholen.** Verwenden Sie `POST /api/v1/render-tickets` mit API-Schlüssel-Authentifizierung (`jobTicket` ist nicht zulässig), dem Request-Body `{"retrySvgJobId":"job_..."}` und einer `Idempotency-Key`. Die Antwort enthält die ursprüngliche `jobTicket`. Die Extraktion wird ohne erneute PDF-Kompilierung und ohne Fristverlängerung wiederholt. Höchstens 8 Versuche einschließlich des ersten sind bei übereinstimmenden Quellen, PDF und Laufzeitumgebung möglich. SVG-Diagnosen stehen in `svg/compile.log`, `svg/errors.json` und `svg/dependencies.json`.

> [!DETAILS] Koordinaten und Schema von `svg/manifest.json` (schemaVersion 2)
>
> SVGs werden als `svg/objects/math-NNNNNN.svg` oder `tikz-NNNNNN.svg` mit `Content-Type: image/svg+xml` und `Content-Disposition: attachment` gespeichert. Bei abweichender Objektzahl oder aktivem Inhalt (externe Verweise, Skripte oder Ereignisattribute) schlägt der gesamte Auftrag fehl. `svg/manifest.json` enthält die Zuordnungen. Neue Ausgaben verwenden immer `schemaVersion: 2`. Version `1` bleibt lesbar.
>
> - **Koordinaten (`coordinateSystem`).** `id` und `page` beginnen bei 1. Die Einheit ist der PDF-Punkt (1/72 Zoll), mit Ursprung oben links, x nach rechts und y nach unten.
> - **Bekannte Position (`placementStatus: "known"`)**
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
> - **Unbekannte Position (`placementStatus: "unknown"`).** Kann SyncTeX beispielsweise mehrere Ausdrücke in derselben Zeile nicht unterscheiden, entfallen `page`, `x` und `y` ohne Koordinatenschätzung. In diesem Fall beschreiben `width` und `height` die Größe des extrahierten SVGs und nicht die Position im PDF. Prüfen Sie `schemaVersion` und `placementStatus` vor dem Einblenden über dem PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## ZIP hochladen {#zipアップロード}

Dieser Endpunkt lädt ein ZIP für einen im früheren Ablauf reservierten Auftrag hoch. Für separat vorbereitete Quellen verwenden Sie `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Auftragsstatus {#ジョブ状態}

| Status | Bedeutung | Aktion des Clients |
| --- | --- | --- |
| `reserved` / `uploading` | Reserviert oder im Upload | ZIP vor Ablauf senden |
| `queued` / `validating` / `running` | Wartend, in Prüfung oder Kompilierung | Zwischen Abfragen warten |
| `succeeded` | Erfolgreich | PDF und benötigte Dateien herunterladen |
| `failed` / `timeout` / `rejected` | Fehlgeschlagen, Zeitlimit erreicht oder abgewiesen | Fehler prüfen |
| `canceled` | Abgebrochen | Bei Bedarf neuen Auftrag erstellen |
| `deleting` / `deleted` / `expired` | In Löschung, gelöscht oder abgelaufen | Bei Bedarf neuen Auftrag erstellen |

**Aufbewahrung und Schutz laufender Downloads**
Ist `ARTIFACT_RETENTION_HOURS` (standardmäßig 24 Stunden) seit Abschluss oder, bei älteren Aufträgen ohne diese Angabe, seit der letzten Aktualisierung verstrichen, kann auch bei noch nicht bereinigten Dateien kein neuer Download beginnen. Das gilt für Web, API, Renderer und Remote MCP. Rechtzeitig begonnene Downloads, ZIP-Abrufe und MCP-Lesevorgänge erneuern ihren Löschschutz nur bei laufender Datenübertragung. Er endet bei Abschluss oder Trennung. Bei ungewöhnlichem Abbruch läuft er 5 Minuten nach der letzten Erneuerung aus. Schlägt die Erneuerung fehl, bricht die Übertragung ab, ohne abgelaufene Dateien zu reaktivieren.

## Häufige Fehler {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-Status | Bedeutung | Wann wiederholen |
| --- | --- | --- |
| `400` | Ungültige Eingabe, Header oder ZIP-Inhalte | Vor dem Senden korrigieren |
| `401` / `403` | Token ungültig, abgelaufen oder Berechtigung unzureichend | Zugangsdaten und Berechtigungen prüfen |
| `404` / `410` | Auftrag oder Datei fehlt, gehört einem anderen Schlüssel oder Quellen abgelaufen | Bei Bedarf neuen Auftrag erstellen |
| `409` | Unvereinbarer Zustand oder Konflikt bei `Idempotency-Key` | Aktuellen Zustand abfragen |
| `429` / `503` | Anfragelimit, fehlende Kapazität, volle Warteschlange oder Wartung | Vor dem nächsten Versuch warten |

## curl-Beispiel {#curlの例}

Dieses vollständige Bash-Beispiel für Linux reserviert die Quellen, lädt `source.zip` hoch, fragt den Status bis zu 60-mal alle 2 Sekunden ab und speichert das PDF. Führen Sie es im ZIP-Ordner aus. Es benötigt `curl`, `jq`, `sha256sum` und `uuidgen`. Ändern Sie bei einem eigenen Server `base`.

> [!DETAILS] ZIP hochladen und PDF herunterladen
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

Ist der Auftrag nach 60 Abfragen noch offen, verwenden Sie die angezeigte `jobId`, um ihn später erneut abzufragen. Läuft `jobTicket` ab, rufen Sie `POST /api/v1/job-tickets/{jobId}` mit dem API-Schlüssel auf, der den Auftrag erstellt hat. Die folgenden Beispiele zeigen Reservierung und ZIP-Upload.

## PowerShell {#powershell}

> [!DETAILS] PowerShell-Beispiel
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

> [!DETAILS] JavaScript-/TypeScript-Beispiel
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

> [!DETAILS] Python-Beispiel
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
