---
slug: updates
category: Kendi sunucunuzda barındırma
title: Sunucuyu güncelleme veya önceki sürüme dönme
description: Kararlı sürümü uygulayın, sonucu doğrulayın ve hata durumunda uygun kurtarma yolunu seçin.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Güncellemeden önce {#更新する前に}

| Değiştirilecek öğe | Kullanılacak bölüm |
| --- | --- |
| Sunucu uygulaması | **Yönetim → Güncellemeler** |
| TeX Live sürümü veya dilleri | **Yönetim → TeX ortamı**. [TeX ortamını değiştirme](/tr/docs/self-hosting/#tex環境の初期設定) bölümüne bakın. |
| Yerel APT paketi `n624-latex` | [APT paketini güncelleme](/tr/docs/client/#apt-版の更新) |

Başlamadan önce üç noktayı denetleyin.

1. [Şifrelenmiş bir yedek oluşturun ve doğrulayın](/tr/docs/backups/#手動で作成する).
2. Az sayıda etkin dönüştürme işi olan bir zaman seçin.
3. Bakım modunu `normal` olarak bırakın. Güncelleyici gerekli hizmetleri durdurup başlatır ve bir deneme dönüştürmesi yapar.

## Kararlı sürümü uygulama {#正式版を適用する}

1. Sahip olarak giriş yapıp **Yönetim → Güncellemeler** (`/admin/updates/`) bölümünü açın.
2. Geçerli sürüm ile kullanılabilir kararlı sürümü görmek için sürüm alanını boş bırakıp **Güncellemeleri denetle** düğmesine basın.
3. **İndir, doğrula ve güncelle** seçeneğini kullanın, değişiklik nedenini girip güncellemeyi başlatın.
4. **İşlem kimliğini** kaydedin ve durumun başarılı tamamlanmayı gösterdiğini doğrulayın.
   - Uygulama güncel olsa da güncelleyicinin değişmesi gerekiyorsa aynı işlemin sonucuna ve güncelleyici ayrıntılarına bakın.
   - Tarayıcıyı kapatsanız da işlem sürer. Yeniden başlatılırken `502` görürseniz arayüzün tekrar bağlanmasını bekleyin.
5. Başka bir tarayıcıda veya gizli pencerede giriş yapın. Temsili bir belgeyi dönüştürün, PDF indirmesini ve uygulamayla güncelleyicinin sürümlerini kontrol edin.

## Bildirimler ve otomatik güncellemeler {#通知と自動更新}

Güncelleme ilkesinde denetleyip bildirme (varsayılan) veya doğrulamadan sonra otomatik uygulama seçeneklerinden birini seçebilirsiniz.

- Otomatik uygulama yalnızca kararlı sürümleri kapsar.
- Bir sürüm adayını ayrı bir test ortamında denemek için yayımlanan etiketi `vX.Y.Z-rc.N` biçiminde belirtin.

## Güncelleme başarısız olursa {#更新が失敗した場合}

Ayrıntılı günlükte işlem kimliğini ve hatanın oluştuğu aşamayı inceleyin. Uygulama ve güncelleyici sürümlerini, girişi, dönüştürmeyi ve kurtarma noktasının incelenmesi gerekip gerekmediğini denetleyin. Sürüm numarası tek başına yeterli değildir.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Bakım yapılıp yapılmadığını kontrol edin ve güncellemeye başlamadan önce `normal` moduna dönün.
- **`RECOVERY_REVIEW_REQUIRED`.** [Hata sonrasında kurtarma noktasını inceleme](/tr/docs/backups/#更新失敗後の復旧点を確認する) yönergelerini izleyin.

## Önceki sürüme dönme {#前の版へ戻す}

- **Yalnızca uygulamayı geri almak yeterliyse** hedefi **Yönetim → Güncellemeler** bölümünde kontrol edin ve varsa **Önceki sürüme geri dön** seçeneğini kullanın. Ardından giriş ve PDF dönüştürmesini deneyin.
- **Veritabanı değişikliği uyumsuzsa** aynı kurtarma noktasından hem veritabanını hem depolamayı geri yükleyin. [Verileri geri yükleme](/tr/docs/backups/#データを復旧する場合) adımlarını izleyin.

[Eski sürümlerden geçiş ve kurtarma](/tr/docs/reference/#旧版からの移行と特殊復旧) ile [güncelleyici belirtimi ve saklama ilkesine](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md) bakın.
