---
slug: client
category: Kurulum
title: CLI kurulumu
description: CLI’yi Windows, macOS veya Linux’a kurun ve terminalden ilk PDF’nizi oluşturun.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Desteklenen platformlar {#対応環境}

CLI’yi sisteminize uygun yöntemle kurun ve yöneticiden aldığınız API anahtarını (`lrk_...`) kaydedin. LaTeX belgelerini sunucu derler.

| Platform | Yöntem | Node.js |
| --- | --- | --- |
| Debian 12 / 13 veya Ubuntu 24.04 / 26.04 (amd64 ya da arm64) | **[APT paketi](#debian-ubuntu-の-apt-パッケージ)** | Pakete dahil |
| Windows | **[Windows yönergeleri](/tr/docs/windows/)** | 24 veya üzeri |
| macOS (Apple Silicon veya Intel) | **[Homebrew](#homebrew-でインストール)** | Homebrew kurar |
| macOS veya diğer Linux dağıtımları | **[İndirilebilir yükleyici](#linux-macos)** | 24 veya üzeri |

## Debian veya Ubuntu’da APT ile kurma {#debian-ubuntu-の-apt-パッケージ}

1. [`n624-latex.sources` dosyasını indirin](https://apt.n624.jp/latex-renderer/n624-latex.sources). Dosya LaTeX Renderer APT deposunun açık imza anahtarını içerir.
2. Dosyayı kaydettiğiniz klasörde paketi kurmak için şu komutları çalıştırın.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. [İlk PDF’nizi oluşturun](#最初の-pdf-を作る) bölümüne geçin. Sunucu kurmak istiyorsanız [kendi sunucunuzda barındırma yönergelerini](/tr/docs/self-hosting/) izleyin.

## Homebrew ile kurma {#homebrew-でインストール}

Homebrew kurulu bir Mac’te şu komutları çalıştırın.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

API anahtarını kaydettikten sonra [İlk PDF’nizi oluşturun](#最初の-pdf-を作る) bölümüne geçin.

### İndirilebilir yükleyiciden Homebrew’a geçme {#配布インストーラー版から-homebrew-へ移行する}

API anahtarını ve MCP yapılandırmasını koruyabilirsiniz. Kabuğun önce hangi komutu bulduğunu `type -a n624-latex` ile denetleyin. Eski kurulum önce geliyorsa Homebrew sürümünü doğrudan çalıştırın.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

`n624-latex` komutunun Homebrew sürümünü kullanması için kabuğun `PATH` değişkeninde Homebrew’un `bin` dizinini eski kurulumun önüne alın.

Local MCP’yi de değiştirmek istiyorsanız yapay zekâ aracındaki `latex-renderer` kaydının komutunu Homebrew’un sağladığı `bin/latex-renderer-mcp` dosyasının mutlak yoluna ayarlayın. Kurulumu bulmak için `brew --prefix` kullanın.

Eski sürümü kaldırmadan önce yapay zekâ aracını yeniden başlatıp Homebrew Local MCP bağlantısını denetleyin. Kaldırma işleminde eski başlatıcının mutlak yolunu belirtin ve anahtar ile becerileri koruyun. Varsayılan konuma kurulmuşsa şu komutu çalıştırın.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## İndirilebilir yükleyiciyi hazırlama {#配布インストーラーの準備}

Normal kullanıcı hesabınız için **Node.js 24 veya üzerini** kurup sürümü `node --version` ile denetleyin. Windows’ta [Windows yönergelerini](/tr/docs/windows/) izleyin.

## Linux ve macOS {#linux-macos}

Terminalde yükleyiciyi geçici bir klasöre indirip Node.js ile çalıştırın.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

`n624-latex` bulunamazsa yeni bir terminal açın. Sorun sürerse `export PATH="$HOME/.local/bin:$PATH"` çalıştırın ve aynı satırı kabuğun ayar dosyasına, örneğin `~/.bashrc` veya `~/.zshrc` dosyasına ekleyin.

## İlk PDF’nizi oluşturun {#最初の-pdf-を作る}

1. Ayarları normal kullanıcı hesabınızla açın ve API anahtarını kaydedin. Kendi sunucunuzu kullanıyorsanız [önce sunucuyu belirtin](/tr/docs/cli/#接続先サーバー). Tarayıcı açamıyorsanız [anahtarı standart girdiden kaydedin](/tr/docs/cli/#認証).

```sh
n624-latex setup
```

2. `main.tex` dosyasının bulunduğu klasörde şu komutu çalıştırın. [Örnek belgeyi](/tr/docs/#最短でpdfを作る) kullanabilirsiniz.

```sh
n624-latex main.tex
```

Aynı klasörde `main.pdf` oluşturulur. Hedef seçmek veya ZIP, PDF ve SVG ile çalışmak için [CLI ile dönüştürme ve indirme](/tr/docs/cli/#レンダリング) bölümüne bakın.

## Windows {#windows}

[Windows yönergeleri](/tr/docs/windows/) PowerShell kullanır. Windows DPAPI kayıtlı anahtarı geçerli kullanıcı için şifreler. [Kurulum konumunu değiştirme ve PATH’i onarma](/tr/docs/reference/#windowsの配置と保護) bölümüne bakın.

## Güncellemeler {#更新}

### APT paketini güncelleme {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Kayıtlı bağlantı ve API anahtarı korunur. Barındırdığınız sunucuyu güncellemek için [yönetimdeki güncellemeler ekranını](/tr/docs/updates/) kullanın.

### Homebrew paketini güncelleme {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### İndirilebilir yükleyici ile kurulan istemciyi güncelleme {#配布インストーラー版の更新}

Şu komutu çalıştırın veya ilk kurulum komutunu yeniden çalıştırın.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　v1.6.9 veya daha eski istemcileri güncelleme
>
> Yalnızca `latex-render` kuruluysa kurulumu tekrarlayın. [Windows’ta kayıtlı anahtarı yeniden girmeden güncelleyebilirsiniz](/tr/docs/windows/#更新). macOS ve Linux’ta `latex-render setup` ile güncelleyip `latex-render setup repair` ile yeni komutu ekleyebilirsiniz. Mevcut betikler `latex-render` kullanmaya devam edebilir.

> [!DETAILS] Kurulum ve güncellemelerin işleyişi
>
> - İndirilebilir ZIP’in SHA-256 değeri kurulu sürümle eşleşiyorsa yükleyici dosyaları yeniden kurmadan yönetilen ayarları denetler.
> - Güncelleme sırasında eski sürüm tarih ve saat içeren bir yedeğe taşınır. Diğer başlatıcılar, MCP kayıtları ve kullanıcının değiştirdiği beceriler korunur.

## Kurulumu denetleme ve onarma {#状態確認と修復}

Bu komutlar tüm kurulum yöntemlerinde durumu denetler.

```sh
n624-latex setup status
n624-latex doctor --json
```

- APT için paketi `sudo apt install --reinstall n624-latex` ile yeniden kurun.
- Homebrew için paketi `brew reinstall n624-dev/tap/n624-latex` ile yeniden kurun.
- İndirilebilir yükleyici için yönetilen başlatıcıları ve entegrasyonları `n624-latex setup repair` ile onarın.

## Çıktı dosyalarını kaydetme ve kurtarma {#成果物の保存と復旧}

`n624-latex main.tex` PDF’yi geçerli klasöre kaydeder. `render` ve `jobs download` ile kaydedilen PDF, günlük ve görüntüler için [CLI çıktı dosyalarına](/tr/docs/cli/#成果物) bakın. Hedef kullanımdaysa [Sorun giderme](/tr/docs/troubleshooting/#成果物の取得) bölümüne bakın.

## Kaldırma {#アンインストール}

APT paketini `sudo apt remove n624-latex` ile kaldırın. Kullanıcının anahtarını da kaldırmak için önce `n624-latex auth logout` çalıştırın.

Homebrew paketini `brew uninstall n624-dev/tap/n624-latex` ile kaldırın. Kayıtlı anahtar ve yapay zekâ aracınızın MCP ayarları korunur. Bunlara ihtiyacınız kalmadıysa kaldırmadan önce oturumu kapatın ve yapay zekâ aracında MCP yapılandırmasını silin.

İndirilebilir yükleyici için şu komutu çalıştırın.

```sh
n624-latex setup remove --yes
```

Kimlik bilgilerini veya becerileri korumak için sırasıyla `--keep-credential` veya `--keep-skills` ekleyin. Windows betiğiyle kaldırma için [Windows yönergelerine](/tr/docs/windows/#アンインストール) bakın.
