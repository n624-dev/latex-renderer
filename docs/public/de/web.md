---
slug: web
category: Webanwendung
title: Dokumente im Browser umwandeln
description: Erstellen Sie aus einer TeX- oder ZIP-Datei ein PDF und rufen Sie frühere Ergebnisse ab.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Ein PDF im Browser erstellen {#ブラウザでpdfへ変換}

1. Öffnen Sie die [Webanwendung](/app/) und melden Sie sich mit dem von der Administration angegebenen Verfahren an.
2. Wählen Sie die Dateien aus oder ziehen Sie sie auf die Seite.
   - Besteht das Dokument aus einer einzigen Datei, wählen Sie die `.tex` direkt aus.
   - Enthält es Bilder, Literaturdatenbanken oder mehrere `.tex` (etwa über `\input`), packen Sie das Dokument und seine Abhängigkeiten in eine `.zip`. Siehe [Unterstützte Dateien und ZIP-Struktur](/de/docs/projects/).
   - Wählen Sie mehrere einzelne `.tex` aus, wird jede als eigenständiges Dokument umgewandelt.
3. Enthält das ZIP mehrere `.tex` und erscheint eine Auswahl, wählen Sie das Hauptdokument als Einstiegspunkt.
4. Klicken Sie auf **In PDF umwandeln**. Nach Abschluss erscheinen das PDF und die Seitenvorschauen auf der Ergebnisseite.

Um einen anderen Satzmotor als LuaLaTeX zu verwenden, wählen Sie ihn unter **Ziel und Ausgabeoptionen → Engine**. Die [Render-Umgebung](/app/environment/) zeigt verfügbare Motoren und die Prüfergebnisse für PDF, SVG und SVG-Positionen. pLaTeX und upLaTeX erfordern die japanische Sammlung auf dem Server.

## Dokumente im Browser bearbeiten {#ブラウザーで文書を編集する}

1. Öffnen Sie ein Dokument unter [Projekte](/app/projects/) und wählen Sie **TeX bearbeiten**. Ein neues Projekt beginnt mit einer leeren `main.tex`. Sie können auch eine Vorlage wählen.
2. Änderungen werden automatisch im Entwurf gespeichert. Mit **Datei anhängen** fügen Sie Bilder oder Literaturdatenbanken hinzu.
3. Aktivieren Sie **Automatisch kompilieren**, um das PDF nach einer Schreibpause zu aktualisieren. Für eine sofortige Aktualisierung klicken Sie auf **Kompilieren**.
4. Klicken Sie auf **Version speichern**, um die Quellen im Verlauf zu behalten. Mit **Ab dieser Revision bearbeiten** können Sie eine gespeicherte Fassung weiterbearbeiten. Ist bereits ein Entwurf vorhanden, müssen Sie das Ersetzen bestätigen.

Öffnen Sie **Dateien verwalten**, um Dateien hinzuzufügen oder anzuhängen. Unter **Einstellungen** können Sie die Engine, die automatische Kompilierung und die Anzeigesprache ändern oder eine Version speichern. Über **⋯** im PDF-Bereich öffnen Sie die Optionen für Zoom und PNG.

Schlägt die Kompilierung fehl, bleiben der Entwurf und das letzte erfolgreiche PDF erhalten. Wählen Sie einen Fehler mit Dateiname und Zeilennummer, um zur betreffenden Zeile zu springen. Auf Mobilgeräten wechseln Sie zwischen **Code**, **PDF** und **Fehler**. Lädt das PDF langsam, verwenden Sie **PNG (ressourcenschonende Vorschau)**.

Temporäre Vorschauen erscheinen nur im Editor. Möchten Sie ein PDF behalten, laden Sie es mit **PDF speichern** herunter.

Der Editor verwendet UTF-8. Öffnen Sie Shift_JIS- oder EUC-JP-Dateien in einem Texteditor mit ihrer ursprünglichen Kodierung, prüfen Sie die Darstellung und speichern Sie eine Kopie als UTF-8. Hängen Sie die Kopie unter demselben Namen an und bestätigen Sie das Ersetzen.

## Formeln und TikZ-Grafiken als SVG ausgeben {#数式や-tikz-を-svg-で取得する}

1. Öffnen Sie vor der Umwandlung **Ziel und Ausgabeoptionen** und aktivieren Sie **Formeln und TikZ auch als SVG exportieren**.
2. Sie können das PDF herunterladen, sobald es fertig ist.
3. Bei **Teilerfolg** ist das PDF fertig, die SVG-Extraktion ist jedoch fehlgeschlagen. Speichern Sie zuerst das PDF und klicken Sie bei Bedarf auf **Nur SVG erneut versuchen**.

Zunächst wird nur die PNG-Vorschau der ersten Seite erzeugt. Weitere Seiten entstehen beim Öffnen. Sie können das fertige PDF herunterladen, während Vorschauen vorbereitet werden. Siehe [PDF, PNG und SVG abrufen](/de/docs/outputs/).

## Frühere Dokumente und Ergebnisse öffnen {#以前の文書や結果を開く}

- Im **[Verlauf](/app/history/)** sehen Sie den Fortschritt und die erzeugten Dateien. Auch nach dem Schließen des Browsers können Sie dieselbe Ergebnisseite wieder aufrufen.
- Unter **[Projekte](/app/projects/)** finden Sie gespeicherte Dokumente und Revisionen. Zum Umwandeln früherer Quellen öffnen Sie die Revision und klicken auf **Erneut umwandeln**.
- In der **[Render-Umgebung](/app/environment/)** können Sie nach LaTeX-Paketen und Schriftarten auf dem Server suchen.

## Öffentliche und private Informationen {#公開される情報}

- **Seiten mit Anmeldung.** Melden Sie sich bei der Webanwendung (`/app/`) an, um Ihre Dokumente und Umwandlungen im Verlauf oder auf der Ergebnisseite anzusehen. Nur Administrierende und Eigentümer haben Zugriff auf die Verwaltung (`/admin/`). Siehe [Sicherheit von Konten und Dokumenten](/de/docs/security/).
- **Öffentliche Seiten.** Bei Anmeldeproblemen helfen der [Dienststatus](/status/) und die [Fehlerbehebung](/de/docs/troubleshooting/). Die CLI steht unter [Downloads](/downloads/) bereit, die Integrationsspezifikationen finden Sie unter [Öffentliche API](/de/docs/api/).
