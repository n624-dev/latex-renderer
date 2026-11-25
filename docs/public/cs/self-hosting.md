---
slug: self-hosting
category: Vlastní server
title: Provoz LaTeX Renderer na vlastním serveru
description: Vyberte podporovanou konfiguraci, připravte hostitele a nainstalujte službu s aktualizacemi a zálohami.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Možnosti instalace {#現在の提供状況}

Server zprovozníte instalací [balíčku APT](/cs/docs/client/#debian-ubuntu-の-apt-パッケージ) a spuštěním průvodce. V něm nastavíte HTTPS, způsob přihlášení a prvního vlastníka.

### Postup první instalace {#初回導入の順序}

1. **Připravte server.** Ověřte [podporované systémy a způsoby přístupu](#対応する構成) a [nainstalujte Docker Engine a Nginx](#準備するもの).
2. **Nainstalujte balíček APT.** Nainstalujte `n624-latex` podle [pokynů pro Debian a Ubuntu](/cs/docs/client/#debian-ubuntu-の-apt-パッケージ).
3. **Nastavte server.** Z účtu pro nasazení bez práv roota spusťte `sudo n624-latex server setup --plan`. Doplňte chybějící požadavky a pokračujte [nastavením v prohlížeči](/cs/docs/server-setup/#ブラウザで開く).
4. **Vytvořte první PDF.** Otevřete nastavenou adresu HTTPS, [přihlaste se a převeďte zkušební dokument](#導入完了の確認). Průvodce připraví první prostředí TeX.

U existujícího serveru viz [Aktualizace ze správy](/cs/docs/updates/). Instalaci z archivu tar popisuje [ruční postup](#v1-6-9をダウンロードして検証).

## Automatické HTTPS v LAN {#lan-内の自動-https}

**Akebi** umožňuje nastavit adresu HTTPS odvozenou od soukromé IP adresy serveru. Můžete začít se sdílenou certifikační službou. Viz [HTTPS v místní síti pomocí Akebi](/cs/docs/lan-https/).

## Podporované konfigurace {#対応する構成}

APT podporuje novou instalaci na jediném hostiteli s `systemd` v Debianu 12 nebo 13 či Ubuntu 24.04 nebo 26.04 pro amd64 a arm64. Pro překlad LaTeXu se používá Docker bez práv roota pod vyhrazeným uživatelem.

| Režim nasazení (`DEPLOYMENT_MODE`) | Vstupní bod | Způsob přihlášení |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache nebo HTTPS v LAN (Akebi) | Místní hesla, OIDC nebo obojí |
| `cloudflare` | Cloudflare Tunnel a Worker | Cloudflare Access nebo vlastní ověření (hesla, OIDC nebo obojí) |

- **OIDC.** Umožňuje používat poskytovatele identity (IdP) vaší organizace.
- **Cloudflare Access.** Připravte aplikaci Access pro uživatele v Cloudflare.
- **Místní hesla.** Uživatelé se registrují ve správě serveru bez externího IdP.
- **Hesla a OIDC.** Zapněte obojí pomocí nativního přihlášení s `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` a `AUTH_OIDC_ENABLED=true`. Pro starší konfigurace s jedinou metodou použijte `AUTH_MODE`.

## Příprava serveru {#準備するもの}

- **Pracovní účet.** Připojte se účtem bez práv roota a příkazy pro nastavení spouštějte pomocí `sudo`.
- **Disk.** Úvodní kontrola vyžaduje **nejméně 5 GiB volného prostoru** v každém souborovém systému obsahujícím `/opt` nebo `/var/lib`. Vyhraďte další prostor na obrazy TeX, vydání, výsledky a šifrované zálohy.
- **Docker Engine.** Z oficiálního repozitáře nainstalujte Docker Engine a `docker-ce-rootless-extras`. Průvodce nastaví Docker bez práv roota pro překlad. Viz oficiální pokyny pro [Debian](https://docs.docker.com/engine/install/debian/) nebo [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Nainstalujte pomocí `sudo apt install nginx`. Nová instalace přes APT kontroluje přítomnost Nginx i při zpřístupnění služby přes Caddy, Apache či Cloudflare.
- **Přístup a TLS.** Pro vlastní HTTPS připravte název hostitele, certifikát a soukromý klíč a uvolněte adresu a port pro vestavěné HTTPS. Pro Cloudflare připravte Tunnel, DNS a Worker. Viz [Požadavky pro HTTPS v LAN](#lan-内の自動-https).
- **Přihlašovací údaje**
  - OIDC vyžaduje URL vydavatele, ID a tajemství klienta a stabilní `subject` prvního vlastníka.
  - Cloudflare Access vyžaduje údaje aplikace Access a `subject` vlastníka.
  - Pro přihlášení heslem připravte přihlašovací jméno a počáteční heslo vlastníka.
- **Odchozí spojení.** Server musí mít přístup pomocí HTTPS ke GitHub Releases a Attestations, GHCR (`ghcr.io`), archivům TeX Live a repozitářům balíčků Debianu či Ubuntu.
- **Balíček APT.** Zahrnuje Node.js. Viz [pokyny pro APT](/cs/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Ověření instalace {#導入完了の確認}

1. Otevřete `/admin/` na nastavené adrese HTTPS a přihlaste se jako vlastník zaregistrovaný během instalace.
2. Na stejné adrese otevřete `/app/`, vyberte [ukázkový `main.tex`](/cs/docs/#最短でpdfを作る) a klikněte na **Převést do PDF**.
3. Na stránce výsledku otevřete PDF a zkontrolujte, že zobrazuje text ukázky.

> [!DETAILS] Další kontroly služeb a výstupů
>
> Správci mohou provést zkušební převod přes veřejnou adresu URL. Klíč API vydaný pro test se ihned poté zneplatní.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Můžete také ověřit přístup běžného uživatele, veřejné návody, jazyky a obraz uvedené v prostředí TeX a běžné výstupy, například japonské dokumenty či SVG.

### Registrace uživatelů a vydávání klíčů {#利用者と-api-キーの発行}

Po přihlášení vlastníka do `/admin/` zaregistrujte uživatele.

- **Web a Remote MCP.** V části **Uživatelé** vytvořte uživatele, zaregistrujte jeho identitu pro zvolený způsob přihlášení a předejte mu adresu webové aplikace.
- **CLI, Local MCP a HTTP API.** Vytvořte účet služby propojený s uživatelem. V části **Klíče API → Vydat klíč API** vydejte vykreslovací klíč s `render:create` a `render:read:own` (předpona `lrk_...`) a předejte jej bezpečným kanálem.

## Aktualizace a návrat k předchozí verzi {#更新とロールバック}

### Aktualizace aplikace {#アプリケーションを更新する}

- Jako vlastník otevřete **Správa → Aktualizace**. Viz [Aktualizace serveru a návrat k předchozí verzi](/cs/docs/updates/).
- Pro změnu verze nebo jazyků TeX Live otevřete **Správa → Prostředí TeX**. Viz [Nastavení prostředí TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migrace a zvláštní postupy obnovy
>
> ### Migrace aktualizačního nástroje root v1.2.x na oddělená oprávnění {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Viz [pokyny k migraci aktualizačního nástroje](/cs/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar zastaví rozbalení s chybou Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Viz [postup při chybách rozbalování](/cs/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Zámek změn je obsazený {#mutation-lockが使用中と表示される場合}
>
> Viz [Zjištění procesu držícího zámek](/cs/docs/reference/#mutation-lockが使用中と表示される場合).

## Zálohy {#バックアップ}

Pravidelné zálohy, body před aktualizací, zkoušky obnovy a postup obnovy popisuje [Vytváření, ověřování a obnova záloh](/cs/docs/backups/). Při neshodě pozice exportu auditu po obnově viz [Obnova auditních protokolů](/cs/docs/reference/#監査ログの復旧).

## Řešení potíží {#問題が起きた場合}

| Příznak | Co zkontrolovat nejdříve |
| --- | --- |
| Není přístup k `/app/` | DNS, certifikát TLS, konfigurace Tunnel nebo proxy a pořadí spouštění místních služeb |
| Nelze přihlásit pouze správce | Výslovně registrovaná identita či údaje vlastníka, `AUTH_MODE`, vydavatel, příjemce a role |
| Nelze získat obraz TeX | Přístup HTTPS k `ghcr.io`, viditelnost balíčku a architektura značky |
| Změna TeX trvá dlouho | ID operace a protokoly Image Manager se skrytými citlivými údaji |
| Aktualizace byla odmítnuta | Neměnnost vydání, otisk archivu, cesta aktualizace a volné místo |
| Příprava hostitele se zastaví kvůli nebezpečné cestě | Ověřte, že `/var/lib/latex-renderer` vlastní `root:latex-renderer` a že má režim `2770` |
| Selže jen obrazovka aktualizací | Přítomnost `client-dist/manifest.json` v distribuci a stav Admin Web |
| Převod se nespustí | Stav fronty, nejméně 5 GiB volného místa, služba zpracování a soket Dockeru bez práv roota |
| Potíže hned po aktualizaci | Zastavte přijímání nových úloh a před rozhodnutím o návratu ověřte starou a novou verzi aplikace a prostředí |

Poznamenejte si ID operace, fázi selhání a kód chyby, který lze sdílet. Viz [Řešení potíží](/cs/docs/troubleshooting/), [Zabezpečení účtů a dokumentů](/cs/docs/security/) a [Nastavení nasazení a konfigurační soubory (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Změna prostředí TeX {#tex環境の初期設定}

První nastavení připraví překladové prostředí. Pro přidání jazyků nebo změnu verze TeX Live otevřete **Správa → Prostředí TeX** (`/admin/tex-environment/`). Tento příklad podporuje angličtinu a japonštinu.

| Nastavení | Doporučená hodnota |
| --- | --- |
| Image | `latest` (pro značky s pevným datem vyberte značku odpovídající architektuře) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (ve výchozím nastavení vypnuto) |

- Z veřejného balíčku GHCR se stahuje pouze **základní obraz** bez jazyků, určený pevným otiskem. Server vytvoří **běhový obraz** s vybranými jazyky a aktuálním kódem vykreslovací služby. Místní obraz téže konfigurace se použije znovu. Běhové obrazy se veřejně nepublikují.
- Sestavení pokračuje i po zavření prohlížeče. Poté ve správě ověřte aktivní prostředí a jazyky. Při chybě stažení zkontrolujte přístup HTTPS k `ghcr.io` a odpovídající architekturu.

### Automatické čištění disku {#自動容量整理}

> [!DETAILS] Odstranění nepoužívaných obrazů a mezipaměti sestavení
>
> Ve výchozím nastavení Image Manager čistí nepoužívané spravované obrazy každých 24 hodin. Chrání současný základní a běhový obraz, předchozí obrazy pro návrat a obrazy odkazované nastavením. Ostatní může odstranit 24 hodin po vytvoření. Pro nepoužívanou mezipaměť sestavení je orientační hodnota 2 GiB, nikoli limit pro celý Docker.
>
> Upravte hodnoty v `/etc/latex-renderer/renderer.env` a použijte je přes `sudo systemctl restart latex-renderer-image-manager.service` v době, kdy se neaktualizuje TeX.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` přijímá `0` pro vypnutí čištění nebo interval od `1` do `720` hodin. Od 5. minuty po spuštění se každých 5 minut kontroluje, zda je čištění na řadě. Společný zámek je během aktualizace nebo nasazení odloží. Ruční čištění z webu nebo CLI odstraní nechráněné položky bez čekání na uplynutí doby uchování.
> - `RETENTION_HOURS` přijímá hodnoty od `0` do `8760` hodin a `BUILD_CACHE_MAX_GIB` od `0` do `1024` GiB.
> - Od `1.3.4-rc.2` se metadata Buildx Dockeru bez práv roota oddělují do `.docker/buildx-worker` v domovském adresáři uživatele pro zpracování, aby nekolidovala s oprávněními sestavení pod rootem. Automatické čištění vynechává obrazy starších konfigurací a adresáře pro ruční obnovu. Jednotlivé položky mažte až po kontrole, že nejsou potřeba. Nikdy neodstraňujte přímo datový adresář Dockeru.

## Oprávnění při instalaci a provozu {#sudoと通常運用の境界}

Při první instalaci se nastaví systémoví uživatelé, adresáře, jednotky `systemd`, Docker bez práv roota a soubory klíčů pomocí `sudo`. **Při běžném provozu web ani správní API nezískávají oprávnění `sudo`.**

- **Změny TeX.** Požadavky směřují přes unixový soket s omezenými oprávněními do služby Image Manager vlastněné rootem.
- **Aktualizace.** Unixový soket se připojí ke kontroléru Update Manager bez práv roota, který předá pevně určené operace krátkodobému pomocnému procesu s právy roota.
- **Vzájemné vyloučení.** Společný zámek řadí změny TeX a aktualizace za sebe. Web ani API nemohou rootovi předat libovolné příkazy, cesty či URL.

## Konfigurace a tajné údaje {#設定と秘密情報}

Konfiguraci a tajné údaje daného hostitele uchovávejte mimo aplikaci a pracovní strom Gitu, například v `/etc/latex-renderer/`.

| Cesta | Obsah | Doporučený režim |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Přístupový profil, URL, limity a nastavení IdP bez tajných údajů | `0640` |
| `/etc/latex-renderer/deployment.env` | Identifikátory a tokeny pouze pro profil Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Účet pro nasazení bez práv roota | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Vazby a trasy produkčního Workeru | `0600` |
| `/etc/cloudflared/config.yml` | Pravidla pro příchozí provoz Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, klíč tiketů a přihlašovací údaje správcovských služeb | Podle souboru |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Klientské tajemství profilu OIDC | `0440` |

> [!WARNING]
> Neukládejte do Gitu ani nevkládejte do hlášení a žádostí o pomoc soubory `.env`, tokeny Cloudflare, údaje Tunnel, klíče API, databáze SQLite, rukopisy, PDF ani nezpracované provozní protokoly. Soubory `*.example` v repozitáři jsou šablony vysvětlující položky.

## Ruční instalace z archivu tar a starší verze {#手動配置-旧版向けの構築手順-tarball-導入}

Při použití APT a `sudo n624-latex server setup` průvodce provede rozbalení, přípravu hostitele a registraci vlastníka nebo vás jimi provede. Následující části otevřete při ručním nasazení `v1.7.1` nebo kontrole hranic přístupu a změny přihlášení.

> [!DETAILS] Stažení, ověření, nasazení a registrace vlastníka pro v1.7.1
>
> Pro novou ruční instalaci použijte stabilní vydání [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archiv `latex-renderer-server-1.7.1.tar.gz`. Značka a soubory se po zveřejnění nemění. Přímé nasazení z vývojové větve `main` a místní `docker build` pro TeX nejsou podporovaným způsobem provozu.
>
> ### Stažení a ověření v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Připravte `curl`, `jq`, `tar`, `sha256sum` a GitHub CLI podporující `gh attestation verify`. Node.js a Corepack se instalují později při přípravě hostitele.
>
> Jako běžný uživatel spusťte následující příkazy v jedné relaci Bashe. Ověří se SHA-256 z GitHub Releases a podpis původu z GitHub Actions. Údaje o původu se z veřejného API předají do `gh` bez účtu či tokenu GitHub. Při chybě zůstane `bundle_root` nenastavené. Opravte příčinu a pokus zopakujte.
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
> ### Příprava hostitele {#ホストを準備}
>
> Nainstalujte `setfacl` pro přístupová práva úložiště, `bsdtar` pro rozbalování v omezeném aktualizačním nástroji a `unzip` pro kontrolu ZIP. Podle oficiálních pokynů nainstalujte Node.js 26 nebo 24 (`/usr/local/bin/node` a `/usr/local/bin/corepack`) a nástroje pro Docker bez práv roota. Pro `cloudflare` nainstalujte také `cloudflared`. Update Manager přes Corepack nainstaluje a ověří určenou verzi pnpm pro uživatele nasazení.
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
> Z běžného účtu pro nasazení inicializujte hostitele a připravte Docker bez práv roota pro `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Vytvoření konfigurace hostitele {#ホスト固有設定を作成}
>
> V každém profilu vytvořte `renderer.env` a nastavte `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` a `AUTH_MODE`. Alias jako `ADMIN_ALLOWED_ORIGINS` neexistuje. Povolený počátek operací prohlížeče se musí přesně shodovat s `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Nahraďte `example.com`, `REPLACE_*`, všechna UUID a příjemce Access hodnotami své instalace. U vzdáleně spravovaného Tunnel vynechte místní `config.yml` a předem ověřte, že konektor běží.
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
> - **Profil `standalone`.** Nainstalujte Nginx, Caddy nebo Apache, zkopírujte příklad z `deploy/reverse-proxy/` a zadejte FQDN a cesty k certifikátům. Proxy odstraní příchozí hlavičky `CF-Access-*` a přepíše IP adresu klienta. Místní služby na portech 3100 až 3105 nevystavujte přímo navenek.
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
> - **Při `AUTH_MODE=oidc`.** Zaregistrujte `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` u IdP. V `renderer.env` nastavte `OIDC_ISSUER` a `OIDC_CLIENT_ID` a tajemství uložte do samostatného souboru bez koncového znaku nového řádku.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Nasazení služeb {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Při prvním spuštění se znovu stáhne a ověří zveřejněný neměnný archiv, oddělí se řídicí strom roota od sestavovacího stromu bez těchto oprávnění, sestaví se `client-dist` a nasadí do `/opt/latex-renderer/releases/$release_id`. Hostitel s existující databází nebo `current` je odmítnut. Po instalaci použijte běžnou aktualizaci.
> - Před nasazením se zkontroluje `renderer.env` (vlastník root, režim `0640`, klíče bez duplicit), `PUBLIC_ORIGIN`, nastavení přihlášení a vlastnictví, oprávnění a délka pepperu a tajemství bez vypsání jejich hodnot.
> - Aktualizační nástroj se uchovává odděleně v `/opt/latex-renderer/updater` podle dokumentu `docs/independent-updater.md` v repozitáři. Přes `/opt/latex-renderer/update-staging` může procházet pouze primární skupina uživatele pro nasazení. Každá fáze je oddělena režimem `0700` a uklidí se po dokončení, případně při přerušení na některém dalším startu po uplynutí 24 hodin.
>
> ### Hranice veřejného přístupu {#公開境界}
>
> - **`cloudflare-access`.** Chraňte `/auth/*`, `/app/`, `/admin/` a `/oauth/authorize` stejnou aplikací Access pro lidské uživatele a ověřujte příjemce i na cílovém serveru. U Cloudflare s OIDC nebo heslem nesmí Access blokovat `/auth/*`. Dokumentace a soubory ke stažení jsou veřejné. Worker Routes obsluhují jen veřejnou část vykreslovacího API. V pravidlech Tunnel umístěte nejdříve konkrétní trasy API a správy, potom výchozí web a nakonec `http_status:404`.
> - **`standalone`.** Reverzní TLS proxy předává provoz podle cesty místním službám. Do Standalone Gateway na portu 3105 přecházejí jen malé operace s tikety v JSON. Příklad Nginx omezuje počet spojení a četnost požadavků při přihlášení heslem a v API tiketů. Caddy a Apache bez rozšíření nemají rovnocenný limit na klienta, proto jej musíte zajistit u poskytovatele nebo na vyvažovači zátěže. Ponechte `/internal/*`, databázi i správcovské sokety neveřejné.
>
> ### První vlastník {#最初のowner}
>
> Externí identitu určuje `provider + issuer + subject` a identitu s heslem `login name`. E-mail se používá pouze pro zobrazení. Podle shodného e-mailu se účty nepropojují a při přihlášení se nevytvářejí automaticky. Postup pro vybranou metodu proveďte jen jednou.
>
> **Cloudflare Access nebo OIDC**
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
> **Místní heslo (příklad se jménem `owner`)**
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
> ### Pozdější změna AUTH_MODE {#後からauth-modeを変更する場合}
>
> Tento postup použijte, není-li dostupný [průvodce nastavením serveru](/cs/docs/server-setup/).
> Vytvořte šifrovanou zálohu a zastavte správní API. Pomocí neměnného ID ze správy nebo z `users list` (formát `user_...`) přidejte novou metodu přihlášení. Přepsání stávajících údajů bude odmítnuto a současné relace odvolány. Poté změňte `renderer.env` a restartujte API a web. Původní údaje ponechte, dokud neověříte nové přihlášení v anonymním okně.
>
> Nejprve proveďte níže uvedenou přípravu a potom jen příkazy pro cílovou metodu.
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
> **Při přechodu na OIDC nebo Cloudflare Access** zadejte `oidc` nebo `cloudflare-access`.
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
> **Při přechodu na heslo** je zadejte do skrytého pole.
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
