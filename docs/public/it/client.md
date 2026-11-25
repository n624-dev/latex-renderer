---
slug: client
category: Installazione
title: Installare la CLI
description: Installa la CLI su Windows, macOS o Linux e crea il primo PDF dal terminale.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Piattaforme supportate {#対応環境}

Installa la CLI con il metodo previsto per il tuo sistema e registra la chiave API (`lrk_...`) fornita dall’amministratore. I documenti LaTeX vengono compilati sul server.

| Piattaforma | Metodo | Node.js |
| --- | --- | --- |
| Debian 12 / 13 o Ubuntu 24.04 / 26.04 (amd64 o arm64) | **[Pacchetto APT](#debian-ubuntu-の-apt-パッケージ)** | Incluso |
| Windows | **[Istruzioni per Windows](/it/docs/windows/)** | 24 o successivo |
| macOS (Apple Silicon o Intel) | **[Homebrew](#homebrew-でインストール)** | Installato da Homebrew |
| macOS o altre distribuzioni Linux | **[Programma di installazione scaricabile](#linux-macos)** | 24 o successivo |

## Installare con APT su Debian o Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Scarica `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Il file include la chiave pubblica di firma del repository APT di LaTeX Renderer.
2. Nella cartella in cui lo hai salvato, esegui questi comandi per installare il pacchetto.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Continua con [Crea il tuo primo PDF](#最初の-pdf-を作る). Se vuoi installare un server, segui le [istruzioni per l’hosting in proprio](/it/docs/self-hosting/).

## Installare con Homebrew {#homebrew-でインストール}

Esegui questi comandi su un Mac con Homebrew installato.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Dopo aver registrato la chiave API, continua con [Crea il tuo primo PDF](#最初の-pdf-を作る).

### Passare dal programma di installazione scaricabile a Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Puoi mantenere la chiave API e la configurazione MCP. Esegui `type -a n624-latex` per verificare quale comando viene trovato per primo dalla shell. Se ha precedenza la vecchia installazione, esegui direttamente la versione di Homebrew.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Per fare in modo che `n624-latex` usi la versione di Homebrew, nel `PATH` della shell metti la directory `bin` di Homebrew prima della vecchia installazione.

Per cambiare anche Local MCP, modifica il comando della voce `latex-renderer` nel tuo strumento IA indicando il percorso assoluto del `bin/latex-renderer-mcp` di Homebrew. Usa `brew --prefix` per individuare l’installazione.

Prima di eliminare la vecchia versione, riavvia lo strumento IA e verifica il collegamento al Local MCP di Homebrew. Specifica il percorso assoluto del vecchio lanciatore per disinstallarlo e mantieni chiave e skill. Se era installato nella posizione predefinita, esegui questo comando.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Preparare il programma di installazione scaricabile {#配布インストーラーの準備}

Installa **Node.js 24 o successivo** per il tuo account abituale e verifica la versione con `node --version`. Su Windows segui le [istruzioni per Windows](/it/docs/windows/).

## Linux e macOS {#linux-macos}

Dal terminale, scarica il programma di installazione in una cartella temporanea ed eseguilo con Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Se `n624-latex` non viene trovato, apri un nuovo terminale. Se il problema persiste, esegui `export PATH="$HOME/.local/bin:$PATH"` e aggiungi la stessa riga al file di configurazione della shell, per esempio `~/.bashrc` o `~/.zshrc`.

## Crea il tuo primo PDF {#最初の-pdf-を作る}

1. Apri la configurazione con l’account abituale e salva la chiave API. Per l’hosting in proprio, [specifica prima il server](/it/docs/cli/#接続先サーバー). Se non puoi aprire un browser, [registra la chiave tramite lo standard input](/it/docs/cli/#認証).

```sh
n624-latex setup
```

2. Esegui questo comando nella cartella che contiene `main.tex`. Puoi usare il [documento di esempio](/it/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

Viene creato `main.pdf` nella stessa cartella. Per scegliere la destinazione o lavorare con ZIP, PDF e SVG, consulta [Convertire e scaricare con la CLI](/it/docs/cli/#レンダリング).

## Windows {#windows}

Le [istruzioni per Windows](/it/docs/windows/) usano PowerShell. Windows DPAPI cifra la chiave salvata per l’utente corrente. Consulta [Cambiare la posizione e riparare il PATH](/it/docs/reference/#windowsの配置と保護).

## Aggiornamenti {#更新}

### Aggiornare il pacchetto APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

La connessione e la chiave API salvate vengono mantenute. Per aggiornare il server che gestisci, usa la [pagina degli aggiornamenti nell’amministrazione](/it/docs/updates/).

### Aggiornare il pacchetto Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Aggiornare il client del programma di installazione scaricabile {#配布インストーラー版の更新}

Esegui questo comando o ripeti quello dell’installazione iniziale.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Aggiornare client in versione 1.6.9 o precedenti
>
> Se è presente solo `latex-render`, ripeti l’installazione. [Su Windows puoi aggiornare senza reinserire la chiave salvata](/it/docs/windows/#更新). Su macOS e Linux puoi anche aggiornare con `latex-render setup` e aggiungere il nuovo comando con `latex-render setup repair`. Gli script esistenti possono continuare a usare `latex-render`.

> [!DETAILS] Come funzionano installazione e aggiornamento
>
> - Se lo SHA-256 dello ZIP scaricabile corrisponde alla versione installata, vengono controllate le impostazioni gestite senza reinstallare i file.
> - Durante l’aggiornamento, il programma sposta la versione precedente in un backup contrassegnato con data e ora. Gli altri lanciatori, le registrazioni MCP e le skill modificate dall’utente vengono conservati.

## Verificare e riparare l’installazione {#状態確認と修復}

Questi comandi verificano lo stato con qualsiasi metodo di installazione.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Per APT, reinstalla il pacchetto con `sudo apt install --reinstall n624-latex`.
- Per Homebrew, reinstalla il pacchetto con `brew reinstall n624-dev/tap/n624-latex`.
- Per il programma di installazione scaricabile, ripara i lanciatori e le integrazioni gestiti con `n624-latex setup repair`.

## Salvare e recuperare i file di output {#成果物の保存と復旧}

`n624-latex main.tex` salva il PDF nella cartella corrente. Per i PDF, i log e le immagini salvati da `render` e `jobs download`, consulta [File di output della CLI](/it/docs/cli/#成果物). Se la destinazione è occupata, consulta la [risoluzione dei problemi](/it/docs/troubleshooting/#成果物の取得).

## Disinstallazione {#アンインストール}

Disinstalla il pacchetto APT con `sudo apt remove n624-latex`. Per eliminare anche la chiave dell’utente, esegui `n624-latex auth logout` prima della disinstallazione.

Disinstalla il pacchetto Homebrew con `brew uninstall n624-dev/tap/n624-latex`. La chiave salvata e la configurazione MCP dello strumento IA vengono mantenute. Se non ti servono più, disconnettiti prima di disinstallare ed elimina la configurazione MCP nello strumento IA.

Per il programma di installazione scaricabile, esegui questo comando.

```sh
n624-latex setup remove --yes
```

Per conservare le credenziali o le skill, aggiungi rispettivamente `--keep-credential` o `--keep-skills`. Per la disinstallazione con lo script Windows, consulta le [istruzioni per Windows](/it/docs/windows/#アンインストール).
