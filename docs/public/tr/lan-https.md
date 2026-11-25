---
slug: lan-https
category: Kendi sunucunuzda barındırma
title: Akebi ile LAN’da HTTPS kullanma
description: Yerel IP adresinden türetilen HTTPS URL’siyle sunucuya erişin.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## LAN IP adresi üzerinden erişme {#lan-の-ip-アドレスからアクセスする}

Akebi sunucunun özel IP adresini HTTPS üzerinden erişilebilen bir ana makine adına dönüştürür.

LaTeX Renderer sihirbazında paylaşılan sertifika hizmetini yapılandırın. Kendi hizmetinizi sunmak için [Akebi sertifika hizmetini yönetme](/tr/docs/lan-https-authority/) bölümüne bakın.

- **IPv4 örneği.** IP `192.168.1.50` ve LAN alan adı `lan.example.org` ise URL `https://192-168-1-50.lan.example.org` olur.
- **IPv6.** Ad, desteklenen özel adresin genişletilmiş sekiz grubunu içerir. Kurulumun gösterdiği URL’yi olduğu gibi kullanın.

**Ağ ve DNS gereksinimleri**
İstemci sunucunun LAN’ına erişebilmelidir. Ad çözümlenmiyorsa yönlendiricinin veya DNS çözümleyicinin **DNS rebinding koruması** kapsamında özel IP içeren yanıtları engelleyip engellemediğini kontrol edin. Gerekirse yalnızca kullanılan LAN alan adı için istisna ekleyin.

## Sertifika türünü seçme {#証明書の方式を選ぶ}

| Yöntem | Gereksinimler ve özellikler |
| --- | --- |
| **Paylaşılan hizmet, genel sertifika yetkilisi (CA)** | Paylaşılan hizmeti yapılandırıp CA koşullarını kabul edin. Sertifikanın özel anahtarı sunucuda kalır. |
| **Özel hizmet, genel CA** | [Kendi Akebi hizmetinizin](/tr/docs/lan-https-authority/) URL’si ve LAN alan adı, gerekiyorsa davet kodu. |
| **Keyless** | TLS el sıkışması sırasında imzalamanın devredildiği uyumlu bir hizmet gerekir. |
| **Mevcut sertifika veya özel CA** | Sunucu adıyla eşleşen sertifika ve özel anahtarı. Özel CA kullanıyorsanız sunucu ve tüm istemcilerde kök sertifikaya güveni yapılandırın. |

> [!NOTE]
> - Genel CA kullanıldığında verilen sertifikalardaki ana makine adları **herkese açık sertifika şeffaflığı (CT) günlüklerinde** görünür.
> - Farklı konumlardaki iki LAN aynı özel IP’yi ve LAN alan adını kullanıyorsa tarayıcı bunları **aynı kaynak** olarak görür. Çerezleri ve depolanan diğer verileri paylaşırlar.

## LAN erişimini yapılandırma {#lan-向けに設定する}

1. Yeni kurulumda [sunucuyu hazırlayın](/tr/docs/self-hosting/#準備するもの) ve `sudo n624-latex server setup --web` ile [sihirbazı](/tr/docs/server-setup/#ブラウザで開く) açın. Yönetilen ayrılmış HTTPS kullanan bir sunucuyu değiştirmek için `sudo n624-latex server setup --ingress --web` kullanın.
2. Erişim yolu olarak **LAN** seçip ağ arabirimini, özel IP’yi, izin verilen istemci alt ağlarını ve HTTPS portunu belirtin.
3. Sertifika hizmeti ve yöntemini seçin. Paylaşılan hizmette `https://akebi.n624.net` URL’si ve `lan.n624.net` LAN alan adı ayarlanır, değişiklikler uygulanırken sunucu kaydedilir. Davet gerekmez. Genel CA kullanıyorsanız koşullarını inceleyip kabul edin. Kendi davetli hizmetinizde yöneticinin kodunu girin.
4. Uygulamadan önce oluşturulan HTTPS URL’sini ve izin verilen alt ağları denetleyin. Uygulamada parola veya OIDC ile kimlik doğrulama yürürlükte kalır.
5. İzin verilen bir alt ağdaki başka bir cihazdan URL’yi açın, sertifika uyarısı olmadığını doğrulayın, giriş yapıp bir deneme belgesi dönüştürün.

Kendi hizmetinizi kurmak için [Akebi sertifika hizmetini yönetme](/tr/docs/lan-https-authority/) bölümüne bakın.

## Sertifika durumunu denetleme {#証明書の状態を確認する}

Hizmeti, yenileme zamanlayıcısını ve ilgili ad alanının günlüklerini görmek için şu komutları kullanın.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Verme veya yenileme başarısız olursa sunucu saatini, hizmete HTTPS bağlantısını, alan adını, IP’yi ve CA’nın belirttiği yeniden deneme zamanını doğrulayın. Geçici hata, geçerli sertifikayı korur. Zamanlayıcı kayıtlı durumdan işleme devam eder. Anahtar ve durum eşleşmiyorsa aynı nesilden korunmuş durum dosyalarını kontrol edin.

[Akebi tasarımı ve sorun giderme](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md) bölümüne bakın.
