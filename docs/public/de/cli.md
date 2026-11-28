---
slug: cli
category: CLI
title: Dokumente mit der CLI umwandeln und Ergebnisse herunterladen
description: Kompilieren Sie TeX im Terminal und laden Sie PDF, Protokolle und Vorschauen herunter.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Führen Sie im Ordner mit `main.tex` den Befehl `n624-latex main.tex` aus, um das PDF dort zu speichern. Bei der ersten Verwendung [installieren Sie die CLI](/de/docs/client/) und richten die Verbindung ein.

## Authentifizierung {#認証}

Öffnen Sie die Einstellungen im Browser, um den API-Schlüssel zu speichern.

```sh
n624-latex setup --gui
```

Können Sie keinen Browser öffnen, etwa in einer SSH-Sitzung, hinterlegen Sie den Schlüssel über die **Standardeingabe**, damit er nicht in den Befehlsargumenten erscheint. Führen Sie in Bash oder Zsh die erste Zeile aus, fügen Sie den Schlüssel ein, drücken Sie die Eingabetaste und führen Sie die weiteren Zeilen aus.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Unter Windows können Sie auch die [verdeckte Eingabe des Installationsprogramms](/de/docs/windows/#インストール) verwenden.

Mit diesen Befehlen prüfen Sie, ob ein Schlüssel gespeichert ist, bzw. löschen ihn.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` zeigt die tatsächlich verwendete Serveradresse und die Quelle der Zugangsdaten: den Namen eines gespeicherten Profils, die Umgebungsvariable `LATEX_RENDER_API_KEY` oder keine. Mit `--json` erscheinen die Felder `origin` und `credentialSource`.

- Ist die Umgebungsvariable `LATEX_RENDER_API_KEY` gesetzt, hat sie Vorrang vor dem lokalen Schlüssel.
- `logout` entfernt nur den lokal gespeicherten Schlüssel. Heben Sie die Umgebungsvariable bei Bedarf separat auf oder widerrufen Sie den Schlüssel auf dem Server.

### Server wählen {#接続先サーバー}

Standardmäßig verbindet sich die CLI mit dem gehosteten Dienst (`https://latex-render.n624.jp`). Für einen eigenen Server setzen Sie dessen HTTPS-URL in der Terminalsitzung, in der Sie die Befehle ausführen.

- Lassen Sie `/app/` und `/api/v1/` am Ende der URL weg.
- Verwenden Sie einen von diesem Server ausgestellten API-Schlüssel.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Einstellungen und Diagnose {#セットアップと診断}

Öffnen Sie die Verbindungs- und Integrationseinstellungen mit `n624-latex setup`. Bei Verbindungsproblemen prüfen Sie zuerst den Zustand mit den folgenden Befehlen. Wird `n624-latex` nicht gefunden, siehe [Installation und PATH](/de/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` prüft Installation und Zugangsdaten schreibgeschützt, ohne den Wert des API-Schlüssels auszugeben. Bei Problemen liefert der Befehl den Exitcode `2`.

| Installation | Aktualisierung und Reparatur |
| --- | --- |
| APT | [Mit APT aktualisieren](/de/docs/client/#apt-版の更新) oder beschädigte Pakete [neu installieren](/de/docs/client/#状態確認と修復). [Local MCP manuell registrieren](/de/docs/mcp/#local-mcpの登録). |
| Homebrew | [Mit Homebrew aktualisieren](/de/docs/client/#homebrew-版の更新) oder beschädigte Pakete [neu installieren](/de/docs/client/#状態確認と修復). KI-Integrationen mit `n624-latex setup` einrichten. |
| Installationsprogramm zum Herunterladen | [In den Einstellungen aktualisieren](/de/docs/client/#配布インストーラー版の更新). Verwaltete Startprogramme und Integrationen mit `n624-latex setup repair` reparieren. |

Zur Deinstallation folgen Sie den [Anweisungen für Ihre Installationsart](/de/docs/client/#アンインストール). Die Einstellungsoberfläche läuft lokal und schließt beim Beenden der CLI.

## Rendern {#レンダリング}

### Eine TeX-Datei direkt umwandeln {#tex-ファイルを直接変換する}

Geben Sie die `.tex` im Projektordner an, um das PDF zu erzeugen. Auf Bilder, Literaturdatenbanken und lokale `.sty` können Sie über relative Pfade verweisen.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Ohne `-o` wird im Aufrufordner ein PDF mit demselben Basisnamen gespeichert, zum Beispiel `main.pdf`.
- Bei LaTeX-Fehlern werden, soweit ermittelbar, Datei, Zeile und Auftrags-ID ausgegeben. Schlagen Kompilierung oder Download fehl, bleibt das zuletzt erfolgreich gespeicherte PDF erhalten.

#### LaTeX-Satzmotor wählen {#latex-のエンジンを選ぶ}

Stellen Sie für XeLaTeX den Motornamen vor den Dateinamen.

```sh
n624-latex xelatex main.tex
```

Geben Sie keinen Motor an, sucht die CLI am Dokumentanfang nach `% !TeX program = xelatex` oder
`% !TEX TS-program = xelatex`. Fehlt eine solche Anweisung, liest sie
`.n624-latex.json` im Projektstamm. Diese Datei können Sie
über Git teilen, um auf anderen Rechnern denselben Motor zu verwenden.

```json
{"engine":"xelatex"}
```

Ohne Angabe wird LuaLaTeX verwendet. pLaTeX und upLaTeX setzen voraus,
dass die Laufzeitumgebung des Servers die japanische Sammlung enthält.

| Satzmotor | Bei der Migration eines Dokuments prüfen |
| --- | --- |
| LuaLaTeX | Konfiguration für Dokumente prüfen, die `fontspec` oder LuaTeX-ja nutzen. |
| pdfLaTeX | `fontspec` wird nicht unterstützt. Schriftkonfiguration für pdfLaTeX verwenden. |
| XeLaTeX | Unterstützt `fontspec`. Auf nur mit LuaTeX nutzbare Pakete prüfen. |
| pLaTeX / upLaTeX | Eine zum Motor passende japanische Dokumentklasse verwenden. Für `jsarticle` unter upLaTeX die Klassenoption `uplatex` angeben. |

Die Literaturverarbeitung richtet sich nach Paketen und Dokumentkonfiguration. Legen Sie `.bib` und eigene `.bst` bei. BibTeX-Dokumente unter pLaTeX bzw. upLaTeX verwenden pBibTeX bzw. upBibTeX. Prüfergebnisse für PDF, SVG und SVG-Positionen finden Sie in der [Render-Umgebung](/app/environment/).

### ZIP umwandeln oder mehrere Ausgaben anfordern {#zip-複数の出力を指定する}

Verwenden Sie den Unterbefehl `render`, um eine ZIP-Datei umzuwandeln oder alle Ausgaben einschließlich Protokollen, Vorschauen und SVGs herunterzuladen.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Beispiele**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Standardpfad ist der aktuelle Ordner, der Standardwert von `--entrypoint` ist `main.tex`. Die CLI bereitet eine Eingabe aus bis zu 500 Dateien vor und wartet auf den Abschluss. Als Einstiegspunkt ist ein relativer Pfad zu einer `.tex` zulässig. Der Server prüft die Sicherheit des Pfads und die Existenz der Datei.
- Mit `--svg` werden auch die äußersten mathematischen Ausdrücke und TikZ-Grafiken der obersten Ebene als einzelne SVGs extrahiert.

### Quellen für mehrere Dokumente wiederverwenden {#同じ入力から複数の文書を作る-source-の再利用}

Enthält ein Ordner oder ZIP mehrere Hauptdokumente, laden Sie die Quellen einmal mit `source upload` hoch und verwenden deren Kennung erneut. Geben Sie für jeden Auftrag einen eigenen Ausgabeordner (`--output`) an.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Zielbereinigung, Ausschlüsse und doppelte Uploads
>
> - **Frühere Ausgaben bereinigen.** Bei erneut verwendetem Ziel werden nur PDF-, Vorschau- und SVG-Dateien entfernt, die im früheren `job.json` aufgeführt waren und im neuen Ergebnis fehlen. Auftragsfremde Benutzerdateien bleiben erhalten.
> - **Ziel prüfen.** Pfade mit symbolischen Links werden abgewiesen. Auf POSIX-Systemen werden außerdem Eigentümer und Schreibrechte für Gruppe und andere geprüft. Windows überspringt die Prüfung der POSIX-Modusbits.
> - **Ausgabeordner ausschließen.** Zeigt `--output` auf einen Unterordner des Projekts, wird genau dieser Ordner vom nächsten ZIP ausgeschlossen. Ähnlich benannte Ordner bleiben enthalten. Der Projektstamm darf nicht das Ausgabeziel sein.
> - **Doppelte Uploads.** Liegt beim Server ein gültiges ZIP desselben Eigentümers mit demselben SHA-256 vor, gibt er `uploadRequired: false` zurück und überspringt die Übertragung. Nur dieser Eigentümer kann die Quellenkennung für spätere Aufträge verwenden.

## Gespeicherte Projekte und Revisionen {#保存projectと改訂}

Mit der CLI verwalten und kompilieren Sie Projekte und Revisionen auf dem Server erneut. Web, API, MCP und weitere Schlüssel desselben Benutzers teilen die Projekte. Für die temporären Vorgänge `render` und `source upload` muss kein Projekt gespeichert werden.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** bereitet Ordner oder ZIP als Eingabe vor und speichert eine unveränderliche Projektrevision. Mit `--svg` sind PDF und SVG die anfänglichen Ausgabeformate der Revision.
- **`render`** erstellt einen Auftrag aus einer gespeicherten Revision. Nur `--svg` überschreibt die Ausgabeeinstellungen.
- **`list`, `get` und `jobs`** akzeptieren `--cursor` zum Abrufen der nächsten Seite.
- **`delete`** blendet das Projekt aus der Liste aus. Vorhandene Aufträge werden nicht sofort gelöscht.

## Aufträge verwalten {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Herunterladen und warten.** Diese Befehle verwenden den API-Schlüssel, um ein kurzlebiges Token zu erneuern. `jobs download` wartet auf den Abschluss des Auftrags, bevor die gespeicherten Dateien ersetzt werden. Scheitert das Warten oder wird es unterbrochen, bleiben die bisherigen Dateien erhalten. `delete` gilt nur für abgeschlossene Aufträge.
- **Weitere PNG-Vorschauen abrufen.** Zunächst wird nur die erste Seite erzeugt. Ein normaler Download ruft bereits vorhandene PNGs ab. Mit beispielsweise `--preview-page 2 5` können Sie die angegebenen Seiten erzeugen, Größe und SHA-256 prüfen und sie speichern. Das PDF wird nicht erneut kompiliert und die Aufbewahrungsfrist nicht verlängert.
- **PDF vorab herunterladen und SVG wiederholen.** Bei PDF-und-SVG-Aufträgen erhalten Sie mit `--pdf-only` das PDF, ohne auf SVGs zu warten. Scheitert nur die SVG-Extraktion, bleibt das PDF bei Teilerfolg erhalten. `retry-svg` wiederholt nur die Extraktion. Einschließlich des ersten Versuchs sind 8 Versuche ohne Verlängerung der Aufbewahrung möglich. Hat sich die Laufzeitumgebung geändert, legen Sie einen neuen Auftrag an. Siehe [Frühe PDF-Verfügbarkeit und SVG-Wiederholungen](/de/docs/api/#pdfの先行公開とsvgの再試行).
- **Wiederholungen bei Netzwerkproblemen.** Vorübergehend fehlgeschlagene Statusabfragen werden wiederholt. Authentifizierungs- und Berechtigungsfehler werden sofort zurückgegeben. Beendet die CLI das Warten, kann der Server weiterarbeiten. Prüfen Sie dieselbe `<jobId>`, bevor Sie einen neuen Auftrag erstellen. Siehe [Warten und Wiederholungen in der CLI](/de/docs/reference/#cliの待機と再試行).

## Ausgabedateien {#成果物}

Zum vorzeitigen PDF-Download, zur Auswahl von PNG-Seiten und zum Wiederholen von SVG siehe [PDF, PNG und SVG abrufen](/de/docs/outputs/).

| Pfad | Inhalt |
| --- | --- |
| `.render/result.pdf` | Erfolgreich erstelltes PDF |
| `.render/compile.log` | LaTeX-Kompilierungsprotokoll |
| `.render/errors.json` | Strukturierte Fehlerdetails |
| `.render/job.json` | Endzustand des Auftrags |
| `.render/previews/page-N.png` | Vorschauen für bis zu 100 Seiten |
| `.render/svg/manifest.json` | Zuordnung von SVGs zu Quellpositionen und PDF-Koordinaten |
| `.render/svg/objects/*.svg` | Einzelnes SVG für einen mathematischen Ausdruck oder eine TikZ-Grafik |

## JSON-Ausgabe {#json出力}

Ergänzen Sie einen Befehl um `--json`, um ein einzelnes JSON-Objekt ohne Fortschrittsmeldungen auf die Standardausgabe zu schreiben. Es verwendet dasselbe Ergebnis von `client-core` wie die normale Darstellung und enthält weder API-Schlüssel noch kurzlebige Token.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Erfolgs- und Fehlerschemata sowie Exitcodes stehen unter [JSON-Format der CLI](/de/docs/reference/#cliのjson形式).
