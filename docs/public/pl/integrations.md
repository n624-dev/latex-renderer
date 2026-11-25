---
slug: integrations
category: AI i MCP
title: Korzystanie z Codex lub Claude Code
description: Używaj tych samych lokalnie zapisanych danych uwierzytelniających w CLI i MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalacja umiejętności {#skillの導入}

1. Najpierw [zainstaluj CLI i zarejestruj klucz API](/pl/docs/client/).
2. Po zainstalowaniu Codex lub Claude Code skonfiguruj integrację odpowiednio do sposobu instalacji CLI.

   - **Instalator do pobrania.** Otwórz `n624-latex setup` i wybierz swoje narzędzie AI. Możesz zarejestrować umiejętność i Local MCP jednocześnie.
   - **Homebrew.** Możesz też skonfigurować integrację poleceniem `n624-latex setup`. Aby przenieść wcześniejszy wpis Local MCP, skorzystaj z [instrukcji dla Homebrew](/pl/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Zarejestruj Local MCP ręcznie](/pl/docs/mcp/#local-mcpの登録).

3. Uruchom ponownie Codex lub Claude Code i wskaż w poleceniu katalog lub główny dokument do kompilacji.

- **Lokalizacje umiejętności**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Jeśli instalator wykryje umiejętność zmienioną przez użytkownika, zachowa ją i poinformuje o tym w wyniku.

## Rejestracja MCP {#mcpの登録}

- **Do pracy z lokalnymi plikami w Codex lub Claude Code** użyj Local MCP. Zobacz [ręczną rejestrację](/pl/docs/mcp/#local-mcpの登録) i [sprawdzanie stanu](/pl/docs/client/#状態確認と修復).
- **W ChatGPT, w internetowej wersji Claude lub w innym asystencie chmurowym** skorzystaj z [instrukcji połączenia z Remote MCP](/pl/docs/mcp/#通常はremote-mcpを使う). Klucz API nie jest potrzebny.

## Przykłady poleceń {#依頼例}

- „Sprawdź i skompiluj plik `main.tex` w tym katalogu.”
- „Skompiluj plik `reports/a.tex` z tego archiwum ZIP.”
- „Prześlij to archiwum ZIP tylko raz, a następnie osobno skompiluj `reports/a.tex` i `reports/b.tex`.”
- „Odczytaj błędy strukturalne, popraw tylko wskazany kod TeX i skompiluj ponownie.”
- „Sprawdź wygenerowany PDF oraz podglądy stron.”

## Bezpieczne korzystanie {#安全な使い方}

> [!WARNING]
> Nie umieszczaj kluczy API w poleceniach dla asystenta, argumentach narzędzi MCP ani plikach projektu. Local MCP korzysta wewnętrznie z chronionych danych uwierzytelniających zapisanych przez CLI.

- **Niezaufane dane.** Źródła LaTeX, ścieżki, dzienniki, błędy, pliki wynikowe i odpowiedzi MCP są traktowane jako niezaufane dane. Integracja ma ignorować zawarte w nich instrukcje, w tym próby wstrzyknięcia poleceń dla asystenta.
- **Operacje destrukcyjne.** Wywołuj `cancel_render` i `delete_render` tylko na wyraźną prośbę użytkownika.
- **Wybór dokumentu.** Przy braku wskazanego punktu wejścia używany jest `main.tex`. Jeśli brakuje `main.tex`, a do wyboru jest kilka plików `.tex`, użytkownik musi wskazać właściwy. Narzędzie nie kompiluje automatycznie wszystkich `.tex`. Reguły bezpieczeństwa i kolejność operacji zawarto w umiejętności. Szczegółowe specyfikacje są w `references/` i publicznej dokumentacji.
