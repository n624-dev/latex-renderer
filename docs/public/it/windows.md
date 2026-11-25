---
slug: windows
category: Installazione
title: Installare la CLI su Windows
description: Installa la CLI da PowerShell, registra la chiave API e crea un PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installazione {#インストール}

1. Prepara **Node.js 24 o successivo** e una chiave API (`lrk_...`) fornita dall’amministratore.
2. Apri PowerShell con il tuo account abituale ed esegui questi comandi.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Incolla la chiave nel campo di immissione nascosto. Windows la cifra e la salva per l’utente corrente.
4. Dopo l’installazione, apri **una nuova finestra di PowerShell**. Se [usi un server tuo](/it/docs/cli/#接続先サーバー), specificane l’indirizzo prima della conversione.

Per registrare di nuovo una chiave, apri la configurazione con `n624-latex setup`.

## Prima conversione {#最初の変換}

1. Apri in Esplora file la cartella che contiene `main.tex`. Puoi usare il [documento di esempio](/it/docs/#最短でpdfを作る).
2. Scrivi `powershell` nella barra degli indirizzi di Esplora file e premi Invio. Nella finestra di PowerShell che si apre, esegui questo comando.

```powershell
n624-latex main.tex
```

Viene creato `main.pdf` nella stessa cartella. Per lavorare con gli ZIP o scaricare più file, consulta la [guida alla conversione con la CLI](/it/docs/cli/#レンダリング).

## Aggiornamento {#更新}

Esegui `n624-latex setup` in PowerShell e aggiorna il client nella schermata di configurazione.

> [!DETAILS] 履歴資料　Migrare dalla versione 1.6.9 o precedente
>
> Esegui lo stesso programma delle [istruzioni di installazione](#インストール) con `-SkipCredential`. La chiave salvata viene mantenuta e viene aggiunto `n624-latex`. Se avevi cambiato cartella di installazione, [specifica lo stesso percorso](/it/docs/reference/#windowsの配置と保護). Gli script esistenti possono continuare a usare `latex-render`.

## Rimuovere solo la chiave API {#apiキーだけを削除}

Per mantenere il client ed eliminare solo la chiave salvata, esegui questo comando.

```powershell
n624-latex auth logout
```

## Disinstallazione {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Per impostazione predefinita vengono eliminati il client, la chiave API salvata e le skill gestite per Codex e Claude. Per conservare le credenziali o le skill, aggiungi rispettivamente `-KeepCredential` o `-KeepSkills`.
