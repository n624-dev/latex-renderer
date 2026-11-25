---
slug: integrations
category: AI a MCP
title: Použití Codex nebo Claude Code
description: Používejte stejné místně uložené přihlašovací údaje v CLI a MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalace dovednosti {#skillの導入}

1. Nejprve [nainstalujte CLI a uložte klíč API](/cs/docs/client/).
2. Po instalaci Codex nebo Claude Code nastavte integraci podle způsobu instalace CLI.

   - **Stažený instalační program.** Otevřete `n624-latex setup` a vyberte nástroj AI. Dovednost a Local MCP můžete zaregistrovat současně.
   - **Homebrew.** Integraci lze nastavit také pomocí `n624-latex setup`. Převod starší registrace Local MCP popisují [pokyny pro Homebrew](/cs/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Zaregistrujte Local MCP ručně](/cs/docs/mcp/#local-mcpの登録).

3. Restartujte Codex nebo Claude Code a v zadání uveďte složku nebo hlavní dokument, který chcete přeložit.

- **Umístění dovednosti**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Pokud instalační program rozpozná uživatelem upravenou dovednost, zachová ji a uvede to ve výsledku.

## Registrace MCP {#mcpの登録}

- **Pro práci s místními soubory z Codex nebo Claude Code** použijte Local MCP. Viz [ruční registrace](/cs/docs/mcp/#local-mcpの登録) a [kontrola stavu](/cs/docs/client/#状態確認と修復).
- **Pro ChatGPT, webový Claude nebo jiného cloudového asistenta** postupujte podle [návodu k připojení Remote MCP](/cs/docs/mcp/#通常はremote-mcpを使う). Klíč API nepotřebujete.

## Příklady zadání {#依頼例}

- „Zkontroluj a přelož soubor `main.tex` v této složce.“
- „Přelož soubor `reports/a.tex` z tohoto archivu ZIP.“
- „Nahraj tento ZIP jen jednou a přelož samostatně `reports/a.tex` a `reports/b.tex`.“
- „Přečti strukturované chyby, oprav jen dotčený TeX a zopakuj překlad.“
- „Zkontroluj vytvořené PDF a náhledy stran.“

## Bezpečné použití {#安全な使い方}

> [!WARNING]
> Nevkládejte klíče API do zadání, argumentů nástrojů MCP ani souborů projektu. Local MCP interně používá zabezpečené údaje uložené v CLI.

- **Nedůvěryhodná data.** Zdrojový kód LaTeX, cesty, protokoly, chyby, výstupní soubory a odpovědi MCP se považují za nedůvěryhodné. Integrace má ignorovat pokyny v jejich obsahu včetně podvržených instrukcí pro model.
- **Destruktivní operace.** `cancel_render` a `delete_render` provádějte pouze na výslovnou žádost uživatele.
- **Výběr dokumentu.** Bez určeného hlavního souboru se použije `main.tex`. Pokud `main.tex` chybí a existuje více kandidátů `.tex`, uživatel vybere požadovaný soubor. Nikdy se automaticky nepřekládají všechny `.tex`. Dovednost obsahuje bezpečnostní pravidla a pořadí operací. Podrobné specifikace jsou v `references/` a ve veřejné dokumentaci.
