---
slug: contributing
category: Geliştirme ve katkı
title: Belgelere katkıda bulunma
description: Markdown kılavuzlarını düzenleyin ve değişiklikleri yerel olarak doğrulayın.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Bir kılavuzu düzenleme {#本文を編集する}

- **Hata bildirme.** Kılavuz arayüzle veya komutlarla uyuşmuyorsa [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) üzerinden ilgili sayfayı ve önerdiğiniz düzeltmeyi belirten bir bildirim açın.
- **Değişiklik gönderme.** [Herkese açık kılavuzların Markdown kaynaklarında (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) ilgili dosyayı düzenleyip bir çekme isteği (pull request) açın.

## Yerel doğrulama {#ローカル検証}

Düzenlemeden sonra şu komutları çalıştırıp derleme, bağlantı ve HTTP üstbilgisi denetimlerinin başarılı olduğunu doğrulayın.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

`public-web` derlemesi Wrangler ile deneme çalıştırması yapar ve örnek sayfaları, arama dizinini, 404 hatalarını, yönlendirmeleri ve üstbilgileri denetlemek için yerel Workers ortamı başlatır.

## Uyumluluk {#互換性}

- Herkese açık yolları ve başlık bağlantılarını (metinden oluşturulan `#...` parçaları) koruyun. Bir başlığı değiştirirseniz diğer sayfalardaki bağlantıları denetleyin.
- CLI seçeneklerini veya HTTP isteği örneklerini değiştirirken uygulama ve OpenAPI tanımlarıyla eşleştiklerini doğrulayın.
