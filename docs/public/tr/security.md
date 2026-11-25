---
slug: security
category: Sorun giderme ve güvenlik
title: Hesap ve belge güvenliği
description: Kimlik bilgilerini ve yüklenen dosyaları koruyun, işleyici ile yönetim arayüzünün erişim sınırlarını öğrenin.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- API anahtarı açığa çıkarsa yöneticiden anahtarı derhal iptal etmesini ve yenisini vermesini isteyin.
- Güvenlik açıklarını [GitHub’ın özel bildirim formuyla](https://github.com/n624-dev/latex-renderer/security/advisories/new) bildirin. Ayrıntıları herkese açık bir sorun kaydında yayımlamayın.

## Kimlik bilgileri {#資格情報}

- API anahtarlarını komut satırı argümanlarına (`ps` gibi araçlarla görülebilir), URL’lere, Git depolarına, günlüklere veya yapay zekâ sohbetlerine eklemeyin.
- Yerel depolamada Windows’ta DPAPI, Linux ve macOS’ta yalnızca sahibinin okuyabildiği `0600` kipinde bir dosya kullanın.
- Tarayıcı parolalarını, OIDC sırlarını ve oturum çerezlerini yalnızca amaçları doğrultusunda kullanın. CLI ve API anahtarlarını (`lrk_` ve `lra_`) ayrı tutun.

## Projeler {#プロジェクト}

Tüm LaTeX kaynakları ve ekler güvenilmeyen girdi olarak değerlendirilir. Sembolik bağlantılar, TeX’ten kabuk erişimi, dış komut yürütme ve kapsayıcı dışına ağ bağlantıları devre dışıdır. Yalıtıma, zaman aşımlarına ve dosya sınırlarına uyun.

## Herkese açık alanlar ve yönetim {#公開領域と管理領域}

Herkese açık belgeler ve indirmeler, kimlik doğrulamalı sayfalar (`/app/` ve `/admin/`) ve işleme API’si tek bir asıl HTTPS kaynağında farklı yollar kullanır.

- **Ağ sınırı.** Cloudflare profilinin tek giriş noktası Tunnel/Workers, standalone profilininki ise TLS ters vekilidir. Tüm uygulama hizmetleri geri döngü arabirimini dinler. Dahili API, SQLite ve yönetim soketleri özel kalır. Kimlik doğrulamalı alanlar arama motoru dizinlerinden çıkarılır.
- **Tarayıcıda kimlik doğrulama ve oturumlar.** Dış IdP üzerinden kimlik tespiti için `provider + issuer + subject` tam eşleşmelidir. E-posta ve görünen ad hesapları otomatik bağlamaz. Sunucu oturumu hemen iptal edebilir. Durumu değiştiren isteklerde `Origin` tam eşleşmeli ve oturuma özgü CSRF belirteci bulunmalıdır. Parolalar `scrypt` ve root kullanıcısına ait ek bir sırla (pepper) korunur. Herkese açık kurulumlarda vekilde bağlantı ve hız sınırları, sağlayıcıda da DDoS koruması uygulayın.
- **Remote MCP.** `/mcp`, OAuth belirteç uç noktası ve keşif meta verileri herkese açıktır. Araç çalıştırmak için hedef kitlesi ve kapsamı sınırlandırılmış kısa ömürlü Bearer belirteci gerekir. Yetkilendirme `/app/` tarayıcı oturumunu kullanır ve erişimi mevcut, etkin bir kullanıcıya açıkça bağlar.
  - Standart yanıt (`content`) yalnızca sahibine göre sınırlandırılmış kimlikleri, durumları, imleçleri ve devam etmek için gereken sınırlı tanılama bilgilerini içerir. Kullanıcıdan gelen yollar ve tanılama bilgileri, denetim karakterlerinden arındırılmış, uzunluğu ve sayısı sınırlı güvenilmeyen veriler olarak döner.
  - Standart `content` içeriği ve tanılama günlükleri OAuth belirteçleri, API anahtarları, biletler, ham base64, tam kaynaklar, tam günlükler, yığın izleri, Access subject kimlikleri ve dahili sunucu yollarını içermez. Tam PDF’ler ve günlükler yalnızca sahipliği yeniden denetleyen kaynak okumalarıyla alınabilir.

## Yerel web yapılandırma arayüzü {#local-setup-web-ui}

`n624-latex setup --gui` (eski adı `latex-render setup --gui`) yerel bilgisayarda yalnızca `127.0.0.1` üzerindeki rastgele bir bağlantı noktasını dinler.

- CLI’nin açtığı URL’nin parçası (`#...`), tek kullanımlık başlangıç belirteci içerir. Tarayıcı bunu hemen geçmişten siler ve kısa ömürlü bir oturumla değiştirir.
- Tüm API işlemleri için `Origin` tam eşleşmesi, Bearer oturumu ve ayrı bir CSRF belirteci gerekir. CORS kapalıdır, Host ve istemcinin geri döngü adresi doğrulanır, katı bir CSP ile `frame-ancestors 'none'` ve `no-store` uygulanır.
- Girilen anahtar yalnızca kaydetme işlemine aktarılır. Durum, tanılama ve deneme dönüştürmesi yanıtlarına eklenmez. Arayüz 30 dakika işlem yapılmadığında veya başlangıçtan 2 saat sonra kapanır.
