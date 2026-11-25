---
slug: lan-https-authority
category: Kendi sunucunuzda barındırma
title: Akebi sertifika hizmetini yönetme
description: LAN alan adının DNS yetki devrini, sertifika vermeyi ve açık ya da davetli kaydı yapılandırın.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Bu kılavuz kendi sertifika hizmetini işleten yöneticiler içindir. LaTeX Renderer ile paylaşılan hizmeti kullanmak için [Akebi ile LAN’da HTTPS kullanma](/tr/docs/lan-https/) bölümüne bakın.

Yetkisini devredebileceğiniz bir DNS bölgesi, genel DNS ve HTTPS sunabilen bir Linux makinesi (amd64 veya arm64), Node.js 24 veya 26 ve sertifika yetkilinizde (CA) bir hesap hazırlayın. [Elle indirme işlemiyle](/tr/docs/self-hosting/#v1-6-9をダウンロードして検証) imzasını doğruladığınız sunucu dağıtımını kullanın.

## DNS yetkisini devretme {#dns-を委任する}

Üst alanın DNS bölgesinde şu kayıtları ayarlayın. Akebi DNS sunucusuna internetten **hem UDP hem TCP ile 53. porttan** erişilebilmelidir.

| Tür | Ad | Değer |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebi DNS sunucusunun genel IPv4 adresi |
| `A` | `akebi.example.org` | Akebi API HTTPS ters vekilinin genel IPv4 adresi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- `ns1.example.org` adını DNS’e ayırın ve API ana makinesini (`akebi.example.org`) LAN sertifika bölgesinin (`lan.example.org`) dışında tutun.
- Yetki devrinden sonra Akebi, LAN IP’lerinden türetilen `A` ve `AAAA` kayıtları ile ACME doğrulaması için `TXT` kayıtlarına dinamik yanıt verir. Üst bölgede her IP için ayrı kayıt gerekmez.

## Hizmeti dağıtma {#サービスを配置する}

1. **Kullanıcı ve durum dizinlerini oluşturun.** Uygulama izinlerini `latex-renderer-lan-authority` adında ayrı bir kullanıcı ve grupla ayırın. `/var/lib/latex-renderer-lan-authority` dizinini ve altındaki `keyless` dizinini bu sahiplikle, ikisini de `0700` kipinde oluşturun.
2. **Yapılandırma dizinini hazırlayın.** `/etc/latex-renderer-lan-authority` dizinini `root:latex-renderer-lan-authority` sahip ve grubuyla, `0750` kipinde oluşturun. Doğrulanmış dağıtımdaki `deploy/lan-https/examples/authority.json` dosyasını buraya kopyalayın ve `root:latex-renderer-lan-authority` sahipliğiyle `0640` kipini ayarlayın.
3. **`authority.json` dosyasını düzenleyin.**
   - `policy.serverOrigin` API’nin HTTPS URL’sini belirtir; örneğin `https://akebi.example.org`.
   - `policy.lanDomain` yetkisi devredilmiş LAN alan adını belirtir; örneğin `lan.example.org`.
   - `dns.nameserver` ile `dns.listeners` genel DNS ana makinesini ve dinleme adreslerini belirtir. Başka bir DNS 53. portu kullanıyorsa çakışmayacak bir genel IP seçin.
   - `http` değerini geri döngü arabirimine bağlayın.
   - Genel CA’yı `issuers` içinde yapılandırın. External Account Binding (EAB) gerekiyorsa `eabFile` dosyası hizmet kullanıcısına ait ve `0600` kipinde olacak şekilde `kid` ile `hmacKey` değerlerini burada saklayın. Alan adı CAA kayıtları kullanıyorsa seçtiğiniz CA’ya izin verin.
4. **Kodu ve systemd birimini kurun.** Örnekte doğrulanmış kaynaklar root’a aittir ve `/path/to/verified-release` altındadır.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Durumu ilklendirip hizmeti başlatın.** `init` komutunu yalnızca ilk seferde çalıştırın.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS sertifikasını alma {#https-証明書を用意する}

API’yi yayımlayan Nginx örneği `deploy/lan-https/examples/authority.nginx.conf` içindedir ve istekleri yerel arabirimdeki API’ye iletir. Nginx’te TLS’yi açmadan önce API sertifikasını alın.

Certbot ile otomatik yenilemede CA’yı, iletişim bilgisini, koşulların kabulünü ve gerekli EAB bilgilerini yalnızca root’un erişebileceği `/etc/latex-renderer-lan-authority/certbot.ini` içinde belirtin. ECDSA P-256 anahtarı kullanın. DNS yetki devrinin yayılmasını bekleyip şunları çalıştırın.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Sertifika verildikten sonra Nginx’te sunucu adını ve sertifika yollarını ayarlayın, `nginx -t` ile söz dizimini denetleyin, değişiklikleri uygulayın ve Certbot yenileme zamanlayıcısını kontrol edin.

- **Keyless sunacaksanız** yalnızca `*.lan.example.org` içeren ayrı bir ECDSA P-256 joker sertifikası alın. Önceki komutta `--cert-name` değerini `akebi-keyless`, `-d` değerini `'*.lan.example.org'`, `--deploy-hook` değerini `"$hooks/operator-certificate-hook.sh"` olarak değiştirin. Yalnızca genel CA modu sunuyorsanız bu sertifika gerekmez.

## Kayıt yöntemini ayarlama {#登録方法を設定する}

`authority.json` içinde `policy.registration` ile istemci sunucularının kayıt yöntemini seçin.

- `"open"` otomatik kayda izin verir.
- `"invite"` yöneticinin verdiği bir kod gerektirir.

Davetli kayıt için şu komutla kullanım sayısı ve süresi sınırlı bir kod oluşturup güvenli bir kanaldan yalnızca alıcıya verin.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Her iki modda da CA’nın sertifika verme ilkelerinin yanı sıra kayıt sayısı, verme sıklığı ve depolanan öğe sayısı sınırları uygulanır.

## Dışarıdan doğrulama {#外部から確認する}

Harici bir bilgisayardan DNS yetki devrini, UDP ve TCP üzerinden SOA yanıtlarını, IP’den türetilen adların çözümlemesini ve HTTPS keşif yanıtını kontrol edin.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Tüm denetimler başarılı olduğunda [LAN erişimini yapılandırma](/tr/docs/lan-https/#lan-向けに設定する) adımlarıyla bir LaTeX Renderer test sunucusu bağlayıp sertifika verilmesini ve girişi doğrulayın. CA bir yeniden deneme zamanı veriyorsa o zamana kadar bekleyin.

**Yedekler.** `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA hesapları ve Certbot yenileme ayarlarını şifrelenmiş yedeklere ekleyin. Etkin SQLite veritabanı için çevrimiçi yedekleme özelliğini kullanın.

[Akebi yapılandırma örnekleri ve belirtimine](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md) bakın.
