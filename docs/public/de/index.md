---
slug: index
category: Erste Schritte
title: Handbuch für LaTeX Renderer
description: Wandeln Sie LaTeX-Dokumente im Browser, im Terminal oder mit einem KI-Assistenten in PDF um.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Das erste PDF erstellen {#最短でpdfを作る}

1. Öffnen Sie die [Webanwendung](/app/) und melden Sie sich mit dem von der Administration angegebenen Verfahren an.
2. Wählen Sie die Datei `.tex` aus und klicken Sie auf **In PDF umwandeln**. Verwendet das Dokument Bilder oder Literaturdatenbanken, packen Sie diese zusammen mit dem Dokument in eine ZIP-Datei und wählen Sie diese aus.
3. Öffnen Sie das PDF in den Ergebnissen. Später finden Sie es in der Webanwendung unter **Verlauf**.

Haben Sie kein Testdokument zur Hand, speichern Sie dieses Beispiel als `main.tex` in UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Japanisches Beispiel und ZIP-Struktur](/de/docs/projects/)
- [Anleitung zur Webanwendung](/de/docs/web/)
- [PDF und PNG speichern und SVG-Extraktion wiederholen](/de/docs/outputs/)

Für die Arbeit im Terminal [installieren Sie die CLI für Ihr System](/de/docs/client/). Richten Sie die Verbindung mit `n624-latex setup` ein. Führen Sie in dem Ordner, in dem Sie `main.tex` gespeichert haben, `n624-latex main.tex` aus, um `main.pdf` zu erstellen.

## Werkzeug auswählen {#利用方法を選ぶ}

| Vorhaben | Werkzeug | Anleitung |
| --- | --- | --- |
| **Dokumente im Browser umwandeln** | Webanwendung | [Im Browser umwandeln](/de/docs/web/) |
| **Im Terminal umwandeln und Ergebnisse lokal speichern** | CLI für Windows, macOS oder Linux | [CLI installieren](/de/docs/client/) |
| **Aus ChatGPT oder Claude umwandeln** | Remote MCP mit OAuth | [ChatGPT oder Claude verbinden](/de/docs/mcp/) |
| **Lokale Dokumente mit Codex oder Claude Code bearbeiten** | CLI, Local MCP und Skill | [Codex oder Claude Code verwenden](/de/docs/integrations/) |
| **Umwandlungen in einer eigenen Anwendung automatisieren** | HTTP-API | [Öffentliche API](/de/docs/api/) |
| **Den Dienst auf einem eigenen Linux-Server betreiben** | Selbsthosting | [Eigenen Server betreiben](/de/docs/self-hosting/) |

## Voraussetzungen {#必要なもの}

- **Webanwendung und Remote MCP.** Sie benötigen ein Konto mit dem von der Serveradministration vorgegebenen Anmeldeverfahren.
- **CLI, Local MCP und HTTP-API.** Fordern Sie von der Administration einen Render-API-Schlüssel mit dem Präfix `lrk_` an.
- **Anforderungen der CLI nach Installationsart**
  - Debian und Ubuntu mit APT: Das Paket bringt eine eigene Node.js-Version mit.
  - macOS mit Homebrew: Homebrew installiert die benötigte Node.js-Version.
  - Installationsprogramm zum Herunterladen für Windows, macOS oder Linux: Node.js ab Version 24 ist erforderlich.

Der Server kompiliert die Dokumente. Für keines dieser Verfahren müssen Sie TeX Live lokal installieren.

> [!WARNING]
> Halten Sie API-Schlüssel aus KI-Unterhaltungen, Quellcode, Git-Repositories und Protokollen heraus. Vermuten Sie, dass ein Schlüssel offengelegt wurde, lassen Sie ihn unverzüglich von der Administration widerrufen und ersetzen.

Bei Problemen mit der Anmeldung oder Umwandlung hilft die [Fehlerbehebung](/de/docs/troubleshooting/).
