---
slug: windows
category: Installation
title: Installera CLI i Windows
description: Installera CLI från PowerShell, spara din API-nyckel och skapa en PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installation {#インストール}

1. Förbered **Node.js 24 eller senare** och en API-nyckel (`lrk_...`) från administratören.
2. Öppna PowerShell som din vanliga användare och kör följande kommandon.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Klistra in nyckeln i det dolda inmatningsfältet. Windows krypterar och sparar den för den aktuella användaren.
4. Öppna **ett nytt PowerShell-fönster** efter installationen. Om du [använder en egen server](/sv/docs/cli/#接続先サーバー), ange dess adress innan du konverterar.

Öppna inställningarna med `n624-latex setup` om du vill registrera en nyckel igen.

## Första konverteringen {#最初の変換}

1. Öppna mappen med `main.tex` i Utforskaren. Du kan använda [exempeldokumentet](/sv/docs/#最短でpdfを作る).
2. Skriv `powershell` i Utforskarens adressfält och tryck på Retur. Kör följande kommando i PowerShell-fönstret som öppnas.

```powershell
n624-latex main.tex
```

`main.pdf` skapas i samma mapp. Se [Konvertera med CLI](/sv/docs/cli/#レンダリング) för att arbeta med ZIP-arkiv eller hämta flera filer.

## Uppdatering {#更新}

Kör `n624-latex setup` i PowerShell och uppdatera klienten från inställningssidan.

> [!DETAILS] 履歴資料　Migrera från v1.6.9 eller tidigare
>
> Kör samma installationsprogram som i [installationsanvisningarna](#インストール) med `-SkipCredential`. Din sparade nyckel behålls och `n624-latex` läggs till. Har du bytt installationsmapp, [ange samma plats](/sv/docs/reference/#windowsの配置と保護). Befintliga skript kan fortsätta använda `latex-render`.

## Ta endast bort API-nyckeln {#apiキーだけを削除}

Kör följande kommando för att behålla klienten och bara ta bort den sparade nyckeln.

```powershell
n624-latex auth logout
```

## Avinstallation {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Som standard tas klienten, den sparade API-nyckeln och hanterade skills för Codex och Claude bort. Lägg till `-KeepCredential` för att behålla inloggningsuppgifterna eller `-KeepSkills` för att behålla dina skills.
