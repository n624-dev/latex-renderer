---
slug: self-hosting
category: Oma palvelin
title: LaTeX Rendererin ylläpito omalla palvelimella
description: Valitse tuettu kokoonpano, valmistele palvelin ja ota käyttöön palvelu päivityksineen ja varmuuskopioineen.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Asennusvaihtoehdot {#現在の提供状況}

Asenna [APT-paketti](/fi/docs/client/#debian-ubuntu-の-apt-パッケージ) ja käynnistä ohjattu määritys. Se määrittää HTTPS:n, kirjautumistavan ja ensimmäisen omistajan.

### Ensiasennuksen vaiheet {#初回導入の順序}

1. **Valmistele palvelin.** Tarkista [tuetut järjestelmät ja yhteystavat](#対応する構成) ja [asenna Docker Engine ja Nginx](#準備するもの).
2. **Asenna APT-paketti.** Asenna `n624-latex` [Debianin ja Ubuntun ohjeella](/fi/docs/client/#debian-ubuntu-の-apt-パッケージ).
3. **Määritä palvelin.** Aja tavallisella, käyttöönottoon tarkoitetulla käyttäjätilillä `sudo n624-latex server setup --plan`. Täytä puuttuvat vaatimukset ja jatka [selaimessa tehtävään määritykseen](/fi/docs/server-setup/#ブラウザで開く).
4. **Luo ensimmäinen PDF.** Avaa määritetty HTTPS-osoite, [kirjaudu ja muunna testiasiakirja](#導入完了の確認). Ohjattu määritys valmistelee ensimmäisen TeX-ympäristön.

Jos palvelin on jo käytössä, katso [päivitys hallinnasta](/fi/docs/updates/). Jos asennat tar-arkistosta, seuraa [käsinasennusohjetta](#v1-6-9をダウンロードして検証).

## Automaattinen HTTPS lähiverkossa {#lan-内の自動-https}

**Akebi** muodostaa HTTPS-osoitteen palvelimen yksityisestä IP-osoitteesta. Voit aloittaa jaetulla varmennepalvelulla. Katso [HTTPS lähiverkossa Akebilla](/fi/docs/lan-https/).

## Tuetut kokoonpanot {#対応する構成}

APT tukee uutta asennusta yhteen `systemd`-palvelimeen, jossa on Debian 12 tai 13 tai Ubuntu 24.04 tai 26.04 ja amd64- tai arm64-arkkitehtuuri. LaTeX-käännös käyttää Dockeria erillisellä käyttäjätilillä ilman root-oikeuksia.

| Käyttöönottotila (`DEPLOYMENT_MODE`) | Sisääntuloreitti | Kirjautumistavat |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache tai lähiverkon HTTPS (Akebi) | Paikallinen salasana, OIDC tai molemmat |
| `cloudflare` | Cloudflare Tunnel ja Worker | Cloudflare Access tai palvelun oma tunnistautuminen (salasana, OIDC tai molemmat) |

- **OIDC.** Käytä organisaatiosi tunnistuspalvelua (IdP).
- **Cloudflare Access.** Valmistele käyttäjille Cloudflareen Access-sovellus.
- **Paikalliset salasanat.** Rekisteröi käyttäjät palvelimen hallinnassa ilman ulkoista tunnistuspalvelua.
- **Salasanat ja OIDC.** Ota molemmat käyttöön palvelun omassa tunnistautumisessa asetuksilla `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` ja `AUTH_OIDC_ENABLED=true`. Käytä vanhoihin yhden menetelmän kokoonpanoihin asetusta `AUTH_MODE`.

## Palvelimen valmistelu {#準備するもの}

- **Käyttäjätili.** Kirjaudu tavalliselle käyttäjätilille ja aja määrityskomennot komennolla `sudo`.
- **Levytila.** Alkutarkistus vaatii **vähintään 5 GiB vapaata tilaa** jokaisessa tiedostojärjestelmässä, jossa `/opt` tai `/var/lib` sijaitsee. Varaa lisätilaa TeX-levykuville, julkaisuille, tuloksille ja salatuille varmuuskopioille.
- **Docker Engine.** Asenna Docker Engine ja `docker-ce-rootless-extras` virallisesta pakettivarastosta. Ohjattu määritys valmistelee käännöksiin Dockerin ilman root-oikeuksia. Katso [Debianin](https://docs.docker.com/engine/install/debian/) tai [Ubuntun](https://docs.docker.com/engine/install/ubuntu/) virallinen ohje.
- **Nginx.** Asenna se komennolla `sudo apt install nginx`. Uusi APT-asennus tarkistaa Nginxin olemassaolon, vaikka julkaisisit palvelun Caddyn, Apachen tai Cloudflaren kautta.
- **Yhteys ja TLS.** Valmistele omaa HTTPS:ää varten isäntänimi, varmenne ja yksityinen avain. Jätä sisäänrakennetun HTTPS-palvelun osoite ja portti vapaaksi. Valmistele Cloudflarelle Tunnel, DNS ja Worker. Katso [lähiverkon HTTPS-vaatimukset](#lan-内の自動-https).
- **Tunnistetiedot**
  - OIDC tarvitsee myöntäjän osoitteen, asiakastunnuksen ja -salaisuuden sekä ensimmäisen omistajan pysyvän `subject`-arvon.
  - Cloudflare Access tarvitsee Access-sovelluksen tiedot ja omistajan `subject`-arvon.
  - Valmistele salasanoja varten omistajan kirjautumisnimi ja alkusalasana.
- **Lähtevät yhteydet.** Palvelimen on päästävä HTTPS:llä GitHub Releases- ja Attestations-palveluihin, GHCR:ään (`ghcr.io`), TeX Liven arkistoihin ja Debianin tai Ubuntun pakettivarastoihin.
- **APT-paketti.** Node.js sisältyy pakettiin. Katso [APT-ohje](/fi/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Asennuksen tarkistaminen {#導入完了の確認}

1. Avaa `/admin/` määritetyssä HTTPS-osoitteessa ja kirjaudu asennuksessa rekisteröitynä omistajana.
2. Avaa samassa osoitteessa `/app/`, valitse [esimerkkitiedosto `main.tex`](/fi/docs/#最短でpdfを作る) ja napsauta **Muunna PDF-muotoon**.
3. Avaa PDF tulossivulta ja varmista, että siinä näkyy esimerkin teksti.

> [!DETAILS] Palvelujen ja tulosten lisätarkistukset
>
> Ylläpitäjät voivat testata muunnosta julkisen osoitteen kautta. Testin luoma API-avain mitätöidään heti testin jälkeen.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Voit tarkistaa myös tavallisen käyttäjän kirjautumisen, julkiset ohjeet, TeX-ympäristön kielet ja levykuvan sekä tyypilliset tulokset, kuten japaninkieliset asiakirjat ja SVG:t.

### Käyttäjien rekisteröiminen ja avainten myöntäminen {#利用者と-api-キーの発行}

Kun pystyt kirjautumaan omistajana kohteeseen `/admin/`, rekisteröi käyttäjät.

- **Verkko ja etä-MCP.** Luo käyttäjä kohdassa **Käyttäjät**, rekisteröi valitun kirjautumistavan tunniste ja anna käyttäjälle verkkosovelluksen osoite.
- **Komentorivi, paikallinen MCP ja HTTP API.** Luo käyttäjään sidottu palvelutili. Myönnä kohdassa **API-avaimet → Myönnä API-avain** käännösavain, jolla on oikeudet `render:create` ja `render:read:own` (etuliite `lrk_...`). Toimita se suojatun kanavan kautta.

## Päivitykset ja palauttaminen {#更新とロールバック}

### Sovelluksen päivittäminen {#アプリケーションを更新する}

- Avaa omistajana **Hallinta → Päivitykset**. Katso [palvelimen päivittäminen ja edellisen version palauttaminen](/fi/docs/updates/).
- Muuta TeX Liven versiota tai kieliä kohdassa **Hallinta → TeX-ympäristö**. Katso [TeX-ympäristön määrittäminen](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Siirtäminen ja erityistilanteiden palautus
>
> ### Version v1.2.x root-päivitysohjelman siirtäminen eriytettyihin oikeuksiin {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Katso [päivitysohjelman siirto-ohje](/fi/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar keskeyttää purkamisen virheeseen Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Katso [purkuvirheen korjaaminen](/fi/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Muutoslukko on käytössä {#mutation-lockが使用中と表示される場合}
>
> Katso, miten voit [tunnistaa lukkoa pitävän prosessin](/fi/docs/reference/#mutation-lockが使用中と表示される場合).

## Varmuuskopiot {#バックアップ}

Katso ajastetut kopiot, päivityksiä edeltävät pisteet, palautuksen testaus ja tietojen palautus kohdasta [varmuuskopioiden luominen, tarkistaminen ja palauttaminen](/fi/docs/backups/). Jos tarkastuslokin viennin sijainti ei täsmää palautuksen jälkeen, katso [tarkastuslokin palautus](/fi/docs/reference/#監査ログの復旧).

## Vianmääritys {#問題が起きた場合}

| Oire | Tarkista ensin |
| --- | --- |
| Kohteeseen `/app/` ei saada yhteyttä | DNS, TLS-varmenne, Tunnelin tai välityspalvelimen asetukset ja paikallisten palvelujen käynnistysjärjestys |
| Vain ylläpitäjän kirjautuminen epäonnistuu | Omistajan nimenomainen tunniste tai kirjautumistieto, `AUTH_MODE`, myöntäjä, kohdeyleisö ja roolit |
| TeX-levykuvaa ei voida noutaa | HTTPS-yhteys kohteeseen `ghcr.io`, paketin näkyvyys ja tunnisteen arkkitehtuuri |
| TeX-muutos kestää kauan | Toiminnon tunnus ja Image Managerin arkaluonteisilta tiedoilta siistityt lokit |
| Päivitys hylätään | Julkaisun muuttumattomuus, arkiston tiiviste, päivityspolku ja vapaa levytila |
| Isäntäkoneen valmistelu pysähtyy turvattoman polun vuoksi | Varmista, että polun `/var/lib/latex-renderer` omistaa `root:latex-renderer` ja sen tila on `2770` |
| Vain päivitysnäkymä epäonnistuu | Sisältyykö `client-dist/manifest.json` jakeluun ja mikä on Admin Webin tila |
| Muunnos ei käynnisty | Jonon tila, vähintään 5 GiB vapaata tilaa, työpalvelu ja ilman root-oikeuksia toimivan Dockerin soketti |
| Ongelma alkaa heti päivityksen jälkeen | Keskeytä uusien töiden vastaanotto ja tarkista sovelluksen ja suoritusympäristön vanhat ja uudet versiot ennen palautuspäätöstä |

Kirjaa muistiin toiminnon tunnus, epäonnistunut vaihe ja jaettavaksi sopiva virhekoodi. Katso [vianmääritys](/fi/docs/troubleshooting/), [tilien ja asiakirjojen suojaaminen](/fi/docs/security/) ja [käyttöönoton asetukset ja asetustiedostot (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## TeX-ympäristön vaihtaminen {#tex環境の初期設定}

Alkumääritys valmistelee käännösympäristön. Lisää kieliä tai vaihda TeX Liven versiota kohdassa **Hallinta → TeX-ympäristö** (`/admin/tex-environment/`). Seuraava esimerkki tukee englantia ja japania.

| Asetus | Suositusarvo |
| --- | --- |
| Image | `latest` (jos käytät päivättyä tunnistetta, valitse arkkitehtuurillesi sopiva) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (oletuksena pois käytöstä) |

- Julkisesta GHCR-paketista ladataan vain kieletön **peruslevykuva**, jonka versio kiinnitetään tiivisteellä. Palvelin luo **ajonaikaisen levykuvan**, joka sisältää valitut kielet ja käännöspalvelun nykyisen koodin. Jos paikallisesti on jo samoilla asetuksilla tehty levykuva, se käytetään uudelleen. Ajonaikaisia levykuvia ei julkaista ulkopuolelle.
- Rakennus jatkuu, vaikka suljet selaimen. Tarkista jälkeenpäin hallinnasta aktiivinen ympäristö ja kielet. Jos lataus epäonnistuu, tarkista HTTPS-yhteys kohteeseen `ghcr.io` ja arkkitehtuurin yhteensopivuus.

### Automaattinen levytilan siivous {#自動容量整理}

> [!DETAILS] Käyttämättömien levykuvien ja koontivälimuistin siivous
>
> Image Manager siivoaa hallinnoimansa käyttämättömät levykuvat oletuksena 24 tunnin välein. Nykyiset ja edelliseen versioon palaamiseen tarvittavat perus- ja ajonaikaiset levykuvat sekä asetuksissa viitatut levykuvat ovat suojattuja. Muut voidaan poistaa 24 tuntia luomisen jälkeen. Käyttämättömän koontivälimuistin tavoitekoko siivouksessa on 2 GiB. Se ei rajoita Dockerin koko tallennustilaa.
>
> Muuta arvoja tiedostossa `/etc/latex-renderer/renderer.env` ja ota ne käyttöön komennolla `sudo systemctl restart latex-renderer-image-manager.service` silloin, kun TeX-päivitystä ei ole käynnissä.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - Arvolla `INTERVAL_HOURS` voit asettaa siivouksen pois käytöstä arvolla `0` tai antaa aikavälin `1`–`720` tuntia. Viisi minuuttia käynnistyksen jälkeen järjestelmä alkaa tarkistaa siivoustarpeen viiden minuutin välein. Yhteinen lukko lykkää siivousta päivitysten ja käyttöönottojen aikana. Verkosta tai komentoriviltä käsin aloitettu siivous poistaa suojaamattomat kohteet odottamatta säilytysajan päättymistä.
> - Asetus `RETENTION_HOURS` hyväksyy arvot `0`–`8760` tuntia ja `BUILD_CACHE_MAX_GIB` arvot `0`–`1024` GiB.
> - Versiosta `1.3.4-rc.2` alkaen ilman root-oikeuksia käytettävän Dockerin Buildx-metatiedot eristetään työntekijäkäyttäjän kotihakemistossa polkuun `.docker/buildx-worker`, jotta oikeudet eivät sekoitu rootin koonteihin. Automaattinen siivous ohittaa vanhojen kokoonpanojen levykuvat ja käsin tehtävän palautuksen hakemistot. Poista yksittäinen kohde vasta varmistettuasi, että se on tarpeeton. Älä koskaan poista Dockerin tietohakemistoa suoraan.

## Asennuksen ja käytön oikeudet {#sudoと通常運用の境界}

Ensiasennus luo järjestelmäkäyttäjät, hakemistot, `systemd`-yksiköt, Dockerin ilman root-oikeuksia sekä avaintiedostot komennolla `sudo`. **Normaalissa käytössä verkkosovelluksella ja hallinta-API:lla ei ole `sudo`-oikeuksia.**

- **TeX-muutokset.** Pyynnöt välitetään rootin omistamalle Image Managerille käyttöoikeuksiltaan rajatun Unix-soketin kautta.
- **Päivitykset.** Unix-soketti välittää pyynnöt ilman root-oikeuksia toimivalle Update Managerin ohjaimelle. Se delegoi ennalta määritetyt toimet lyhytikäiselle root-apuprosessille.
- **Samanaikaisten muutosten esto.** Yhteinen lukko suorittaa TeX-muutokset ja päivitykset peräkkäin. Verkosta ja API:sta ei voi välittää rootille mielivaltaisia komentoja, polkuja tai URL-osoitteita.

## Asetukset ja salaisuudet {#設定と秘密情報}

Isäntäkonekohtaiset asetukset ja salaisuudet säilytetään sovelluksen ja Git-työpuun ulkopuolella, esimerkiksi hakemistossa `/etc/latex-renderer/`.

| Polku | Sisältö | Suositeltu tila |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Yhteysprofiili, osoitteet, rajat ja IdP:n asetukset ilman salaisuuksia | `0640` |
| `/etc/latex-renderer/deployment.env` | Cloudflare-profiilin omat tunnisteet ja käyttövaltuudet | `0600` |
| `/etc/latex-renderer/update-manager.env` | Käyttöönoton käyttäjätili ilman root-oikeuksia | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Tuotannon Workerin sidonnat ja reitit | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnelin sisääntuloreitit | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, lippujen avain ja hallintapalvelujen tunnistetiedot | Tiedostokohtainen |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC-profiilin asiakassalaisuus | `0440` |

> [!WARNING]
> Älä lisää Gitiin tai vikailmoituksiin ja tukipyyntöihin `.env`-tiedostoja, Cloudflare-tunnisteita, Tunnelin tunnistetietoja, API-avaimia, SQLite-tietokantoja, todellisia asiakirjoja tai PDF:iä tai siistimättömiä lokeja. Tietovaraston `*.example`-tiedostot ovat kenttien tarkistamiseen tarkoitettuja mallipohjia.

## Tar-arkiston käsinasennus ja aiemmat versiot {#手動配置-旧版向けの構築手順-tarball-導入}

Kun käytät APT:tä ja komentoa `sudo n624-latex server setup`, ohjattu määritys hoitaa tai opastaa purkamisen, isäntäkoneen valmistelun ja omistajan rekisteröinnin. Avaa seuraavat ohjeet, jos otat `v1.7.1`-jakelun käyttöön käsin tai tarkistat käyttöoikeusrajat tai tunnistautumisen vaihdon.

> [!DETAILS] Version v1.7.1 lataaminen, tarkistaminen ja käyttöönotto sekä omistajan rekisteröinti
>
> Käytä uudessa käsinasennuksessa vakaan julkaisun [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) arkistoa `latex-renderer-server-1.7.1.tar.gz`. Julkaisun tunniste ja tiedostot ovat julkaisun jälkeen muuttumattomia. Suoraa käyttöönottoa kehityshaarasta `main` ja paikallista TeX-toimintoa `docker build` ei tueta normaalissa käytössä.
>
> ### Version v1.7.1 lataaminen ja tarkistaminen {#v1-6-9をダウンロードして検証}
>
> Tarvitset työkalut `curl`, `jq`, `tar` ja `sha256sum` sekä GitHub CLI:n, joka tukee komentoa `gh attestation verify`. Node.js ja Corepack asennetaan myöhemmin isäntäkoneen valmistelussa.
>
> Suorita seuraavat komennot tavallisella käyttäjätilillä samassa Bash-istunnossa. Ne tarkistavat sekä GitHub Releasesin SHA-256-tiivisteen että GitHub Actionsin alkuperätodistuksen allekirjoituksen. Alkuperätiedot välitetään julkisesta API:sta komennolle `gh` ilman GitHub-tiliä tai -tunnistetta. Jos jokin vaihe epäonnistuu, `bundle_root` jää määrittämättä. Korjaa syy ja yritä uudelleen.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### Isäntäkoneen valmistelu {#ホストを準備}
>
> Asenna `setfacl` tallennustilan oikeuksia varten, `bsdtar` purkamiseen rajoitetussa päivitysohjelmassa ja `unzip` ZIP-tarkistuksiin. Asenna virallisten ohjeiden mukaan Node.js 26 tai 24 (`/usr/local/bin/node` ja `/usr/local/bin/corepack`) sekä Dockerin työkalut ilman root-oikeuksia. Asenna kohteelle `cloudflare` myös `cloudflared`. Update Manager asentaa ja tarkistaa määrätyn pnpm-version käyttöönottotilille Corepackin avulla.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> Alusta isäntäkone tavalliselta käyttöönottotililtä ja määritä Docker ilman root-oikeuksia käyttäjälle `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Isäntäkonekohtaisten asetusten luominen {#ホスト固有設定を作成}
>
> Luo kaikissa profiileissa `renderer.env` ja määritä `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` ja `AUTH_MODE`. Esimerkiksi `ADMIN_ALLOWED_ORIGINS` ei ole tuettu alias. Selainoperaatioiden sallitun alkuperän on vastattava tarkasti arvoa `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profiili `cloudflare`.** Korvaa `example.com`, `REPLACE_*`, kaikki UUID:t ja Accessin kohdeyleisö oman asennuksesi arvoilla. Jos Tunnelia hallitaan etänä, jätä paikallinen `config.yml` pois ja varmista ensin, että liitin toimii.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **Profiili `standalone`.** Asenna Nginx, Caddy tai Apache, kopioi esimerkki hakemistosta `deploy/reverse-proxy/` ja anna täydellinen verkkotunnus sekä varmennepolut. Välityspalvelin poistaa saapuvat `CF-Access-*`-otsakkeet ja korvaa asiakkaan IP-osoitteen. Älä sido porttien 3100–3105 paikallisia palveluita suoraan ulkoverkkoon.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **Kun käytät asetusta `AUTH_MODE=oidc`.** Rekisteröi `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` tunnistuspalvelussa. Määritä tiedostossa `renderer.env` arvot `OIDC_ISSUER` ja `OIDC_CLIENT_ID` ja tallenna salaisuus erilliseen tiedostoon ilman rivinvaihtoa lopussa.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Palvelujen käyttöönotto {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Alkuasennus lataa julkaistun muuttumattoman arkiston uudelleen ja tarkistaa sen, erottaa rootin hallintapuun ilman root-oikeuksia käytettävästä koontipuusta, rakentaa kohteen `client-dist` ja ottaa sen käyttöön polussa `/opt/latex-renderer/releases/$release_id`. Asennus hylätään, jos koneessa on jo tietokanta tai `current`. Käytä tämän jälkeen tavallista päivitystoimintoa.
> - Ennen käyttöönottoa tarkistetaan `renderer.env` (rootin omistama, tila `0640`, ei avaimia kahdesti), `PUBLIC_ORIGIN`, tunnistautumisasetukset sekä pepperin ja salaisuuksien omistajuus, oikeudet ja pituus. Arvoja ei näytetä.
> - Päivitysohjelma säilytetään erikseen polussa `/opt/latex-renderer/updater` tietovaraston ohjeen `docs/independent-updater.md` mukaisesti. Vain käyttöönottokäyttäjän ensisijaisella ryhmällä on hakemiston `/opt/latex-renderer/update-staging` läpikulkuoikeus. Jokainen vaihe eristetään tilalla `0700` ja siivotaan sen päättyessä tai keskeytyksen jälkeen myöhemmällä käynnistyskerralla, kun 24 tuntia on kulunut.
>
> ### Julkisen käytön rajat {#公開境界}
>
> - **`cloudflare-access`.** Suojaa polut `/auth/*`, `/app/`, `/admin/` ja `/oauth/authorize` samalla henkilöille tarkoitetulla Access-sovelluksella ja tarkista kohdeyleisö myös alkuperäpalvelimella. Kun käytät Cloudflarea ja OIDC:tä tai salasanaa, varmista, ettei Access estä polkua `/auth/*`. Ohjeet ja lataukset ovat julkisia. Worker Routes käsittelee vain käännösrajapinnan julkisen osan. Järjestä Tunnelin sisääntuloreitit niin, että ensin ovat yksilöidyt API- ja hallintareitit, sitten oletusverkkosivu ja viimeisenä `http_status:404`.
> - **`standalone`.** TLS-käänteisvälityspalvelin ohjaa pyynnöt polun mukaan paikallisille palveluille. Vain pienet JSON-lippuoperaatiot välitetään portin 3105 Standalone Gatewaylle. Nginx-esimerkki rajoittaa yhteyksiä sekä salasanakirjautumisen ja lippurajapinnan pyyntötiheyttä. Caddy ja Apache eivät ilman lisäosia tarjoa vastaavaa asiakaskohtaista rajoitusta, joten toteuta se kuormantasaajassa tai palveluntarjoajalla. Pidä `/internal/*`, tietokanta ja hallintasoketit yksityisinä.
>
> ### Ensimmäinen omistaja {#最初のowner}
>
> Ulkoisen käyttäjän henkilöllisyys määräytyy arvosta `provider + issuer + subject` ja salasanakäyttäjän arvosta `login name`. Sähköpostiosoite on vain näyttötieto. Tilejä ei yhdistetä saman sähköpostin perusteella eikä luoda automaattisesti kirjautumisessa. Suorita valitun menetelmän menettely vain kerran.
>
> **Cloudflare Access tai OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **Paikallinen salasana (esimerkissä kirjautumisnimi `owner`)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### AUTH_MODE-asetuksen vaihtaminen myöhemmin {#後からauth-modeを変更する場合}
>
> Käytä tätä menettelyä, jos [palvelimen ohjattu määritys](/fi/docs/server-setup/) ei ole käytettävissä.
> Luo salattu varmuuskopio ja pysäytä hallinta-API. Lisää uusi kirjautumistapa käyttäen hallinnasta tai komennolla `users list` saatua muuttumatonta tunnistetta (muoto `user_...`). Nykyisen kirjautumistiedon korvaaminen estetään ja nykyiset istunnot mitätöidään. Muuta sitten asetusta `renderer.env` ja käynnistä API ja verkkopalvelu uudelleen. Säilytä vanhat tunnistetiedot, kunnes olet tarkistanut uuden kirjautumisen yksityisessä ikkunassa.
>
> Aja ensin seuraavat valmistelukomennot ja sitten vain uuden menetelmän komennot.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **Jos vaihdat OIDC:hen tai Cloudflare Accessiin**, anna `oidc` tai `cloudflare-access`.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **Jos vaihdat salasanaan**, anna salasana peitetyssä syöttökentässä.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
