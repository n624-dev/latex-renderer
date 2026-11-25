---
slug: web
category: Web uygulaması
title: Belgeleri tarayıcıda dönüştürme
description: TeX dosyası veya ZIP arşivinden PDF oluşturun ve önceki dönüşümlerin sonuçlarını görüntüleyin.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Tarayıcıda PDF oluşturma {#ブラウザでpdfへ変換}

1. [Web uygulamasını](/app/) açın ve yöneticinizin belirttiği yöntemle giriş yapın.
2. Dosyaları seçin veya sayfaya sürükleyin.
   - Tek dosyalı bir belge için `.tex` dosyasını doğrudan seçin.
   - Görsel, kaynakça veya birden çok `.tex` dosyası (örneğin `\input` ile) kullanılıyorsa belgeyi ve bağımlılıklarını tek bir `.zip` arşivine koyun. [Desteklenen dosyalar ve ZIP yapısı](/tr/docs/projects/) bölümüne bakın.
   - Birden fazla `.tex` dosyasını ayrı ayrı seçerseniz her biri bağımsız bir belge olarak dönüştürülür.
3. ZIP’te birden çok `.tex` dosyası varsa ve uygulama seçim istiyorsa giriş noktası olarak ana belgeyi seçin.
4. **PDF’ye dönüştür** düğmesine basın. İşlem bitince sonuç sayfasında PDF ve sayfa önizlemeleri görünür.

LuaLaTeX dışında bir motor kullanacaksanız **Hedef ve çıktı seçenekleri → Motor** bölümünden seçin. [İşleme ortamında](/app/environment/) kullanılabilen motorları ve PDF, SVG, SVG konumları için doğrulama durumunu görebilirsiniz. pLaTeX ve upLaTeX için sunucuda Japonca koleksiyonu gerekir.

## Belgeyi tarayıcıda düzenleme {#ブラウザーで文書を編集する}

1. [Projeler](/app/projects/) bölümünde bir belge açıp **TeX düzenle** seçeneğini kullanın. Yeni proje boş bir `main.tex` ile başlar. İsterseniz şablon seçebilirsiniz.
2. Değişiklikler taslağa otomatik kaydedilir. Görsel veya kaynakça eklemek için **Dosya iliştir** düğmesini kullanın.
3. Yazmaya ara verdiğinizde PDF’nin güncellenmesi için **Otomatik derleme** seçeneğini açın. Hemen güncellemek için **Derle** düğmesine basın.
4. Kaynakları geçmişte saklamak için **Sürümü kaydet** düğmesine basın. Kayıtlı bir sürümden devam etmek için **Bu revizyondan düzenle** seçeneğini kullanın. Mevcut bir taslak varsa üzerine yazılmadan önce onay istenir.

Dosya eklemek veya iliştirmek için **Dosyaları yönet** seçeneğini açın. Motoru, otomatik derlemeyi ve görüntüleme dilini değiştirmek veya bir sürüm kaydetmek için **Ayarlar** bölümünü kullanın. PDF panelindeki **⋯** düğmesi yakınlaştırma ve PNG seçeneklerini açar.

Derleme başarısız olursa taslak ve son başarılı PDF korunur. Dosya adı ve satır numarası olan bir hatayı seçerek ilgili satıra gidebilirsiniz. Mobilde **Kod**, **PDF** ve **Hatalar** arasında geçiş yapın. PDF yavaş görüntüleniyorsa **PNG (hafif önizleme)** seçeneğini kullanın.

Geçici önizlemeler yalnızca düzenleyicide görünür. PDF’yi saklamak için **PDF’yi kaydet** düğmesiyle indirin.

Düzenleyici UTF-8 kullanır. Shift_JIS veya EUC-JP dosyalarını metin düzenleyicisinde özgün kodlamasıyla açın, metnin doğru göründüğünü denetleyin ve UTF-8 olarak bir kopya kaydedin. Kopyayı aynı adla ekleyip değiştirmeyi onaylayın.

## Denklemleri ve TikZ çizimlerini SVG olarak alma {#数式や-tikz-を-svg-で取得する}

1. Dönüştürmeden önce **Hedef ve çıktı seçenekleri** bölümünü açın ve **Denklemleri ve TikZ'yi SVG olarak da dışa aktar** seçeneğini işaretleyin.
2. PDF hazır olur olmaz indirilebilir.
3. **Kısmi başarı**, PDF’nin hazır olduğunu ancak SVG çıkarmanın başarısız olduğunu belirtir. Önce PDF’yi kaydedin ve gerekirse **Yalnızca SVG'yi yeniden dene** düğmesine basın.

Başlangıçta yalnızca ilk sayfanın PNG önizlemesi oluşturulur. Diğer sayfalar açtığınızda hazırlanır. Önizlemeler hazırlanırken tamamlanmış PDF’yi indirebilirsiniz. [PDF, PNG ve SVG alma](/tr/docs/outputs/) bölümüne bakın.

## Önceki belgeleri ve sonuçları açma {#以前の文書や結果を開く}

- **[Geçmiş](/app/history/)** işlem durumunu ve sonuç dosyalarını gösterir. Tarayıcıyı kapattıktan sonra aynı sonuç sayfasına dönebilirsiniz.
- **[Projeler](/app/projects/)** kayıtlı belgeleri ve revizyonları gösterir. Önceki kaynakları dönüştürmek için revizyonu açıp **Yeniden dönüştür** düğmesine basın.
- Sunucudaki LaTeX paketlerini ve yazı tiplerini **[İşleme ortamı](/app/environment/)** bölümünde arayabilirsiniz.

## Herkese açık ve özel bilgiler {#公開される情報}

- **Giriş gerektiren sayfalar.** Belgelerinizi ve dönüştürmelerinizi geçmişte veya sonuçlarda görmek için web uygulamasına (`/app/`) giriş yapın. Yönetim alanını (`/admin/`) yalnızca yöneticiler ve sahipler kullanabilir. [Hesap ve belge güvenliği](/tr/docs/security/) bölümüne bakın.
- **Herkese açık sayfalar.** Giriş yapamıyorsanız [hizmet durumuna](/status/) veya [sorun giderme kılavuzuna](/tr/docs/troubleshooting/) bakın. CLI [İndirmeler](/downloads/) bölümünde, entegrasyon özellikleri ise [Genel API](/tr/docs/api/) sayfasındadır.
