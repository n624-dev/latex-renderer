---
slug: self-hosting
category: Egen server
title: Driv LaTeX Renderer på en egen server
description: Välj en konfiguration som stöds, förbered värden och installera tjänsten med uppdateringar och säkerhetskopiering.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installationsalternativ {#現在の提供状況}

Du kan sätta upp en server genom att installera [APT-paketet](/sv/docs/client/#debian-ubuntu-の-apt-パッケージ) och starta konfigurationsguiden. Där ställer du in HTTPS, inloggningsmetod och första ägaren.

### Ordning vid nyinstallation {#初回導入の順序}

1. **Förbered servern.** Kontrollera [system och åtkomstvägar som stöds](#対応する構成) och [installera Docker Engine och Nginx](#準備するもの).
2. **Installera APT-paketet.** Följ [anvisningarna för Debian och Ubuntu](/sv/docs/client/#debian-ubuntu-の-apt-パッケージ) för att installera `n624-latex`.
3. **Konfigurera servern.** Kör `sudo n624-latex server setup --plan` från ett driftsättningskonto utan root-behörighet. Åtgärda eventuella saknade förutsättningar och fortsätt med [konfiguration i webbläsaren](/sv/docs/server-setup/#ブラウザで開く).
4. **Skapa din första PDF.** Öppna den konfigurerade HTTPS-adressen, [logga in och konvertera ett testdokument](#導入完了の確認). Guiden förbereder den första TeX-miljön.

För befintliga servrar, se [Uppdatera via administrationen](/sv/docs/updates/). För installation från ett tar-arkiv, följ [de manuella anvisningarna](#v1-6-9をダウンロードして検証).

## Automatisk HTTPS på det lokala nätet {#lan-内の自動-https}

**Akebi** kan konfigurera en HTTPS-adress som härleds från serverns privata IP-adress. Du kan börja med den delade certifikattjänsten. Se [HTTPS på det lokala nätet med Akebi](/sv/docs/lan-https/).

## Konfigurationer som stöds {#対応する構成}

APT stöder nyinstallation på en enda värd med `systemd` som kör Debian 12 eller 13 eller Ubuntu 24.04 eller 26.04 på amd64 eller arm64. LaTeX kompileras med rootlös Docker under en särskild användare.

| Driftsättningsläge (`DEPLOYMENT_MODE`) | Ingång | Inloggningsmetoder |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache eller HTTPS på lokalt nät (Akebi) | Lokala lösenord, OIDC eller båda |
| `cloudflare` | Cloudflare Tunnel och en Worker | Cloudflare Access eller inbyggd autentisering (lösenord, OIDC eller båda) |

- **OIDC.** Använd organisationens identitetsleverantör (IdP).
- **Cloudflare Access.** Förbered en Access-applikation för användarna i Cloudflare.
- **Lokala lösenord.** Registrera användare via serveradministrationen utan extern IdP.
- **Lösenord och OIDC.** Aktivera båda med inbyggd autentisering via `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` och `AUTH_OIDC_ENABLED=true`. För äldre konfigurationer med en enda metod använder du `AUTH_MODE`.

## Förbered servern {#準備するもの}

- **Arbetskonto.** Logga in med ett konto utan root-behörighet och kör konfigurationskommandona med `sudo`.
- **Disk.** Förkontrollen kräver **minst 5 GiB ledigt utrymme** i varje filsystem som innehåller `/opt` eller `/var/lib`. Reservera mer plats för TeX-avbilder, versioner, resultat och krypterade kopior.
- **Docker Engine.** Installera Docker Engine och `docker-ce-rootless-extras` från det officiella paketförrådet. Guiden konfigurerar rootlös Docker för kompilering. Se de officiella anvisningarna för [Debian](https://docs.docker.com/engine/install/debian/) eller [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installera med `sudo apt install nginx`. Nya APT-installationer kontrollerar att Nginx är installerat även när tjänsten exponeras via Caddy, Apache eller Cloudflare.
- **Åtkomst och TLS.** För egen HTTPS, förbered värdnamn, certifikat och privat nyckel och reservera en ledig adress och port för inbyggd HTTPS. För Cloudflare, förbered Tunnel, DNS och Worker. Se [kraven för HTTPS på det lokala nätet](#lan-内の自動-https).
- **Inloggningsuppgifter**
  - OIDC kräver utfärdarens URL, klient-ID, klienthemlighet och den första ägarens stabila `subject`.
  - Cloudflare Access kräver Access-applikationens uppgifter och ägarens `subject`.
  - För lösenord, förbered ägarens inloggningsnamn och första lösenord.
- **Utgående anslutningar.** Servern måste nå GitHub Releases och Attestations, GHCR (`ghcr.io`), TeX Live-arkiven och paketförråden för Debian eller Ubuntu över HTTPS.
- **APT-paketet.** Node.js ingår. Se [APT-anvisningarna](/sv/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Kontrollera installationen {#導入完了の確認}

1. Öppna `/admin/` under den konfigurerade HTTPS-adressen och logga in som den ägare som registrerades vid installationen.
2. Öppna `/app/` på samma adress, välj [exempelfilen `main.tex`](/sv/docs/#最短でpdfを作る) och klicka på **Konvertera till PDF**.
3. Öppna PDF-filen på resultatsidan och kontrollera att exempeltexten visas.

> [!DETAILS] Ytterligare kontroller av tjänster och utdata
>
> Administratörer kan testa konvertering via den publika adressen. Den API-nyckel som utfärdas för testet återkallas direkt efteråt.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Du kan även verifiera en vanlig användares åtkomst, publika guider, språk och avbild i TeX-miljön och vanliga utdata som japanska dokument eller SVG.

### Registrera användare och utfärda nycklar {#利用者と-api-キーの発行}

När du kan logga in som ägare i `/admin/` kan du registrera användare.

- **Webb och Remote MCP.** Skapa användaren under **Användare**, registrera identiteten för vald metod och ge användaren webbappens adress.
- **CLI, Local MCP och HTTP-API.** Skapa ett tjänstekonto kopplat till användaren. Utfärda under **API-nycklar → Utfärda API-nyckel** en renderingsnyckel med `render:create` och `render:read:own` (prefix `lrk_...`) och lämna den via en säker kanal.

## Uppdatering och återgång {#更新とロールバック}

### Uppdatera applikationen {#アプリケーションを更新する}

- Öppna **Administration → Uppdateringar** som ägare. Se [Uppdatera servern eller återgå till föregående version](/sv/docs/updates/).
- Öppna **Administration → TeX-miljö** för att ändra version eller språk i TeX Live. Se [Konfigurera TeX-miljön](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migrering och särskilda återställningsfall
>
> ### Migrera root-uppdateraren i v1.2.x till separata behörigheter {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Se [anvisningarna för migrering av uppdateraren](/sv/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar avbryter uppackningen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Se [åtgärder vid uppackningsfel](/sv/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Ändringslåset används {#mutation-lockが使用中と表示される場合}
>
> Se [Identifiera processen som håller låset](/sv/docs/reference/#mutation-lockが使用中と表示される場合).

## Säkerhetskopior {#バックアップ}

Regelbundna kopior, punkter före uppdatering, återställningstester och återställning beskrivs i [Skapa, verifiera och återställ säkerhetskopior](/sv/docs/backups/). Om granskningsloggens exportposition inte stämmer efter återställningen, se [Återställ granskningsloggar](/sv/docs/reference/#監査ログの復旧).

## Felsökning {#問題が起きた場合}

| Symtom | Kontrollera först |
| --- | --- |
| Det går inte att nå `/app/` | DNS, TLS-certifikat, inställningar för Tunnel eller proxy och startordning för lokala tjänster |
| Endast administratörer kan inte logga in | Ägarens uttryckligen registrerade identitet eller inloggningsuppgifter, `AUTH_MODE`, utfärdare, målgrupp och roller |
| TeX-avbilden kan inte hämtas | HTTPS-åtkomst till `ghcr.io`, paketets synlighet och taggens arkitektur |
| En TeX-ändring tar lång tid | Åtgärds-ID och Image Managers loggar med känsliga uppgifter maskerade |
| En uppdatering avvisas | Versionens oföränderlighet, arkivets kontrollsumma, uppdateringsväg och ledigt utrymme |
| Värdförberedelsen avbryts på grund av en osäker sökväg | Kontrollera att `/var/lib/latex-renderer` ägs av `root:latex-renderer` och har läge `2770` |
| Endast uppdateringssidan fungerar inte | Förekomst av `client-dist/manifest.json` i distributionen och status för Admin Web |
| Konverteringen startar inte | Köstatus, minst 5 GiB ledigt utrymme, arbetstjänsten och sockeln för rootlös Docker |
| Problem direkt efter en uppdatering | Stoppa mottagningen av nya jobb och jämför tidigare och nya applikations- och miljöversioner innan du beslutar om återgång |

Anteckna åtgärdens ID, fasen där felet uppstod och en felkod som kan delas. Se [Felsökning](/sv/docs/troubleshooting/), [Säkerhet för konton och dokument](/sv/docs/security/) och [Driftsättning och konfigurationsfiler (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Byt TeX-miljö {#tex環境の初期設定}

Den första konfigurationen förbereder kompileringsmiljön. För att lägga till språk eller byta version av TeX Live, öppna **Administration → TeX-miljö** (`/admin/tex-environment/`). Följande exempel stöder engelska och japanska.

| Inställning | Rekommenderat värde |
| --- | --- |
| Image | `latest` (välj en tagg för din arkitektur vid användning av fast datumtagg) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (avstängt som standard) |

- Från det publika GHCR-paketet hämtas bara **basavbilden** utan språk, låst till sin kontrollsumma. Servern bygger en **körningsavbild** med de valda språken och aktuell renderarkod. En lokal avbild med samma konfiguration återanvänds. Körningsavbilder publiceras inte externt.
- Bygget fortsätter om webbläsaren stängs. Kontrollera sedan aktiv miljö och språk i administrationen. Om hämtningen misslyckas, kontrollera HTTPS-åtkomst till `ghcr.io` och arkitekturstöd.

### Automatisk diskrensning {#自動容量整理}

> [!DETAILS] Rensa oanvända avbilder och byggcache
>
> Image Manager rensar normalt oanvända hanterade avbilder var 24:e timme. Nuvarande bas- och körningsavbilder, de tidigare för återgång och avbilder som konfigurationen hänvisar till skyddas. Övriga kan tas bort 24 timmar efter att de skapats. Rensningen använder 2 GiB som riktvärde för oanvänd byggcache utan att begränsa hela Docker.
>
> Ställ in värdena i `/etc/latex-renderer/renderer.env` och tillämpa dem med `sudo systemctl restart latex-renderer-image-manager.service` när ingen TeX-uppdatering pågår.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` godtar `0` för att stänga av rensning eller ett intervall från `1` till `720` timmar. Från 5 minuter efter start kontrolleras var femte minut om rensning ska ske. Ett gemensamt lås skjuter upp rensningen under uppdatering eller driftsättning. Manuell rensning via webb eller CLI tar bort oskyddade objekt utan att invänta lagringstiden.
> - `RETENTION_HOURS` tillåter `0` till `8760` timmar och `BUILD_CACHE_MAX_GIB` tillåter `0` till `1024` GiB.
> - Från `1.3.4-rc.2` isoleras Buildx-metadata för rootlös Docker i `.docker/buildx-worker` i arbetsanvändarens hemkatalog för att undvika behörighetsproblem med byggen som root. Automatisk rensning hoppar över avbilder från äldre konfigurationer och kataloger för manuell återställning. Radera enskilda objekt först när du kontrollerat att de inte behövs. Ta aldrig bort Dockers datakatalog direkt.

## Behörigheter vid installation och drift {#sudoと通常運用の境界}

Vid första installationen förbereds systemanvändare, kataloger, `systemd`-enheter, rootlös Docker och nyckelfiler med `sudo`. **Under normal drift ges webben och administrations-API:t inte `sudo`-behörighet.**

- **TeX-ändringar.** Begäranden skickas via en Unix-sockel med begränsade rättigheter till Image Manager som ägs av root.
- **Uppdateringar.** En Unix-sockel ansluter till Update Managers styrenhet utan root-behörighet. Den överlåter fasta åtgärder till en kortlivad hjälpprocess som körs som root.
- **Ömsesidig uteslutning.** Ett gemensamt lås ser till att TeX-ändringar och uppdateringar utförs i tur och ordning. Webb och API kan inte skicka godtyckliga kommandon, sökvägar eller adresser till root.

## Konfiguration och hemligheter {#設定と秘密情報}

Värdspecifika inställningar och hemligheter lagras utanför applikationen och Gits arbetskatalog, exempelvis i `/etc/latex-renderer/`.

| Sökväg | Innehåll | Rekommenderat läge |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Åtkomstprofil, URL, gränser och icke-hemliga IdP-inställningar | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifierare och token enbart för Cloudflare-profilen | `0600` |
| `/etc/latex-renderer/update-manager.env` | Driftsättningskonto utan root-behörighet | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Bindningar och vägar för produktions-Workern | `0600` |
| `/etc/cloudflared/config.yml` | Inkommande trafik för Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, biljettnyckel och inloggningsuppgifter för hanteringstjänster | Beror på filen |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Klienthemlighet för OIDC-profilen | `0440` |

> [!WARNING]
> Lägg inte `.env`-filer, Cloudflare-token, Tunnel-uppgifter, API-nycklar, SQLite-databaser, dokument, PDF-filer eller oredigerade driftloggar i Git, ärenden eller förfrågningar om hjälp. Filerna `*.example` i källkodsarkivet är mallar som visar fälten.

## Manuell installation från tar-arkiv och tidigare versioner {#手動配置-旧版向けの構築手順-tarball-導入}

Med APT och `sudo n624-latex server setup` utför eller beskriver guiden uppackning, värdförberedelser och registrering av ägaren. Öppna följande avsnitt om du driftsätter `v1.7.1` manuellt eller behöver kontrollera åtkomstgränser eller byte av autentisering.

> [!DETAILS] Hämta, verifiera, driftsätt och registrera ägare med v1.7.1
>
> För ny manuell installation används den stabila versionen [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), arkivet `latex-renderer-server-1.7.1.tar.gz`. Taggen och filerna är oföränderliga efter publicering. Direkt driftsättning från utvecklingsgrenen `main` och lokal `docker build` för TeX ingår inte i stödd drift.
>
> ### Hämta och verifiera v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Förbered `curl`, `jq`, `tar`, `sha256sum` och ett GitHub CLI som stöder `gh attestation verify`. Node.js och Corepack installeras senare vid förberedelse av värden.
>
> Kör följande som vanlig användare i samma Bash-session. Både SHA-256 från GitHub Releases och GitHub Actions härkomstsignatur verifieras. Härkomstdata förs från det publika API:t till `gh` utan GitHub-konto eller token. Om ett steg misslyckas förblir `bundle_root` osatt. Åtgärda orsaken och försök igen.
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
> ### Förbered värden {#ホストを準備}
>
> Installera `setfacl` för lagringsbehörigheter, `bsdtar` för uppackning inuti den begränsade uppdateraren och `unzip` för kontroll av ZIP. Följ officiella anvisningar för Node.js 26 eller 24 (`/usr/local/bin/node` och `/usr/local/bin/corepack`) och verktygen för rootlös Docker. För `cloudflare` installerar du även `cloudflared`. Update Manager installerar och verifierar angiven pnpm-version för driftsättningsanvändaren med Corepack.
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
> Från det vanliga driftsättningskontot initierar du värden och konfigurerar rootlös Docker för `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Skapa värdens konfiguration {#ホスト固有設定を作成}
>
> Skapa `renderer.env` för alla profiler och ange `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` och `AUTH_MODE`. Det finns inget alias som `ADMIN_ALLOWED_ORIGINS`. Tillåtet ursprung för webbläsaråtgärder måste exakt matcha `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Byt `example.com`, `REPLACE_*`, alla UUID:n och Access-målgruppen mot installationens egna värden. För en fjärrhanterad Tunnel, utelämna lokalt `config.yml` och kontrollera först att anslutningskomponenten är aktiv.
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
> - **Profil `standalone`.** Installera Nginx, Caddy eller Apache, kopiera ett exempel ur `deploy/reverse-proxy/` och ange fullständigt värdnamn och certifikatsökvägar. Proxyn tar bort inkommande `CF-Access-*`-huvuden och skriver över klientens IP-adress. Exponera inte tjänsterna på portarna 3100–3105 direkt externt.
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
> - **Med `AUTH_MODE=oidc`.** Registrera `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` hos identitetsleverantören. I `renderer.env` anger du `OIDC_ISSUER` och `OIDC_CLIENT_ID` och sparar hemligheten i en separat fil utan avslutande radbrytning.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Driftsätt tjänsterna {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Vid första starten hämtas och verifieras det publicerade oföränderliga arkivet igen. Roots kontrollträd hålls separat från byggträdet utan root-behörighet, `client-dist` byggs och driftsätts i `/opt/latex-renderer/releases/$release_id`. En värd med befintlig databas eller `current` avvisas. Använd vanlig uppdatering efter installationen.
> - Före driftsättning kontrolleras `renderer.env` (root-ägd, läge `0640`, inga dubblettnycklar), `PUBLIC_ORIGIN`, autentiseringsinställningar och ägare, behörigheter och längd för pepper och hemligheter utan att värdena visas.
> - Uppdateraren förvaras separat i `/opt/latex-renderer/updater` enligt dokumentet `docs/independent-updater.md` i källkodsarkivet. Endast driftsättningsanvändarens primära grupp kan passera genom `/opt/latex-renderer/update-staging`. Varje steg isoleras med `0700` och rensas efter slutförande, eller efter ett avbrott vid en senare start när 24 timmar passerat.
>
> ### Gränser för publik åtkomst {#公開境界}
>
> - **`cloudflare-access`.** Skydda `/auth/*`, `/app/`, `/admin/` och `/oauth/authorize` med samma Access-applikation för mänskliga användare och kontrollera målgruppen även på ursprungsservern. Vid Cloudflare med OIDC eller lösenord får Access inte spärra `/auth/*`. Guider och nedladdningar är publika. Worker Routes betjänar enbart den publika delen av renderings-API:t. Ordna inkommande Tunnel-regler med specifika API- och administrationsvägar först, sedan standardwebben och sist `http_status:404`.
> - **`standalone`.** En omvänd TLS-proxy fördelar förfrågningar per sökväg till lokala tjänster. Bara små JSON-begäranden om biljetter går till Standalone Gateway på port 3105. Nginx-exemplet begränsar anslutningar och anropsfrekvens vid lösenordsinloggning och i biljett-API:t. Caddy och Apache utan tillägg saknar en likvärdig gräns per klient, så den måste tillämpas i en lastbalanserare eller hos leverantören. Håll `/internal/*`, databasen och hanteringssocklarna privata.
>
> ### Första ägaren {#最初のowner}
>
> Den externa identiteten bestäms av `provider + issuer + subject` och lösenordsidentiteten av `login name`. E-post visas endast. Konton länkas inte vid matchande e-post och skapas inte automatiskt vid inloggning. Kör proceduren för vald metod bara en gång.
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
> **Lokalt lösenord (exempel med namnet `owner`)**
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
> ### Ändra AUTH_MODE senare {#後からauth-modeを変更する場合}
>
> Använd detta när [serverguiden](/sv/docs/server-setup/) inte finns tillgänglig.
> Skapa en krypterad kopia och stoppa administrations-API:t. Lägg till den nya metoden med oföränderligt ID från administrationen eller `users list` (format `user_...`). Överskrivning av befintliga uppgifter avvisas och aktuella sessioner återkallas. Ändra sedan `renderer.env` och starta om API och webb. Behåll tidigare uppgifter tills den nya inloggningen verifierats i ett privat fönster.
>
> Kör först följande förberedelser och därefter endast kommandona för målmetoden.
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
> **Vid byte till OIDC eller Cloudflare Access**, ange `oidc` eller `cloudflare-access`.
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
> **Vid byte till lösenord**, ange det i det dolda fältet.
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
