---
slug: self-hosting
category: Eigen server
title: LaTeX Renderer op een eigen server beheren
description: Kies een ondersteunde configuratie, bereid de host voor en installeer de dienst met updates en back-ups.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installatiemethoden {#現在の提供状況}

Je kunt een server opzetten door het [APT-pakket](/nl/docs/client/#debian-ubuntu-の-apt-パッケージ) te installeren en de wizard te starten. Daarmee stel je HTTPS, de aanmeldmethode en de eerste eigenaar in.

### Volgorde bij een nieuwe installatie {#初回導入の順序}

1. **Bereid de server voor.** Controleer de [ondersteunde systemen en toegangsroutes](#対応する構成) en [installeer Docker Engine en Nginx](#準備するもの).
2. **Installeer het APT-pakket.** Volg de [instructies voor Debian en Ubuntu](/nl/docs/client/#debian-ubuntu-の-apt-パッケージ) om `n624-latex` te installeren.
3. **Configureer de server.** Voer `sudo n624-latex server setup --plan` uit met een implementatieaccount zonder rootrechten. Voldoe aan de ontbrekende voorwaarden en ga verder met de [configuratie in de browser](/nl/docs/server-setup/#ブラウザで開く).
4. **Maak je eerste PDF.** Open de ingestelde HTTPS-URL, [meld je aan en converteer een testdocument](#導入完了の確認). De wizard bereidt de eerste TeX-omgeving voor.

Raadpleeg voor een bestaande server [Bijwerken via Beheer](/nl/docs/updates/). Volg voor installatie vanuit een tar-archief de [handmatige instructies](#v1-6-9をダウンロードして検証).

## Automatische HTTPS op het LAN {#lan-内の自動-https}

Met **Akebi** kun je een HTTPS-URL instellen die is afgeleid van het privé-IP van de server. Je kunt beginnen met de gedeelde certificaatdienst. Zie [HTTPS op het LAN met Akebi](/nl/docs/lan-https/).

## Ondersteunde configuraties {#対応する構成}

APT ondersteunt nieuwe installaties op één host met `systemd`, onder Debian 12 of 13 en Ubuntu 24.04 of 26.04 op amd64 of arm64. Een aparte gebruiker compileert LaTeX-documenten met rootless Docker.

| Implementatiemodus (`DEPLOYMENT_MODE`) | Toegangsroute | Aanmeldmethoden |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache of HTTPS op het LAN (Akebi) | Lokale wachtwoorden, OIDC of beide |
| `cloudflare` | Cloudflare Tunnel en een Worker | Cloudflare Access of ingebouwde authenticatie (wachtwoorden, OIDC of beide) |

- **OIDC.** Gebruik de identiteitsprovider (IdP) van je organisatie.
- **Cloudflare Access.** Bereid bij Cloudflare een Access-applicatie voor gebruikers voor.
- **Lokale wachtwoorden.** Registreer gebruikers in het serverbeheer zonder externe IdP.
- **Wachtwoorden en OIDC.** Schakel beide in via ingebouwde authenticatie met `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` en `AUTH_OIDC_ENABLED=true`. Gebruik voor oudere configuraties met één methode `AUTH_MODE`.

## De server voorbereiden {#準備するもの}

- **Werkaccount.** Meld je aan met een account zonder rootrechten en voer configuratieopdrachten uit met `sudo`.
- **Schijfruimte.** De eerste controle vereist **minstens 5 GiB vrije ruimte** op elk bestandssysteem dat `/opt` of `/var/lib` bevat. Houd extra ruimte vrij voor TeX-images, versies, resultaten en versleutelde back-ups.
- **Docker Engine.** Installeer Docker Engine en `docker-ce-rootless-extras` vanuit de officiële repository. De wizard stelt rootless Docker in voor compilatie. Zie de officiële instructies voor [Debian](https://docs.docker.com/engine/install/debian/) of [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installeer met `sudo apt install nginx`. Een nieuwe APT-installatie controleert of Nginx is geïnstalleerd, ook als je de dienst via Caddy, Apache of Cloudflare aanbiedt.
- **Toegang en TLS.** Zorg voor eigen HTTPS voor een hostnaam, certificaat en privésleutel en maak het adres en de poort voor ingebouwde HTTPS vrij. Bereid voor Cloudflare de Tunnel, DNS en Worker voor. Zie de [vereisten voor HTTPS op het LAN](#lan-内の自動-https).
- **Inloggegevens**
  - OIDC vereist de issuer-URL, client-ID en het clientgeheim, en de stabiele `subject` van de eerste eigenaar.
  - Cloudflare Access vereist de gegevens van de Access-applicatie en de `subject` van de eigenaar.
  - Zorg bij wachtwoordauthenticatie voor de inlognaam en het initiële wachtwoord van de eigenaar.
- **Uitgaand verkeer.** De server moet via HTTPS toegang hebben tot GitHub Releases en Attestations, GHCR (`ghcr.io`), de TeX Live-archieven en de pakketrepository's van Debian of Ubuntu.
- **APT-pakket.** Node.js is inbegrepen. Zie de [APT-instructies](/nl/docs/client/#debian-ubuntu-の-apt-パッケージ).

## De installatie controleren {#導入完了の確認}

1. Open `/admin/` onder de geconfigureerde HTTPS-URL en meld je aan als de bij de installatie geregistreerde eigenaar.
2. Open `/app/` onder dezelfde URL, selecteer het [voorbeeldbestand `main.tex`](/nl/docs/#最短でpdfを作る) en klik op **Omzetten naar PDF**.
3. Open de PDF op de resultatenpagina en controleer of de voorbeeldtekst verschijnt.

> [!DETAILS] Aanvullende controles van diensten en uitvoer
>
> Beheerders kunnen een testconversie via de openbare URL uitvoeren. De daarvoor uitgegeven API-sleutel wordt direct na de test ingetrokken.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Controleer desgewenst ook toegang voor een gewone gebruiker, de openbare handleidingen, de talen en het image in de TeX-omgeving en veelgebruikte uitvoer, zoals Japanse documenten of SVG.

### Gebruikers registreren en sleutels uitgeven {#利用者と-api-キーの発行}

Registreer de gebruikers zodra je als eigenaar kunt inloggen bij `/admin/`.

- **Web en Remote MCP.** Maak een gebruiker aan onder **Gebruikers**, registreer de identiteit voor de gekozen aanmeldmethode en geef de gebruiker de URL van de webapp.
- **CLI, Local MCP en HTTP-API.** Maak een serviceaccount dat aan de gebruiker is gekoppeld. Geef onder **API-sleutels → API-sleutel uitgeven** een rendersleutel uit met `render:create` en `render:read:own` (voorvoegsel `lrk_...`) en lever deze via een veilig kanaal.

## Updates en terugzetten {#更新とロールバック}

### De applicatie bijwerken {#アプリケーションを更新する}

- Open als eigenaar **Beheer → Updates**. Zie [De server bijwerken of een vorige versie terugzetten](/nl/docs/updates/).
- Open **Beheer → TeX-omgeving** om de TeX Live-versie of de talen te wijzigen. Zie [De TeX-omgeving instellen](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migratie en bijzondere herstelprocedures
>
> ### De root-updater uit v1.2.x migreren naar gescheiden rechten {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Zie de [migratie-instructies voor de updater](/nl/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar stopt bij het uitpakken met Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Zie de [procedure bij uitpakfouten](/nl/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Het wijzigingsslot is in gebruik {#mutation-lockが使用中と表示される場合}
>
> Zie [Het proces vinden dat het slot vasthoudt](/nl/docs/reference/#mutation-lockが使用中と表示される場合).

## Back-ups {#バックアップ}

Zie [Back-ups maken, verifiëren en terugzetten](/nl/docs/backups/) voor periodieke back-ups, herstelpunten vóór een update, hersteltests en gegevensherstel. Komt de positie van de auditexport na herstel niet meer overeen, zie dan [Auditlogboeken herstellen](/nl/docs/reference/#監査ログの復旧).

## Problemen oplossen {#問題が起きた場合}

| Symptoom | Wat controleer je eerst? |
| --- | --- |
| `/app/` is niet bereikbaar | DNS, TLS-certificaat, configuratie van Tunnel of proxy en startvolgorde van lokale diensten |
| Alleen beheerders kunnen niet inloggen | Expliciete eigenaarsidentiteit of inloggegevens, `AUTH_MODE`, issuer, audience en rollen |
| TeX-image kan niet worden opgehaald | HTTPS-toegang tot `ghcr.io`, zichtbaarheid van het pakket en architectuur van de tag |
| Een wijziging van TeX duurt lang | Bewerkings-ID en Image Manager-logboeken met gevoelige gegevens afgeschermd |
| Een update wordt geweigerd | Onveranderlijkheid van de release, archiefdigest, updatepad en vrije ruimte |
| Hostvoorbereiding stopt wegens een onveilig pad | Controleer of `/var/lib/latex-renderer` eigendom is van `root:latex-renderer` en modus `2770` heeft |
| Alleen het updatescherm werkt niet | Aanwezigheid van `client-dist/manifest.json` in de distributie en status van Admin Web |
| De conversie begint niet | Wachtrijstatus, minstens 5 GiB vrije ruimte, de workerdienst en de rootless Docker-socket |
| Problemen direct na een update | Stop de aanname van nieuwe taken en controleer oude en nieuwe applicatie- en omgevingsversies voordat je beslist over terugzetten |

Noteer het bewerkings-ID, de fase waarin het misging en een deelbare foutcode. Zie [Problemen oplossen](/nl/docs/troubleshooting/), [Beveiliging van accounts en documenten](/nl/docs/security/) en [Implementatie en configuratiebestanden (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## De TeX-omgeving wijzigen {#tex環境の初期設定}

De eerste installatie bereidt de compilatieomgeving voor. Open **Beheer → TeX-omgeving** (`/admin/tex-environment/`) om talen toe te voegen of de TeX Live-versie te wijzigen. Dit voorbeeld ondersteunt Engels en Japans.

| Instelling | Aanbevolen waarde |
| --- | --- |
| Image | `latest` (kies voor een vaste datumtag een tag voor jouw architectuur) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (standaard uitgeschakeld) |

- Van het openbare GHCR-pakket wordt alleen het **basisimage** zonder talen gedownload en vastgezet op digest. De server bouwt een **runtime-image** met de gekozen talen en de huidige renderercode. Een lokaal image met dezelfde configuratie wordt hergebruikt. Runtime-images worden niet extern gepubliceerd.
- Het bouwen gaat door als je de browser sluit. Controleer naderhand de actieve omgeving en talen in Beheer. Controleer bij downloadfouten HTTPS-toegang tot `ghcr.io` en de ondersteunde architecturen.

### Schijfruimte automatisch vrijmaken {#自動容量整理}

> [!DETAILS] Ongebruikte images en buildcache opruimen
>
> Image Manager ruimt standaard elke 24 uur ongebruikte beheerde images op. Beschermd zijn het huidige basis- en runtime-image, de vorige images voor terugzetten en alle images waarnaar de configuratie verwijst. Andere images komen 24 uur na aanmaak in aanmerking voor verwijdering. Voor ongebruikte buildcache geldt 2 GiB als richtwaarde bij het opruimen, zonder heel Docker te begrenzen.
>
> Pas de waarden aan in `/etc/latex-renderer/renderer.env` en activeer ze met `sudo systemctl restart latex-renderer-image-manager.service` als er geen TeX-update loopt.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` accepteert `0` om opschoning uit te schakelen of een interval van `1` tot `720` uur. Vanaf 5 minuten na het starten wordt elke 5 minuten gecontroleerd of opschoning nodig is. Een gedeeld slot stelt het opruimen uit tijdens updates en implementaties. Handmatig opruimen via web of CLI verwijdert onbeschermde onderdelen zonder op de bewaartermijn te wachten.
> - `RETENTION_HOURS` accepteert `0` tot `8760` uur en `BUILD_CACHE_MAX_GIB` accepteert `0` tot `1024` GiB.
> - Vanaf `1.3.4-rc.2` worden Buildx-metadata voor rootless Docker apart in `.docker/buildx-worker` onder de thuismap van de worker opgeslagen om rechtenconflicten met builds onder root te voorkomen. Automatisch opruimen slaat images van oude configuraties en mappen voor handmatig herstel over. Verwijder losse onderdelen pas als je zeker weet dat ze overbodig zijn. Verwijder nooit rechtstreeks de datamap van Docker.

## Rechten bij installatie en gebruik {#sudoと通常運用の境界}

De eerste installatie maakt systeemgebruikers, mappen, `systemd`-units, rootless Docker en sleutelbestanden klaar met `sudo`. **Bij normaal gebruik krijgen de webapp en beheer-API geen `sudo`-rechten.**

- **TeX-wijzigingen.** Verzoeken gaan via een Unix-socket met beperkte rechten naar Image Manager, eigendom van root.
- **Updates.** Een Unix-socket verbindt met de Update Manager-controller zonder rootrechten. Deze draagt vaste bewerkingen over aan een kortlevend hulpproces met rootrechten.
- **Wederzijdse uitsluiting.** Eén gedeeld slot laat TeX-wijzigingen en updates na elkaar verlopen. Web en API kunnen geen willekeurige opdrachten, paden of URL's aan root doorgeven.

## Configuratie en geheimen {#設定と秘密情報}

Hostgebonden instellingen en geheimen staan buiten de applicatie en de Git-werkmap, bijvoorbeeld in `/etc/latex-renderer/`.

| Pad | Inhoud | Aanbevolen modus |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Toegangsprofiel, URL, limieten en niet-geheime IdP-instellingen | `0640` |
| `/etc/latex-renderer/deployment.env` | ID's en tokens uitsluitend voor het Cloudflare-profiel | `0600` |
| `/etc/latex-renderer/update-manager.env` | Implementatieaccount zonder rootrechten | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Bindings en routes van de productie-Worker | `0600` |
| `/etc/cloudflared/config.yml` | Inkomende routes voor Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, ticketsleutel en inloggegevens voor beheerdiensten | Afhankelijk van het bestand |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Clientgeheim voor het OIDC-profiel | `0440` |

> [!WARNING]
> Zet geen `.env`-bestanden, Cloudflare-tokens, Tunnel-inloggegevens, API-sleutels, SQLite-databases, documenten, PDF's of echte onbewerkte logboeken in Git, issues of hulpvragen. De `*.example`-bestanden in de repository zijn sjablonen die de velden tonen.

## Handmatige installatie uit een tar-archief en eerdere versies {#手動配置-旧版向けの構築手順-tarball-導入}

Met APT en `sudo n624-latex server setup` verzorgt de wizard het uitpakken, het voorbereiden van de host en het registreren van de eigenaar of begeleidt hij je daarbij. Open de onderstaande onderdelen als je `v1.7.1` handmatig installeert of de toegangsgrenzen of wijziging van authenticatie wilt nagaan.

> [!DETAILS] v1.7.1 downloaden, verifiëren en installeren en de eigenaar registreren
>
> Gebruik voor een nieuwe handmatige installatie de stabiele release [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archief `latex-renderer-server-1.7.1.tar.gz`. Tag en bestanden blijven na publicatie ongewijzigd. Rechtstreeks installeren vanaf de ontwikkeltak `main` en lokale `docker build` voor TeX vallen buiten de ondersteunde werkwijze.
>
> ### v1.7.1 downloaden en verifiëren {#v1-6-9をダウンロードして検証}
>
> Zorg voor `curl`, `jq`, `tar`, `sha256sum` en een GitHub CLI met ondersteuning voor `gh attestation verify`. Node.js en Corepack installeer je later bij de hostvoorbereiding.
>
> Voer de volgende opdrachten als gewone gebruiker uit in dezelfde Bash-sessie. Zowel de SHA-256 van GitHub Releases als de herkomsthandtekening van GitHub Actions wordt gecontroleerd. Herkomstgegevens gaan vanuit de openbare API naar `gh`, zonder GitHub-account of -token. Mislukt een stap, dan blijft `bundle_root` ongedefinieerd. Los de oorzaak op en probeer het opnieuw.
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
> ### De host voorbereiden {#ホストを準備}
>
> Installeer `setfacl` voor opslagrechten, `bsdtar` voor uitpakken binnen de afgeschermde updater en `unzip` voor ZIP-controles. Volg de officiële instructies voor Node.js 26 of 24 (`/usr/local/bin/node` en `/usr/local/bin/corepack`) en de rootless Docker-tools. Installeer voor `cloudflare` ook `cloudflared`. Update Manager installeert en verifieert met Corepack de voorgeschreven pnpm-versie voor de implementatiegebruiker.
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
> Initialiseer de host vanuit het gewone implementatieaccount en configureer rootless Docker voor `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### De hostconfiguratie maken {#ホスト固有設定を作成}
>
> Maak `renderer.env` in elk profiel en stel `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` en `AUTH_MODE` in. Er bestaat geen alias zoals `ADMIN_ALLOWED_ORIGINS`. De toegestane origin voor browserbewerkingen moet exact overeenkomen met `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profiel `cloudflare`.** Vervang `example.com`, `REPLACE_*`, alle UUID's en de audience van Access door je eigen waarden. Laat bij een op afstand beheerde Tunnel het lokale `config.yml` weg en controleer vooraf dat de connector actief is.
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
> - **Profiel `standalone`.** Installeer Nginx, Caddy of Apache, kopieer een voorbeeld uit `deploy/reverse-proxy/` en geef de FQDN en certificaatpaden op. De proxy verwijdert inkomende `CF-Access-*`-headers en overschrijft het client-IP. Stel lokale diensten op poort 3100 tot en met 3105 niet rechtstreeks extern beschikbaar.
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
> - **Met `AUTH_MODE=oidc`.** Registreer `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` bij de IdP. Stel in `renderer.env` de waarden `OIDC_ISSUER` en `OIDC_CLIENT_ID` in en bewaar het geheim in een afzonderlijk bestand zonder afsluitende nieuwe regel.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### De diensten installeren {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Bij de eerste installatie wordt het onveranderlijke releasearchief opnieuw gedownload en geverifieerd. De beheerbestanden van root blijven gescheiden van de buildbestanden zonder rootrechten. Vervolgens wordt `client-dist` gebouwd en geïnstalleerd in `/opt/latex-renderer/releases/$release_id`. Een host met een bestaande database of `current` wordt geweigerd. Gebruik na installatie de normale updater.
> - Vóór implementatie worden `renderer.env` (eigendom van root, modus `0640`, geen dubbele sleutels), `PUBLIC_ORIGIN` en de authenticatie-instellingen gecontroleerd. Ook worden eigendom, rechten en lengte van de pepper en geheimen gecontroleerd zonder hun waarden te tonen.
> - De updater staat apart in `/opt/latex-renderer/updater`, zoals beschreven in `docs/independent-updater.md` in de repository. Alleen de primaire groep van de implementatiegebruiker kan `/opt/latex-renderer/update-staging` doorlopen. Elke fase is geïsoleerd met `0700` en wordt na voltooiing opgeruimd of, na onderbreking, bij een latere start nadat 24 uur zijn verstreken.
>
> ### Grenzen van de openbare toegang {#公開境界}
>
> - **`cloudflare-access`.** Bescherm `/auth/*`, `/app/`, `/admin/` en `/oauth/authorize` met dezelfde Access-applicatie voor menselijke gebruikers en controleer de audience ook op de oorsprongserver. Zorg bij Cloudflare met OIDC of wachtwoord dat Access `/auth/*` niet blokkeert. Documentatie en downloads zijn openbaar. Worker Routes bedienen alleen het openbare deel van de render-API. Plaats in de Tunnel-regels eerst specifieke API- en beheerroutes, dan de standaardwebsite en ten slotte `http_status:404`.
> - **`standalone`.** Een TLS-reverse-proxy verdeelt verkeer per pad over de lokale diensten. Alleen kleine JSON-ticketbewerkingen gaan naar Standalone Gateway op poort 3105. Het Nginx-voorbeeld begrenst verbindingen en het aantal verzoeken voor wachtwoordaanmelding en de ticket-API. Caddy en Apache zonder uitbreidingen hebben geen vergelijkbare limiet per client. Stel die daarom verplicht in op een loadbalancer of bij de provider. Houd `/internal/*`, de database en de beheersockets privé.
>
> ### Eerste eigenaar {#最初のowner}
>
> De externe identiteit wordt bepaald door `provider + issuer + subject` en een wachtwoordidentiteit door `login name`. E-mail dient alleen voor weergave. Accounts worden niet op e-mail gekoppeld of bij inloggen automatisch aangemaakt. Voer de procedure voor de gekozen methode één keer uit.
>
> **Cloudflare Access of OIDC**
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
> **Lokaal wachtwoord (voorbeeld met gebruikersnaam `owner`)**
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
> ### AUTH_MODE later wijzigen {#後からauth-modeを変更する場合}
>
> Gebruik deze procedure wanneer de [serverwizard](/nl/docs/server-setup/) niet beschikbaar is.
> Maak een versleutelde back-up en stop de beheer-API. Voeg de nieuwe aanmeldmethode toe met het onveranderlijke ID uit Beheer of uit `users list` (formaat `user_...`). Overschrijven van bestaande inloggegevens wordt geweigerd en actieve sessies worden ingetrokken. Wijzig vervolgens `renderer.env` en herstart de API en de webapp. Behoud de eerdere inloggegevens totdat je de nieuwe aanmelding in een privévenster hebt getest.
>
> Voer eerst de onderstaande voorbereiding uit en voer daarna alleen de opdrachten voor de doelmethode uit.
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
> **Voer voor de overstap naar OIDC of Cloudflare Access** de waarde `oidc` of `cloudflare-access` in.
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
> **Voer voor de overstap naar een wachtwoord** het wachtwoord in het afgeschermde veld in.
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
