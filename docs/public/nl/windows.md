---
slug: windows
category: Installatie
title: De CLI installeren op Windows
description: Installeer de CLI vanuit PowerShell, sla je API-sleutel op en maak een PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installatie {#インストール}

1. Zorg dat je **Node.js 24 of hoger** en een API-sleutel (`lrk_...`) van de beheerder hebt.
2. Open PowerShell onder je gewone gebruikersaccount en voer de volgende opdrachten uit.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Plak de sleutel in het afgeschermde invoerveld. Windows versleutelt de sleutel en slaat deze op voor de huidige gebruiker.
4. Open na de installatie **een nieuw PowerShell-venster**. Als je [een eigen server gebruikt](/nl/docs/cli/#接続先サーバー), stel dan eerst het serveradres in.

Om een sleutel opnieuw op te slaan, open je de instellingen met `n624-latex setup`.

## Eerste conversie {#最初の変換}

1. Open de map met `main.tex` in Verkenner. Je kunt het [voorbeelddocument](/nl/docs/#最短でpdfを作る) gebruiken.
2. Typ `powershell` in de adresbalk van Verkenner en druk op Enter. Voer in het geopende PowerShell-venster de volgende opdracht uit.

```powershell
n624-latex main.tex
```

In dezelfde map wordt `main.pdf` gemaakt. Zie [Converteren met de CLI](/nl/docs/cli/#レンダリング) om een ZIP te verwerken of meerdere bestanden te downloaden.

## Bijwerken {#更新}

Voer `n624-latex setup` uit in PowerShell en werk de client bij in het instellingenscherm.

> [!DETAILS] 履歴資料　Overstappen vanaf v1.6.9 of ouder
>
> Voer hetzelfde installatieprogramma uit de [installatie-instructies](#インストール) uit met `-SkipCredential`. Je opgeslagen sleutel blijft behouden en `n624-latex` wordt toegevoegd. Heb je de installatiemap gewijzigd, [geef dan dezelfde locatie op](/nl/docs/reference/#windowsの配置と保護). Bestaande scripts kunnen `latex-render` blijven gebruiken.

## Alleen de API-sleutel verwijderen {#apiキーだけを削除}

Voer de volgende opdracht uit als je alleen de opgeslagen sleutel wilt verwijderen en de client wilt behouden.

```powershell
n624-latex auth logout
```

## Verwijderen {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Standaard worden de client, de opgeslagen API-sleutel en de beheerde skills voor Codex en Claude verwijderd. Voeg `-KeepCredential` toe om je inloggegevens te behouden of `-KeepSkills` om je skills te behouden.
