---
slug: contributing
category: Entwicklung und Beiträge
title: Zur Dokumentation beitragen
description: Bearbeiten Sie die Anleitungen in Markdown und prüfen Sie Ihre Änderungen lokal.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Eine Anleitung bearbeiten {#本文を編集する}

- **Fehler melden.** Stimmen Anleitung und Oberfläche oder Befehle nicht überein, erstellen Sie unter [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) eine Meldung mit der betroffenen Seite und einem Korrekturvorschlag.
- **Pull Request einreichen.** Bearbeiten Sie die entsprechende Datei in den [Markdown-Quellen der öffentlichen Anleitungen (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) und öffnen Sie einen Pull Request.

## Lokal überprüfen {#ローカル検証}

Führen Sie nach der Bearbeitung die folgenden Befehle aus und prüfen Sie, ob der Build sowie die Prüfungen für Links und Header erfolgreich sind.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Der Build von `public-web` führt einen Probelauf mit Wrangler durch und startet eine lokale Workers-Umgebung. Geprüft werden repräsentative Seiten, Suchindex, 404-Fehler, Weiterleitungen und Header.

## Kompatibilität {#互換性}

- Behalten Sie öffentliche Pfade und Überschriftenanker bei (aus dem Text generierte Fragmente `#...`). Prüfen Sie beim Ändern einer Überschrift die Links von anderen Seiten.
- Gleichen Sie Änderungen an CLI-Optionen und HTTP-Beispielanfragen mit der Implementierung und den OpenAPI-Definitionen ab.
