---
slug: projects
category: Projekte
title: TeX- und ZIP-Dateien vorbereiten
description: Bereiten Sie Quellen vor, prüfen Sie die Grenzen und testen Sie ein minimales LuaLaTeX-Projekt.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Projektstruktur {#構成}

- **Dokument aus einer Datei.** Laden Sie die `.tex` direkt in der Webanwendung hoch oder führen Sie `n624-latex main.tex` in der CLI aus.
- **Dokument mit Bildern, Literaturdatenbank oder mehreren Quelldateien.** Packen Sie alles in **eine ZIP-Datei** und behalten Sie relative Pfade bei. In der CLI können Sie auch einen Ordner angeben.
- **ZIP erstellen.** Wählen Sie zum Komprimieren den Ordnerinhalt wie `main.tex` und `images/` aus. Packen Sie den übergeordneten Ordner mit ein, müssen Sie beim Umwandeln einen Einstiegspfad wie `project/main.tex` angeben.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Einstiegspunkt und relative Pfade**
Standardmäßig ist `main.tex` im Projektstamm das Hauptdokument. Auch bei einer `.tex` in einem Unterordner, etwa `docs/main.tex`, **bleibt der Projektstamm das Arbeitsverzeichnis der Kompilierung**. Möchten Sie aus `docs/main.tex` die Datei `body.tex` im selben Ordner einbinden, schreiben Sie `\input{docs/body.tex}`. Bei `\input{body.tex}` sucht der Compiler `body.tex` im Projektstamm.

## Japanisches Minimalbeispiel {#日本語の最小例}

Der Standard-Satzmotor ist **LuaLaTeX**. Speichern Sie für ein japanisches Testdokument den folgenden Inhalt als `main.tex` in UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

In der [Render-Umgebung](/app/environment/) können Sie verfügbare Pakete und Schriftarten suchen. Die Liste entsteht bei der Bereitstellung aus dem Servercontainer und wird auch für Suchanfragen über Remote MCP verwendet. Fehlt ein Paket, senden Sie der Administration die zugehörige Meldung aus `compile.log`.

## Gespeicherte Projekte und Revisionen {#保存projectと改訂}

In der Webanwendung (`/app/`) umgewandelte Dokumente werden in Projekten gespeichert.

- **Automatische Revisionen.** Jede neue Kombination aus Inhalt, Hauptdokument, Satzmotor und Ausgabeformaten wird als Projektrevision gespeichert. Frühere Revisionen bleiben im Verlauf.
- **Frühere Revision umwandeln.** Klicken Sie auf **Erneut umwandeln**, um das gespeicherte Dokument und den gespeicherten Satzmotor zu verwenden. Ändern Sie hier die Ausgabeformate, erscheint das Ergebnis im Umwandlungsverlauf derselben Revision.
- **Freigabe und Löschung.** Webanwendung, CLI, HTTP-API und MCP teilen die Projekte und Revisionen eines Benutzers. Das Löschen eines Projekts blendet seinen Eintrag aus. Vorhandene Eingaben und Ausgaben werden gemäß der Aufbewahrungsfrist bereinigt. Für eine sofortige vollständige Löschung wenden Sie sich an die Administration. Von aktiven Revisionen referenzierte Quellen zählen zum Benutzerkontingent. Siehe [Gemeinsame Nutzung und Aufbewahrung](/de/docs/reference/#保存プロジェクトの共有-保持).

### Im Browser bearbeiten {#ブラウザーで編集する}

Öffnen Sie ein gespeichertes Projekt und wählen Sie **TeX bearbeiten**. Änderungen werden im Entwurf gespeichert. Nach einer Schreibpause beginnt die Kompilierung. Bei Erfolg wird das PDF aktualisiert. Scheitert die Vorschau, können Sie das letzte verfügbare PDF und die zugehörige Entwurfsversion einsehen.

Neue Projekte beginnen mit einer leeren `main.tex`. Solange das Hauptdokument leer ist, können Sie mit einer Vorlage beginnen. Mit **Ab dieser Revision bearbeiten** setzen Sie eine gespeicherte Fassung fort. Gibt es bereits einen Entwurf, bestätigen Sie vorab dessen Ersetzung.

Zum Kompilieren auf Anforderung deaktivieren Sie **Automatisch kompilieren** und klicken auf **Kompilieren**. Wählen Sie **Ausgaben der gespeicherten Version** und klicken Sie auf **Version speichern**, um Entwurf und Einstellungen zu behalten. Benötigen Sie SVG, öffnen Sie die gespeicherte Revision und klicken auf **Erneut umwandeln**.
Der Editor zeigt beim Arbeiten den Kompilierungsstatus und die Vorschau an.

## Vom Hochladen ausgeschlossene Dateien {#送信から除外されるもの}

- **Automatische Ausschlüsse.** Die CLI überspringt `.git`, `.render` und LaTeX-Hilfsdateien wie `.aux`. Symbolische Links werden abgewiesen.
- **Nicht unterstützte Dateien.** Verschieben Sie unnötige Ordner wie `node_modules` aus dem Projekt. Enthält ein zu sendender Ordner nicht unterstützte Erweiterungen, zeigt die CLI den Pfad an und bricht ab. Um eine Datei wie `README.md` im Projekt zu behalten, aber vom Hochladen auszunehmen, ergänzen Sie `.latexrenderignore` im Projektstamm um eine Zeile mit `README.md`. Der Server prüft dieselben Regeln für die Erweiterungen im ZIP.
- **Zulässige Erweiterungen** (Groß- und Kleinschreibung ist unerheblich)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst` sind BibTeX-Literaturstile und können in Unterordnern liegen. Hat ein eigener Stil eine nicht aufgeführte Erweiterung, fragen Sie die Administration, bevor Sie sie ändern.

## Grenzen {#制限}

- **Dateianzahl.** Höchstens 500.
- **Standardgrößen.** 20 MiB für das ZIP, 100 MiB insgesamt nach dem Entpacken und 20 MiB pro Datei.
- **Einstiegspunkt.** Relativer Pfad zu einer `.tex` innerhalb der Quellen. Standard ist `main.tex` im Projektstamm.
- **Sicherheit.** Shell-Zugriff aus TeX (einschließlich `\write18`), externe Befehle und externe Netzwerkverbindungen sind deaktiviert.
- **Ressourcen.** Die Administration legt Zeitgrenzen, Speicherplatz pro Benutzer und Aufbewahrung der Ergebnisse fest.
