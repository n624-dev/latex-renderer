---
slug: index
category: Začínáme
title: Průvodce službou LaTeX Renderer
description: Převádějte dokumenty LaTeX do PDF v prohlížeči, terminálu nebo s pomocí asistenta AI.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Vytvořte první PDF {#最短でpdfを作る}

1. Otevřete [webovou aplikaci](/app/) a přihlaste se způsobem určeným správcem.
2. Vyberte soubor `.tex` a klikněte na **Převést do PDF**. Pokud dokument používá obrázky nebo bibliografii, zabalte potřebné soubory společně s dokumentem do archivu ZIP a vyberte tento archiv.
3. Na stránce výsledků otevřete PDF. Později se k němu můžete vrátit ve webové aplikaci přes **Historie**.

Nemáte-li zkušební dokument, uložte následující příklad jako `main.tex` v kódování UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Ukázka japonské sazby a struktura archivu ZIP](/cs/docs/projects/)
- [Průvodce webovou aplikací](/cs/docs/web/)
- [Uložení PDF a PNG a opakované vytvoření SVG](/cs/docs/outputs/)

Chcete-li pracovat v terminálu, [nainstalujte CLI pro svůj systém](/cs/docs/client/). Připojení nastavte příkazem `n624-latex setup`. Ve složce, kam jste uložili `main.tex`, spusťte `n624-latex main.tex`. Vytvoří se `main.pdf`.

## Vyberte způsob práce {#利用方法を選ぶ}

| Co chcete udělat | Nástroj | Návod |
| --- | --- | --- |
| **Převést dokument v prohlížeči** | Webová aplikace | [Převod v prohlížeči](/cs/docs/web/) |
| **Převést dokument v terminálu a uložit výsledky do počítače** | CLI pro Windows, macOS nebo Linux | [Instalace CLI](/cs/docs/client/) |
| **Převádět dokumenty z ChatGPT nebo Claude** | Remote MCP s OAuth | [Připojení ChatGPT nebo Claude](/cs/docs/mcp/) |
| **Pracovat s místními dokumenty v Codex nebo Claude Code** | CLI, Local MCP a dovednost | [Použití Codex nebo Claude Code](/cs/docs/integrations/) |
| **Automatizovat převod ve vlastní aplikaci** | HTTP API | [Veřejné API](/cs/docs/api/) |
| **Provozovat službu na vlastním serveru s Linuxem** | Vlastní server | [Správa vlastního serveru](/cs/docs/self-hosting/) |

## Co budete potřebovat {#必要なもの}

- **Webová aplikace a Remote MCP.** Potřebujete účet pro přihlášení podle pokynů správce serveru.
- **CLI, Local MCP a HTTP API.** Vyžádejte si od správce klíč vykreslovacího API s předponou `lrk_`.
- **Požadavky CLI podle způsobu instalace**
  - Debian a Ubuntu s APT: balíček obsahuje vlastní Node.js.
  - macOS s Homebrew: potřebnou verzi Node.js nainstaluje Homebrew.
  - Stažený instalační program pro Windows, macOS nebo Linux: potřebujete Node.js 24 nebo novější.

Dokumenty překládá server. Pro žádnou z uvedených metod si nemusíte na počítač instalovat TeX Live.

> [!WARNING]
> Nevkládejte klíče API do konverzací s AI, zdrojového kódu, repozitářů Git ani protokolů. Pokud máte podezření, že klíč unikl, ihned požádejte správce o jeho zneplatnění a vydání nového.

Pokud se nemůžete přihlásit nebo převést dokument, otevřete [řešení potíží](/cs/docs/troubleshooting/).
