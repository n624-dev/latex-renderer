---
slug: client
category: Installation
title: Installér CLI
description: Installér kommandolinjeværktøjet i Windows, macOS eller Linux, og lav din første PDF fra terminalen.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Understøttede platforme {#対応環境}

Installér CLI med metoden til dit system, og gem API-nøglen (`lrk_...`) fra administratoren. Serveren kompilerer LaTeX-dokumenterne.

| Platform | Metode | Node.js |
| --- | --- | --- |
| Debian 12 / 13 eller Ubuntu 24.04 / 26.04 (amd64 eller arm64) | **[APT-pakke](#debian-ubuntu-の-apt-パッケージ)** | Medfølger |
| Windows | **[Vejledning til Windows](/da/docs/windows/)** | 24 eller nyere |
| macOS (Apple Silicon eller Intel) | **[Homebrew](#homebrew-でインストール)** | Installeres af Homebrew |
| macOS eller andre Linux-distributioner | **[Installationsprogram til download](#linux-macos)** | 24 eller nyere |

## Installér med APT i Debian eller Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Hent `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Filen indeholder den offentlige signeringsnøgle til LaTeX Renderers APT-pakkearkiv.
2. Kør følgende kommandoer i mappen med den hentede fil for at installere pakken.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Fortsæt med [Lav din første PDF](#最初の-pdf-を作る). Vil du installere en server, skal du følge [vejledningen til egen drift](/da/docs/self-hosting/).

## Installér med Homebrew {#homebrew-でインストール}

Kør følgende på en Mac med Homebrew installeret.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Når du har gemt API-nøglen, kan du fortsætte med [Lav din første PDF](#最初の-pdf-を作る).

### Skift fra det downloadede installationsprogram til Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Du kan beholde API-nøglen og MCP-opsætningen. Kør `type -a n624-latex` for at se, hvilken kommando skallen finder først. Hvis den finder den gamle installation først, skal du køre Homebrew-versionen direkte.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Hvis `n624-latex` skal bruge Homebrew-versionen, skal du i skallens `PATH` placere Homebrews `bin`-mappe før den gamle installation.

Hvis du også vil flytte Local MCP, skal du ændre kommandoen i dit AI-værktøjs `latex-renderer`-post til den absolutte sti til Homebrews `bin/latex-renderer-mcp`. Brug `brew --prefix` til at finde installationen.

Genstart AI-værktøjet, før du fjerner den gamle version, og kontroller forbindelsen til Homebrews Local MCP. Brug den absolutte sti til den tidligere startfil ved afinstallationen, og behold nøglen og dine skills. Brug følgende kommando for en installation på standardplaceringen.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Klargør det downloadede installationsprogram {#配布インストーラーの準備}

Installér **Node.js 24 eller nyere** for din almindelige bruger, og kontroller versionen med `node --version`. Følg [vejledningen til Windows](/da/docs/windows/), hvis du bruger Windows.

## Linux og macOS {#linux-macos}

Hent installationsprogrammet til en midlertidig mappe fra terminalen, og kør det med Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Hvis `n624-latex` ikke bliver fundet, skal du åbne en ny terminal. Fortsætter problemet, skal du køre `export PATH="$HOME/.local/bin:$PATH"` og tilføje samme linje i skallens konfigurationsfil, f.eks. `~/.bashrc` eller `~/.zshrc`.

## Lav din første PDF {#最初の-pdf-を作る}

1. Åbn indstillingerne som almindelig bruger, og gem API-nøglen. Ved egen drift skal du [angive serveren først](/da/docs/cli/#接続先サーバー). Hvis du ikke kan åbne en browser, kan du [læse nøglen fra standardinput](/da/docs/cli/#認証).

```sh
n624-latex setup
```

2. Kør kommandoen i mappen med `main.tex`. Du kan bruge [eksempeldokumentet](/da/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

`main.pdf` oprettes i samme mappe. Se [Konvertér og hent med CLI](/da/docs/cli/#レンダリング) for at vælge en destination eller arbejde med ZIP, PDF og SVG.

## Windows {#windows}

[Vejledningen til Windows](/da/docs/windows/) bruger PowerShell. Windows DPAPI krypterer den gemte nøgle for den aktuelle bruger. Se [Skift placering og reparer PATH](/da/docs/reference/#windowsの配置と保護).

## Opdateringer {#更新}

### Opdater APT-pakken {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Den gemte forbindelse og API-nøgle bevares. Brug [opdateringssiden i administrationen](/da/docs/updates/) for at opdatere din egen server.

### Opdater Homebrew-pakken {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Opdater klienten fra det downloadede installationsprogram {#配布インストーラー版の更新}

Kør følgende kommando, eller gentag den oprindelige installationskommando.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Opdater klienter fra v1.6.9 eller tidligere
>
> Hvis kun `latex-render` er installeret, skal du gentage installationen. [I Windows kan du opdatere uden at indtaste den gemte nøgle igen](/da/docs/windows/#更新). I macOS og Linux kan du også opdatere med `latex-render setup` og tilføje den nye kommando med `latex-render setup repair`. Eksisterende scripts kan fortsat bruge `latex-render`.

> [!DETAILS] Sådan fungerer installation og opdatering
>
> - Hvis SHA-256 for det downloadede ZIP-arkiv svarer til den installerede version, kontrolleres de administrerede indstillinger, uden at filerne geninstalleres.
> - Ved opdatering flytter installationsprogrammet den gamle version til en tidsstemplet sikkerhedskopi. Andre startfiler, MCP-registreringer og brugertilpassede skills bevares.

## Kontroller og reparer installationen {#状態確認と修復}

Disse kommandoer kontrollerer status uanset installationsmetode.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Ved APT geninstallerer du pakken med `sudo apt install --reinstall n624-latex`.
- Ved Homebrew geninstallerer du pakken med `brew reinstall n624-dev/tap/n624-latex`.
- Ved det downloadede installationsprogram reparerer du administrerede startfiler og integrationer med `n624-latex setup repair`.

## Gem og gendan outputfiler {#成果物の保存と復旧}

`n624-latex main.tex` gemmer PDF-filen i den aktuelle mappe. Se filerne fra `render` og `jobs download`, herunder PDF, logfiler og billeder, i [Outputfiler fra CLI](/da/docs/cli/#成果物). Hvis destinationen er i brug, se [Fejlfinding](/da/docs/troubleshooting/#成果物の取得).

## Afinstallation {#アンインストール}

Afinstallér APT-pakken med `sudo apt remove n624-latex`. Vil du også fjerne brugerens nøgle, skal du køre `n624-latex auth logout` før afinstallation.

Afinstallér Homebrew-pakken med `brew uninstall n624-dev/tap/n624-latex`. Den gemte nøgle og AI-værktøjets MCP-opsætning bevares. Hvis du ikke længere skal bruge dem, skal du logge ud før afinstallation og fjerne MCP-opsætningen i AI-værktøjet.

For det downloadede installationsprogram skal du køre følgende kommando.

```sh
n624-latex setup remove --yes
```

Tilføj `--keep-credential` for at beholde loginoplysninger eller `--keep-skills` for at beholde skills. Se [vejledningen til Windows](/da/docs/windows/#アンインストール) for afinstallation med Windows-scriptet.
