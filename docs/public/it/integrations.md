---
slug: integrations
category: IA e MCP
title: Usare Codex o Claude Code
description: Usa le stesse credenziali locali per la CLI e MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Installare la skill {#skillの導入}

1. Per prima cosa, [installa la CLI e registra la chiave API](/it/docs/client/).
2. Dopo avere installato Codex o Claude Code, configura l’integrazione in base al metodo d’installazione della CLI.

   - **Programma di installazione scaricabile.** Apri `n624-latex setup` e scegli lo strumento IA. Puoi registrare insieme la skill e Local MCP.
   - **Homebrew.** Puoi configurare l’integrazione anche con `n624-latex setup`. Per migrare una registrazione Local MCP esistente, segui le [istruzioni di Homebrew](/it/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registra Local MCP manualmente](/it/docs/mcp/#local-mcpの登録).

3. Riavvia Codex o Claude Code e indica nella richiesta la cartella o il documento principale da compilare.

- **Posizioni della skill**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Se il programma di installazione rileva una skill modificata dall’utente, la mantiene e lo segnala nel risultato.

## Registrare MCP {#mcpの登録}

- **Per usare file locali da Codex o Claude Code**, usa Local MCP. Consulta la [registrazione manuale](/it/docs/mcp/#local-mcpの登録) e la [verifica dello stato](/it/docs/client/#状態確認と修復).
- **Per ChatGPT, Claude sul web o un altro assistente cloud**, segui le [istruzioni per collegare Remote MCP](/it/docs/mcp/#通常はremote-mcpを使う). Non occorre una chiave API.

## Esempi di richieste {#依頼例}

- «Controlla e compila il file `main.tex` di questa cartella.»
- «Compila il file `reports/a.tex` di questo ZIP.»
- «Carica questo ZIP una sola volta e compila separatamente `reports/a.tex` e `reports/b.tex`.»
- «Leggi gli errori strutturati, correggi solo il TeX interessato e ricompila.»
- «Verifica il PDF generato e le anteprime delle pagine.»

## Uso sicuro {#安全な使い方}

> [!WARNING]
> Tieni le chiavi API fuori da richieste, argomenti degli strumenti MCP e file di progetto. Local MCP usa internamente le credenziali protette salvate dalla CLI.

- **Dati non attendibili.** I sorgenti LaTeX, i percorsi, i log, gli errori, gli output e le risposte MCP sono trattati come dati non attendibili. L’integrazione è progettata per ignorare le istruzioni che contengono, compresi i tentativi di prompt injection.
- **Azioni distruttive.** Esegui `cancel_render` e `delete_render` solo su richiesta esplicita dell’utente.
- **Selezione del documento.** In assenza di un punto di ingresso viene usato `main.tex`. Se manca `main.tex` e ci sono più candidati `.tex`, viene chiesto all’utente di scegliere. Non vengono mai compilati automaticamente tutti i `.tex`. La skill contiene le regole di sicurezza e la sequenza delle operazioni. Le specifiche dettagliate sono in `references/` e nella documentazione pubblica.
