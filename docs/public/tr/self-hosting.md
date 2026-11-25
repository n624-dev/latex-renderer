---
slug: self-hosting
category: Kendi sunucunuzda barındırma
title: LaTeX Renderer’ı kendi sunucunuzda işletme
description: Desteklenen bir yapılandırma seçin, ana makineyi hazırlayın ve hizmeti güncelleme ve yedeklemeleriyle birlikte kurun.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Kurulum seçenekleri {#現在の提供状況}

[APT paketini](/tr/docs/client/#debian-ubuntu-の-apt-パッケージ) kurup sihirbazı çalıştırarak bir sunucu hazırlayabilirsiniz. Sihirbaz HTTPS’yi, oturum açma yöntemini ve ilk sahibi ayarlar.

### İlk kurulum sırası {#初回導入の順序}

1. **Sunucuyu hazırlayın.** [Desteklenen sistemleri ve erişim yollarını](#対応する構成) kontrol edip [Docker Engine ve Nginx’i kurun](#準備するもの).
2. **APT paketini kurun.** `n624-latex` paketini kurmak için [Debian ve Ubuntu yönergelerini](/tr/docs/client/#debian-ubuntu-の-apt-パッケージ) izleyin.
3. **Sunucuyu yapılandırın.** Root olmayan dağıtım hesabından `sudo n624-latex server setup --plan` çalıştırın. Eksik gereksinimleri giderip [tarayıcıda kuruluma](/tr/docs/server-setup/#ブラウザで開く) geçin.
4. **İlk PDF’nizi oluşturun.** Yapılandırılan HTTPS URL’sini açın, [giriş yapıp bir deneme belgesi dönüştürün](#導入完了の確認). İlk TeX ortamını sihirbaz hazırlar.

Var olan sunucu için [Yönetimden güncelleme](/tr/docs/updates/) bölümüne bakın. Tar arşivi kullanacaksanız [elle kurulum yönergelerini](#v1-6-9をダウンロードして検証) izleyin.

## LAN’da otomatik HTTPS {#lan-内の自動-https}

**Akebi** sunucunun özel IP adresinden türetilen bir HTTPS URL’si ayarlamanızı sağlar. Paylaşılan sertifika hizmetiyle başlayabilirsiniz. [Akebi ile LAN’da HTTPS kullanma](/tr/docs/lan-https/) bölümüne bakın.

## Desteklenen yapılandırmalar {#対応する構成}

APT ile amd64 veya arm64 üzerinde Debian 12/13 ya da Ubuntu 24.04/26.04 çalıştıran, `systemd` kullanan tek bir ana makineye yeni kurulum yapılabilir. LaTeX derlemesi özel bir kullanıcıyla rootless Docker üzerinde çalışır.

| Dağıtım modu (`DEPLOYMENT_MODE`) | Giriş noktası | Oturum açma yöntemleri |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache veya LAN’da HTTPS (Akebi) | Yerel parola, OIDC veya ikisi |
| `cloudflare` | Cloudflare Tunnel ve Worker | Cloudflare Access veya yerleşik kimlik doğrulama (parola, OIDC veya ikisi) |

- **OIDC.** Kuruluşunuzun kimlik sağlayıcısını (IdP) kullanabilirsiniz.
- **Cloudflare Access.** Kullanıcılar için Cloudflare’da bir Access uygulaması hazırlayın.
- **Yerel parolalar.** Kullanıcıları dış IdP olmadan sunucu yönetiminde kaydedin.
- **Parolalar ve OIDC.** Yerleşik kimlik doğrulamada `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` ve `AUTH_OIDC_ENABLED=true` ile ikisini etkinleştirin. Tek yöntemli eski yapılandırmalarda `AUTH_MODE` kullanın.

## Sunucuyu hazırlama {#準備するもの}

- **Çalışma hesabı.** Root olmayan bir hesapla bağlanın ve kurulum komutlarını `sudo` ile çalıştırın.
- **Disk.** İlk denetim `/opt` veya `/var/lib` içeren her dosya sisteminde **en az 5 GiB boş alan** gerektirir. TeX imajları, sürümler, çıktılar ve şifrelenmiş yedekler için ek alan ayırın.
- **Docker Engine.** Resmî depodan Docker Engine ve `docker-ce-rootless-extras` paketini kurun. Sihirbaz derleme için rootless Docker’ı ayarlar. [Debian](https://docs.docker.com/engine/install/debian/) veya [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) için resmî yönergelere bakın.
- **Nginx.** `sudo apt install nginx` ile kurun. Yeni APT kurulumları, hizmet Caddy, Apache veya Cloudflare ile yayımlansa bile Nginx’in kurulu olduğunu denetler.
- **Erişim ve TLS.** Kendi HTTPS’niz için ana makine adı, sertifika ve özel anahtar hazırlayıp yerleşik HTTPS’nin adresini ve portunu boş bırakın. Cloudflare için Tunnel, DNS ve Worker hazırlayın. [LAN’da HTTPS gereksinimlerine](#lan-内の自動-https) bakın.
- **Kimlik bilgileri**
  - OIDC için verenin URL’si, istemci kimliği ve sırrı ve ilk sahibin sabit `subject` değeri gerekir.
  - Cloudflare Access için Access uygulamasının bilgileri ve sahibin `subject` değeri gerekir.
  - Parola kullanırken sahibin giriş adını ve ilk parolasını hazırlayın.
- **Dışarı doğru bağlantı.** Sunucunun GitHub Releases ve Attestations, GHCR (`ghcr.io`), TeX Live arşivleri ve Debian veya Ubuntu paket depolarına HTTPS erişimi olmalıdır.
- **APT paketi.** Node.js içerir. [APT yönergelerine](/tr/docs/client/#debian-ubuntu-の-apt-パッケージ) bakın.

## Kurulumu doğrulama {#導入完了の確認}

1. Yapılandırdığınız HTTPS URL’sinde `/admin/` açıp kurulumda kaydedilen sahip olarak giriş yapın.
2. Aynı URL’de `/app/` açın, [örnek `main.tex` dosyasını](/tr/docs/#最短でpdfを作る) seçip **PDF’ye dönüştür** düğmesine basın.
3. Sonuç sayfasındaki PDF’yi açıp örnek metnin göründüğünü doğrulayın.

> [!DETAILS] Ek hizmet ve çıktı denetimleri
>
> Yöneticiler herkese açık URL üzerinden deneme dönüştürmesi yapabilir. Testin verdiği API anahtarı hemen ardından iptal edilir.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Normal bir kullanıcının girişini, herkese açık kılavuzları, TeX ortamında listelenen imaj ve dilleri, Japonca belge veya SVG gibi sık kullanılan çıktıları da denetleyebilirsiniz.

### Kullanıcı kaydetme ve anahtar verme {#利用者と-api-キーの発行}

`/admin/` üzerinde sahip olarak giriş yapabildiğinizde kullanıcıları kaydedin.

- **Web ve Remote MCP.** **Kullanıcılar** bölümünde kullanıcıyı oluşturun, seçilen giriş yöntemi için kimliğini kaydedin ve web uygulamasının URL’sini iletin.
- **CLI, Local MCP ve HTTP API.** Kullanıcıyla ilişkili bir hizmet hesabı oluşturun. **API anahtarları → API anahtarı ver** bölümünde `render:create` ve `render:read:own` kapsamlarıyla bir işleme anahtarı (`lrk_...` önekiyle) verip güvenli bir kanaldan iletin.

## Güncelleme ve geri alma {#更新とロールバック}

### Uygulamayı güncelleme {#アプリケーションを更新する}

- Sahip olarak **Yönetim → Güncellemeler** bölümünü açın. [Sunucuyu güncelleme veya önceki sürüme dönme](/tr/docs/updates/) bölümüne bakın.
- TeX Live sürümünü veya dilleri değiştirmek için **Yönetim → TeX ortamı** bölümünü açın. [TeX ortamını yapılandırma](#tex環境の初期設定) bölümüne bakın.

> [!DETAILS] 履歴資料　Geçiş ve özel kurtarma durumları
>
> ### v1.2.x root güncelleyiciden ayrıcalıkları ayrılmış güncelleyiciye geçme {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> [Güncelleyici geçiş yönergelerine](/tr/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合) bakın.
>
> ### GNU tar çıkarmayı Function not implemented ile durduruyor {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> [Çıkarma hatası işlemlerine](/tr/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合) bakın.
>
> ### Değişiklik kilidi kullanımda {#mutation-lockが使用中と表示される場合}
>
> [Kilidi tutan süreci belirleme](/tr/docs/reference/#mutation-lockが使用中と表示される場合) bölümüne bakın.

## Yedeklemeler {#バックアップ}

Düzenli yedekler, güncelleme öncesi noktalar, geri yükleme denemeleri ve kurtarma için [Yedek oluşturma, doğrulama ve geri yükleme](/tr/docs/backups/) bölümüne bakın. Geri yüklemeden sonra denetim dışa aktarım konumu uyuşmuyorsa [Denetim günlüklerini kurtarma](/tr/docs/reference/#監査ログの復旧) bölümüne bakın.

## Sorun giderme {#問題が起きた場合}

| Belirti | Önce denetlenecekler |
| --- | --- |
| `/app/` açılamıyor | DNS, TLS sertifikası, Tunnel veya vekil ayarları ve yerel hizmetlerin başlama sırası |
| Yalnızca yöneticiler giriş yapamıyor | Açıkça kayıtlı sahip kimliği veya kimlik bilgisi, `AUTH_MODE`, veren, hedef kitle ve roller |
| TeX imajı alınamıyor | `ghcr.io` için HTTPS erişimi, paket görünürlüğü ve etiket mimarisi |
| TeX değişikliği uzun sürüyor | İşlem kimliği ve hassas bilgiler ayıklanmış Image Manager günlükleri |
| Güncelleme reddediliyor | Sürümün değişmezliği, arşiv özeti, güncelleme yolu ve boş alan |
| Ana makine hazırlığı güvensiz yol nedeniyle duruyor | `/var/lib/latex-renderer` sahibinin `root:latex-renderer` ve kipinin `2770` olduğunu doğrulayın |
| Yalnızca güncellemeler ekranı çalışmıyor | Dağıtımda `client-dist/manifest.json` varlığı ve Admin Web durumu |
| Dönüştürme başlamıyor | Kuyruk durumu, en az 5 GiB boş alan, işçi hizmeti ve rootless Docker soketi |
| Güncellemenin hemen ardından sorun çıkıyor | Geri almaya karar vermeden önce yeni iş alımını durdurup önceki ve yeni uygulama/ortam sürümlerini denetleyin |

İşlem kimliğini, hatanın oluştuğu aşamayı ve paylaşılabilir hata kodunu kaydedin. [Sorun giderme](/tr/docs/troubleshooting/), [Hesap ve belge güvenliği](/tr/docs/security/) ve [Dağıtım ayarları ve yapılandırma dosyaları (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md) bölümlerine bakın.

## TeX ortamını değiştirme {#tex環境の初期設定}

İlk kurulum derleme ortamını hazırlar. Dil eklemek veya TeX Live sürümünü değiştirmek için **Yönetim → TeX ortamı** (`/admin/tex-environment/`) bölümünü açın. Şu örnek İngilizce ve Japoncayı destekler.

| Ayar | Önerilen değer |
| --- | --- |
| Image | `latest` (sabit tarihli etikette mimarinizle eşleşeni seçin) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (varsayılan olarak kapalı) |

- Genel GHCR paketinden yalnızca dilsiz **temel imaj** indirilir ve özetine göre sabitlenir. Sunucu seçilen diller ve güncel işleyici koduyla bir **çalışma zamanı imajı** oluşturur. Aynı yapılandırmaya sahip yerel imaj varsa yeniden kullanılır. Çalışma zamanı imajları dışarıya yayımlanmaz.
- Tarayıcıyı kapatsanız da derleme sürer. Sonrasında yönetim ekranında etkin ortamı ve dilleri denetleyin. İndirme başarısızsa `ghcr.io` için HTTPS erişimini ve mimari uyumluluğunu doğrulayın.

### Otomatik disk temizliği {#自動容量整理}

> [!DETAILS] Kullanılmayan imajları ve derleme önbelleğini temizleme
>
> Image Manager varsayılan olarak kullanılmayan yönetilen imajları 24 saatte bir temizler. Etkin temel imaj ve çalışma ortamını, geri alma için öncekileri ve yapılandırmada başvurulan imajları korur. Diğerleri oluşturulduktan 24 saat sonra silinebilir. Kullanılmayan derleme önbelleği için 2 GiB hedeflenir, tüm Docker’a sınır konmaz.
>
> Değerleri `/etc/latex-renderer/renderer.env` içinde ayarlayıp TeX güncellemesi yapılmıyorken `sudo systemctl restart latex-renderer-image-manager.service` ile uygulayın.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` temizliği kapatmak için `0` veya `1` ile `720` saat arasında bir aralık kabul eder. Başlangıçtan 5 dakika sonra başlayarak her 5 dakikada bir temizlik zamanının gelip gelmediği denetlenir. Ortak kilit güncellemeler ve dağıtımlar sırasında temizliği erteler. Web veya CLI’den elle temizlik, saklama süresini beklemeden korunmayan öğeleri kaldırır.
> - `RETENTION_HOURS` için `0` ile `8760` saat, `BUILD_CACHE_MAX_GIB` için `0` ile `1024` GiB kabul edilir.
> - `1.3.4-rc.2` sürümünden itibaren rootless Docker’ın Buildx meta verileri root derlemeleriyle izin çakışmasını önlemek için işçinin ev dizininde `.docker/buildx-worker` altına ayrılmıştır. Otomatik temizlik eski yapılandırma imajlarını ve elle kurtarma dizinlerini atlar. Öğeleri gereksiz olduklarını doğrulamadan tek tek silmeyin. Docker veri dizinini doğrudan silmeyin.

## Kurulum ve işletim ayrıcalıkları {#sudoと通常運用の境界}

İlk kurulum sistem kullanıcıları, dizinler, `systemd` birimleri, rootless Docker ve anahtar dosyalarını `sudo` ile hazırlar. **Normal işletimde yönetim web arayüzü ve API’ye `sudo` ayrıcalıkları verilmez.**

- **TeX değişiklikleri.** Sınırlı izinli bir Unix soketi üzerinden root’a ait Image Manager’dan istenir.
- **Güncellemeler.** Bir Unix soketi root olmayan Update Manager denetleyicisine bağlanır. Denetleyici sabit işlemleri kısa ömürlü root yardımcısına devreder.
- **Karşılıklı dışlama.** Ortak kilit TeX değişiklikleriyle güncellemeleri sıraya sokar. Web ve API’den root’a keyfî komut, yol veya URL gönderilemez.

## Yapılandırma ve sırlar {#設定と秘密情報}

Makineye özgü ayar ve sırlar uygulamanın ve Git çalışma ağacının dışında, örneğin `/etc/latex-renderer/` altında tutulur.

| Yol | İçerik | Önerilen kip |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Erişim profili, URL, sınırlar ve gizli olmayan IdP ayarları | `0640` |
| `/etc/latex-renderer/deployment.env` | Cloudflare profiline özgü kimlik ve belirteçler | `0600` |
| `/etc/latex-renderer/update-manager.env` | Root olmayan dağıtım hesabı | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Üretim Worker’ının bağlamaları ve yolları | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel giriş kuralları | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, bilet anahtarı ve yönetici hizmetlerinin kimlik bilgileri | Dosyaya göre |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC profilinin istemci sırrı | `0440` |

> [!WARNING]
> `.env` dosyalarını, Cloudflare belirteçlerini, Tunnel kimlik bilgilerini, API anahtarlarını, SQLite veritabanlarını, gerçek belgeleri, PDF’leri veya ayıklanmamış günlükleri Git’e eklemeyin, hata kayıtlarına ve destek isteklerine yapıştırmayın. Depodaki `*.example` dosyaları alanları gösteren şablonlardır.

## Tar arşivinden elle kurulum ve eski sürümler {#手動配置-旧版向けの構築手順-tarball-導入}

APT ve `sudo n624-latex server setup` kullanıldığında sihirbaz arşiv çıkarma, ana makine hazırlığı ve sahip kaydını yürütür veya yönlendirir. `v1.7.1` dağıtımını elle yapıyorsanız ya da erişim sınırlarını veya kimlik doğrulama değişikliğini inceleyecekseniz aşağıdaki bölümü açın.

> [!DETAILS] v1.7.1 ile indirme, doğrulama, dağıtma ve sahip kaydı
>
> Yeni elle kurulumda kararlı [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) sürümünün `latex-renderer-server-1.7.1.tar.gz` arşivini kullanın. Yayımlanınca etiket ve dosyalar değişmez. Geliştirme dalı `main` üzerinden doğrudan dağıtım ve TeX’in yerel `docker build` işlemi desteklenen işletim kapsamında değildir.
>
> ### v1.7.1 sürümünü indirip doğrulama {#v1-6-9をダウンロードして検証}
>
> `curl`, `jq`, `tar`, `sha256sum` ve `gh attestation verify` destekleyen GitHub CLI hazırlayın. Node.js ve Corepack daha sonra ana makine hazırlanırken kurulur.
>
> Normal kullanıcı olarak aşağıdakileri aynı Bash oturumunda çalıştırın. GitHub Releases SHA-256 değeri ve GitHub Actions kaynak imzası doğrulanır. Kaynak doğrulama verileri GitHub hesabı veya belirteci gerekmeden genel API’den `gh` aracına iletilir. Bir adım başarısız olursa `bundle_root` tanımsız kalır. Nedeni düzeltip yeniden deneyin.
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
> ### Ana makineyi hazırlama {#ホストを準備}
>
> Depolama izinleri için `setfacl`, kısıtlı güncelleyicide arşiv çıkarma için `bsdtar` ve ZIP denetimi için `unzip` kurun. Node.js 26 veya 24 (`/usr/local/bin/node` ve `/usr/local/bin/corepack`) ve rootless Docker araçlarını resmî yönergelerle kurun. `cloudflare` için ayrıca `cloudflared` kurun. Update Manager dağıtım kullanıcısı için belirtilen pnpm sürümünü Corepack ile kurar ve doğrular.
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
> Her zamanki dağıtım hesabından ana makineyi ilklendirin ve `latex-render-worker` için rootless Docker’ı ayarlayın.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Ana makineye özgü yapılandırmayı oluşturma {#ホスト固有設定を作成}
>
> Tüm profillerde `renderer.env` oluşturup `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` ve `AUTH_MODE` ayarlayın. `ADMIN_ALLOWED_ORIGINS` gibi bir takma ad yoktur. Tarayıcı işlemlerinde izin verilen kaynak `PUBLIC_ORIGIN` ile tam eşleşmelidir.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **`cloudflare` profili.** `example.com`, `REPLACE_*`, tüm UUID’ler ve Access hedef kitlesini kurulum değerlerinizle değiştirin. Uzaktan yönetilen Tunnel için yerel `config.yml` dosyasını atlayın ve önce bağlayıcının etkin olduğunu doğrulayın.
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
> - **`standalone` profili.** Nginx, Caddy veya Apache kurun, `deploy/reverse-proxy/` içinden bir örnek kopyalayın ve tam alan adıyla sertifika yollarını belirtin. Vekil gelen `CF-Access-*` üstbilgilerini kaldırır ve istemci IP’sini yeniden yazar. 3100–3105 portlarındaki yerel hizmetleri doğrudan dışarıya açmayın.
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
> - **`AUTH_MODE=oidc` kullanırken.** `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` adresini IdP’ye kaydedin. `renderer.env` içinde `OIDC_ISSUER` ve `OIDC_CLIENT_ID` değerlerini ayarlayıp sırrı sonunda satır sonu olmayan ayrı bir dosyada tutun.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Hizmetleri dağıtma {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - İlk başlatma yayımlanan değişmez arşivi yeniden indirip doğrular, root denetim ağacını ayrıcalıksız derleme ağacından ayırır, `client-dist` oluşturup `/opt/latex-renderer/releases/$release_id` altına dağıtır. Veritabanı veya `current` bulunan makineleri reddeder. Kurulumdan sonra normal güncelleme yolunu kullanın.
> - Dağıtımdan önce `renderer.env` (root’a ait, `0640` kipinde, yinelenen anahtarsız), `PUBLIC_ORIGIN`, kimlik doğrulama ayarları ile pepper ve sırların sahiplik, izin ve uzunluklarını değerleri göstermeden denetleyin.
> - Güncelleyici `/opt/latex-renderer/updater` altında ayrı tutulur. Bu düzen depodaki `docs/independent-updater.md` dosyasında açıklanır. Yalnızca dağıtım kullanıcısının birincil grubu `/opt/latex-renderer/update-staging` üzerinden geçebilir. Her hazırlık alanı `0700` ile yalıtılır ve bittiğinde ya da kesildiyse 24 saat geçtikten sonraki bir başlangıçta temizlenir.
>
> ### Herkese açık erişim sınırları {#公開境界}
>
> - **`cloudflare-access`.** `/auth/*`, `/app/`, `/admin/` ve `/oauth/authorize` yollarını insan kullanıcılar için aynı Access uygulamasıyla koruyup hedef kitleyi kaynak sunucuda da doğrulayın. Cloudflare ile OIDC veya parola kullanırken Access’in `/auth/*` yolunu engellemediğini doğrulayın. Belgeler ve indirmeler herkese açıktır. Worker Routes yalnızca işleme API’sinin genel bölümünü sunar. Tunnel girişinde önce özel API ve yönetim yollarını, sonra varsayılan web yolunu, en son `http_status:404` kuralını koyun.
> - **`standalone`.** Bir TLS ters vekili yolu temel alarak istekleri yerel hizmetlere dağıtır. Standalone Gateway’in 3105 portuna yalnızca küçük JSON bilet işlemleri gider. Nginx örneği parola girişleri ve bilet API’si için bağlantı ve istek sıklığını sınırlar. Eklentisiz Caddy ve Apache’de istemci başına eşdeğer sınır bulunmadığından bunu yük dengeleyicide veya sağlayıcıda uygulamak zorunludur. `/internal/*`, veritabanı ve yönetim soketlerini özel tutun.
>
> ### İlk sahip {#最初のowner}
>
> Dış kimlik `provider + issuer + subject`, parola kimliği `login name` üzerinden belirlenir. E-posta yalnızca gösterilir. E-postası eşleşen hesaplar bağlanmaz, giriş sırasında otomatik hesap açılmaz. Seçtiğiniz yöntemin adımlarını bir kez uygulayın.
>
> **Cloudflare Access veya OIDC**
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
> **Yerel parola (`owner` adlı kullanıcı örneği)**
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
> ### AUTH_MODE değerini daha sonra değiştirme {#後からauth-modeを変更する場合}
>
> [Sunucu sihirbazı](/tr/docs/server-setup/) kullanılamadığında bu işlemi izleyin.
> Şifrelenmiş yedek alıp yönetim API’sini durdurun. Yönetimden veya `users list` ile aldığınız değişmez kimlikle (`user_...` biçimi) yeni kimlik doğrulama yöntemini ekleyin. Mevcut kimlik bilgisinin üzerine yazılması reddedilir ve mevcut oturumlar iptal edilir. Ardından `renderer.env` değiştirip API ile web’i yeniden başlatın. Yeni girişi gizli pencerede doğrulayana kadar eski kimlik bilgilerini saklayın.
>
> Önce aşağıdaki hazırlığı ve ardından yalnızca hedef yöntemin komutlarını çalıştırın.
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
> **OIDC veya Cloudflare Access’e geçmek için** `oidc` veya `cloudflare-access` girin.
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
> **Parolaya geçmek için** parolayı gizli alana girin.
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
