---
slug: outputs
category: Web und CLI
title: PDF, PNG und SVG abrufen
description: Speichern Sie das PDF, laden Sie Seitenbilder herunter und exportieren Sie Formeln und TikZ-Grafiken als SVG oder wiederholen Sie deren Extraktion.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## PDF öffnen und speichern {#pdf-を開く-保存する}

- **Webanwendung.** Wählen Sie das Dokument im [Verlauf](/app/history/) und öffnen Sie `result.pdf` in der Dateiliste der Ergebnisseite. Haben Sie PDF und SVG angefordert, können Sie das PDF herunterladen, sobald es fertig ist.
- **CLI.** Laden Sie die Ergebnisse mit der angezeigten `<jobId>` herunter. Mit `--pdf-only` laden Sie das PDF herunter, ohne auf die SVGs zu warten. Möchten Sie die Dateien eines anderen Dokuments behalten, wählen Sie mit `--output` einen anderen Ordner.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Seitenbilder abrufen {#ページ画像を取得する}

Für Bilder ganzer Seiten verwenden Sie die PNG-Vorschauen. Zunächst wird nur Seite 1 erzeugt. Weitere Seiten entstehen auf Anfrage. Bei laufender Vorbereitung warten Sie kurz oder öffnen Sie die Seite erneut. Das fertige PDF können Sie schon währenddessen herunterladen.

- **Webanwendung.** Wählen Sie in den Ergebnissen die Vorschau der gewünschten Seite.
- **CLI.** Dieser Befehl lädt die PNGs der Seiten 2 und 5 herunter. Die Dateinamen haben die Form `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Formeln und TikZ als SVG speichern {#数式と-tikz-を-svg-で保存する}

Äußerste mathematische Ausdrücke und TikZ-Grafiken der obersten Ebene lassen sich als einzelne Vektorgrafiken extrahieren.

- **Webanwendung.** Öffnen Sie vor der Umwandlung **Ziel und Ausgabeoptionen** und aktivieren Sie **Formeln und TikZ auch als SVG exportieren**. Laden Sie nach Abschluss der Extraktion die SVG-Dateien von der Ergebnisseite herunter.
- **CLI.** Wandeln Sie das Dokument mit `--svg` um. Die SVGs liegen in `.render/svg/objects/`. Die Zuordnung der Zeilen in der ursprünglichen `.tex` zu den Koordinaten im PDF steht in `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Wenn das PDF fertig ist, aber die SVG-Extraktion fehlschlägt {#pdf-はあるが-svg-が失敗した場合}

**Teilerfolg** bedeutet, dass das PDF fertig ist und nur die SVG-Extraktion fehlgeschlagen ist. Speichern Sie das PDF und wiederholen Sie die Extraktion ohne Neukompilierung.

- **Webanwendung.** Klicken Sie in den Ergebnissen auf **Nur SVG erneut versuchen**.
- **CLI.** Führen Sie diesen Befehl aus.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Voraussetzungen und Höchstzahl der Versuche**
- Solange die ursprünglichen Quellen und das fertige PDF vorliegen und die TeX-Umgebung des Servers unverändert ist, sind **höchstens 8 Versuche** einschließlich des ersten möglich. Wiederholungen verlängern die Aufbewahrung der Dateien nicht.
- Besteht das Problem fort, prüfen Sie die Diagnose auf der Ergebnisseite oder in `.render/svg/errors.json`.
- Erscheint `SVG_RUNTIME_CHANGED` oder ist die Schaltfläche bei einem älteren Auftrag nicht verfügbar, [starten Sie die Umwandlung aus dem Originaldokument oder einer gespeicherten Revision neu](/de/docs/web/#以前の文書や結果を開く).

Siehe auch [Herunterladen und Wiederholen mit der HTTP-API](/de/docs/api/#pdfの先行公開とsvgの再試行) und die [Spezifikation zur Ausgabeverarbeitung](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
