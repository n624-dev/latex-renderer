---
slug: index
category: Primi passi
title: Guida a LaTeX Renderer
description: Converti i documenti LaTeX in PDF dal browser, dal terminale o con un assistente IA.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Crea il tuo primo PDF {#最短でpdfを作る}

1. Apri l’[applicazione web](/app/) e accedi con il metodo indicato dall’amministratore.
2. Seleziona il file `.tex` e fai clic su **Converti in PDF**. Se il documento usa immagini o bibliografie, raccogli i file insieme al documento in uno ZIP e seleziona lo ZIP.
3. Apri il PDF nei risultati. Per ritrovarlo in seguito, apri **Cronologia** nell’applicazione web.

Se non hai un documento di prova, salva questo esempio come `main.tex` con codifica UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Esempio in giapponese e struttura dello ZIP](/it/docs/projects/)
- [Guida all’applicazione web](/it/docs/web/)
- [Salvare PDF e PNG e ripetere l’estrazione SVG](/it/docs/outputs/)

Per lavorare dal terminale, [installa la CLI per il tuo sistema](/it/docs/client/). Configura la connessione con `n624-latex setup`. Nella cartella in cui hai salvato `main.tex`, esegui `n624-latex main.tex` per creare `main.pdf`.

## Scegli come lavorare {#利用方法を選ぶ}

| Obiettivo | Strumento | Guida |
| --- | --- | --- |
| **Convertire documenti nel browser** | Applicazione web | [Convertire nel browser](/it/docs/web/) |
| **Convertire dal terminale e salvare i risultati sul computer** | CLI per Windows, macOS o Linux | [Installare la CLI](/it/docs/client/) |
| **Convertire da ChatGPT o Claude** | Remote MCP con OAuth | [Collegare ChatGPT o Claude](/it/docs/mcp/) |
| **Lavorare su documenti locali con Codex o Claude Code** | CLI, Local MCP e skill | [Usare Codex o Claude Code](/it/docs/integrations/) |
| **Automatizzare la conversione da un’applicazione** | API HTTP | [API pubblica](/it/docs/api/) |
| **Eseguire il servizio sul proprio server Linux** | Hosting in proprio | [Gestire il proprio server](/it/docs/self-hosting/) |

## Requisiti {#必要なもの}

- **Applicazione web e Remote MCP.** Occorre un account con il metodo di accesso indicato dall’amministratore del server.
- **CLI, Local MCP e API HTTP.** Chiedi all’amministratore una chiave API di rendering che inizi con `lrk_`.
- **Requisiti della CLI per metodo di installazione**
  - Debian e Ubuntu con APT: il pacchetto include la propria versione di Node.js.
  - macOS con Homebrew: Homebrew installa la versione necessaria di Node.js.
  - Programma di installazione scaricabile per Windows, macOS o Linux: occorre Node.js 24 o successivo.

Il server si occupa della compilazione. Tutti i metodi possono essere usati senza installare TeX Live sul computer.

> [!WARNING]
> Tieni le chiavi API fuori da conversazioni con l’IA, codice sorgente, repository Git e log. Se sospetti che una chiave sia stata divulgata, chiedi subito all’amministratore di revocarla e di emetterne un’altra.

Per problemi di accesso o conversione, consulta la [risoluzione dei problemi](/it/docs/troubleshooting/).
