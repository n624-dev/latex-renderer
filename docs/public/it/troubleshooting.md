---
slug: troubleshooting
category: Risoluzione dei problemi e sicurezza
title: Risoluzione dei problemi
description: Individua le cause dei problemi di accesso, installazione, conversione e download.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Da dove iniziare {#確認する順序}

1. **Consulta lo [stato del servizio](/status/)** per verificare se è in corso un incidente generale o una manutenzione.
2. **Verifica il processo esistente.** Se hai già avviato una conversione, apri lo stesso processo nella **Cronologia** o esegui `n624-latex jobs get <jobId>` con la CLI.
3. **Consulta la diagnostica e il log.** Sul web apri la diagnostica nella pagina dei risultati. Nella CLI consulta `.render/errors.json` e il log dettagliato `.render/compile.log`.

## Problemi frequenti {#代表的な問題}

### Installazione e accesso {#インストール-ログイン}

- **Impossibile trovare `n624-latex` o `latex-render`.**
  Apri un nuovo terminale o una nuova finestra di PowerShell. Se il problema persiste, controlla il [PATH su Linux o macOS](/it/docs/client/#linux-macos) o le [istruzioni di installazione su Windows](/it/docs/windows/#インストール).
- **Non riesci ad accedere all’applicazione web.**
  Usa l’account registrato e il metodo indicato dall’amministratore (password, OIDC o Cloudflare Access). Se si blocca una connessione da ChatGPT o Claude, consulta [Verificare la connessione Remote MCP](/it/docs/mcp/#chatgptなどの接続を確認する).
- **La CLI restituisce `401` o `403`.**
  Esegui `n624-latex auth status` per controllare la chiave registrata. Chiedi all’amministratore di verificare che sia attiva e disponga dei permessi `render:create` e `render:read:own`. Se occorre, [registra di nuovo la chiave](/it/docs/cli/#認証). Per un server tuo verifica anche l’[URL del server (`LATEX_RENDER_BASE_URL`)](/it/docs/cli/#接続先サーバー).

### Caricamento e conversione {#アップロード-変換}

- **Il documento principale non viene trovato nello ZIP.**
  L’ingresso predefinito è `main.tex` nella radice. Controlla se hai incluso la cartella superiore oppure specifica il percorso relativo del documento. Consulta [Preparare lo ZIP](/it/docs/projects/#構成).
- **La dimensione o l’estensione di un file viene rifiutata.**
  Rimuovi i file generati superflui o non supportati oppure configura `.latexrenderignore`. Controlla i [file ammessi e i limiti](/it/docs/projects/#制限).
- **La conversione resta in coda o la connessione si interrompe.**
  Il server potrebbe continuare a elaborarla. Riapri la stessa pagina dei risultati o consulta lo stesso ID processo prima di crearne un altro.
- **Mancano pacchetti o caratteri, oppure scade il tempo.**
  Cerca i nomi disponibili nell’[ambiente di rendering](/app/environment/). Se scade il tempo, controlla macro complesse, immagini grandi e diagrammi TikZ vicino al punto in cui si è interrotto il log.

### Scaricare i file {#成果物の取得}

- **È presente il PDF ma mancano gli SVG.**
  Se compare **Successo parziale**, salva prima il PDF e seleziona **Riprova solo SVG**. Consulta [Ripetere l’estrazione SVG](/it/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **L’anteprima PNG è ancora in preparazione.**
  Attendi qualche istante o riapri la stessa pagina. Puoi scaricare il PDF definitivo senza attendere.
- **La destinazione è occupata o compare `OUTPUT_BUSY`.**
  Chiudi il visualizzatore che tiene aperto il PDF di output o attendi la fine del processo che scrive nella cartella, quindi ripeti il download.
- **Risultato scaduto o spazio insufficiente.**
  Per un risultato scaduto, converti nuovamente la revisione salvata o i file locali. Se hai raggiunto la quota, elimina i processi completati che non servono più. Se il disco del server è pieno, informa l’amministratore.

## Richiedere assistenza {#問い合わせ}

- **Amministratore del server.** Indica l’ora del problema, l’operazione interrotta, il codice di errore e, se disponibile, l’ID processo (`job_...`).
- **Segnalazione pubblica su GitHub.** Fornisci i passaggi minimi per riprodurre il problema senza segreti o documenti personali. **Non pubblicare mai chiavi API, cookie, il documento originale, il PDF o log completi non oscurati.**
