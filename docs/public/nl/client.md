---
slug: client
category: Installatie
title: De CLI installeren
description: Installeer de CLI op Windows, macOS of Linux en maak je eerste PDF vanuit de terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Ondersteunde platforms {#対応環境}

Installeer de CLI met de methode voor je besturingssysteem en sla de API-sleutel (`lrk_...`) van de beheerder op. De server compileert de LaTeX-documenten.

| Platform | Installatiemethode | Node.js |
| --- | --- | --- |
| Debian 12 / 13 of Ubuntu 24.04 / 26.04 (amd64 of arm64) | **[APT-pakket](#debian-ubuntu-の-apt-パッケージ)** | Inbegrepen |
| Windows | **[Instructies voor Windows](/nl/docs/windows/)** | 24 of hoger |
| macOS (Apple Silicon of Intel) | **[Homebrew](#homebrew-でインストール)** | Geïnstalleerd door Homebrew |
| macOS of andere Linux-distributies | **[Downloadbaar installatieprogramma](#linux-macos)** | 24 of hoger |

## Installeren met APT op Debian of Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Download `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Dit bestand bevat de openbare ondertekeningssleutel van de APT-repository voor LaTeX Renderer.
2. Installeer het pakket met de volgende opdrachten in de map waarin je het hebt opgeslagen.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Ga verder met [Je eerste PDF maken](#最初の-pdf-を作る). Wil je een server installeren, volg dan de [instructies voor een eigen server](/nl/docs/self-hosting/).

## Installeren met Homebrew {#homebrew-でインストール}

Voer de volgende opdrachten uit op een Mac waarop Homebrew is geïnstalleerd.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Sla je API-sleutel op en ga verder met [Je eerste PDF maken](#最初の-pdf-を作る).

### Overstappen van het downloadbare installatieprogramma naar Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Je kunt je API-sleutel en MCP-configuratie behouden. Gebruik `type -a n624-latex` om te controleren welke opdracht je shell als eerste vindt. Krijgt de oude installatie voorrang, start dan rechtstreeks de Homebrew-versie.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Wil je dat `n624-latex` de Homebrew-versie gebruikt, zet dan in de `PATH` van je shell de Homebrew-map `bin` vóór de oude installatie.

Wil je ook Local MCP omzetten, wijzig dan de opdracht van de vermelding `latex-renderer` in je AI-tool in het absolute pad naar Homebrews `bin/latex-renderer-mcp`. Zoek de installatie op met `brew --prefix`.

Start je AI-tool opnieuw voordat je de oude versie verwijdert en controleer dat deze verbinding maakt met Local MCP van Homebrew. Gebruik het absolute pad naar de oude starter bij het verwijderen en behoud je sleutel en skills. Gebruik voor een installatie op de standaardlocatie de volgende opdracht.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Het downloadbare installatieprogramma voorbereiden {#配布インストーラーの準備}

Installeer **Node.js 24 of hoger** voor je gewone gebruikersaccount en controleer de versie met `node --version`. Volg onder Windows de [instructies voor Windows](/nl/docs/windows/).

## Linux en macOS {#linux-macos}

Download het installatieprogramma vanuit de terminal naar een tijdelijke map en voer het uit met Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Wordt `n624-latex` niet gevonden, open dan een nieuwe terminal. Blijft het probleem bestaan, voer dan `export PATH="$HOME/.local/bin:$PATH"` uit en voeg dezelfde regel toe aan het configuratiebestand van je shell, bijvoorbeeld `~/.bashrc` of `~/.zshrc`.

## Je eerste PDF maken {#最初の-pdf-を作る}

1. Open de instellingen onder je gewone account en sla de API-sleutel op. Gebruik je een eigen server, [stel dan eerst de server in](/nl/docs/cli/#接続先サーバー). Kun je geen browser openen, [lees de sleutel dan in via standaardinvoer](/nl/docs/cli/#認証).

```sh
n624-latex setup
```

2. Voer deze opdracht uit in de map met `main.tex`. Je kunt het [voorbeelddocument](/nl/docs/#最短でpdfを作る) gebruiken.

```sh
n624-latex main.tex
```

In dezelfde map wordt `main.pdf` gemaakt. Zie [Converteren en downloaden met de CLI](/nl/docs/cli/#レンダリング) om een locatie te kiezen of ZIP, PDF en SVG te verwerken.

## Windows {#windows}

De [Windows-instructies](/nl/docs/windows/) gebruiken PowerShell. Windows DPAPI versleutelt de opgeslagen sleutel voor de huidige gebruiker. Zie [De locatie wijzigen en PATH herstellen](/nl/docs/reference/#windowsの配置と保護).

## Updates {#更新}

### Het APT-pakket bijwerken {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

De opgeslagen verbinding en API-sleutel blijven behouden. Werk je eigen server bij via het [updatescherm voor beheerders](/nl/docs/updates/).

### Het Homebrew-pakket bijwerken {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### De client van het downloadbare installatieprogramma bijwerken {#配布インストーラー版の更新}

Voer de volgende opdracht uit of voer de oorspronkelijke installatieopdracht opnieuw uit.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Clients van v1.6.9 en ouder bijwerken
>
> Als alleen `latex-render` is geïnstalleerd, voer de installatie dan opnieuw uit. [In Windows kun je bijwerken zonder de opgeslagen sleutel opnieuw in te voeren](/nl/docs/windows/#更新). Op macOS en Linux kun je ook bijwerken met `latex-render setup` en de nieuwe opdracht toevoegen met `latex-render setup repair`. Bestaande scripts kunnen `latex-render` blijven gebruiken.

> [!DETAILS] Hoe installatie en updates werken
>
> - Komt de SHA-256 van de downloadbare ZIP overeen met de geïnstalleerde versie, dan worden de beheerde instellingen gecontroleerd zonder de bestanden opnieuw te installeren.
> - Bij een update verplaatst het installatieprogramma de vorige versie naar een back-up met een tijdstempel. Andere starters, MCP-registraties en door de gebruiker gewijzigde skills blijven behouden.

## De installatie controleren en herstellen {#状態確認と修復}

Met deze opdrachten controleer je de status, ongeacht de installatiemethode.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Voor APT installeer je het pakket opnieuw met `sudo apt install --reinstall n624-latex`.
- Voor Homebrew installeer je het pakket opnieuw met `brew reinstall n624-dev/tap/n624-latex`.
- Bij het downloadbare installatieprogramma herstel je beheerde starters en integraties met `n624-latex setup repair`.

## Uitvoerbestanden opslaan en herstellen {#成果物の保存と復旧}

`n624-latex main.tex` slaat de PDF op in de huidige map. Zie [Uitvoerbestanden van de CLI](/nl/docs/cli/#成果物) voor de PDF's, logbestanden en afbeeldingen die `render` en `jobs download` opslaan. Is de bestemming in gebruik, zie dan [Problemen oplossen](/nl/docs/troubleshooting/#成果物の取得).

## Verwijderen {#アンインストール}

Verwijder het APT-pakket met `sudo apt remove n624-latex`. Om ook de sleutel van de gebruiker te verwijderen, voer je vooraf `n624-latex auth logout` uit.

Verwijder het Homebrew-pakket met `brew uninstall n624-dev/tap/n624-latex`. De opgeslagen sleutel en MCP-configuratie van je AI-tool blijven behouden. Heb je ze niet meer nodig, meld je dan af voordat je het pakket verwijdert en verwijder de MCP-configuratie in de AI-tool.

Gebruik voor het downloadbare installatieprogramma de volgende opdracht.

```sh
n624-latex setup remove --yes
```

Voeg `--keep-credential` toe om inloggegevens te behouden of `--keep-skills` om skills te behouden. Zie de [Windows-instructies](/nl/docs/windows/#アンインストール) voor verwijdering met het Windows-script.
