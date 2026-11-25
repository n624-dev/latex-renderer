---
slug: backups
category: Kendi sunucunuzda barındırma
title: Yedek oluşturma, doğrulama ve geri yükleme
description: Düzenli yedeklerle güncelleme kurtarma noktalarını karşılaştırın, arşivi doğrulayın ve verileri geri yükleyin.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Neler kaydedilir {#何が保存されるか}

| Tür | İçerik | Amaç |
| --- | --- | --- |
| **Düzenli yedek** | SQLite veritabanı ve etkin revizyonların, taslakların veya oluşturulmakta olan önizlemelerin başvurduğu girdi ZIP’leri | Veritabanını, projeleri ve düzenlenen belgeleri koruma |
| **Güncelleme kurtarma noktası** | Güncellemeden hemen önceki SQLite, tüm uygulama depolaması ve önceki sürüm bilgileri | Hataları inceleme ve önceki durumu geri yükleme |
| **Ayrı ana makine yapılandırma yedeği** | `/etc/latex-renderer/` gibi dosyalar, özel anahtarlar, TLS sertifikaları ve Akebi durumu | Arıza sonrası ana makineyi yeniden kurma |

- Düzenli bir yedeği geri yükledikten sonra önizlemeyi yeniden oluşturmak için projeyi düzenleyicide açın. Geçici işlerin çıktıları ve çalışma önbellekleri yedeğe dahil edilmez.
- Yapılandırmayı, sertifikaları ve şifre çözme anahtarını (age kimliği) ayrıca koruyun. **Aynı olayda ikisini birden kaybetmemek için şifrelenmiş yedekleri ve anahtarı ayrı güvenli yerlerde saklayın.**

## Elle yedek oluşturma {#手動で作成する}

1. Sahip olarak giriş yapıp **Yönetim → Sistem → Yedeklemeler** bölümünü açın.
2. **Yedekleme oluştur** düğmesine basıp tamamlanmasını bekleyin.
3. **Son yedeklemeyi doğrula** düğmesine basın ve son doğrulamadaki arşiv adını ve zamanı kontrol edin. Sunucuda şifre çözme anahtarı bulunmalıdır.

### Komut satırından oluşturma ve doğrulama {#コマンドで作成-検証する}

1. Sunucuda hemen şifrelenmiş bir yedek oluşturun. `/etc/latex-renderer/backup.env` içinde `BACKUP_DIRECTORY` hedefi belirtir, varsayılan hedef `/var/lib/latex-renderer/backups` şeklindedir. Düzenli yedekleri `latex-renderer-backup.timer` zamanlayıcısı alır.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. `.tar.age` dosyasını doğrulama için bir Linux makinesine kopyalayın. GNU `tar`, `age`, `node:sqlite` destekli bir Node.js sürümü (24 veya 26) ve şifre çözme anahtarını hazırlayın. Uzun süreli saklama için arşivi ve anahtarı ayrı yerlerde tutun.
3. Yedeği oluşturan sürüme karşılık gelen [sunucu dağıtımını indirin, doğrulayın ve çıkarın](/tr/docs/self-hosting/#v1-6-9をダウンロードして検証). İlk `version=` içinde sürümü belirtin, `release_dir` değerini çıkarılan klasöre ayarlayıp dağıtımın betiğini çalıştırın.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

`restore_test.completed` iletisi doğrulamanın bittiğini gösterir. Test, geçici alana çıkarılan SQLite ve girdi ZIP’lerinin tutarlılığını denetler. Harici bir yedeği de saklandığı yerden geri alarak doğrulayabilirsiniz.

## Hata sonrasında kurtarma noktasını inceleme {#更新失敗後の復旧点を確認する}

Başarısız bir güncelleme sonrası `RECOVERY_REVIEW_REQUIRED` görünürse yönetici ayrıcalıklarıyla kurtarma noktasının durumunu denetleyin.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Önceki sürümlerde duruma bakma
>
> `n624-latex server recovery status` yoksa `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status` çalıştırın.

1. Nokta kimliğini (`POINT_ID`), uygulama ve güncelleyici sürümlerini, veritabanı şemasını ve çalışan hizmetleri karşılaştırın. Veriler geri yüklenecekse önce arşivi ve geçerli yapılandırmayı başka bir yerde koruyun.
2. `acknowledge` komutunu ancak inceleme sonucunda verilerin geri yüklenmesi gerekmediğini ve noktanın korumasının kaldırılabileceğini doğruladıktan sonra çalıştırın.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` incelemeyi tamamlar ve koşullar karşılanıyorsa hizmetleri sürdürür. Verileri geri yükleyecekseniz noktayı korumalı bırakıp aşağıdaki işleme geçin.

## Verileri geri yükleme {#データを復旧する場合}

Yedekten sonraki değişiklikler kaybolur. Veritabanı uyumluysa ve sadece uygulamanın önceki sürümüne dönmek yetiyorsa [Güncellemeler bölümünden geri alma](/tr/docs/updates/#前の版へ戻す) işlemini kullanın. Üretimden önce bir test makinesinde geri yüklemeyi deneyin.

1. **Hedefi belirleyip mevcut durumu koruyun.** Arşivi ve şemasıyla uyumlu uygulama sürümünü belirleyin. Üretime müdahale etmeden önce mevcut veritabanını, depolamayı ve yapılandırmayı ayrıca saklayın.
2. **Hizmetleri durdurun.** Güncelleme ve temizlikle çakışmayı önlemek için paylaşılan yönetim kilidi altında veritabanına veya depolamaya yazan tüm hizmet ve zamanlayıcıları durdurun.
3. **Çıkarıp doğrulayın.** Arşivin şifresini çözün, boş ve özel bir klasöre çıkarıp bütünlüğünü doğrulayın. Güncelleme noktası kullanıyorsanız root tarafından yönetilen `summary.json` ile iç bildirimi de karşılaştırın.
4. **Tek bir zamana geri dönün.** SQLite ile girdi ve çıktı depolaması **aynı kurtarma noktasından** olmalıdır. Düzenli yedekte her ZIP’i geri yüklenen veritabanının gösterdiği doğrulanmış `storage_key` konumuna yerleştirin. Uygun sürümleri, yapılandırma dosyalarını, sahipleri ve izinleri kullanın.
5. **Başlatıp doğrulayın.** Girişi, kayıtlı proje dönüştürmeyi, çıktı indirmeyi ve yeni yedek almayı deneyin. Denetim dışa aktarımı konum uyuşmazlığıyla durursa [denetim günlüklerini kurtarma](/tr/docs/reference/#監査ログの復旧) adımlarını izleyin.

[İşletim yedeklerinin biçimi ve denetimleri](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) ile [güncelleme kurtarma noktalarının tasarımına](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md) bakın.
