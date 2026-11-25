---
slug: outputs
category: Web e CLI
title: Ottenere PDF, PNG e SVG
description: Salva il PDF, scarica le immagini delle pagine ed esporta o estrai di nuovo formule e diagrammi TikZ in SVG.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Aprire e salvare un PDF {#pdf-を開く-保存する}

- **Applicazione web.** Seleziona il documento nella [Cronologia](/app/history/) e apri `result.pdf` nell’elenco dei file sulla pagina dei risultati. Se hai richiesto PDF e SVG, puoi scaricare il PDF appena è pronto.
- **CLI.** Scarica il risultato con il `<jobId>` visualizzato. Aggiungi `--pdf-only` per ottenere il PDF senza attendere gli SVG. Se devi conservare i file di un altro documento, scegli una cartella `--output` diversa.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Ottenere le immagini delle pagine {#ページ画像を取得する}

Usa le anteprime PNG per ottenere immagini di pagine intere. Inizialmente viene generata solo la pagina 1. Le altre vengono generate su richiesta. Se una pagina è in preparazione, attendi o riaprila. Nel frattempo puoi scaricare il PDF completato.

- **Applicazione web.** Nei risultati, seleziona l’anteprima della pagina che vuoi vedere.
- **CLI.** Il comando seguente scarica i PNG delle pagine 2 e 5. I nomi dei file seguono il modello `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Salvare formule e TikZ come SVG {#数式と-tikz-を-svg-で保存する}

Puoi estrarre le espressioni matematiche più esterne e i diagrammi TikZ di primo livello come singole immagini vettoriali.

- **Applicazione web.** Prima di convertire, apri **Destinazione e opzioni di output** e seleziona **Esporta anche formule e TikZ in SVG**. Al termine dell’estrazione, scarica gli SVG dalla pagina dei risultati.
- **CLI.** Converti il documento con `--svg`. Gli SVG sono salvati in `.render/svg/objects/`. La corrispondenza tra le righe del file `.tex` originale e le coordinate nel PDF è in `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Se il PDF è pronto ma l’estrazione SVG fallisce {#pdf-はあるが-svg-が失敗した場合}

**Successo parziale** indica che il PDF è pronto e che è fallita solo l’estrazione SVG. Salva il PDF e ripeti l’estrazione senza ricompilarlo.

- **Applicazione web.** Fai clic su **Riprova solo SVG** nei risultati.
- **CLI.** Esegui questo comando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Condizioni e limite di tentativi**
- Sono ammessi **fino a 8 tentativi**, incluso il primo, finché restano disponibili i sorgenti originali e il PDF definitivo e l’ambiente TeX del server non cambia. I tentativi non prolungano la conservazione dei file.
- Se il problema persiste, consulta i dati diagnostici nella pagina dei risultati o in `.render/svg/errors.json`.
- Se compare `SVG_RUNTIME_CHANGED` o il pulsante non è disponibile per un vecchio processo, [avvia una nuova conversione dal documento originale o da una revisione salvata](/it/docs/web/#以前の文書や結果を開く).

Consulta anche [Scaricare e riprovare tramite l’API HTTP](/it/docs/api/#pdfの先行公開とsvgの再試行) e la [specifica di elaborazione degli output](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
