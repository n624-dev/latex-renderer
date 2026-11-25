---
slug: projects
category: Progetti
title: Preparare i file TeX e ZIP
description: Prepara i sorgenti, controlla i limiti e prova un progetto minimo con LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Struttura del progetto {#構成}

- **Documento con un solo file.** Carica direttamente il `.tex` nell’applicazione web o esegui `n624-latex main.tex` con la CLI.
- **Documento con immagini, bibliografia o più file sorgente.** Raccogli tutto in **un unico ZIP** mantenendo i percorsi relativi. Nella CLI puoi anche indicare una cartella.
- **Creare lo ZIP.** Seleziona il contenuto della cartella, per esempio `main.tex` e `images/`, e comprimilo. Se includi la cartella superiore, al momento della conversione dovrai indicare un percorso di ingresso come `project/main.tex`.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Punto di ingresso e percorsi relativi**
Il documento principale predefinito è `main.tex` nella radice del progetto. Anche se scegli un `.tex` in una sottocartella, come `docs/main.tex`, **la directory di lavoro della compilazione resta la radice del progetto**. Per includere da `docs/main.tex` il file `body.tex` della stessa cartella, scrivi `\input{docs/body.tex}`. Se scrivi `\input{body.tex}`, il compilatore cerca `body.tex` nella radice.

## Esempio minimo in giapponese {#日本語の最小例}

Il motore predefinito è **LuaLaTeX**. Per provare un documento in giapponese, salva il testo seguente come `main.tex` in UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Cerca i pacchetti e i caratteri disponibili nell’[ambiente di rendering](/app/environment/). L’elenco viene generato dal contenitore del server durante il deployment ed è usato anche per le ricerche di Remote MCP. Se manca un pacchetto, invia all’amministratore il messaggio pertinente di `compile.log`.

## Progetti e revisioni salvati {#保存projectと改訂}

I documenti convertiti nell’applicazione web (`/app/`) vengono salvati nei progetti.

- **Registrazione automatica delle revisioni.** Ogni nuova combinazione di contenuto, documento principale, motore e formati di output viene salvata come revisione del progetto. Le revisioni precedenti restano nella cronologia.
- **Convertire una revisione precedente.** Fai clic su **Converti di nuovo** per usare il documento e il motore salvati. Se cambi il formato di output in questa fase, il risultato viene aggiunto alla cronologia delle conversioni della stessa revisione.
- **Condivisione ed eliminazione.** Applicazione web, CLI, API HTTP e MCP condividono progetti e revisioni dell’utente. Eliminare un progetto ne nasconde la registrazione. Gli input e gli output esistenti vengono rimossi secondo i tempi di conservazione. Per un’eliminazione completa e immediata contatta l’amministratore. Gli input referenziati da revisioni attive concorrono alla quota dell’utente. Consulta [Condivisione e conservazione](/it/docs/reference/#保存プロジェクトの共有-保持).

### Modificare nel browser {#ブラウザーで編集する}

Apri un progetto salvato e scegli **Modifica TeX**. Le modifiche vengono salvate nella bozza. Quando interrompi la digitazione, inizia la compilazione e, se riesce, il PDF si aggiorna. Se l’anteprima fallisce, puoi consultare l’ultimo PDF disponibile e la versione della bozza a cui corrisponde.

I progetti nuovi si aprono con un `main.tex` vuoto. Finché il documento principale resta vuoto, puoi iniziare da un modello. Per riprendere una versione salvata, scegli **Modifica da questa revisione**. Se hai già una bozza, conferma prima di sostituirla.

Per compilare solo su richiesta, disattiva **Compilazione automatica** e fai clic su **Compila**. Scegli **Risultati della versione salvata** e fai clic su **Salva una versione** per conservare la bozza e le impostazioni. Se ti occorrono gli SVG, apri la revisione salvata e fai clic su **Converti di nuovo**.
L’editor mostra lo stato di compilazione e l’anteprima mentre lavori.

## File esclusi dal caricamento {#送信から除外されるもの}

- **Esclusioni automatiche.** La CLI ignora `.git`, `.render` e i file ausiliari di LaTeX come `.aux`. I collegamenti simbolici vengono rifiutati.
- **File non supportati.** Sposta fuori dal progetto le cartelle superflue come `node_modules`. Se una cartella da inviare contiene estensioni non supportate, la CLI mostra il percorso e si ferma. Per tenere un file come `README.md` nel progetto ed escluderlo dal caricamento, aggiungi al file `.latexrenderignore` nella radice una riga con `README.md`. Il server applica allo ZIP le stesse regole sulle estensioni.
- **Estensioni ammesse** (senza distinzione fra maiuscole e minuscole)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  I file `.bst` sono stili bibliografici BibTeX e possono trovarsi in sottocartelle. Se uno stile personalizzato ha un’estensione non elencata, consulta l’amministratore prima di cambiarla.

## Limiti {#制限}

- **Numero di file.** Al massimo 500.
- **Dimensioni predefinite.** 20 MiB per lo ZIP, 100 MiB in totale dopo l’estrazione e 20 MiB per file.
- **Punto di ingresso.** Percorso relativo a un file `.tex` nei sorgenti. Il valore predefinito è `main.tex` nella radice.
- **Sicurezza.** Sono disattivati l’accesso alla shell da TeX (incluso `\write18`), l’esecuzione di comandi esterni e le connessioni alla rete esterna.
- **Risorse.** L’amministratore definisce limiti di tempo, spazio per utente e conservazione degli output.
