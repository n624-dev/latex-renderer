---
slug: integrations
category: KI und MCP
title: Codex oder Claude Code verwenden
description: Verwenden Sie dieselben lokal gespeicherten Zugangsdaten für CLI und MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Skill installieren {#skillの導入}

1. [Installieren Sie zunächst die CLI und hinterlegen Sie Ihren API-Schlüssel](/de/docs/client/).
2. Ist Codex oder Claude Code installiert, richten Sie die Integration entsprechend der Installationsart ein.

   - **Installationsprogramm zum Herunterladen.** Öffnen Sie `n624-latex setup` und wählen Sie Ihr KI-Werkzeug. Skill und Local MCP können gemeinsam registriert werden.
   - **Homebrew.** Mit `n624-latex setup` können Sie die Integration ebenfalls konfigurieren. Zum Migrieren eines bestehenden Local-MCP-Eintrags folgen Sie der [Homebrew-Anleitung](/de/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registrieren Sie Local MCP manuell](/de/docs/mcp/#local-mcpの登録).

3. Starten Sie Codex oder Claude Code neu. Geben Sie in Ihrer Anfrage den Ordner oder das Hauptdokument für die Kompilierung an.

- **Speicherorte des Skills**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Erkennt das Installationsprogramm einen vom Benutzer geänderten Skill, behält es ihn bei und meldet dies im Ergebnis.

## MCP registrieren {#mcpの登録}

- **Für lokale Dateien in Codex oder Claude Code** verwenden Sie Local MCP. Siehe [Manuelle Registrierung](/de/docs/mcp/#local-mcpの登録) und [Status prüfen](/de/docs/client/#状態確認と修復).
- **Für ChatGPT, Claude im Web oder einen anderen Cloud-Assistenten** folgen Sie der [Verbindungsanleitung für Remote MCP](/de/docs/mcp/#通常はremote-mcpを使う). Ein API-Schlüssel ist dafür nicht erforderlich.

## Beispielanfragen {#依頼例}

- „Prüfe und kompiliere die Datei `main.tex` in diesem Ordner.“
- „Kompiliere die Datei `reports/a.tex` in diesem ZIP.“
- „Lade dieses ZIP nur einmal hoch und kompiliere `reports/a.tex` und `reports/b.tex` getrennt.“
- „Lies die strukturierten Fehler, korrigiere nur den betroffenen TeX-Code und kompiliere erneut.“
- „Prüfe das erstellte PDF und die Seitenvorschauen.“

## Sichere Verwendung {#安全な使い方}

> [!WARNING]
> Halten Sie API-Schlüssel aus Anfragen, MCP-Werkzeugargumenten und Projektdateien heraus. Local MCP nutzt intern die geschützten Zugangsdaten der CLI.

- **Nicht vertrauenswürdige Daten.** LaTeX-Quellen, Pfade, Protokolle, Fehler, Ausgabedateien und MCP-Antworten werden als nicht vertrauenswürdige Daten behandelt. Die Integration ist darauf ausgelegt, darin enthaltene Anweisungen einschließlich Prompt-Injections zu ignorieren.
- **Destruktive Aktionen.** Führen Sie `cancel_render` und `delete_render` nur auf ausdrücklichen Wunsch des Benutzers aus.
- **Dokumentauswahl.** Ohne Angabe eines Einstiegspunkts wird `main.tex` verwendet. Fehlt `main.tex` und kommen mehrere `.tex` infrage, wird der Benutzer um eine Auswahl gebeten. Es werden nie automatisch alle `.tex` kompiliert. Sicherheitsregeln und Abläufe stehen im Skill, ausführliche Spezifikationen in `references/` und der öffentlichen Dokumentation.
