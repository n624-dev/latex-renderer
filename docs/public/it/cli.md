---
slug: cli
category: CLI
title: Convertire documenti e scaricare i risultati con la CLI
description: Compila TeX nel terminale e scarica PDF, log e anteprime.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Nella cartella che contiene `main.tex`, esegui `n624-latex main.tex` per salvare il PDF nella stessa cartella. Al primo utilizzo, [installa la CLI](/it/docs/client/) e configura la connessione.

## Autenticazione {#認証}

Apri la schermata di configurazione nel browser per salvare la chiave API.

```sh
n624-latex setup --gui
```

Se non puoi aprire un browser, per esempio in una sessione SSH, registra la chiave tramite lo **standard input** per evitare che compaia negli argomenti del comando. In Bash o Zsh esegui la prima riga, incolla la chiave, premi Invio e prosegui con le righe successive.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Su Windows puoi anche usare l’[immissione nascosta del programma di installazione](/it/docs/windows/#インストール).

Questi comandi verificano la presenza di una chiave salvata e la eliminano, rispettivamente.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` mostra l’origine effettiva della connessione e la fonte della credenziale: il nome di un profilo salvato, la variabile d’ambiente `LATEX_RENDER_API_KEY` o nessuna fonte. Con `--json`, consulta i campi `origin` e `credentialSource`.

- La variabile d’ambiente `LATEX_RENDER_API_KEY`, se impostata, ha la precedenza sulla chiave locale.
- `logout` elimina solo la chiave salvata localmente. Se necessario, disattiva a parte la variabile d’ambiente o revoca la chiave sul server.

### Scegliere il server {#接続先サーバー}

Per impostazione predefinita la CLI si collega al servizio ospitato (`https://latex-render.n624.jp`). Per un server tuo, configura l’URL HTTPS nella sessione di terminale in cui eseguirai i comandi.

- Ometti i suffissi `/app/` e `/api/v1/` nell’URL.
- Usa una chiave API emessa da quel server.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Configurazione e diagnosi {#セットアップと診断}

Apri le impostazioni di connessione e integrazione con `n624-latex setup`. Se non riesci a collegarti, verifica prima lo stato con i comandi seguenti. Se `n624-latex` non viene trovato, consulta [Installazione e PATH](/it/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` esamina l’installazione e le credenziali in sola lettura e omette il valore della chiave API. Se rileva problemi, restituisce il codice di uscita `2`.

| Installazione | Aggiornamento e riparazione |
| --- | --- |
| APT | [Aggiorna con APT](/it/docs/client/#apt-版の更新) o [reinstalla](/it/docs/client/#状態確認と修復) i pacchetti danneggiati. [Registra Local MCP manualmente](/it/docs/mcp/#local-mcpの登録). |
| Homebrew | [Aggiorna con Homebrew](/it/docs/client/#homebrew-版の更新) o [reinstalla](/it/docs/client/#状態確認と修復) i pacchetti danneggiati. Configura le integrazioni IA con `n624-latex setup`. |
| Programma di installazione scaricabile | [Aggiorna dalla configurazione](/it/docs/client/#配布インストーラー版の更新). Ripara le integrazioni e i lanciatori gestiti con `n624-latex setup repair`. |

Per disinstallare, segui le [istruzioni del metodo usato](/it/docs/client/#アンインストール). L’interfaccia di configurazione è locale e si chiude all’uscita dalla CLI.

## Rendering {#レンダリング}

### Convertire direttamente un file TeX {#tex-ファイルを直接変換する}

Indica il file `.tex` nella cartella del progetto per generare il PDF. Puoi riferirti a immagini, bibliografia e file `.sty` locali con percorsi relativi.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Se ometti `-o`, viene salvato nella cartella da cui hai eseguito il comando un PDF con lo stesso nome base, per esempio `main.pdf`.
- In caso di errore LaTeX vengono mostrati file, riga e ID processo, se identificabili. L’ultimo PDF salvato correttamente viene conservato se la compilazione o il download fallisce.

#### Scegliere il motore LaTeX {#latex-のエンジンを選ぶ}

Per usare XeLaTeX, scrivi il nome del motore prima del file.

```sh
n624-latex xelatex main.tex
```

Se non indichi il motore, la CLI cerca all’inizio del documento `% !TeX program = xelatex` o
`% !TEX TS-program = xelatex`. Se non trova direttive, consulta
`.n624-latex.json` nella radice del progetto. Puoi condividere questo file
in Git per usare lo stesso motore su altri computer.

```json
{"engine":"xelatex"}
```

Se non viene specificato alcun motore, si usa LuaLaTeX. pLaTeX e upLaTeX richiedono
che l’ambiente di esecuzione del server includa la collezione giapponese.

| Motore | Cosa verificare durante la migrazione di un documento |
| --- | --- |
| LuaLaTeX | Controlla la configurazione dei documenti che usano `fontspec` o LuaTeX-ja. |
| pdfLaTeX | Non supporta `fontspec`. Usa la configurazione dei caratteri per pdfLaTeX. |
| XeLaTeX | Supporta `fontspec`. Verifica la presenza di pacchetti specifici di LuaTeX. |
| pLaTeX / upLaTeX | Usa una classe di documento giapponese compatibile con il motore. Per `jsarticle` con upLaTeX, specifica l’opzione di classe `uplatex`. |

La gestione della bibliografia dipende dai pacchetti e dalla configurazione del documento. Includi i file `.bib` e i `.bst` personalizzati. I documenti BibTeX con pLaTeX e upLaTeX usano rispettivamente pBibTeX e upBibTeX. Consulta nell’[ambiente di rendering](/app/environment/) la verifica di PDF, SVG e posizionamento degli SVG.

### Convertire uno ZIP o richiedere più output {#zip-複数の出力を指定する}

Usa il sottocomando `render` per convertire uno ZIP o scaricare l’insieme degli output, compresi log, anteprime e SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Esempi**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Il percorso predefinito è la cartella corrente e il valore predefinito di `--entrypoint` è `main.tex`. La CLI prepara un input di massimo 500 file e attende il completamento. Il punto di ingresso può essere un percorso relativo a un file `.tex`. Il server verifica che il percorso sia sicuro e che il file esista.
- Con `--svg` vengono estratti come SVG distinti anche le espressioni matematiche più esterne e i diagrammi TikZ di primo livello.

### Riutilizzare l’input per più documenti {#同じ入力から複数の文書を作る-source-の再利用}

Se una cartella o uno ZIP contiene più documenti principali, carica l’input una volta con `source upload` e riutilizzane l’ID. Usa una cartella di output (`--output`) diversa per ogni processo.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Pulizia della destinazione, esclusioni e caricamenti duplicati
>
> - **Pulizia degli output precedenti.** Se riutilizzi una destinazione, vengono rimossi solo PDF, anteprime e SVG elencati nel `job.json` precedente e assenti dal nuovo risultato. I file dell’utente estranei al processo vengono conservati.
> - **Controllo della destinazione.** I percorsi con collegamenti simbolici vengono rifiutati. Su POSIX si controllano anche proprietà e permessi di scrittura del gruppo e degli altri utenti. Windows ignora il controllo dei bit di modalità POSIX.
> - **Esclusione della directory di output.** Se `--output` punta a una sottocartella del progetto, viene esclusa dal successivo ZIP precisamente quella cartella. Le cartelle con un nome simile rimangono incluse. La radice del progetto non può essere la destinazione.
> - **Caricamenti duplicati.** Se il server conserva uno ZIP valido dello stesso proprietario con lo stesso SHA-256, restituisce `uploadRequired: false` e salta il trasferimento. Solo quel proprietario può usare l’ID dell’input nei processi successivi.

## Progetti e revisioni salvati {#保存projectと改訂}

Usa la CLI per gestire e ricompilare progetti e revisioni presenti sul server. Il web, l’API, MCP e le altre chiavi dello stesso utente condividono i progetti. Le operazioni temporanee `render` e `source upload` non richiedono il salvataggio in un progetto.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** prepara la cartella o lo ZIP come input e salva una revisione immutabile nel progetto. Con `--svg` gli output iniziali della revisione sono PDF e SVG.
- **`render`** crea un processo da una revisione salvata. Solo `--svg` sostituisce le impostazioni di output.
- **`list`, `get` e `jobs`** accettano `--cursor` per recuperare la pagina successiva.
- **`delete`** nasconde il progetto nell’elenco. I processi esistenti non vengono eliminati immediatamente.

## Operazioni sui processi {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Scaricare e attendere.** Questi comandi usano la chiave API per rinnovare un token di breve durata. `jobs download` attende la fine del processo prima di sostituire l’insieme dei file salvati. Se l’attesa fallisce o viene interrotta, i file precedenti restano intatti. `delete` si applica solo ai processi terminati.
- **Ottenere altre anteprime PNG.** All’inizio viene generata solo la prima pagina. Il download normale recupera i PNG già generati. Usa per esempio `--preview-page 2 5` per generare quelle pagine, verificarne dimensioni e SHA-256 e salvarle. Il PDF non viene ricompilato e la conservazione non viene prolungata.
- **Scaricare il PDF in anticipo e riprovare gli SVG.** Nei processi PDF e SVG, con `--pdf-only` ottieni il PDF senza attendere gli SVG. Se fallisce solo l’estrazione SVG, il PDF resta disponibile e il successo è parziale. `retry-svg` ripete solo l’estrazione. Sono ammessi 8 tentativi incluso il primo, senza prolungare la conservazione. Se l’ambiente di esecuzione è cambiato, crea un nuovo processo. Consulta [PDF disponibile in anticipo e nuovi tentativi SVG](/it/docs/api/#pdfの先行公開とsvgの再試行).
- **Nuovi tentativi dopo problemi di rete.** Le consultazioni dello stato vengono ripetute in caso di errore transitorio. Gli errori di autenticazione e autorizzazione vengono restituiti subito. Se la CLI smette di attendere, il server potrebbe continuare l’elaborazione. Consulta lo stesso `<jobId>` prima di crearne un altro. Vedi [Attesa e nuovi tentativi della CLI](/it/docs/reference/#cliの待機と再試行).

## File di output {#成果物}

Per scaricare il PDF in anticipo, scegliere le pagine PNG o riprovare gli SVG, consulta [Ottenere PDF, PNG e SVG](/it/docs/outputs/).

| Percorso | Contenuto |
| --- | --- |
| `.render/result.pdf` | PDF generato con successo |
| `.render/compile.log` | Log della compilazione LaTeX |
| `.render/errors.json` | Dettagli strutturati degli errori |
| `.render/job.json` | Stato finale del processo |
| `.render/previews/page-N.png` | Anteprime di massimo 100 pagine |
| `.render/svg/manifest.json` | Corrispondenza fra SVG, posizioni nei sorgenti e coordinate del PDF |
| `.render/svg/objects/*.svg` | SVG distinto per ogni espressione matematica o diagramma TikZ |

## Output JSON {#json出力}

Aggiungi `--json` a qualsiasi comando per scrivere un singolo oggetto JSON sullo standard output senza messaggi di avanzamento. Usa lo stesso risultato di `client-core` della visualizzazione normale e non include chiavi API o token di breve durata.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Consulta il [formato JSON della CLI](/it/docs/reference/#cliのjson形式) per gli schemi di successo ed errore e i codici di uscita.
