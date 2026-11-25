---
slug: client
category: Asennus
title: Komentorivityökalun asentaminen
description: Asenna komentorivityökalu Windowsiin, macOS:ään tai Linuxiin ja luo ensimmäinen PDF päätteessä.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Tuetut alustat {#対応環境}

Asenna komentorivityökalu käyttöjärjestelmällesi sopivalla tavalla ja tallenna ylläpitäjältä saamasi API-avain (`lrk_...`). Palvelin kääntää LaTeX-asiakirjat.

| Alusta | Asennustapa | Node.js |
| --- | --- | --- |
| Debian 12 / 13 tai Ubuntu 24.04 / 26.04 (amd64 tai arm64) | **[APT-paketti](#debian-ubuntu-の-apt-パッケージ)** | Sisältyy pakettiin |
| Windows | **[Windows-ohje](/fi/docs/windows/)** | 24 tai uudempi |
| macOS (Apple Silicon tai Intel) | **[Homebrew](#homebrew-でインストール)** | Homebrew asentaa |
| macOS tai muu Linux-jakelu | **[Ladattava asennusohjelma](#linux-macos)** | 24 tai uudempi |

## Asennus APT:llä Debianiin tai Ubuntuun {#debian-ubuntu-の-apt-パッケージ}

1. [Lataa `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Tiedosto sisältää LaTeX Rendererin APT-pakettivaraston julkisen allekirjoitusavaimen.
2. Asenna paketti ajamalla seuraavat komennot latauskansiossa.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Jatka kohtaan [Ensimmäisen PDF:n luominen](#最初の-pdf-を作る). Jos asennat palvelimen, katso [oman palvelimen ohjeet](/fi/docs/self-hosting/).

## Asennus Homebrew’lla {#homebrew-でインストール}

Aja seuraavat komennot Macissa, johon on asennettu Homebrew.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Kun olet tallentanut API-avaimen, jatka kohtaan [Ensimmäisen PDF:n luominen](#最初の-pdf-を作る).

### Siirtyminen ladattavasta asennusohjelmasta Homebrew’hun {#配布インストーラー版から-homebrew-へ移行する}

Voit säilyttää API-avaimen ja MCP-asetukset. Tarkista komennolla `type -a n624-latex`, minkä komennon komentotulkki löytää ensin. Jos vanha asennus tulee ensin, käynnistä Homebrew-versio suoraan.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Jos haluat komennon `n624-latex` käyttävän Homebrew-versiota, aseta komentotulkin `PATH`-muuttujassa Homebrew’n `bin`-hakemisto ennen vanhaa asennusta.

Jos vaihdat myös paikallisen MCP:n, muuta tekoälytyökalun `latex-renderer`-määrityksen komennoksi Homebrew’n komennon `bin/latex-renderer-mcp` absoluuttinen polku. Löydät asennuspolun komennolla `brew --prefix`.

Ennen kuin poistat vanhan version, käynnistä tekoälytyökalu uudelleen ja varmista, että se saa yhteyden Homebrew’n paikalliseen MCP:hen. Käytä poistossa vanhan käynnistimen absoluuttista polkua ja säilytä avain ja taidot. Jos käytit oletussijaintia, aja seuraava komento.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Ladattavan asennusohjelman valmistelu {#配布インストーラーの準備}

Asenna tavalliselle käyttäjätilillesi **Node.js 24 tai uudempi** ja tarkista versio komennolla `node --version`. Windowsissa käytä [Windows-ohjetta](/fi/docs/windows/).

## Linux ja macOS {#linux-macos}

Lataa asennusohjelma päätteessä väliaikaiseen kansioon ja suorita se Node.js:llä.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Jos `n624-latex` ei löydy, avaa uusi pääte. Jos ongelma jatkuu, aja `export PATH="$HOME/.local/bin:$PATH"` ja lisää sama rivi komentotulkin asetustiedostoon, esimerkiksi tiedostoon `~/.bashrc` tai `~/.zshrc`.

## Ensimmäisen PDF:n luominen {#最初の-pdf-を作る}

1. Avaa asetukset tavallisella käyttäjätililläsi ja tallenna API-avain. Jos käytät omaa palvelinta, [määritä ensin palvelimen osoite](/fi/docs/cli/#接続先サーバー). Jos et voi avata selainta, [anna avain vakiosyötteen kautta](/fi/docs/cli/#認証).

```sh
n624-latex setup
```

2. Aja seuraava komento kansiossa, jossa `main.tex` sijaitsee. Voit käyttää [esimerkkiasiakirjaa](/fi/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

Tiedosto `main.pdf` syntyy samaan kansioon. Katso [muuntaminen ja lataaminen komentoriviltä](/fi/docs/cli/#レンダリング), jos haluat valita tallennuspaikan tai käsitellä ZIP-, PDF- ja SVG-tiedostoja.

## Windows {#windows}

[Windows-ohje](/fi/docs/windows/) käyttää PowerShelliä. Windows DPAPI salaa tallennetun avaimen nykyiselle käyttäjälle. Katso [asennuspaikan vaihtaminen ja PATH-muuttujan korjaaminen](/fi/docs/reference/#windowsの配置と保護).

## Päivitykset {#更新}

### APT-paketin päivittäminen {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Tallennettu yhteys ja API-avain säilyvät. Päivitä oma palvelin [hallinnan päivitysnäkymässä](/fi/docs/updates/).

### Homebrew-paketin päivittäminen {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Ladattavalla asennusohjelmalla asennetun asiakkaan päivittäminen {#配布インストーラー版の更新}

Aja seuraava komento tai toista alkuperäinen asennuskomento.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Version v1.6.9 tai sitä vanhemman asiakkaan päivittäminen
>
> Jos vain `latex-render` on asennettu, suorita asennus uudelleen. [Windowsissa voit päivittää syöttämättä tallennettua avainta uudelleen](/fi/docs/windows/#更新). macOS:ssä ja Linuxissa voit myös päivittää komennolla `latex-render setup` ja lisätä uuden komennon komennolla `latex-render setup repair`. Vanhat komentosarjat voivat edelleen käyttää komentoa `latex-render`.

> [!DETAILS] Asennuksen ja päivitysten toiminta
>
> - Jos ladatun ZIP-tiedoston SHA-256-tiiviste vastaa asennetun version tiivistettä, asennusohjelma tarkistaa hallinnoimansa asetukset asentamatta tiedostoja uudelleen.
> - Päivitettäessä asennusohjelma siirtää vanhan version aikaleimalla varustettuun varmuuskopioon. Muut käynnistimet, MCP-rekisteröinnit ja käyttäjän muokkaamat taidot säilyvät.

## Asennuksen tarkistaminen ja korjaaminen {#状態確認と修復}

Seuraavat komennot tarkistavat tilan kaikilla asennustavoilla.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Asenna APT-paketti uudelleen komennolla `sudo apt install --reinstall n624-latex`.
- Asenna Homebrew-paketti uudelleen komennolla `brew reinstall n624-dev/tap/n624-latex`.
- Korjaa ladattavan asennusohjelman hallinnoimat käynnistimet ja integraatiot komennolla `n624-latex setup repair`.

## Tulostiedostojen tallentaminen ja noutaminen {#成果物の保存と復旧}

`n624-latex main.tex` tallentaa PDF:n nykyiseen kansioon. Katso komentojen `render` ja `jobs download` tallentamat PDF:t, lokit ja kuvat kohdasta [komentorivityökalun tulostiedostot](/fi/docs/cli/#成果物). Jos kohde on käytössä, katso [vianmääritys](/fi/docs/troubleshooting/#成果物の取得).

## Asennuksen poistaminen {#アンインストール}

Poista APT-paketti komennolla `sudo apt remove n624-latex`. Jos haluat poistaa myös käyttäjän avaimen, aja `n624-latex auth logout` ennen paketin poistamista.

Poista Homebrew-paketti komennolla `brew uninstall n624-dev/tap/n624-latex`. Tallennettu avain ja tekoälytyökalun MCP-asetukset säilyvät. Jos et enää tarvitse niitä, kirjaudu ulos ennen paketin poistamista ja poista MCP-asetukset tekoälytyökalusta.

Jos käytit ladattavaa asennusohjelmaa, aja seuraava komento.

```sh
n624-latex setup remove --yes
```

Säilytä tunnistetiedot lisäämällä `--keep-credential` tai taidot lisäämällä `--keep-skills`. Katso Windows-komentosarjalla poistaminen [Windows-ohjeesta](/fi/docs/windows/#アンインストール).
