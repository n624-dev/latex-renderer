---
slug: windows
category: Asennus
title: Komentorivityökalun asentaminen Windowsiin
description: Asenna komentorivityökalu PowerShellissä, tallenna API-avain ja luo PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Asennus {#インストール}

1. Tarvitset **Node.js-version 24 tai uudemman** ja ylläpitäjän myöntämän API-avaimen (`lrk_...`).
2. Avaa PowerShell tavallisella käyttäjätililläsi ja suorita seuraavat komennot.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Liitä avain peitettyyn syötekenttään. Windows salaa ja tallentaa sen nykyiselle käyttäjälle.
4. Avaa asennuksen jälkeen **uusi PowerShell-ikkuna**. Jos [käytät omaa palvelinta](/fi/docs/cli/#接続先サーバー), määritä sen osoite ennen muunnosta.

Jos haluat tallentaa avaimen uudelleen, avaa asetukset komennolla `n624-latex setup`.

## Ensimmäinen muunnos {#最初の変換}

1. Avaa Resurssienhallinnassa kansio, jossa `main.tex` sijaitsee. Voit käyttää [esimerkkiasiakirjaa](/fi/docs/#最短でpdfを作る).
2. Kirjoita Resurssienhallinnan osoiteriville `powershell` ja paina Enter. Suorita avautuvassa PowerShell-ikkunassa seuraava komento.

```powershell
n624-latex main.tex
```

Samaan kansioon luodaan `main.pdf`. Katso [Muuntaminen komentorivillä](/fi/docs/cli/#レンダリング), jos haluat käsitellä ZIP-arkistoa tai ladata useita tulostiedostoja.

## Päivittäminen {#更新}

Suorita PowerShellissä `n624-latex setup` ja päivitä asiakasohjelma asetussivulla.

> [!DETAILS] 履歴資料　Siirtyminen versiosta v1.6.9 tai vanhemmasta
>
> Suorita sama asennusohjelma kuin [asennusohjeessa](#インストール) käyttäen valitsinta `-SkipCredential`. Tallennettu avain säilyy ja `n624-latex` lisätään. Jos muutit asennuskansiota, [anna sama sijainti](/fi/docs/reference/#windowsの配置と保護). Nykyiset komentosarjat voivat käyttää edelleen komentoa `latex-render`.

## Pelkän API-avaimen poistaminen {#apiキーだけを削除}

Jos haluat säilyttää asiakasohjelman ja poistaa vain tallennetun avaimen, suorita seuraava komento.

```powershell
n624-latex auth logout
```

## Asennuksen poistaminen {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Oletuksena poistetaan asiakasohjelma, tallennettu API-avain ja hallitut Codex- ja Claude-taidot. Säilytä kirjautumistiedot lisäämällä `-KeepCredential` tai taidot lisäämällä `-KeepSkills`.
