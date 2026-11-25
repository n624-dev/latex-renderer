---
slug: outputs
category: Web ve CLI
title: PDF, PNG ve SVG alma
description: PDF’yi kaydedin, sayfa görüntülerini indirin ve denklemlerle TikZ çizimlerini SVG olarak dışa aktarın veya yeniden çıkarın.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## PDF açma ve kaydetme {#pdf-を開く-保存する}

- **Web uygulaması.** [Geçmiş](/app/history/) bölümünde belgeyi seçin ve sonuç sayfasındaki dosya listesinde `result.pdf` dosyasını açın. PDF ve SVG istediyseniz PDF hazır olduğunda hemen indirebilirsiniz.
- **CLI.** Görüntülenen `<jobId>` ile sonucu indirin. SVG’leri beklemeden PDF’yi indirmek için `--pdf-only` ekleyin. Başka bir belgenin dosyalarını korumak istiyorsanız `--output` için farklı bir klasör seçin.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Sayfa görüntülerini alma {#ページ画像を取得する}

Sayfaların tamamını görüntü olarak almak için PNG önizlemelerini kullanın. Başlangıçta yalnızca 1. sayfa oluşturulur. Diğerleri istek üzerine hazırlanır. Sayfa hazırlanıyorsa bekleyin veya aynı sayfayı tekrar açın. Bu sırada tamamlanmış PDF’yi indirebilirsiniz.

- **Web uygulaması.** Sonuçlarda görüntülemek istediğiniz sayfanın önizlemesini seçin.
- **CLI.** Şu komut 2. ve 5. sayfaların PNG görüntülerini indirir. Dosyalar `.render/previews/page-2.png` gibi adlarla kaydedilir.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Denklemleri ve TikZ’yi SVG olarak kaydetme {#数式と-tikz-を-svg-で保存する}

En dıştaki matematik ifadelerini ve üst düzey TikZ çizimlerini bağımsız vektör görüntüleri olarak çıkarabilirsiniz.

- **Web uygulaması.** Dönüştürmeden önce **Hedef ve çıktı seçenekleri** bölümünü açıp **Denklemleri ve TikZ'yi SVG olarak da dışa aktar** seçeneğini işaretleyin. Çıkarma tamamlanınca SVG dosyalarını sonuç sayfasından indirin.
- **CLI.** Belgeyi `--svg` ile dönüştürün. SVG dosyaları `.render/svg/objects/` içine kaydedilir. Özgün `.tex` dosyasındaki satırların PDF koordinatlarına karşılıkları `.render/svg/manifest.json` içinde bulunur.

```sh
n624-latex render . --svg
```

## PDF hazır olduğu hâlde SVG çıkarma başarısızsa {#pdf-はあるが-svg-が失敗した場合}

**Kısmi başarı**, PDF’nin hazır olduğunu ve yalnızca SVG çıkarmanın başarısız olduğunu belirtir. PDF’yi kaydedin ve tekrar derlemeden çıkarmayı yeniden deneyin.

- **Web uygulaması.** Sonuçlarda **Yalnızca SVG'yi yeniden dene** düğmesine basın.
- **CLI.** Şu komutu çalıştırın.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Koşullar ve deneme sınırı**
- Özgün kaynaklar ve nihai PDF mevcut olduğu, sunucunun TeX ortamı değişmediği sürece ilk deneme dahil **en fazla 8 deneme** yapılabilir. Yeni denemeler dosyaların saklanma süresini uzatmaz.
- Sorun sürerse sonuç sayfasındaki veya `.render/svg/errors.json` içindeki tanılamayı inceleyin.
- `SVG_RUNTIME_CHANGED` görünürse veya eski bir işte yeniden deneme düğmesi kullanılamıyorsa [özgün belgeden veya kayıtlı revizyondan yeni bir dönüştürme başlatın](/tr/docs/web/#以前の文書や結果を開く).

Ayrıca [HTTP API üzerinden indirme ve yeniden deneme](/tr/docs/api/#pdfの先行公開とsvgの再試行) ile [çıktı işleme belirtimine](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md) bakın.
