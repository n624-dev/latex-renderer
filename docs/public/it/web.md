---
slug: web
category: Applicazione web
title: Convertire documenti nel browser
description: Crea un PDF da un file TeX o ZIP e consulta i risultati delle conversioni precedenti.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Creare un PDF nel browser {#ブラウザでpdfへ変換}

1. Apri l’[applicazione web](/app/) e accedi con il metodo indicato dall’amministratore.
2. Seleziona i file o trascinali sulla pagina.
   - Per un documento costituito da un solo file, seleziona direttamente il `.tex`.
   - Se comprende immagini, bibliografie o più file `.tex` (per esempio tramite `\input`), raccogli il documento e le dipendenze in uno `.zip`. Consulta i [file supportati e la struttura dello ZIP](/it/docs/projects/).
   - Se selezioni più file `.tex` separati, ognuno viene convertito come documento autonomo.
3. Se lo ZIP include più file `.tex` e viene mostrato un selettore, scegli il documento principale come punto di ingresso.
4. Fai clic su **Converti in PDF**. Al termine, la pagina dei risultati mostra il PDF e le anteprime delle pagine.

Per usare un motore diverso da LuaLaTeX, selezionalo in **Destinazione e opzioni di output → Motore**. L’[ambiente di rendering](/app/environment/) mostra i motori disponibili e le verifiche di PDF, SVG e posizioni degli SVG. pLaTeX e upLaTeX richiedono la collezione giapponese sul server.

## Modificare un documento nel browser {#ブラウザーで文書を編集する}

1. Apri un documento in [Progetti](/app/projects/) e seleziona **Modifica TeX**. Un progetto nuovo contiene un `main.tex` vuoto. Puoi anche scegliere un modello.
2. Le modifiche vengono salvate automaticamente nella bozza. Usa **Allega un file** per aggiungere immagini o bibliografie.
3. Attiva **Compilazione automatica** per aggiornare il PDF quando fai una pausa nella digitazione. Per aggiornarlo subito, fai clic su **Compila**.
4. Fai clic su **Salva una versione** per conservare i sorgenti nella cronologia. Con **Modifica da questa revisione** puoi riprendere una versione salvata. Se esiste già una bozza, viene chiesta conferma prima di sostituirla.

Apri **Gestisci file** per aggiungere o allegare file. In **Impostazioni** puoi cambiare il motore, la compilazione automatica e la lingua, oppure salvare una revisione. Il pulsante **⋯** nel riquadro PDF apre le opzioni di zoom e PNG.

Se la compilazione fallisce, la bozza e l’ultimo PDF valido vengono conservati. Seleziona un errore con nome file e numero di riga per passare a quella riga. Sul cellulare puoi alternare **Codice**, **PDF** e **Errori**. Se il PDF tarda ad apparire, usa **PNG (anteprima leggera)**.

Le anteprime temporanee sono disponibili solo nell’editor. Per conservare un PDF, scaricalo con **Salva PDF**.

L’editor usa UTF-8. Apri i file Shift_JIS o EUC-JP in un editor di testo con la codifica originale, verifica che si leggano correttamente e salva una copia in UTF-8. Allega la copia con lo stesso nome e conferma la sostituzione.

## Ottenere formule e diagrammi TikZ in SVG {#数式や-tikz-を-svg-で取得する}

1. Prima della conversione, apri **Destinazione e opzioni di output** e seleziona **Esporta anche formule e TikZ in SVG**.
2. Puoi scaricare il PDF appena è pronto.
3. **Successo parziale** indica che il PDF è pronto ma l’estrazione SVG non è riuscita. Salva prima il PDF e, se necessario, fai clic su **Riprova solo SVG**.

All’inizio viene generata solo l’anteprima PNG della prima pagina. Le altre vengono generate quando le apri. Il PDF completato può essere scaricato mentre le anteprime sono in preparazione. Consulta [Ottenere PDF, PNG e SVG](/it/docs/outputs/).

## Aprire documenti e risultati precedenti {#以前の文書や結果を開く}

- La **[Cronologia](/app/history/)** mostra l’avanzamento e i file prodotti. Puoi riaprire la stessa pagina dei risultati dopo aver chiuso il browser.
- In **[Progetti](/app/projects/)** trovi documenti e revisioni salvati. Per convertire sorgenti precedenti, apri la revisione e fai clic su **Converti di nuovo**.
- Nell’**[Ambiente di rendering](/app/environment/)** puoi cercare i pacchetti LaTeX e i caratteri disponibili sul server.

## Informazioni pubbliche e private {#公開される情報}

- **Pagine con accesso.** Accedi all’applicazione web (`/app/`) per consultare i documenti e le conversioni nella cronologia o nei risultati. L’area di amministrazione (`/admin/`) è riservata ad amministratori e proprietari. Consulta [Sicurezza di account e documenti](/it/docs/security/).
- **Pagine pubbliche.** Se non riesci ad accedere, consulta lo [stato del servizio](/status/) o la [risoluzione dei problemi](/it/docs/troubleshooting/). Trovi la CLI in [Download](/downloads/) e le specifiche di integrazione nell’[API pubblica](/it/docs/api/).
