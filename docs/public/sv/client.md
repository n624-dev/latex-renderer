---
slug: client
category: Installation
title: Installera CLI
description: Installera kommandoradsverktyget i Windows, macOS eller Linux och skapa din första PDF från terminalen.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Plattformar som stöds {#対応環境}

Installera CLI med metoden för ditt system och spara API-nyckeln (`lrk_...`) från administratören. LaTeX-dokumenten kompileras på servern.

| Plattform | Metod | Node.js |
| --- | --- | --- |
| Debian 12 / 13 eller Ubuntu 24.04 / 26.04 (amd64 eller arm64) | **[APT-paket](#debian-ubuntu-の-apt-パッケージ)** | Ingår |
| Windows | **[Anvisningar för Windows](/sv/docs/windows/)** | 24 eller senare |
| macOS (Apple Silicon eller Intel) | **[Homebrew](#homebrew-でインストール)** | Installeras av Homebrew |
| macOS eller andra Linuxdistributioner | **[Nedladdningsbart installationsprogram](#linux-macos)** | 24 eller senare |

## Installera med APT i Debian eller Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Hämta `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Filen innehåller den publika signeringsnyckeln för LaTeX Renderers APT-förråd.
2. Kör följande kommandon för att installera paketet i mappen där du sparade det.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Fortsätt med [Skapa din första PDF](#最初の-pdf-を作る). Vill du installera en server, följ [anvisningarna för egen server](/sv/docs/self-hosting/).

## Installera med Homebrew {#homebrew-でインストール}

Kör följande kommandon på en Mac med Homebrew installerat.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Fortsätt med [Skapa din första PDF](#最初の-pdf-を作る) när du har sparat API-nyckeln.

### Byt från det nedladdningsbara installationsprogrammet till Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Du kan behålla API-nyckeln och MCP-inställningarna. Kör `type -a n624-latex` för att se vilket kommando skalet hittar först. Om det hittar den tidigare installationen först, kör Homebrew-versionen direkt.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

För att `n624-latex` ska använda Homebrew-versionen, placera i skalets `PATH` Homebrews `bin`-katalog före den tidigare installationen.

Vill du även byta Local MCP, ändra kommandot för posten `latex-renderer` i ditt AI-verktyg till den absoluta sökvägen till Homebrews `bin/latex-renderer-mcp`. Hitta installationen med `brew --prefix`.

Starta om AI-verktyget innan du tar bort den tidigare versionen och kontrollera att det ansluter till Local MCP från Homebrew. Ange den absoluta sökvägen till den gamla startfilen vid avinstallationen och behåll nyckeln och dina skills. För en installation på standardplatsen kör du följande kommando.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Förbered det nedladdningsbara installationsprogrammet {#配布インストーラーの準備}

Installera **Node.js 24 eller senare** för ditt vanliga användarkonto och kontrollera versionen med `node --version`. Följ [anvisningarna för Windows](/sv/docs/windows/) om du använder Windows.

## Linux och macOS {#linux-macos}

Hämta installationsprogrammet till en tillfällig mapp i terminalen och kör det med Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Hittas inte `n624-latex`, öppna en ny terminal. Om problemet kvarstår, kör `export PATH="$HOME/.local/bin:$PATH"` och lägg till samma rad i skalets inställningsfil, exempelvis `~/.bashrc` eller `~/.zshrc`.

## Skapa din första PDF {#最初の-pdf-を作る}

1. Öppna inställningarna som vanlig användare och spara API-nyckeln. För egen drift, [ange servern först](/sv/docs/cli/#接続先サーバー). Om du inte kan öppna en webbläsare, [läs in nyckeln via standardindata](/sv/docs/cli/#認証).

```sh
n624-latex setup
```

2. Kör följande i mappen som innehåller `main.tex`. Du kan använda [exempeldokumentet](/sv/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

`main.pdf` skapas i samma mapp. För att välja mål eller arbeta med ZIP, PDF och SVG, se [Konvertera och hämta med CLI](/sv/docs/cli/#レンダリング).

## Windows {#windows}

[Anvisningarna för Windows](/sv/docs/windows/) använder PowerShell. Windows DPAPI krypterar den sparade nyckeln för den aktuella användaren. Se [Byta plats och reparera PATH](/sv/docs/reference/#windowsの配置と保護).

## Uppdateringar {#更新}

### Uppdatera APT-paketet {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Anslutningen och den sparade API-nyckeln behålls. Använd [administrationens uppdateringssida](/sv/docs/updates/) för att uppdatera din egen server.

### Uppdatera Homebrew-paketet {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Uppdatera klienten från det nedladdade installationsprogrammet {#配布インストーラー版の更新}

Kör följande kommando eller upprepa installationskommandot.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Uppdatera klienter från v1.6.9 eller tidigare
>
> Om endast `latex-render` är installerat, gör om installationen. [I Windows kan du uppdatera utan att ange den sparade nyckeln igen](/sv/docs/windows/#更新). I macOS och Linux kan du även uppdatera med `latex-render setup` och lägga till det nya kommandot med `latex-render setup repair`. Befintliga skript kan fortsätta använda `latex-render`.

> [!DETAILS] Så fungerar installation och uppdatering
>
> - Om SHA-256 för det nedladdade ZIP-arkivet matchar den installerade versionen kontrolleras de hanterade inställningarna utan att filerna installeras om.
> - Vid uppdatering flyttas den gamla versionen till en tidsstämplad säkerhetskopia. Andra startfiler, MCP-registreringar och användarändrade skills behålls.

## Kontrollera och reparera installationen {#状態確認と修復}

Följande kommandon kontrollerar status oavsett installationsmetod.

```sh
n624-latex setup status
n624-latex doctor --json
```

- För APT, installera om paketet med `sudo apt install --reinstall n624-latex`.
- För Homebrew, installera om paketet med `brew reinstall n624-dev/tap/n624-latex`.
- För det nedladdade installationsprogrammet, reparera hanterade startfiler och integreringar med `n624-latex setup repair`.

## Spara och återställ utdatafiler {#成果物の保存と復旧}

`n624-latex main.tex` sparar PDF-filen i aktuell mapp. Filerna som `render` och `jobs download` sparar, bland annat PDF, loggar och bilder, beskrivs i [Utdatafiler från CLI](/sv/docs/cli/#成果物). Om målet används, se [Felsökning](/sv/docs/troubleshooting/#成果物の取得).

## Avinstallation {#アンインストール}

Avinstallera APT-paketet med `sudo apt remove n624-latex`. Vill du även ta bort användarens nyckel, kör `n624-latex auth logout` före avinstallationen.

Avinstallera Homebrew-paketet med `brew uninstall n624-dev/tap/n624-latex`. Den sparade nyckeln och AI-verktygets MCP-inställningar behålls. Behöver du dem inte längre, logga ut före avinstallationen och ta bort MCP-konfigurationen i AI-verktyget.

För det nedladdade installationsprogrammet kör du följande.

```sh
n624-latex setup remove --yes
```

Lägg till `--keep-credential` för att behålla inloggningsuppgifterna eller `--keep-skills` för att behålla dina skills. För avinstallation med Windows-skriptet, se [anvisningarna för Windows](/sv/docs/windows/#アンインストール).
