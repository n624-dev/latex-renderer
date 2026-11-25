---
slug: self-hosting
category: Egen server
title: Drift af LaTeX Renderer på din egen server
description: Vælg en understøttet konfiguration, klargør værten, og installér tjenesten med opdateringer og sikkerhedskopiering.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installationsmuligheder {#現在の提供状況}

Du kan oprette en server ved at installere [APT-pakken](/da/docs/client/#debian-ubuntu-の-apt-パッケージ) og starte guiden. Her konfigurerer du HTTPS, loginmetode og den første ejer.

### Rækkefølge ved nyinstallation {#初回導入の順序}

1. **Klargør serveren.** Kontroller [understøttede systemer og adgangsveje](#対応する構成), og [installér Docker Engine og Nginx](#準備するもの).
2. **Installér APT-pakken.** Følg [vejledningen til Debian og Ubuntu](/da/docs/client/#debian-ubuntu-の-apt-パッケージ) for at installere `n624-latex`.
3. **Konfigurer serveren.** Kør `sudo n624-latex server setup --plan` fra en udrulningskonto uden root-rettigheder. Opfyld eventuelle manglende forudsætninger, og fortsæt med [opsætningen i browseren](/da/docs/server-setup/#ブラウザで開く).
4. **Opret din første PDF.** Åbn den konfigurerede HTTPS-URL, [log ind, og konvertér et testdokument](#導入完了の確認). Guiden klargør det første TeX-miljø.

For en eksisterende server, se [Opdater fra administrationen](/da/docs/updates/). Ved installation fra et tar-arkiv skal du følge [den manuelle vejledning](#v1-6-9をダウンロードして検証).

## Automatisk HTTPS på lokalnettet {#lan-内の自動-https}

**Akebi** kan konfigurere en HTTPS-URL, der er afledt af serverens private IP-adresse. Du kan begynde med den delte certifikattjeneste. Se [HTTPS på lokalnettet med Akebi](/da/docs/lan-https/).

## Understøttede konfigurationer {#対応する構成}

APT understøtter nyinstallation på én vært med `systemd`, som kører Debian 12 eller 13 eller Ubuntu 24.04 eller 26.04 på amd64 eller arm64. LaTeX kompileres med Docker uden root-rettigheder under en dedikeret bruger.

| Udrulningstilstand (`DEPLOYMENT_MODE`) | Indgang | Loginmetoder |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache eller HTTPS på lokalnettet (Akebi) | Lokale adgangskoder, OIDC eller begge |
| `cloudflare` | Cloudflare Tunnel og en Worker | Cloudflare Access eller indbygget godkendelse (adgangskoder, OIDC eller begge) |

- **OIDC.** Brug din organisations identitetsudbyder (IdP).
- **Cloudflare Access.** Klargør en Access-applikation til brugerne i Cloudflare.
- **Lokale adgangskoder.** Registrer brugere i serveradministrationen uden en ekstern IdP.
- **Adgangskoder og OIDC.** Aktivér begge via indbygget godkendelse med `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` og `AUTH_OIDC_ENABLED=true`. Brug `AUTH_MODE` til ældre konfigurationer med en enkelt metode.

## Klargør serveren {#準備するもの}

- **Arbejdskonto.** Opret forbindelse med en konto uden root-rettigheder, og kør opsætningskommandoer med `sudo`.
- **Disk.** Den første kontrol kræver **mindst 5 GiB ledig plads** på hvert filsystem, der indeholder `/opt` eller `/var/lib`. Afsæt ekstra plads til TeX-images, versioner, resultater og krypterede kopier.
- **Docker Engine.** Installér Docker Engine og `docker-ce-rootless-extras` fra det officielle pakkearkiv. Guiden konfigurerer Docker uden root-rettigheder til kompileringen. Se de officielle instruktioner til [Debian](https://docs.docker.com/engine/install/debian/) eller [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installér med `sudo apt install nginx`. Ved nye APT-installationer kontrolleres det, at Nginx er installeret, selv hvis du udstiller tjenesten via Caddy, Apache eller Cloudflare.
- **Adgang og TLS.** Klargør værtsnavn, certifikat og privat nøgle til egen HTTPS, og hold adresse og port fri til indbygget HTTPS. Til Cloudflare skal du klargøre Tunnel, DNS og Worker. Se [kravene til HTTPS på lokalnettet](#lan-内の自動-https).
- **Loginoplysninger**
  - OIDC kræver udstederens URL, klient-ID og klienthemmelighed samt den første ejers stabile `subject`.
  - Cloudflare Access kræver Access-applikationens oplysninger og ejerens `subject`.
  - Ved adgangskoder skal du klargøre ejerens loginnavn og første adgangskode.
- **Udgående forbindelser.** Serveren skal via HTTPS kunne nå GitHub Releases og Attestations, GHCR (`ghcr.io`), TeX Live-arkiverne og pakkearkiverne for Debian eller Ubuntu.
- **APT-pakken.** Node.js medfølger. Se [APT-vejledningen](/da/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Kontroller installationen {#導入完了の確認}

1. Åbn `/admin/` på den konfigurerede HTTPS-URL, og log ind som den ejer, der blev registreret under installationen.
2. Åbn `/app/` på samme URL, vælg [eksempelfilen `main.tex`](/da/docs/#最短でpdfを作る), og klik på **Konvertér til PDF**.
3. Åbn PDF-filen på resultatsiden, og kontroller, at eksempelteksten vises.

> [!DETAILS] Yderligere kontrol af tjenester og output
>
> Administratorer kan teste en konvertering via den offentlige URL. Den API-nøgle, der udstedes til testen, tilbagekaldes straks derefter.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Du kan også kontrollere adgangen for en almindelig bruger, de offentlige vejledninger, sprog og image i TeX-miljøet og ofte brugte output, f.eks. japanske dokumenter eller SVG.

### Registrer brugere og udsted nøgler {#利用者と-api-キーの発行}

Når du kan logge ind som ejer i `/admin/`, skal du registrere brugerne.

- **Webapp og Remote MCP.** Opret en bruger under **Brugere**, registrer identiteten for den valgte loginmetode, og giv brugeren webappens URL.
- **CLI, Local MCP og HTTP-API.** Opret en tjenestekonto tilknyttet brugeren. Under **API-nøgler → Udsted API-nøgle** udsteder du en renderingsnøgle med `render:create` og `render:read:own` (præfiks `lrk_...`) og leverer den via en sikker kanal.

## Opdateringer og tilbagerulning {#更新とロールバック}

### Opdater applikationen {#アプリケーションを更新する}

- Som ejer skal du åbne **Administration → Opdateringer**. Se [Opdater serveren eller gå tilbage til en tidligere version](/da/docs/updates/).
- For at ændre TeX Live-versionen eller sprogene, åbn **Administration → TeX-miljø**. Se [Konfigurer TeX-miljøet](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migrering og særlige gendannelsestilfælde
>
> ### Migrer root-opdateringsværktøjet i v1.2.x til adskilte rettigheder {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Se [vejledningen til migrering af opdateringsværktøjet](/da/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar stopper udpakningen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Se [fremgangsmåden ved udpakningsfejl](/da/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Ændringslåsen er i brug {#mutation-lockが使用中と表示される場合}
>
> Se [Find den proces, der holder låsen](/da/docs/reference/#mutation-lockが使用中と表示される場合).

## Sikkerhedskopier {#バックアップ}

For periodiske kopier, punkter før opdatering, gendannelsestest og gendannelse, se [Opret, verificer og gendan sikkerhedskopier](/da/docs/backups/). Er revisionsloggens eksportposition forkert efter en gendannelse, se [Gendan revisionslogge](/da/docs/reference/#監査ログの復旧).

## Fejlfinding {#問題が起きた場合}

| Symptom | Kontroller først |
| --- | --- |
| `/app/` kan ikke nås | DNS, TLS-certifikat, Tunnel- eller proxyopsætning og startrækkefølgen for lokale tjenester |
| Kun administratorer kan ikke logge ind | Udtrykkeligt registreret ejeridentitet eller loginoplysninger, `AUTH_MODE`, udsteder, målgruppe og roller |
| TeX-imaget kan ikke hentes | HTTPS-adgang til `ghcr.io`, pakkens synlighed og taggets arkitektur |
| En TeX-ændring tager lang tid | Handlings-ID og Image Manager-logge med skjulte følsomme oplysninger |
| En opdatering bliver afvist | Uforanderlig udgivelse, arkivets kontrolsum, opdateringssti og ledig plads |
| Værtsklargøring stopper pga. en usikker sti | Kontroller, at `/var/lib/latex-renderer` ejes af `root:latex-renderer` og har tilstand `2770` |
| Kun opdateringssiden fejler | Om `client-dist/manifest.json` findes i distributionen, og status for Admin Web |
| Konverteringen starter ikke | Køstatus, mindst 5 GiB ledig plads, arbejdstjenesten og soklen til Docker uden root-rettigheder |
| Problemer lige efter opdatering | Stop modtagelsen af nye job, og sammenlign tidligere og nye versioner af applikation og miljø, før du beslutter at rulle tilbage |

Notér handlings-ID, den fase, hvor fejlen opstod, og en fejlkode, du kan dele. Se [Fejlfinding](/da/docs/troubleshooting/), [Sikkerhed for konti og dokumenter](/da/docs/security/) og [Udrulning og konfigurationsfiler (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Skift TeX-miljø {#tex環境の初期設定}

Den første opsætning klargør kompileringsmiljøet. For at tilføje sprog eller ændre TeX Live-version, åbn **Administration → TeX-miljø** (`/admin/tex-environment/`). Følgende eksempel understøtter engelsk og japansk.

| Indstilling | Anbefalet værdi |
| --- | --- |
| Image | `latest` (vælg et tag til din arkitektur ved brug af faste datotags) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (deaktiveret som standard) |

- Fra den offentlige GHCR-pakke hentes kun **basisimaget** uden sprog, fastlåst til dets kontrolsum. Serveren bygger et **kørselsimage** med de valgte sprog og rendererens aktuelle kode. Et lokalt image med samme opsætning genbruges. Kørselsimages offentliggøres ikke eksternt.
- Bygningen fortsætter, selvom du lukker browseren. Kontroller derefter det aktive miljø og sprogene i administrationen. Ved downloadfejl skal du kontrollere HTTPS-adgangen til `ghcr.io` og arkitekturunderstøttelsen.

### Automatisk diskoprydning {#自動容量整理}

> [!DETAILS] Ryd op i ubrugte images og byggecache
>
> Image Manager rydder som standard ubrugte administrerede images hver 24. time. Nuværende basis- og kørselsimages samt de tidligere til tilbagerulning og alle images, som konfigurationen henviser til, er beskyttede. De øvrige kan fjernes 24 timer efter oprettelse. Oprydningen bruger 2 GiB som mål for ubrugt byggecache uden at fastsætte en grænse for hele Docker.
>
> Angiv værdierne i `/etc/latex-renderer/renderer.env`, og anvend dem med `sudo systemctl restart latex-renderer-image-manager.service`, når TeX ikke opdateres.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` accepterer `0` for at deaktivere oprydning eller et interval fra `1` til `720` timer. Fra 5 minutter efter start kontrolleres det hvert 5. minut, om der skal ryddes op. En fælles lås udskyder oprydningen under opdatering og udrulning. Manuel oprydning fra web eller CLI fjerner ubeskyttede elementer uden at afvente opbevaringstiden.
> - `RETENTION_HOURS` accepterer fra `0` til `8760` timer, og `BUILD_CACHE_MAX_GIB` fra `0` til `1024` GiB.
> - Fra `1.3.4-rc.2` isoleres Buildx-metadata til Docker uden root-rettigheder i `.docker/buildx-worker` i arbejdsbrugerens hjemmemappe, så der ikke opstår rettighedsproblemer med bygninger udført som root. Automatisk oprydning springer images fra ældre opsætninger og mapper til manuel gendannelse over. Fjern kun enkelte elementer, når du har kontrolleret, at de er overflødige. Slet aldrig Dockers datamappe direkte.

## Rettigheder ved installation og drift {#sudoと通常運用の境界}

Ved første installation klargøres systembrugere, mapper, `systemd`-enheder, Docker uden root-rettigheder og nøglefiler med `sudo`. **Ved almindelig drift får webappen og administrations-API'et ikke `sudo`-rettigheder.**

- **TeX-ændringer.** Anmodninger sendes via en Unix-sokkel med begrænsede rettigheder til Image Manager, som ejes af root.
- **Opdateringer.** En Unix-sokkel forbinder til Update Managers controller uden root-rettigheder, der uddelegerer faste handlinger til en kortlivet hjælpeproces med root-rettigheder.
- **Gensidig udelukkelse.** En fælles lås sørger for, at TeX-ændringer og opdateringer udføres på skift. Webappen og API'et kan ikke sende vilkårlige kommandoer, stier eller URL'er til root.

## Konfiguration og hemmeligheder {#設定と秘密情報}

Værtsspecifik konfiguration og hemmeligheder gemmes uden for applikationen og Gits arbejdstræ, f.eks. i `/etc/latex-renderer/`.

| Sti | Indhold | Anbefalet tilstand |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Adgangsprofil, URL, grænser og ikke-hemmelige IdP-indstillinger | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifikatorer og tokens kun til Cloudflare-profilen | `0600` |
| `/etc/latex-renderer/update-manager.env` | Udrulningskonto uden root-rettigheder | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Bindinger og ruter for produktions-Workeren | `0600` |
| `/etc/cloudflared/config.yml` | Regler for indgående Cloudflare Tunnel-trafik | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, billetnøgle og loginoplysninger til administrationstjenester | Afhænger af filen |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Klienthemmelighed til OIDC-profilen | `0440` |

> [!WARNING]
> Læg ikke `.env`-filer, Cloudflare-tokens, Tunnel-loginoplysninger, API-nøgler, SQLite-databaser, dokumenter, PDF'er eller uredigerede driftslogge i Git, sager eller anmodninger om hjælp. Filerne `*.example` i repositoriet er skabeloner, som viser felterne.

## Manuel installation fra tar-arkiv og tidligere versioner {#手動配置-旧版向けの構築手順-tarball-導入}

Med APT og `sudo n624-latex server setup` udfører eller beskriver guiden udpakning, klargøring af vært og registrering af ejer. Åbn følgende afsnit, hvis du udruller `v1.7.1` manuelt eller skal gennemgå adgangsgrænserne eller skifte godkendelse.

> [!DETAILS] Hent, verificer og udrul v1.7.1, og registrer ejeren
>
> Brug den stabile udgivelse [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), arkivet `latex-renderer-server-1.7.1.tar.gz`, til en ny manuel installation. Tag og filer er uforanderlige efter udgivelsen. Direkte udrulning fra udviklingsgrenen `main` og lokal `docker build` til TeX er ikke understøttede driftsmetoder.
>
> ### Hent og verificer v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Klargør `curl`, `jq`, `tar`, `sha256sum` og et GitHub CLI med understøttelse af `gh attestation verify`. Node.js og Corepack installeres senere under klargøring af værten.
>
> Kør følgende som almindelig bruger i samme Bash-session. Både SHA-256 fra GitHub Releases og oprindelsessignaturen fra GitHub Actions verificeres. Oprindelsesdata sendes fra det offentlige API til `gh` uden GitHub-konto eller token. Hvis et trin fejler, forbliver `bundle_root` udefineret. Ret årsagen, og prøv igen.
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
> ### Klargør værten {#ホストを準備}
>
> Installér `setfacl` til lagerrettigheder, `bsdtar` til udpakning i det begrænsede opdateringsværktøj og `unzip` til kontrol af ZIP. Følg de officielle anvisninger til Node.js 26 eller 24 (`/usr/local/bin/node` og `/usr/local/bin/corepack`) og værktøjerne til Docker uden root-rettigheder. Til `cloudflare` skal du også installere `cloudflared`. Update Manager installerer og verificerer den angivne pnpm-version til udrulningsbrugeren med Corepack.
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
> Initialiser værten fra den almindelige udrulningskonto, og konfigurer Docker uden root-rettigheder for `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Opret den værtsspecifikke konfiguration {#ホスト固有設定を作成}
>
> Opret `renderer.env` for alle profiler, og angiv `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` og `AUTH_MODE`. Der findes ikke et alias som `ADMIN_ALLOWED_ORIGINS`. Tilladt oprindelse for browserhandlinger skal være præcis den samme som `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Erstat `example.com`, `REPLACE_*`, alle UUID'er og Access-målgruppen med værdier for din installation. For en fjernadministreret Tunnel skal du udelade lokal `config.yml` og først kontrollere, at forbindelseskomponenten kører.
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
> - **Profil `standalone`.** Installér Nginx, Caddy eller Apache, kopiér et eksempel fra `deploy/reverse-proxy/`, og angiv FQDN og certifikatstier. Proxyen fjerner indgående `CF-Access-*`-headere og overskriver klientens IP-adresse. Udstil ikke de lokale tjenester på port 3100–3105 direkte eksternt.
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
> - **Med `AUTH_MODE=oidc`.** Registrer `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` hos identitetsudbyderen. I `renderer.env` angiver du `OIDC_ISSUER` og `OIDC_CLIENT_ID` og gemmer hemmeligheden i en separat fil uden afsluttende linjeskift.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Udrul tjenesterne {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Ved første start hentes og verificeres det uforanderlige udgivelsesarkiv igen. Roots kontroltræ adskilles fra byggetræet uden root-rettigheder. Derefter bygges `client-dist` og udrulles i `/opt/latex-renderer/releases/$release_id`. Værter med en eksisterende database eller `current` afvises. Brug normal opdatering efter installationen.
> - Før udrulning kontrolleres `renderer.env` (ejet af root, tilstand `0640`, ingen dublerede nøgler), `PUBLIC_ORIGIN`, godkendelsesindstillinger og ejerskab, rettigheder og længde for pepper og hemmeligheder uden at vise deres værdier.
> - Opdateringsværktøjet ligger separat i `/opt/latex-renderer/updater` som beskrevet i `docs/independent-updater.md` i repositoriet. Kun udrulningsbrugerens primære gruppe kan passere gennem `/opt/latex-renderer/update-staging`. Hver fase er isoleret med `0700` og ryddes efter afslutning eller, efter afbrydelse, ved en senere start efter 24 timer.
>
> ### Grænser for offentlig adgang {#公開境界}
>
> - **`cloudflare-access`.** Beskyt `/auth/*`, `/app/`, `/admin/` og `/oauth/authorize` med samme Access-applikation til menneskelige brugere, og verificer også målgruppen på oprindelsesserveren. Ved Cloudflare med OIDC eller adgangskode må Access ikke blokere `/auth/*`. Vejledninger og downloads er offentlige. Worker Routes håndterer kun den offentlige del af renderings-API'et. Placer de specifikke API- og administrationsruter først i indgående Tunnel-regler, derefter webappen som standard og til sidst `http_status:404`.
> - **`standalone`.** En omvendt TLS-proxy fordeler trafikken på lokale tjenester efter sti. Kun små JSON-billethandlinger sendes til Standalone Gateway på port 3105. Nginx-eksemplet begrænser forbindelser og anmodningsfrekvens for adgangskodelogin og billet-API. Caddy og Apache uden udvidelser har ikke en tilsvarende grænse per klient, så den skal håndhæves af en belastningsfordeler eller udbyderen. Hold `/internal/*`, databasen og administrationssoklerne private.
>
> ### Første ejer {#最初のowner}
>
> Ekstern identitet bestemmes af `provider + issuer + subject` og adgangskodeidentitet af `login name`. Mailadressen er kun til visning. Konti knyttes ikke automatisk sammen ved samme mailadresse, og de oprettes ikke automatisk ved login. Kør proceduren for den valgte metode præcis én gang.
>
> **Cloudflare Access eller OIDC**
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
> **Lokal adgangskode (eksempel med brugernavn `owner`)**
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
> ### Skift AUTH_MODE senere {#後からauth-modeを変更する場合}
>
> Brug denne fremgangsmåde, når [serverguiden](/da/docs/server-setup/) ikke er tilgængelig.
> Opret en krypteret kopi, og stop administrations-API'et. Tilføj den nye loginmetode med det uforanderlige ID fra administrationen eller `users list` (format `user_...`). Overskrivning af eksisterende loginoplysninger afvises, og de aktuelle sessioner tilbagekaldes. Skift derefter `renderer.env`, og genstart API og webapp. Behold de tidligere oplysninger, indtil du har verificeret det nye login i et privat vindue.
>
> Udfør først nedenstående forberedelse og derefter kun kommandoerne til målmetoden.
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
> **Ved skift til OIDC eller Cloudflare Access** skal du angive `oidc` eller `cloudflare-access`.
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
> **Ved skift til adgangskode** skal du indtaste den i det skjulte felt.
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
