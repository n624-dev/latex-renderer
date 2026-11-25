---
slug: server-setup
category: Kendi sunucunuzda barındırma
title: Sunucu kurulum sihirbazı
description: Hazırlanmış sunucuda kimlik doğrulamayı, HTTPS’yi ve çalıştırma sınırlarını tarayıcıdan veya terminalden ayarlayın.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Yöntem seçimi {#どの手順を使うか}

Yeni bir kurulum için [sunucuyu hazırlayın](/tr/docs/self-hosting/#準備するもの) ve sihirbazı bir **tarayıcıda** açın. Mevcut kurulumda aynı sihirbazla oturum açma yöntemini ve çalıştırma sınırlarını değiştirebilirsiniz.

- Gerekli paketleri ve boş alanı denetlemek için sunucuda `sudo n624-latex server setup --plan` çalıştırın. Bildirilen eksikleri giderip denetimi tekrarlayın.
- Ayrılmış HTTPS veya LAN’da HTTPS (Akebi) kullanan mevcut kurulumu değiştirirken başlatma komutuna `--ingress` ekleyin.
- Asgari kurulumlu bir makinede Docker eksik çekirdek modülleri bildirirse yönergeleri izleyip yeniden deneyin. Örneğin `nf_tables` gerekiyorsa bir yönetici `sudo modprobe nf_tables` çalıştırmalıdır.

## Tarayıcıda açma {#ブラウザで開く}

Root olmayan dağıtım hesabıyla SSH üzerinden bağlanıp aşağıdaki komutu çalıştırın. **Kurulum bitene kadar terminali açık tutun.**

```sh
sudo n624-latex server setup --web
```

1. İlk kurulumda hazırlık işlemlerini inceleyip devam etmek için `PREPARE` yazın. İmzalı sürümün indirilmesini, hizmetlerin hazırlanmasını ve ilk TeX ortamının oluşturulup doğrulanmasını bekleyin.
2. Terminalde tek kullanımlık URL’yi bulun. **5 dakika** geçerlidir.
3. Sunucuda açın veya bilgisayarınızdan aynı bağlantı noktasına ulaşmak için **SSH port yönlendirmesi** kullanın. Gösterilen port `41234` ise şu komutu ayrı bir yerel terminalde çalıştırın ve sihirbazın verdiği URL’yi tarayıcıda açın.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Kurulum URL’sini paylaşmayın, portunu internete veya bir ters vekile açmayın.

## Ayarları inceleme ve uygulama {#プレビューから適用まで}

1. **Erişim ve oturum açma yöntemini seçin.** Yeni kurulumda HTTPS’yi ve ilk sahibi ayarlayın. Parolaları ve OIDC istemci sırlarını bunlara ayrılmış gizli alanlara girin.
2. **Önizlemeyi inceleyin.** Herkese açık URL’yi ve giriş yöntemini doğrulayın. Yöntemi değiştirirken hâlâ giriş yapabiliyorken yeni yöntem için sahip kimliğini hazırlayın.
3. **Değişiklikleri uygulayın.** Hizmetlerin başlamasını veya yeniden başlatılmasını bekleyin.
4. **Giriş yapıp PDF oluşturun.** [Kurulumu doğrulamak](/tr/docs/self-hosting/#導入完了の確認) için başka bir tarayıcı penceresi kullanın.

Yeni kurulumda hem parola hem OIDC etkinse önce sahibi parolayla kaydedin ve OIDC’nin `issuer` ile `subject` değerlerini o hesaba ekleyin. Çalıştırma sınırlarında başlatma eşiği iş başlamadan önce gereken boş RAM’i, çalışma sırasındaki sınır ise kapsayıcının kullanabileceği RAM’i gösterir.

## Kesilen bir değişikliği inceleme {#中断した変更を確認する}

- Değişiklikler uygulanmaya başladıktan sonra bağlantı kesilirse önce aynı işlemin sonucunu kontrol edin.
- Sihirbaz süreci sona erdiyse aynı hedef için yeniden başlatıp web’de **Recover**, terminalde **`RECOVER`** seçin. Bir sahip zaten kayıtlıysa sihirbaz bu kaydı kullanıp onaya kadar ilerler. Bu yapılandırma kurtarma işlemi eski bir veritabanı yedeğini geri yüklemez.
- Kurtarma dosyaları TLS veya OIDC sırları içerebilir. Bunları elle düzenlemeyin. Yardım isterken yalnızca gösterilen hata kodunu ve aşamayı paylaşın.

## Terminalde açma {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Mevcut sunucuyu değiştirirken ayarı girin veya mevcut değeri korumak için alanı boş bırakıp Enter’a basın. İlk kurulumda LAN’da otomatik HTTPS için `LAN` seçip yönergeleri izleyin. Terminalden ilk kez kendi HTTPS’nizi veya mevcut bir Cloudflare yolunu ayarlıyorsanız gösterilen biçimdeki JSON’u tek satırda girin. İlk kez yapıyorsanız [tarayıcıdan başlayın](#ブラウザで開く).

### Eski sürümler ve elle kurulum {#旧版-手動配置の場合}

> [!DETAILS] server-setup.mjs dosyasını doğrudan çalıştırma
>
> Sunucuyu APT olmadan ayrı kullanıcı, Node.js ve rootless Docker ile hazırlayıp doğrulanmış bir sürümü `/opt/latex-renderer/current` altına yerleştirdiyseniz doğrudan `server-setup.mjs` çağırın. Yeni bir makineyi hazırlamak için [elle kurulum yönergelerine](/tr/docs/self-hosting/#現在の提供状況) bakın.
>
> | Görev | Başlatma argümanı | Koşullar |
> | --- | --- | --- |
> | Mevcut kimlik doğrulamayı veya sınırları değiştirme | `--existing` | Sahip kayıtlı ve hizmetler çalışıyor |
> | Yapılandırma ve ilk sahibi kaydetme | `--initial` | Dağıtım ve ortam hazır, önceki işletim yapılandırması veya veritabanı yok |
> | Yönetilen ayrılmış HTTPS’yi değiştirme | `--ingress` | Ayrılmış standalone HTTPS. Paylaşılan Nginx’ten geçiş ayrı bir işlemdir. |
>
> - **Terminal arayüzü**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Tarayıcı arayüzü**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

[Sihirbazın girdi ve kurtarma belirtimine](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md) bakın.
