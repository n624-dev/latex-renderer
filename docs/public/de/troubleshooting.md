---
slug: troubleshooting
category: Fehlerbehebung und Sicherheit
title: Fehlerbehebung
description: Finden Sie die Ursache von Problemen bei Anmeldung, Installation, Umwandlung und Download.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Erste Prüfungen {#確認する順序}

1. **Prüfen Sie den [Dienststatus](/status/)** auf allgemeine Störungen oder Wartungsarbeiten.
2. **Prüfen Sie den vorhandenen Auftrag.** Haben Sie die Umwandlung bereits gestartet, öffnen Sie denselben Auftrag im **Verlauf** oder führen Sie `n624-latex jobs get <jobId>` in der CLI aus.
3. **Lesen Sie Diagnose und Protokoll.** Öffnen Sie im Web die Diagnose der Ergebnisseite. In der CLI finden Sie sie in `.render/errors.json` und im ausführlichen Protokoll `.render/compile.log`.

## Häufige Probleme {#代表的な問題}

### Installation und Anmeldung {#インストール-ログイン}

- **`n624-latex` oder `latex-render` wird nicht gefunden.**
  Öffnen Sie ein neues Terminal oder PowerShell-Fenster. Besteht das Problem fort, prüfen Sie den [PATH unter Linux oder macOS](/de/docs/client/#linux-macos) oder die [Installationsanleitung für Windows](/de/docs/windows/#インストール).
- **Anmeldung bei der Webanwendung nicht möglich.**
  Verwenden Sie das registrierte Konto und das vorgegebene Verfahren (Passwort, OIDC oder Cloudflare Access). Bleibt die Verbindung aus ChatGPT oder Claude hängen, siehe [Remote-MCP-Verbindung prüfen](/de/docs/mcp/#chatgptなどの接続を確認する).
- **Die CLI gibt `401` oder `403` zurück.**
  Prüfen Sie den hinterlegten Schlüssel mit `n624-latex auth status`. Lassen Sie die Administration prüfen, ob er aktiv ist und die Berechtigungen `render:create` und `render:read:own` hat. [Hinterlegen Sie den Schlüssel bei Bedarf erneut](/de/docs/cli/#認証). Prüfen Sie bei einem eigenen Server auch die [Server-URL (`LATEX_RENDER_BASE_URL`)](/de/docs/cli/#接続先サーバー).

### Hochladen und Umwandeln {#アップロード-変換}

- **Das Hauptdokument wird im ZIP nicht gefunden.**
  Standard ist `main.tex` im Stammverzeichnis. Prüfen Sie, ob der übergeordnete Ordner mitgepackt wurde, oder geben Sie den relativen Pfad des Dokuments an. Siehe [ZIP vorbereiten](/de/docs/projects/#構成).
- **Dateigröße oder Erweiterung wird abgewiesen.**
  Entfernen Sie unnötige generierte oder nicht unterstützte Dateien oder konfigurieren Sie `.latexrenderignore`. Prüfen Sie die [unterstützten Dateien und Grenzen](/de/docs/projects/#制限).
- **Die Umwandlung bleibt in der Warteschlange oder die Verbindung bricht ab.**
  Der Server kann weiterarbeiten. Öffnen Sie dieselbe Ergebnisseite oder prüfen Sie dieselbe Auftrags-ID, bevor Sie einen neuen Auftrag erstellen.
- **Pakete oder Schriftarten fehlen oder das Zeitlimit wurde erreicht.**
  Suchen Sie verfügbare Namen in der [Render-Umgebung](/app/environment/). Prüfen Sie bei einer Zeitüberschreitung komplexe Makros, große Bilder und TikZ-Grafiken nahe der letzten Protokollstelle.

### Dateien herunterladen {#成果物の取得}

- **Ein PDF ist vorhanden, aber keine SVGs.**
  Bei **Teilerfolg** speichern Sie zuerst das PDF und wählen dann **Nur SVG erneut versuchen**. Siehe [SVG-Extraktion wiederholen](/de/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **Die PNG-Vorschau wird noch vorbereitet.**
  Warten Sie kurz oder öffnen Sie dieselbe Seite erneut. Das fertige PDF lässt sich bereits herunterladen.
- **Das Ziel ist belegt oder `OUTPUT_BUSY` erscheint.**
  Schließen Sie den Betrachter, der das Ausgabe-PDF geöffnet hat, oder warten Sie, bis der Schreibvorgang im Ordner abgeschlossen ist, und laden Sie die Datei erneut herunter.
- **Ergebnis abgelaufen oder Speicherplatz erschöpft.**
  Wandeln Sie bei abgelaufenem Ergebnis die gespeicherte Revision oder lokale Dateien erneut um. Bei erschöpftem Kontingent löschen Sie nicht mehr benötigte abgeschlossene Aufträge. Ist der Datenträger des Servers voll, informieren Sie die Administration.

## Hilfe anfordern {#問い合わせ}

- **Serveradministration.** Geben Sie Zeitpunkt, betroffenen Vorgang, Fehlercode und falls vorhanden die Auftrags-ID (`job_...`) an.
- **Öffentliche Meldung auf GitHub.** Geben Sie die nötigen Schritte zum Nachvollziehen des Problems ohne Geheimnisse und persönliche Dokumente an. **Veröffentlichen Sie niemals API-Schlüssel, Cookies, das Originaldokument, das PDF oder vollständige unbereinigte Protokolle.**
