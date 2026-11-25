---
slug: client
category: Installasjon
title: Installer CLI
description: Installer kommandolinjeverktøyet i Windows, macOS eller Linux og lag din første PDF fra terminalen.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Støttede plattformer {#対応環境}

Installer CLI med metoden for operativsystemet ditt og lagre API-nøkkelen (`lrk_...`) fra administratoren. LaTeX-dokumentene kompileres på serveren.

| Plattform | Metode | Node.js |
| --- | --- | --- |
| Debian 12 / 13 eller Ubuntu 24.04 / 26.04 (amd64 eller arm64) | **[APT-pakke](#debian-ubuntu-の-apt-パッケージ)** | Inkludert |
| Windows | **[Veiledning for Windows](/no/docs/windows/)** | 24 eller nyere |
| macOS (Apple Silicon eller Intel) | **[Homebrew](#homebrew-でインストール)** | Installeres av Homebrew |
| macOS eller andre Linux-distribusjoner | **[Nedlastbart installasjonsprogram](#linux-macos)** | 24 eller nyere |

## Installer med APT i Debian eller Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Last ned `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Filen inneholder den offentlige signeringsnøkkelen for APT-pakkearkivet til LaTeX Renderer.
2. Kjør følgende kommandoer i mappen der du lagret filen for å installere pakken.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Fortsett med [Lag din første PDF](#最初の-pdf-を作る). For serverinstallasjon følger du [veiledningen for egen drift](/no/docs/self-hosting/).

## Installer med Homebrew {#homebrew-でインストール}

Kjør følgende kommandoer på en Mac der Homebrew er installert.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Når API-nøkkelen er lagret, fortsetter du med [Lag din første PDF](#最初の-pdf-を作る).

### Bytt fra det nedlastbare installasjonsprogrammet til Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Du kan beholde API-nøkkelen og MCP-oppsettet. Kjør `type -a n624-latex` for å se hvilken kommando skallet finner først. Hvis det finner den gamle installasjonen først, kjør Homebrew-versjonen direkte.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Hvis `n624-latex` skal bruke Homebrew-versjonen, plasserer du Homebrew-katalogen i søkestien slik: I skallets `PATH` skal Homebrews `bin` stå foran den gamle installasjonen.

Vil du også bytte Local MCP, endrer du kommandoen i oppføringen `latex-renderer` i KI-verktøyet til den absolutte stien til Homebrews `bin/latex-renderer-mcp`. Finn plasseringen med `brew --prefix`.

Før du fjerner den gamle versjonen, start KI-verktøyet på nytt og kontroller at det kobler seg til Local MCP fra Homebrew. Bruk absolutt sti til den gamle startfilen ved avinstallasjon og behold nøkkelen og ferdighetene. Kjør følgende kommando for en installasjon på standardplasseringen.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Klargjør det nedlastbare installasjonsprogrammet {#配布インストーラーの準備}

Installer **Node.js 24 eller nyere** for din vanlige bruker og kontroller versjonen med `node --version`. Bruk [veiledningen for Windows](/no/docs/windows/) hvis du kjører Windows.

## Linux og macOS {#linux-macos}

Last ned installasjonsprogrammet til en midlertidig mappe i terminalen og kjør det med Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Hvis `n624-latex` ikke blir funnet, åpne en ny terminal. Vedvarer problemet, kjør `export PATH="$HOME/.local/bin:$PATH"` og legg til samme linje i skallets oppsettsfil, for eksempel `~/.bashrc` eller `~/.zshrc`.

## Lag din første PDF {#最初の-pdf-を作る}

1. Åpne innstillingene som vanlig bruker og lagre API-nøkkelen. Ved egen drift, [angi serveren først](/no/docs/cli/#接続先サーバー). Kan du ikke åpne en nettleser, [les inn nøkkelen fra standard inndata](/no/docs/cli/#認証).

```sh
n624-latex setup
```

2. Kjør følgende i mappen som inneholder `main.tex`. Du kan bruke [eksempeldokumentet](/no/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

`main.pdf` opprettes i samme mappe. Hvis du vil velge mål eller arbeide med ZIP, PDF og SVG, se [Konverter og last ned med CLI](/no/docs/cli/#レンダリング).

## Windows {#windows}

[Veiledningen for Windows](/no/docs/windows/) bruker PowerShell. Windows DPAPI krypterer den lagrede nøkkelen for den gjeldende brukeren. Se [Bytt plassering og reparer PATH](/no/docs/reference/#windowsの配置と保護).

## Oppdateringer {#更新}

### Oppdater APT-pakken {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Tilkoblingen og den lagrede API-nøkkelen beholdes. Vil du oppdatere en egen server, bruk [oppdateringssiden i administrasjonen](/no/docs/updates/).

### Oppdater Homebrew-pakken {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Oppdater klienten fra det nedlastbare installasjonsprogrammet {#配布インストーラー版の更新}

Kjør følgende kommando eller kjør den opprinnelige installasjonskommandoen på nytt.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Oppdater klienter fra v1.6.9 eller eldre
>
> Hvis bare `latex-render` er installert, gjenta installasjonen. [I Windows kan du oppdatere uten å oppgi den lagrede nøkkelen på nytt](/no/docs/windows/#更新). I macOS og Linux kan du også oppdatere med `latex-render setup` og legge til den nye kommandoen med `latex-render setup repair`. Eksisterende skript kan fortsatt bruke `latex-render`.

> [!DETAILS] Slik fungerer installasjon og oppdatering
>
> - Hvis SHA-256 for det nedlastbare ZIP-arkivet samsvarer med installert versjon, kontrolleres de administrerte innstillingene uten å installere filene på nytt.
> - Ved oppdatering flyttes den gamle versjonen til en sikkerhetskopi med tidsstempel. Andre startfiler, MCP-registreringer og ferdigheter som brukeren har endret, beholdes.

## Kontroller og reparer installasjonen {#状態確認と修復}

Disse kommandoene kontrollerer status uansett installasjonsmetode.

```sh
n624-latex setup status
n624-latex doctor --json
```

- For APT installerer du pakken på nytt med `sudo apt install --reinstall n624-latex`.
- For Homebrew installerer du pakken på nytt med `brew reinstall n624-dev/tap/n624-latex`.
- For det nedlastbare installasjonsprogrammet reparerer du administrerte startfiler og integrasjoner med `n624-latex setup repair`.

## Lagre og gjenopprett utdatafiler {#成果物の保存と復旧}

`n624-latex main.tex` lagrer PDF-filen i gjeldende mappe. Filer lagret med `render` og `jobs download`, deriblant PDF, logger og bilder, beskrives i [Utdatafiler fra CLI](/no/docs/cli/#成果物). Hvis målet er i bruk, se [Feilsøking](/no/docs/troubleshooting/#成果物の取得).

## Avinstallasjon {#アンインストール}

Avinstaller APT-pakken med `sudo apt remove n624-latex`. For å fjerne brukernøkkelen også, kjør `n624-latex auth logout` før avinstallasjon.

Avinstaller Homebrew-pakken med `brew uninstall n624-dev/tap/n624-latex`. Den lagrede nøkkelen og MCP-oppsettet i KI-verktøyet beholdes. Trenger du dem ikke lenger, logg ut før avinstallasjon og fjern MCP-oppsettet i verktøyet.

For det nedlastbare installasjonsprogrammet kjører du følgende.

```sh
n624-latex setup remove --yes
```

Legg til `--keep-credential` for å beholde påloggingsopplysninger eller `--keep-skills` for å beholde ferdigheter. For avinstallasjon med Windows-skriptet, se [veiledningen for Windows](/no/docs/windows/#アンインストール).
