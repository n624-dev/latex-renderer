---
slug: contributing
category: Sviluppo e contributi
title: Contribuire alla documentazione
description: Modifica le guide in Markdown e verifica i cambiamenti in locale.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Modificare una guida {#本文を編集する}

- **Segnalare un errore.** Se una guida non corrisponde all’interfaccia o ai comandi, apri una segnalazione in [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) indicando la pagina e la correzione proposta.
- **Proporre una modifica.** Modifica il file corrispondente nei [sorgenti Markdown delle guide pubbliche (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) e apri una pull request.

## Verifica locale {#ローカル検証}

Dopo la modifica, esegui questi comandi e controlla che la build e le verifiche di link e intestazioni vadano a buon fine.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

La build di `public-web` effettua una simulazione con Wrangler e avvia un ambiente Workers locale per verificare pagine rappresentative, indice di ricerca, errori 404, reindirizzamenti e intestazioni.

## Compatibilità {#互換性}

- Mantieni i percorsi pubblici e le ancore dei titoli (frammenti `#...` generati dal testo). Se cambi un titolo, controlla i link dalle altre pagine.
- Quando modifichi le opzioni della CLI o gli esempi di richieste HTTP, verifica la corrispondenza con l’implementazione e le definizioni OpenAPI.
