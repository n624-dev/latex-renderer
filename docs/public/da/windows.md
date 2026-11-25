---
slug: windows
category: Installation
title: Installér CLI i Windows
description: Installér CLI fra PowerShell, gem din API-nøgle, og opret en PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installation {#インストール}

1. Sørg for at have **Node.js 24 eller nyere** og en API-nøgle (`lrk_...`) fra administratoren.
2. Åbn PowerShell med din almindelige brugerkonto, og kør følgende kommandoer.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Indsæt nøglen i det skjulte inputfelt. Windows krypterer og gemmer nøglen for den aktuelle bruger.
4. Åbn **et nyt PowerShell-vindue** efter installationen. Hvis du [bruger din egen server](/da/docs/cli/#接続先サーバー), skal du angive adressen før konvertering.

Hvis du vil registrere en nøgle igen, åbner du indstillingerne med `n624-latex setup`.

## Første konvertering {#最初の変換}

1. Åbn mappen med `main.tex` i Stifinder. Du kan bruge [eksempeldokumentet](/da/docs/#最短でpdfを作る).
2. Skriv `powershell` i Stifinders adresselinje, og tryk på Enter. Kør følgende kommando i det PowerShell-vindue, der åbnes.

```powershell
n624-latex main.tex
```

`main.pdf` oprettes i samme mappe. Se [Konvertér med CLI](/da/docs/cli/#レンダリング) for at arbejde med ZIP eller hente flere filer.

## Opdatering {#更新}

Kør `n624-latex setup` i PowerShell, og opdater klienten på indstillingssiden.

> [!DETAILS] 履歴資料　Skift fra v1.6.9 eller tidligere
>
> Kør det samme installationsprogram som i [installationsvejledningen](#インストール) med `-SkipCredential`. Den gemte nøgle bevares, og `n624-latex` tilføjes. Har du ændret installationsmappen, skal du [angive samme placering](/da/docs/reference/#windowsの配置と保護). Eksisterende scripts kan fortsat bruge `latex-render`.

## Fjern kun API-nøglen {#apiキーだけを削除}

Kør følgende kommando for at beholde klienten og kun fjerne den gemte nøgle.

```powershell
n624-latex auth logout
```

## Afinstallation {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Som standard fjernes klienten, den gemte API-nøgle og administrerede skills til Codex og Claude. Tilføj `-KeepCredential` for at beholde loginoplysninger eller `-KeepSkills` for at beholde skills.
