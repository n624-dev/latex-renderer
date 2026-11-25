---
slug: self-hosting
category: Egen server
title: Drift av LaTeX Renderer på egen server
description: Velg et støttet oppsett, klargjør verten og installer tjenesten med oppdateringer og sikkerhetskopier.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installasjonsalternativer {#現在の提供状況}

Du kan sette opp en server ved å installere [APT-pakken](/no/docs/client/#debian-ubuntu-の-apt-パッケージ) og kjøre veiviseren. Der setter du opp HTTPS, innloggingsmetode og første eier.

### Rekkefølge for nyinstallasjon {#初回導入の順序}

1. **Klargjør serveren.** Kontroller [støttede systemer og tilgangsveier](#対応する構成) og [installer Docker Engine og Nginx](#準備するもの).
2. **Installer APT-pakken.** Følg [veiledningen for Debian og Ubuntu](/no/docs/client/#debian-ubuntu-の-apt-パッケージ) for å installere `n624-latex`.
3. **Konfigurer serveren.** Kjør `sudo n624-latex server setup --plan` fra en utrullingskonto uten root-rettigheter. Rett opp uoppfylte krav og fortsett med [oppsett i nettleseren](/no/docs/server-setup/#ブラウザで開く).
4. **Lag din første PDF.** Åpne den konfigurerte HTTPS-adressen, [logg inn og konverter et testdokument](#導入完了の確認). Veiviseren klargjør det første TeX-miljøet.

For en eksisterende server, se [Oppdater fra administrasjonen](/no/docs/updates/). For installasjon fra et tar-arkiv, følg [manuell installasjon](#v1-6-9をダウンロードして検証).

## Automatisk HTTPS i lokalnettet {#lan-内の自動-https}

**Akebi** kan sette opp en HTTPS-adresse avledet fra serverens private IP-adresse. Du kan begynne med den delte sertifikattjenesten. Se [HTTPS i lokalnettet med Akebi](/no/docs/lan-https/).

## Støttede konfigurasjoner {#対応する構成}

APT støtter nyinstallasjon på én vert med `systemd` som kjører Debian 12 eller 13 eller Ubuntu 24.04 eller 26.04 på amd64 eller arm64. LaTeX-kompileringen bruker Docker uten root-rettigheter under en egen bruker.

| Utrullingsmodus (`DEPLOYMENT_MODE`) | Tilgangsvei | Innloggingsmetoder |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache eller HTTPS i lokalnettet (Akebi) | Lokale passord, OIDC eller begge |
| `cloudflare` | Cloudflare Tunnel og en Worker | Cloudflare Access eller innebygd autentisering (passord, OIDC eller begge) |

- **OIDC.** Bruk organisasjonens identitetsleverandør (IdP).
- **Cloudflare Access.** Klargjør en Access-applikasjon for brukerne i Cloudflare.
- **Lokale passord.** Registrer brukerne i serveradministrasjonen uten ekstern IdP.
- **Passord og OIDC.** Aktiver begge via innebygd autentisering med `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` og `AUTH_OIDC_ENABLED=true`. For eldre oppsett med én metode bruker du `AUTH_MODE`.

## Klargjør serveren {#準備するもの}

- **Arbeidskonto.** Koble til med en konto uten root-rettigheter og kjør oppsettskommandoene med `sudo`.
- **Disk.** Den innledende kontrollen krever **minst 5 GiB ledig plass** på hvert filsystem som inneholder `/opt` eller `/var/lib`. Sett av mer plass til TeX-avbildninger, versjoner, resultater og krypterte kopier.
- **Docker Engine.** Installer Docker Engine og `docker-ce-rootless-extras` fra det offisielle pakkearkivet. Veiviseren setter opp Docker uten root-rettigheter for kompilering. Se de offisielle veiledningene for [Debian](https://docs.docker.com/engine/install/debian/) eller [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installer med `sudo apt install nginx`. Ved nyinstallasjon med APT kontrolleres det at Nginx er installert selv hvis du eksponerer tjenesten via Caddy, Apache eller Cloudflare.
- **Tilgang og TLS.** For egen HTTPS trenger du vertsnavn, sertifikat og privat nøkkel, og ledig adresse og port for innebygd HTTPS. For Cloudflare klargjør du Tunnel, DNS og Worker. Se [kravene til HTTPS i lokalnettet](#lan-内の自動-https).
- **Påloggingsopplysninger**
  - OIDC krever utstederens URL, klient-ID og klienthemmelighet samt den første eierens stabile `subject`.
  - Cloudflare Access krever informasjon om Access-applikasjonen og eierens `subject`.
  - For passord, klargjør innloggingsnavn og førstegangspassord for eieren.
- **Utgående tilkoblinger.** Serveren må kunne nå GitHub Releases og Attestations, GHCR (`ghcr.io`), TeX Live-arkivene og pakkearkivene til Debian eller Ubuntu over HTTPS.
- **APT-pakken.** Node.js er inkludert. Se [APT-veiledningen](/no/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Kontroller installasjonen {#導入完了の確認}

1. Åpne `/admin/` under den konfigurerte HTTPS-adressen og logg inn som eieren som ble registrert under installasjonen.
2. Åpne `/app/` under samme adresse, velg [eksempelfilen `main.tex`](/no/docs/#最短でpdfを作る) og klikk på **Konverter til PDF**.
3. Åpne PDF-filen på resultatsiden og kontroller at eksempelteksten vises.

> [!DETAILS] Ytterligere kontroller av tjenester og utdata
>
> Administratorer kan teste konverteringen via den offentlige adressen. API-nøkkelen som utstedes til testen, trekkes tilbake umiddelbart etterpå.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Du kan også kontrollere innlogging som vanlig bruker, de offentlige veiledningene, språk og avbildning i TeX-miljøet og vanlige utdata, for eksempel japanske dokumenter eller SVG.

### Registrer brukere og utsted nøkler {#利用者と-api-キーの発行}

Når du kan logge inn som eier i `/admin/`, registrerer du brukerne.

- **Nettapp og Remote MCP.** Opprett brukeren under **Brukere**, registrer identiteten for valgt innloggingsmetode og gi brukeren adressen til nettappen.
- **CLI, Local MCP og HTTP-API.** Opprett en tjenestekonto knyttet til brukeren. Under **API-nøkler → Utsted API-nøkkel** utsteder du en renderingsnøkkel med `render:create` og `render:read:own` (prefiks `lrk_...`) og gir den til brukeren gjennom en sikker kanal.

## Oppdatering og tilbakerulling {#更新とロールバック}

### Oppdater applikasjonen {#アプリケーションを更新する}

- Som eier åpner du **Administrasjon → Oppdateringer**. Se [Oppdater serveren eller rull tilbake til forrige versjon](/no/docs/updates/).
- For å endre versjon eller språk i TeX Live, åpne **Administrasjon → TeX-miljø**. Se [Konfigurer TeX-miljøet](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migrering og spesielle gjenopprettingstilfeller
>
> ### Migrer root-oppdatereren fra v1.2.x til atskilte rettigheter {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Se [veiledningen for migrering av oppdateringsverktøyet](/no/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar avbryter utpakkingen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Se [fremgangsmåten ved utpakkingsfeil](/no/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Endringslåsen er i bruk {#mutation-lockが使用中と表示される場合}
>
> Se [Finn prosessen som holder låsen](/no/docs/reference/#mutation-lockが使用中と表示される場合).

## Sikkerhetskopier {#バックアップ}

For regelmessige kopier, gjenopprettingspunkter før oppdatering, testing og gjenoppretting, se [Opprett, kontroller og gjenopprett sikkerhetskopier](/no/docs/backups/). Hvis posisjonen for eksport av revisjonslogger ikke stemmer etter gjenoppretting, se [Gjenopprett revisjonslogger](/no/docs/reference/#監査ログの復旧).

## Feilsøking {#問題が起きた場合}

| Symptom | Kontroller først |
| --- | --- |
| Kan ikke nå `/app/` | DNS, TLS-sertifikat, oppsett for Tunnel eller proxy og startrekkefølge for lokale tjenester |
| Bare administratorer får ikke logget inn | Eksplisitt registrert eieridentitet eller påloggingsopplysninger, `AUTH_MODE`, utsteder, målgruppe og roller |
| Kan ikke hente TeX-avbildningen | HTTPS-tilgang til `ghcr.io`, pakkens synlighet og taggens arkitektur |
| En TeX-endring tar lang tid | Operasjons-ID og logger fra Image Manager med skjermede opplysninger |
| En oppdatering blir avvist | Uforanderlig utgivelse, arkivets kontrollsum, oppdateringsvei og ledig plass |
| Vertsklargjøringen stopper på grunn av en usikker sti | Kontroller at `/var/lib/latex-renderer` eies av `root:latex-renderer` og har modus `2770` |
| Bare oppdateringssiden feiler | Om `client-dist/manifest.json` finnes i distribusjonen, og statusen til Admin Web |
| Konverteringen starter ikke | Køstatus, minst 5 GiB ledig plass, arbeidstjenesten og sokkelen for Docker uten root-rettigheter |
| Problemer rett etter en oppdatering | Stopp mottak av nye jobber og kontroller gammel og ny versjon av applikasjon og miljø før du avgjør om du skal rulle tilbake |

Noter operasjons-ID, fasen der feilen oppstod og en feilkode som kan deles. Se [Feilsøking](/no/docs/troubleshooting/), [Sikkerhet for kontoer og dokumenter](/no/docs/security/) og [Utrulling og konfigurasjonsfiler (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Endre TeX-miljøet {#tex環境の初期設定}

Det første oppsettet klargjør kompileringsmiljøet. For å legge til språk eller endre TeX Live-versjonen, åpne **Administrasjon → TeX-miljø** (`/admin/tex-environment/`). Følgende eksempel støtter engelsk og japansk.

| Innstilling | Anbefalt verdi |
| --- | --- |
| Image | `latest` (velg en tagg som passer arkitekturen ved bruk av faste datotagger) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (deaktivert som standard) |

- Fra den offentlige GHCR-pakken lastes bare **grunnavbildningen** uten språk ned, låst til kontrollsummen. Serveren bygger en **kjøreavbildning** med valgte språk og gjeldende rendererkode. En lokal avbildning med samme oppsett gjenbrukes. Kjøreavbildningene publiseres ikke eksternt.
- Byggingen fortsetter om du lukker nettleseren. Kontroller aktivt miljø og språk i administrasjonen etterpå. Mislykkes nedlastingen, kontroller HTTPS-tilgang til `ghcr.io` og arkitekturstøtte.

### Automatisk diskopprydding {#自動容量整理}

> [!DETAILS] Rydd opp i ubrukte avbildninger og byggbuffer
>
> Image Manager rydder normalt ubrukte administrerte avbildninger hver 24. time. Gjeldende grunn- og kjøreavbildninger, de forrige for tilbakerulling og avbildninger som oppsettet viser til, er beskyttet. Andre kan fjernes 24 timer etter oppretting. Ved opprydding i ubrukt byggbuffer brukes 2 GiB som mål, uten at hele Docker begrenses.
>
> Angi verdiene i `/etc/latex-renderer/renderer.env` og bruk dem med `sudo systemctl restart latex-renderer-image-manager.service` når TeX ikke oppdateres.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` godtar `0` for å slå av opprydding eller et intervall fra `1` til `720` timer. Fra 5 minutter etter start kontrolleres det hvert 5. minutt om opprydding skal kjøres. En felles lås utsetter opprydding under oppdatering og utrulling. Manuell opprydding fra nett eller CLI fjerner ubeskyttede elementer uten å vente på utløpt lagringstid.
> - `RETENTION_HOURS` godtar fra `0` til `8760` timer og `BUILD_CACHE_MAX_GIB` fra `0` til `1024` GiB.
> - Fra `1.3.4-rc.2` lagres Buildx-metadata for Docker uten root-rettigheter separat i `.docker/buildx-worker` i hjemmekatalogen til arbeidsbrukeren. Det hindrer rettighetskonflikter med bygg som root. Automatisk opprydding hopper over avbildninger fra eldre oppsett og kataloger for manuell gjenoppretting. Slett enkeltelementer først etter at du har kontrollert at de er overflødige. Slett aldri Dockers datakatalog direkte.

## Rettigheter ved installasjon og drift {#sudoと通常運用の境界}

Under første installasjon klargjøres systembrukere, kataloger, `systemd`-enheter, Docker uten root-rettigheter og nøkkelfiler ved hjelp av `sudo`. **I vanlig drift får nettappen og administrasjons-API-et ikke `sudo`-rettigheter.**

- **TeX-endringer.** Forespørsler sendes via en Unix-sokkel med begrensede rettigheter til Image Manager, som eies av root.
- **Oppdateringer.** En Unix-sokkel kobles til kontrolleren for Update Manager uten root-rettigheter. Den delegerer faste operasjoner til en kortlivet hjelpeprosess med root-rettigheter.
- **Gjensidig utelukkelse.** En felles lås sørger for at TeX-endringer og oppdateringer skjer etter tur. Nettappen og API-et kan ikke gi root vilkårlige kommandoer, stier eller nettadresser.

## Konfigurasjon og hemmeligheter {#設定と秘密情報}

Vertsspesifikke innstillinger og hemmeligheter oppbevares utenfor applikasjonen og Gits arbeidstre, for eksempel i `/etc/latex-renderer/`.

| Sti | Innhold | Anbefalt modus |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Tilgangsprofil, URL, grenser og ikke-hemmelige IdP-innstillinger | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifikatorer og token bare for Cloudflare-profilen | `0600` |
| `/etc/latex-renderer/update-manager.env` | Utrullingskonto uten root-rettigheter | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Bindinger og ruter for produksjons-Workeren | `0600` |
| `/etc/cloudflared/config.yml` | Regler for innkommende trafikk til Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, billettnøkkel og opplysninger for administrasjonstjenester | Avhenger av filen |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Klienthemmelighet for OIDC-profilen | `0440` |

> [!WARNING]
> Ikke legg `.env`-filer, Cloudflare-token, Tunnel-opplysninger, API-nøkler, SQLite-databaser, dokumenter, PDF-er eller uredigerte driftslogger i Git, saker eller henvendelser om hjelp. Filene `*.example` i repositoriet er maler som viser feltene.

## Manuell installasjon fra tar-arkiv og eldre versjoner {#手動配置-旧版向けの構築手順-tarball-導入}

Med APT og `sudo n624-latex server setup` utfører eller beskriver veiviseren utpakking, klargjøring av vert og registrering av eier. Åpne de følgende avsnittene hvis du ruller ut `v1.7.1` manuelt eller trenger å kontrollere tilgangsgrensene eller endre autentisering.

> [!DETAILS] Last ned, verifiser, rull ut og registrer eier med v1.7.1
>
> Bruk den stabile versjonen [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), arkivet `latex-renderer-server-1.7.1.tar.gz`, ved ny manuell installasjon. Tagg og filer er uforanderlige etter publisering. Direkte utrulling fra utviklingsgrenen `main` og lokal `docker build` for TeX er ikke støttede driftsmetoder.
>
> ### Last ned og verifiser v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Klargjør `curl`, `jq`, `tar`, `sha256sum` og GitHub CLI med støtte for `gh attestation verify`. Node.js og Corepack installeres senere under klargjøringen av verten.
>
> Kjør følgende som vanlig bruker i samme Bash-økt. Både SHA-256 fra GitHub Releases og opphavssignaturen fra GitHub Actions verifiseres. Opphavsdata fra det offentlige API-et sendes til `gh` uten GitHub-konto eller token. Ved feil blir `bundle_root` stående uten verdi. Rett årsaken og prøv på nytt.
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
> ### Klargjør verten {#ホストを準備}
>
> Installer `setfacl` for lagringsrettigheter, `bsdtar` for utpakking i det begrensede oppdateringsverktøyet og `unzip` for kontroll av ZIP. Følg offisielle anvisninger for Node.js 26 eller 24 (`/usr/local/bin/node` og `/usr/local/bin/corepack`) og verktøyene for Docker uten root-rettigheter. For `cloudflare` installerer du også `cloudflared`. Update Manager installerer og verifiserer den angitte pnpm-versjonen for utrullingsbrukeren med Corepack.
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
> Initialiser verten fra den vanlige utrullingskontoen og sett opp Docker uten root-rettigheter for `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Opprett vertsspesifikk konfigurasjon {#ホスト固有設定を作成}
>
> Opprett `renderer.env` i alle profiler og angi `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` og `AUTH_MODE`. Et alias som `ADMIN_ALLOWED_ORIGINS` finnes ikke. Tillatt opphav for nettleseroperasjoner må samsvare nøyaktig med `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Erstatt `example.com`, `REPLACE_*`, alle UUID-er og Access-målgruppen med verdiene for installasjonen din. For en fjernadministrert Tunnel utelater du lokal `config.yml` og kontrollerer først at tilkoblingskomponenten kjører.
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
> - **Profil `standalone`.** Installer Nginx, Caddy eller Apache, kopier et eksempel fra `deploy/reverse-proxy/` og angi FQDN og sertifikatstier. Proxyen fjerner innkommende `CF-Access-*`-hoder og overskriver klientens IP-adresse. Ikke eksponer de lokale tjenestene på port 3100–3105 direkte eksternt.
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
> - **Med `AUTH_MODE=oidc`.** Registrer `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` hos IdP-en. I `renderer.env` setter du `OIDC_ISSUER` og `OIDC_CLIENT_ID` og lagrer hemmeligheten i en egen fil uten avsluttende linjeskift.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Rull ut tjenestene {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Ved første oppstart lastes det publiserte uforanderlige arkivet ned og verifiseres på nytt. Kontrolltreet til root skilles fra byggtreet uten root-rettigheter, `client-dist` bygges og rulles ut i `/opt/latex-renderer/releases/$release_id`. Verter med eksisterende database eller `current` avvises. Bruk vanlig oppdatering etter installasjonen.
> - Før utrulling kontrolleres `renderer.env` (eid av root, modus `0640`, ingen dupliserte nøkler), `PUBLIC_ORIGIN`, autentiseringsinnstillingene og eierskap, rettigheter og lengde for pepper og hemmeligheter uten at verdiene vises.
> - Oppdateringsverktøyet oppbevares separat i `/opt/latex-renderer/updater`, som beskrevet i `docs/independent-updater.md` i repositoriet. Bare utrullingsbrukerens primærgruppe kan gå gjennom `/opt/latex-renderer/update-staging`. Hvert trinn isoleres med `0700` og ryddes ved fullføring eller, etter avbrudd, ved en senere oppstart når det har gått 24 timer.
>
> ### Grenser for offentlig tilgang {#公開境界}
>
> - **`cloudflare-access`.** Beskytt `/auth/*`, `/app/`, `/admin/` og `/oauth/authorize` med samme Access-applikasjon for menneskelige brukere og verifiser målgruppen også på opprinnelsesserveren. Ved Cloudflare med OIDC eller passord må ikke Access blokkere `/auth/*`. Dokumentasjon og nedlastinger er offentlige. Worker Routes betjener bare den offentlige delen av renderings-API-et. Plasser spesifikke API- og administrasjonsruter først i innkommende Tunnel-regler, deretter nettappen som standard og til slutt `http_status:404`.
> - **`standalone`.** En omvendt TLS-proxy ruter etter sti til de lokale tjenestene. Bare små JSON-billettoperasjoner går til Standalone Gateway på port 3105. Nginx-eksempelet begrenser tilkoblinger og anropsfrekvens for passordinnlogging og billett-API. Caddy og Apache uten utvidelser mangler tilsvarende grense per klient, så en slik grense må settes på lastbalansereren eller hos leverandøren. Hold `/internal/*`, databasen og administrasjonssoklene private.
>
> ### Første eier {#最初のowner}
>
> Ekstern identitet avgjøres av `provider + issuer + subject` og passordidentitet av `login name`. E-post brukes bare til visning. Kontoer kobles ikke automatisk ved samme e-post og opprettes ikke automatisk ved innlogging. Kjør prosedyren for valgt metode bare én gang.
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
> **Lokalt passord (eksempel med brukernavn `owner`)**
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
> ### Endre AUTH_MODE senere {#後からauth-modeを変更する場合}
>
> Bruk denne fremgangsmåten når [serverveiviseren](/no/docs/server-setup/) ikke er tilgjengelig.
> Opprett en kryptert kopi og stopp administrasjons-API-et. Med den uforanderlige ID-en fra administrasjonen eller `users list` (format `user_...`) legger du til ny autentiseringsmetode. Overskriving av eksisterende opplysninger avvises, og gjeldende økter trekkes tilbake. Endre deretter `renderer.env` og start API og nettapp på nytt. Behold tidligere opplysninger til du har verifisert ny innlogging i et privat vindu.
>
> Gjør først forberedelsene nedenfor og kjør deretter bare kommandoene for målmetoden.
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
> **Ved overgang til OIDC eller Cloudflare Access**, angi `oidc` eller `cloudflare-access`.
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
> **Ved overgang til passord**, skriv det inn i det skjulte feltet.
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
