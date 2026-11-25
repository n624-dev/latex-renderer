---
slug: projects
category: Projeler
title: TeX ve ZIP dosyalarını hazırlama
description: Kaynakları hazırlayın, sınırları denetleyin ve küçük bir LuaLaTeX projesi deneyin.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Proje yapısı {#構成}

- **Tek dosyalı belge.** Web uygulamasında `.tex` dosyasını doğrudan yükleyin veya CLI’de `n624-latex main.tex` çalıştırın.
- **Görsel, kaynakça veya birden fazla kaynak dosyası içeren belge.** Göreli yolları koruyarak tüm dosyaları **tek bir ZIP** içinde toplayın. CLI’de bir klasör de belirtebilirsiniz.
- **ZIP oluşturma.** Sıkıştırmak üzere klasörün içeriğini, örneğin `main.tex` ve `images/` öğelerini seçin. Üst klasörü de eklerseniz dönüştürürken `project/main.tex` gibi bir giriş yolu belirtmeniz gerekir.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Giriş noktası ve göreli yollar**
Varsayılan ana belge proje kökündeki `main.tex` dosyasıdır. Alt klasörde bir `.tex` dosyası, örneğin `docs/main.tex` seçseniz bile **derlemenin çalışma dizini daima proje köküdür**. `docs/main.tex` içinden aynı klasördeki `body.tex` dosyasını eklemek için `\input{docs/body.tex}` yazın. `\input{body.tex}` yazarsanız derleyici `body.tex` dosyasını kökte arar.

## Japonca için en küçük örnek {#日本語の最小例}

Varsayılan motor **LuaLaTeX**’tir. Japonca bir belgeyi denemek için aşağıdaki metni `main.tex` olarak UTF-8 kodlamasıyla kaydedin.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Kullanılabilen paketleri ve yazı tiplerini [işleme ortamında](/app/environment/) arayın. Liste dağıtım sırasında sunucu kapsayıcısından oluşturulur ve Remote MCP aramalarında da kullanılır. Bir paket yoksa `compile.log` içindeki ilgili iletiyi yöneticiye gönderin.

## Kayıtlı projeler ve revizyonlar {#保存projectと改訂}

Web uygulamasında (`/app/`) dönüştürülen belgeler projelere kaydedilir.

- **Otomatik revizyon kaydı.** İçerik, ana belge, motor ve çıktı biçimlerinden oluşan her yeni bileşim proje revizyonu olarak kaydedilir. Öncekiler geçmişte kalır.
- **Önceki bir revizyonu dönüştürme.** Kayıtlı belge ve motoru kullanmak için **Yeniden dönüştür** düğmesine basın. Bu sırada çıktı biçimini değiştirirseniz sonuç aynı revizyonun dönüştürme geçmişine eklenir.
- **Paylaşım ve silme.** Web uygulaması, CLI, HTTP API ve MCP kullanıcının projelerini ve revizyonlarını paylaşır. Proje silindiğinde kaydı gizlenir. Mevcut girdiler ve çıktılar saklama sürelerine göre temizlenir. Hemen ve tamamen silinmeleri gerekiyorsa yöneticiye başvurun. Etkin revizyonların başvurduğu girdiler kullanıcı kotasına dahildir. [Paylaşım ve saklama](/tr/docs/reference/#保存プロジェクトの共有-保持) bölümüne bakın.

### Tarayıcıda düzenleme {#ブラウザーで編集する}

Kayıtlı bir proje açıp **TeX düzenle** seçeneğini kullanın. Değişiklikler taslağa kaydedilir. Yazmaya ara verdiğinizde derleme başlar ve başarılı olursa PDF güncellenir. Önizleme başarısız olursa son kullanılabilir PDF’yi ve karşılık geldiği taslak sürümünü görebilirsiniz.

Yeni projeler boş bir `main.tex` ile açılır. Ana belge boşken bir şablondan başlayabilirsiniz. Kayıtlı sürümden devam etmek için **Bu revizyondan düzenle** seçeneğini kullanın. Bir taslak varsa değiştirmeden önce onaylayın.

Yalnızca istediğiniz zaman derlemek için **Otomatik derleme** seçeneğini kapatıp **Derle** düğmesine basın. Taslağı ve ayarlarını korumak için **Kaydedilen sürümün çıktıları** seçip **Sürümü kaydet** düğmesine basın. SVG gerekiyorsa kayıtlı revizyonu açıp **Yeniden dönüştür** düğmesini kullanın.
Düzenleyici, çalışırken derleme durumunu ve önizlemeyi gösterir.

## Yüklemeye dahil edilmeyen dosyalar {#送信から除外されるもの}

- **Otomatik dışlamalar.** CLI, `.git` ve `.render` ile `.aux` gibi yardımcı LaTeX dosyalarını atlar. Sembolik bağlantıları reddeder.
- **Desteklenmeyen dosyalar.** `node_modules` gibi gereksiz klasörleri proje dışına taşıyın. Yüklenecek klasör desteklenmeyen uzantılar içerirse CLI yolu gösterip durur. `README.md` gibi bir dosyayı projede tutup yüklememek için kökteki `.latexrenderignore` dosyasına `README.md` içeren bir satır ekleyin. Sunucu ZIP içindeki uzantıları aynı kurallarla denetler.
- **Kabul edilen uzantılar** (büyük/küçük harf ayrımı yoktur)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst` dosyaları BibTeX kaynakça stilleridir ve alt klasörlerde bulunabilir. Özel bir stil listede olmayan bir uzantı kullanıyorsa değiştirmeden önce yöneticiye danışın.

## Sınırlar {#制限}

- **Dosya sayısı.** En fazla 500.
- **Varsayılan boyutlar.** ZIP için 20 MiB, açıldıktan sonra toplam 100 MiB, dosya başına 20 MiB.
- **Giriş noktası.** Kaynaklardaki bir `.tex` dosyasının göreli yolu. Varsayılan olarak kökteki `main.tex` kullanılır.
- **Güvenlik.** TeX’ten kabuk erişimi (`\write18` dahil), dış komut çalıştırma ve dış ağ bağlantıları devre dışıdır.
- **Kaynaklar.** Süre sınırlarını, kullanıcı başına depolama alanını ve çıktı saklama süresini yönetici belirler.
