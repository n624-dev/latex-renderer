---
slug: self-hosting
category: Własny serwer
title: Uruchomienie LaTeX Renderer na własnym serwerze
description: Wybierz obsługiwaną konfigurację, przygotuj host i zainstaluj usługę z aktualizacjami i kopiami zapasowymi.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Metody instalacji {#現在の提供状況}

Aby uruchomić serwer, zainstaluj [pakiet APT](/pl/docs/client/#debian-ubuntu-の-apt-パッケージ) i uruchom kreator. Skonfigurujesz w nim HTTPS, metodę logowania i pierwszego właściciela.

### Kolejność pierwszej instalacji {#初回導入の順序}

1. **Przygotuj serwer.** Sprawdź [obsługiwane systemy i sposoby dostępu](#対応する構成) i [zainstaluj Docker Engine i Nginx](#準備するもの).
2. **Zainstaluj pakiet APT.** Zainstaluj `n624-latex` zgodnie z [instrukcją dla Debiana i Ubuntu](/pl/docs/client/#debian-ubuntu-の-apt-パッケージ).
3. **Skonfiguruj serwer.** Na koncie wdrożeniowym bez uprawnień roota uruchom `sudo n624-latex server setup --plan`. Uzupełnij brakujące wymagania i przejdź do [konfiguracji w przeglądarce](/pl/docs/server-setup/#ブラウザで開く).
4. **Utwórz pierwszy PDF.** Otwórz skonfigurowany adres HTTPS, [zaloguj się i przekonwertuj dokument testowy](#導入完了の確認). Kreator przygotowuje pierwsze środowisko TeX.

W przypadku działającego serwera zobacz [Aktualizacja z panelu administracyjnego](/pl/docs/updates/). Aby użyć archiwum tar, skorzystaj z [instalacji ręcznej](#v1-6-9をダウンロードして検証).

## Automatyczny HTTPS w sieci LAN {#lan-内の自動-https}

**Akebi** pozwala skonfigurować adres HTTPS wyprowadzony z prywatnego adresu IP serwera. Możesz zacząć od współdzielonej usługi certyfikatów. Zobacz [HTTPS w sieci LAN z Akebi](/pl/docs/lan-https/).

## Obsługiwane konfiguracje {#対応する構成}

APT pozwala na nową instalację na pojedynczym hoście z `systemd` w systemach Debian 12 lub 13 i Ubuntu 24.04 lub 26.04, na amd64 lub arm64. Kompilacja LaTeX używa Dockera bez uprawnień roota na dedykowanym koncie.

| Tryb wdrożenia (`DEPLOYMENT_MODE`) | Droga dostępu | Metody logowania |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache lub HTTPS w sieci LAN (Akebi) | Lokalne hasła, OIDC lub obie metody |
| `cloudflare` | Cloudflare Tunnel i Worker | Cloudflare Access lub natywne uwierzytelnianie (hasła, OIDC lub obie metody) |

- **OIDC.** Pozwala używać dostawcy tożsamości (IdP) Twojej organizacji.
- **Cloudflare Access.** Przygotuj aplikację Access w Cloudflare dla użytkowników.
- **Lokalne hasła.** Rejestruj użytkowników w panelu administracyjnym serwera bez zewnętrznego IdP.
- **Hasła i OIDC.** Włącz obie metody natywnego uwierzytelniania za pomocą `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` i `AUTH_OIDC_ENABLED=true`. W starszych konfiguracjach z jedną metodą użyj `AUTH_MODE`.

## Przygotowanie serwera {#準備するもの}

- **Konto robocze.** Połącz się przez zwykłe konto bez uprawnień roota i uruchamiaj polecenia konfiguracji z `sudo`.
- **Dysk.** Wstępna kontrola wymaga **co najmniej 5 GiB wolnego miejsca** w każdym systemie plików zawierającym `/opt` lub `/var/lib`. Zapewnij dodatkowe miejsce na obrazy TeX, wydania, wyniki i zaszyfrowane kopie.
- **Docker Engine.** Zainstaluj Docker Engine i `docker-ce-rootless-extras` z oficjalnego repozytorium. Kreator przygotuje Docker bez uprawnień roota na potrzeby kompilacji. Zobacz oficjalne instrukcje dla [Debiana](https://docs.docker.com/engine/install/debian/) lub [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Zainstaluj za pomocą `sudo apt install nginx`. Nowa instalacja APT sprawdza obecność Nginx także przy dostępie publicznym przez Caddy, Apache lub Cloudflare.
- **Dostęp i TLS.** Dla własnego HTTPS przygotuj nazwę hosta, certyfikat i klucz prywatny, a także wolny adres i port dla wbudowanego HTTPS. Dla Cloudflare przygotuj Tunnel, DNS i Worker. Zobacz [wymagania HTTPS w sieci LAN](#lan-内の自動-https).
- **Dane dostępowe**
  - OIDC wymaga adresu URL wystawcy, identyfikatora i sekretu klienta oraz stabilnego `subject` pierwszego właściciela.
  - Cloudflare Access wymaga danych aplikacji Access i `subject` właściciela.
  - Do logowania hasłem przygotuj nazwę użytkownika i początkowe hasło właściciela.
- **Połączenia wychodzące.** Serwer musi mieć dostęp przez HTTPS do GitHub Releases i Attestations, GHCR (`ghcr.io`), archiwów TeX Live i repozytoriów pakietów Debiana lub Ubuntu.
- **Pakiet APT.** Zawiera Node.js. Zobacz [instrukcje APT](/pl/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Weryfikacja instalacji {#導入完了の確認}

1. Otwórz `/admin/` pod skonfigurowanym adresem HTTPS i zaloguj się jako właściciel zarejestrowany podczas instalacji.
2. Otwórz `/app/` pod tym samym adresem, wybierz [przykładowy `main.tex`](/pl/docs/#最短でpdfを作る) i kliknij **Konwertuj do PDF**.
3. Otwórz PDF na stronie wyniku i sprawdź, czy widać tekst z przykładu.

> [!DETAILS] Dodatkowe testy usług i wyników
>
> Administrator może uruchomić test konwersji przez publiczny adres URL. Klucz API wydany na potrzeby testu zostaje bezpośrednio po nim unieważniony.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Możesz również sprawdzić logowanie zwykłego użytkownika, publiczne przewodniki, obraz i języki wskazane w środowisku TeX oraz typowe wyniki, np. dokumenty japońskie lub SVG.

### Rejestrowanie użytkowników i wydawanie kluczy {#利用者と-api-キーの発行}

Po zalogowaniu jako właściciel do `/admin/` zarejestruj użytkowników.

- **Aplikacja internetowa i Remote MCP.** Utwórz użytkownika w sekcji **Użytkownicy**, zarejestruj tożsamość dla wybranej metody logowania i przekaż mu adres aplikacji.
- **CLI, Local MCP i API HTTP.** Utwórz konto usługi powiązane z użytkownikiem. W **Klucze API → Wydaj klucz API** wydaj klucz renderowania z `render:create` i `render:read:own` (prefiks `lrk_...`) i przekaż go bezpiecznym kanałem.

## Aktualizacje i wycofywanie {#更新とロールバック}

### Aktualizacja aplikacji {#アプリケーションを更新する}

- Jako właściciel otwórz **Administracja → Aktualizacje**. Zobacz [Aktualizacja serwera i powrót do poprzedniej wersji](/pl/docs/updates/).
- Aby zmienić wersję lub zestaw języków TeX Live, otwórz **Administracja → Środowisko TeX**. Zobacz [Konfiguracja środowiska TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migracja i szczególne przypadki odzyskiwania
>
> ### Migracja aktualizatora root v1.2.x do wersji z rozdzielonymi uprawnieniami {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Zobacz [instrukcję migracji aktualizatora](/pl/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar przerywa rozpakowywanie z błędem Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Zobacz [procedurę obsługi błędów rozpakowywania](/pl/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Blokada zmian jest zajęta {#mutation-lockが使用中と表示される場合}
>
> Zobacz [Ustalanie procesu utrzymującego blokadę](/pl/docs/reference/#mutation-lockが使用中と表示される場合).

## Kopie zapasowe {#バックアップ}

Kopie okresowe, punkty sprzed aktualizacji, próby odtworzenia i odzyskiwanie opisuje [Tworzenie, weryfikowanie i odtwarzanie kopii zapasowych](/pl/docs/backups/). Gdy po odtworzeniu nie zgadza się pozycja eksportu audytu, zobacz [Odzyskiwanie dzienników audytu](/pl/docs/reference/#監査ログの復旧).

## Rozwiązywanie problemów {#問題が起きた場合}

| Objaw | Co sprawdzić najpierw |
| --- | --- |
| Brak dostępu do `/app/` | DNS, certyfikat TLS, konfiguracja Tunnel lub proxy i kolejność uruchomienia lokalnych usług |
| Tylko administratorzy nie mogą się zalogować | Jawnie zarejestrowana tożsamość lub dane dostępowe właściciela, `AUTH_MODE`, wystawca, odbiorca i role |
| Nie można pobrać obrazu TeX | Dostęp HTTPS do `ghcr.io`, widoczność pakietu i architektura znacznika |
| Zmiana TeX trwa długo | Identyfikator operacji i dzienniki Image Manager z ukrytymi danymi poufnymi |
| Aktualizacja została odrzucona | Niezmienność wydania, suma kontrolna archiwum, ścieżka aktualizacji i wolne miejsce |
| Przygotowanie hosta przerwane z powodu niebezpiecznej ścieżki | Sprawdź, czy `/var/lib/latex-renderer` należy do `root:latex-renderer` i ma uprawnienia `2770` |
| Nie działa tylko ekran aktualizacji | Obecność `client-dist/manifest.json` w dystrybucji i stan Admin Web |
| Konwersja się nie rozpoczyna | Stan kolejki, co najmniej 5 GiB wolnego miejsca, usługa robocza i gniazdo Dockera bez uprawnień roota |
| Problemy tuż po aktualizacji | Wstrzymaj przyjmowanie nowych zadań i sprawdź poprzednią oraz nową wersję aplikacji i środowiska przed podjęciem decyzji o wycofaniu |

Zanotuj identyfikator operacji, etap niepowodzenia i kod błędu, który możesz udostępnić. Zobacz [Rozwiązywanie problemów](/pl/docs/troubleshooting/), [Bezpieczeństwo kont i dokumentów](/pl/docs/security/) oraz [Konfiguracja wdrożenia i pliki konfiguracyjne (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Zmiana środowiska TeX {#tex環境の初期設定}

Pierwsza konfiguracja przygotowuje środowisko kompilacji. Aby dodać języki lub zmienić wersję TeX Live, otwórz **Administracja → Środowisko TeX** (`/admin/tex-environment/`). Poniższy przykład obsługuje angielski i japoński.

| Ustawienie | Zalecana wartość |
| --- | --- |
| Image | `latest` (dla znaczników z ustaloną datą wybierz zgodny z architekturą) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (domyślnie wyłączone) |

- Z publicznego pakietu GHCR pobierany jest tylko **obraz bazowy** bez języków, przypięty do sumy kontrolnej. Serwer buduje **obraz wykonawczy** z wybranymi językami i aktualnym kodem renderera. Lokalny obraz z taką samą konfiguracją jest używany ponownie. Obrazy wykonawcze nie są publikowane na zewnątrz.
- Budowanie trwa po zamknięciu przeglądarki. Po zakończeniu sprawdź aktywne środowisko i języki w panelu administracyjnym. Jeśli pobieranie zawiedzie, sprawdź dostęp HTTPS do `ghcr.io` i zgodność architektury.

### Automatyczne czyszczenie dysku {#自動容量整理}

> [!DETAILS] Czyszczenie nieużywanych obrazów i pamięci podręcznej budowania
>
> Domyślnie Image Manager co 24 godziny czyści nieużywane zarządzane obrazy. Chroni bieżący obraz bazowy i środowisko, ich poprzednie wersje do wycofania i obrazy wskazane przez konfigurację. Pozostałe można usunąć po 24 godzinach od utworzenia. Czyszczenie przyjmuje 2 GiB jako cel dla nieużywanej pamięci podręcznej budowania. Nie jest to limit całego Dockera.
>
> Ustaw wartości w `/etc/latex-renderer/renderer.env` i zastosuj je poleceniem `sudo systemctl restart latex-renderer-image-manager.service`, gdy nie trwa aktualizacja TeX.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` przyjmuje `0`, aby wyłączyć czyszczenie, lub odstęp od `1` do `720` godzin. Od 5. minuty po starcie co 5 minut sprawdzany jest termin czyszczenia. Wspólna blokada odracza czyszczenie podczas aktualizacji i wdrożeń. Czyszczenie ręczne przez stronę lub CLI usuwa niechronione elementy bez czekania na upływ terminu przechowywania.
> - `RETENTION_HOURS` przyjmuje od `0` do `8760` godzin, a `BUILD_CACHE_MAX_GIB` od `0` do `1024` GiB.
> - Od `1.3.4-rc.2` metadane Buildx Dockera bez uprawnień roota znajdują się osobno w `.docker/buildx-worker` w katalogu domowym konta roboczego. Zapobiega to problemom z uprawnieniami przy budowaniu jako root. Automatyczne czyszczenie pomija obrazy starszych konfiguracji i katalogi odzyskiwania ręcznego. Poszczególne elementy usuwaj dopiero po sprawdzeniu, że są zbędne. Nigdy nie usuwaj bezpośrednio katalogu danych Dockera.

## Uprawnienia przy instalacji i działaniu {#sudoと通常運用の境界}

Podczas pierwszej instalacji za pomocą uprawnień administracyjnych przygotowywani są użytkownicy systemowi, katalogi, jednostki `systemd`, Docker bez uprawnień roota i pliki kluczy. Służy do tego `sudo`. **Podczas zwykłej pracy strona i administracyjne API nie otrzymują uprawnień `sudo`.**

- **Zmiany TeX.** Żądania są przekazywane do należącego do roota Image Manager przez gniazdo Unix o ograniczonych uprawnieniach.
- **Aktualizacje.** Gniazdo Unix łączy się z kontrolerem Update Manager bez uprawnień roota, który deleguje ustalone operacje krótkotrwałemu procesowi pomocniczemu roota.
- **Wzajemne wykluczanie.** Wspólna blokada zapewnia wykonywanie kolejno zmian TeX i aktualizacji. Strona i API nie mogą przekazać rootowi dowolnych poleceń, ścieżek ani adresów URL.

## Konfiguracja i sekrety {#設定と秘密情報}

Ustawienia i sekrety hosta są przechowywane poza aplikacją i drzewem roboczym Git, na przykład w `/etc/latex-renderer/`.

| Ścieżka | Zawartość | Zalecane uprawnienia |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Profil dostępu, adres URL, limity i niepoufne ustawienia IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Identyfikatory i tokeny używane wyłącznie w profilu Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Konto wdrożeniowe bez uprawnień roota | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Powiązania i trasy produkcyjnego Workera | `0600` |
| `/etc/cloudflared/config.yml` | Reguły ruchu przychodzącego Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, klucz biletów i dane dostępowe usług zarządzających | Zależnie od pliku |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Sekret klienta profilu OIDC | `0440` |

> [!WARNING]
> Nie umieszczaj w Git, zgłoszeniach ani prośbach o pomoc plików `.env`, tokenów Cloudflare, danych dostępowych Tunnel, kluczy API, baz SQLite, dokumentów, PDF ani prawdziwych dzienników bez usunięcia danych poufnych. Pliki `*.example` w repozytorium są wzorami pokazującymi poszczególne pola.

## Ręczna instalacja z archiwum tar i starsze wersje {#手動配置-旧版向けの構築手順-tarball-導入}

Przy użyciu APT i `sudo n624-latex server setup` kreator wykonuje lub opisuje kroki rozpakowania, przygotowania hosta i rejestracji właściciela. Rozwiń poniższe instrukcje, jeśli wdrażasz ręcznie `v1.7.1` albo chcesz sprawdzić granice dostępu lub zmianę uwierzytelniania.

> [!DETAILS] Pobranie, weryfikacja, wdrożenie i rejestracja właściciela w v1.7.1
>
> Do nowej instalacji ręcznej użyj stabilnego wydania [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archiwum `latex-renderer-server-1.7.1.tar.gz`. Po publikacji znacznik i archiwa są niezmienne. Bezpośrednie wdrożenie z gałęzi deweloperskiej `main` i lokalny `docker build` dla TeX nie należą do obsługiwanych sposobów pracy.
>
> ### Pobranie i weryfikacja v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Przygotuj `curl`, `jq`, `tar`, `sha256sum` i GitHub CLI obsługujące `gh attestation verify`. Node.js i Corepack zostaną zainstalowane na późniejszym etapie przygotowania hosta.
>
> Jako zwykły użytkownik wykonaj poniższe polecenia w tej samej sesji Bash. Sprawdzają SHA-256 z GitHub Releases i podpis pochodzenia z GitHub Actions. Dane pochodzenia z publicznego API trafiają do `gh` bez konta i tokenu GitHub. Jeśli krok zawiedzie, `bundle_root` pozostanie niezdefiniowane. Usuń przyczynę i spróbuj ponownie.
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
> ### Przygotowanie hosta {#ホストを準備}
>
> Zainstaluj `setfacl` do uprawnień magazynu, `bsdtar` do rozpakowywania w ograniczonym aktualizatorze i `unzip` do kontroli ZIP. Zgodnie z oficjalną instrukcją zainstaluj Node.js 26 lub 24 (`/usr/local/bin/node` i `/usr/local/bin/corepack`) i narzędzia Dockera bez uprawnień roota. Dla `cloudflare` zainstaluj także `cloudflared`. Update Manager instaluje i weryfikuje wersję pnpm wskazaną dla użytkownika wdrożeniowego przez Corepack.
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
> Ze zwykłego konta wdrożeniowego zainicjuj host i skonfiguruj Docker bez uprawnień roota dla `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Tworzenie konfiguracji hosta {#ホスト固有設定を作成}
>
> Utwórz `renderer.env` dla każdego profilu i ustaw `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` i `AUTH_MODE`. Nie ma aliasu takiego jak `ADMIN_ALLOWED_ORIGINS`. Dozwolone źródło operacji przeglądarki musi dokładnie odpowiadać `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Zastąp `example.com`, `REPLACE_*`, wszystkie UUID i odbiorcę Access wartościami swojej instalacji. Przy zdalnie zarządzanym Tunnel pomiń lokalny `config.yml` i najpierw potwierdź, że łącznik jest aktywny.
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
> - **Profil `standalone`.** Zainstaluj Nginx, Caddy lub Apache, skopiuj przykład z `deploy/reverse-proxy/` i podaj FQDN i ścieżki certyfikatów. Proxy usuwa przychodzące nagłówki `CF-Access-*` i nadpisuje adres IP klienta. Nie udostępniaj na zewnątrz lokalnych usług na portach 3100–3105.
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
> - **Przy `AUTH_MODE=oidc`.** Zarejestruj `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` w IdP. W `renderer.env` ustaw `OIDC_ISSUER` i `OIDC_CLIENT_ID`, a sekret zapisz w osobnym pliku bez końcowego znaku nowego wiersza.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Wdrożenie usług {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Przy pierwszym uruchomieniu instalator ponownie pobiera i weryfikuje niezmienne opublikowane archiwum, oddziela drzewo sterowania roota od drzewa budowania bez uprawnień roota, buduje `client-dist` i wdraża je w `/opt/latex-renderer/releases/$release_id`. Odrzuca host z istniejącą bazą lub `current`. Po instalacji stosuj zwykłe aktualizacje.
> - Przed wdrożeniem sprawdzane są `renderer.env` (właściciel root, uprawnienia `0640`, brak powtarzających się kluczy), `PUBLIC_ORIGIN`, ustawienia uwierzytelniania oraz właściciel, uprawnienia i długość peppera i sekretów, bez ujawniania ich wartości.
> - Aktualizator znajduje się oddzielnie w `/opt/latex-renderer/updater`, zgodnie z opisem `docs/independent-updater.md` w repozytorium. Tylko grupa podstawowa użytkownika wdrożeniowego może przechodzić przez `/opt/latex-renderer/update-staging`. Każdy etap jest izolowany z uprawnieniami `0700` i czyszczony po zakończeniu lub, po przerwaniu, przy kolejnym starcie po upływie 24 godzin.
>
> ### Granice dostępu publicznego {#公開境界}
>
> - **`cloudflare-access`.** Chroń `/auth/*`, `/app/`, `/admin/` i `/oauth/authorize` tą samą aplikacją Access dla użytkowników i sprawdzaj odbiorcę także na serwerze źródłowym. Przy Cloudflare z OIDC lub hasłami zadbaj, aby Access nie blokował `/auth/*`. Dokumentacja i pliki do pobrania są publiczne. Worker Routes obsługują tylko publiczną część API renderowania. Uporządkuj reguły wejściowe Tunnel od konkretnych tras API i administracji, przez domyślną stronę, po końcowe `http_status:404`.
> - **`standalone`.** Odwrotny serwer proxy TLS rozdziela ruch według ścieżek między lokalne usługi. Do Standalone Gateway na porcie 3105 trafiają tylko małe operacje biletowe w JSON. Przykład Nginx ogranicza liczbę połączeń i częstość żądań logowania hasłem i API biletów. Caddy i Apache bez rozszerzeń nie zapewniają równoważnego limitu na klienta, dlatego należy zastosować go u dostawcy lub na równoważniku obciążenia. Zachowaj prywatność `/internal/*`, bazy i gniazd zarządzania.
>
> ### Pierwszy właściciel {#最初のowner}
>
> Tożsamość zewnętrzną wyznacza `provider + issuer + subject`, a tożsamość przy logowaniu hasłem `login name`. E-mail jest używany wyłącznie do wyświetlenia. System nie łączy kont po zgodności e-maila ani nie tworzy ich automatycznie przy logowaniu. Wykonaj procedurę wybranej metody tylko raz.
>
> **Cloudflare Access lub OIDC**
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
> **Hasło lokalne (przykład z nazwą `owner`)**
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
> ### Późniejsza zmiana AUTH_MODE {#後からauth-modeを変更する場合}
>
> Użyj tej procedury, gdy [kreator serwera](/pl/docs/server-setup/) jest niedostępny.
> Utwórz zaszyfrowaną kopię i zatrzymaj administracyjne API. Za pomocą niezmiennego ID z panelu administracyjnego lub z `users list` (format `user_...`) dodaj nową metodę uwierzytelniania. Nadpisywanie istniejących danych dostępowych jest odrzucane, a bieżące sesje są unieważniane. Następnie zmień `renderer.env` i uruchom ponownie API oraz stronę. Zachowaj starsze dane dostępowe, dopóki nie zweryfikujesz nowego logowania w oknie prywatnym.
>
> Najpierw wykonaj poniższe przygotowania, a potem tylko polecenia docelowej metody.
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
> **Przy przejściu na OIDC lub Cloudflare Access** podaj `oidc` lub `cloudflare-access`.
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
> **Przy przejściu na hasło** wpisz je w polu maskującym.
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
