---
slug: cli
category: CLI
title: CLI ile belge dönüştürme ve sonuçları indirme
description: Terminalde TeX derleyip PDF, günlük ve önizlemeleri indirin.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

`main.tex` dosyasının bulunduğu klasörde `n624-latex main.tex` çalıştırarak PDF’yi aynı klasöre kaydedin. İlk kullanımda [CLI’yi kurun](/tr/docs/client/) ve bağlantıyı yapılandırın.

## Kimlik doğrulama {#認証}

API anahtarını kaydetmek için ayarlar ekranını tarayıcıda açın.

```sh
n624-latex setup --gui
```

Örneğin bir SSH oturumunda tarayıcı açamıyorsanız anahtarın komut argümanlarında görünmemesi için **standart girdiden** kaydedin. Bash veya Zsh’te ilk satırı çalıştırın, anahtarı yapıştırın, Enter’a basın ve sonraki satırları çalıştırın.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Windows’ta [yükleyicinin gizli giriş alanını](/tr/docs/windows/#インストール) da kullanabilirsiniz.

Şu komutlar sırasıyla kayıtlı anahtar bulunup bulunmadığını denetler ve anahtarı kaldırır.

```sh
n624-latex auth status
n624-latex auth logout
```

- `LATEX_RENDER_API_KEY` ortam değişkeni ayarlanmışsa yerel anahtara göre önceliklidir.
- `logout` yalnızca yerelde kayıtlı anahtarı kaldırır. Gerekiyorsa ortam değişkenini ayrıca kaldırın veya sunucuda anahtarı iptal edin.

### Sunucuyu seçme {#接続先サーバー}

CLI varsayılan olarak barındırılan hizmete (`https://latex-render.n624.jp`) bağlanır. Kendi sunucunuz için komutları çalıştıracağınız terminal oturumunda HTTPS URL’sini ayarlayın.

- URL’ye `/app/` ve `/api/v1/` son eklerini koymayın.
- O sunucunun verdiği bir API anahtarını kullanın.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Ayarlar ve tanılama {#セットアップと診断}

Bağlantı ve entegrasyon ayarlarını `n624-latex setup` ile açın. Bağlanamıyorsanız önce şu komutlarla durumu kontrol edin. `n624-latex` bulunamıyorsa [Kurulum ve PATH](/tr/docs/troubleshooting/#インストール-ログイン) bölümüne bakın.

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` kurulumu ve kimlik bilgilerini salt okunur biçimde inceler, API anahtarının değerini göstermez. Sorun belirlerse `2` çıkış kodunu döndürür.

| Kurulum | Güncelleme ve onarım |
| --- | --- |
| APT | [APT ile güncelleyin](/tr/docs/client/#apt-版の更新) veya bozuk paketleri [yeniden kurun](/tr/docs/client/#状態確認と修復). [Local MCP’yi elle kaydedin](/tr/docs/mcp/#local-mcpの登録). |
| Homebrew | [Homebrew ile güncelleyin](/tr/docs/client/#homebrew-版の更新) veya bozuk paketleri [yeniden kurun](/tr/docs/client/#状態確認と修復). Yapay zekâ entegrasyonlarını `n624-latex setup` ile ayarlayın. |
| İndirilebilir yükleyici | [Ayarlardan güncelleyin](/tr/docs/client/#配布インストーラー版の更新). Yönetilen entegrasyonları ve başlatıcıları `n624-latex setup repair` ile onarın. |

Kaldırmak için [kurulum yönteminize ait yönergeleri](/tr/docs/client/#アンインストール) izleyin. Ayarlar arayüzü yereldir ve CLI sonlandığında kapanır.

## İşleme {#レンダリング}

### TeX dosyasını doğrudan dönüştürme {#tex-ファイルを直接変換する}

PDF oluşturmak için proje klasöründeki `.tex` dosyasını belirtin. Görsellere, kaynakçaya ve yerel `.sty` dosyalarına göreli yollarla başvurabilirsiniz.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- `-o` belirtmezseniz komutu çalıştırdığınız klasöre aynı taban adını taşıyan bir PDF, örneğin `main.pdf` kaydedilir.
- LaTeX hata verirse belirlenebilen dosya, satır ve iş kimliği gösterilir. Derleme veya indirme başarısız olursa son başarıyla kaydedilen PDF korunur.

#### LaTeX motorunu seçme {#latex-のエンジンを選ぶ}

XeLaTeX kullanmak için motor adını dosyadan önce yazın.

```sh
n624-latex xelatex main.tex
```

Motor belirtmezseniz CLI belgenin başında `% !TeX program = xelatex` veya
`% !TEX TS-program = xelatex` arar. Bir yönerge yoksa proje kökündeki
`.n624-latex.json` dosyasını okur. Aynı motoru başka bilgisayarlarda da kullanmak için
bu dosyayı Git üzerinden paylaşabilirsiniz.

```json
{"engine":"xelatex"}
```

Motor belirtilmezse LuaLaTeX kullanılır. pLaTeX ve upLaTeX için
sunucudaki çalışma ortamında Japonca koleksiyonu bulunmalıdır.

| Motor | Belge taşırken denetlenecekler |
| --- | --- |
| LuaLaTeX | `fontspec` veya LuaTeX-ja kullanan belgelerin ayarlarını kontrol edin. |
| pdfLaTeX | `fontspec` desteklenmez. pdfLaTeX yazı tipi ayarlarını kullanın. |
| XeLaTeX | `fontspec` desteklenir. Yalnızca LuaTeX’e özgü paketleri kontrol edin. |
| pLaTeX / upLaTeX | Motorla uyumlu bir Japonca belge sınıfı kullanın. upLaTeX altında `jsarticle` için `uplatex` sınıf seçeneğini belirtin. |

Kaynakça işleme belgenin paketlerine ve ayarlarına bağlıdır. `.bib` ve özel `.bst` dosyalarını ekleyin. pLaTeX ve upLaTeX altında BibTeX belgeleri sırasıyla pBibTeX ve upBibTeX kullanır. PDF, SVG ve SVG konumu doğrulamasını [işleme ortamında](/app/environment/) inceleyin.

### ZIP dönüştürme veya birden fazla çıktı isteme {#zip-複数の出力を指定する}

ZIP dönüştürmek veya günlükler, önizlemeler ve SVG’ler dahil çıktı kümesini indirmek için `render` alt komutunu kullanın.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Örnekler**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Varsayılan yol geçerli klasör, `--entrypoint` için varsayılan değer `main.tex` şeklindedir. CLI en fazla 500 dosyalık bir girdi hazırlayıp işin bitmesini bekler. Giriş noktası bir `.tex` dosyasına göreli yol olabilir. Sunucu yolun güvenli, dosyanın mevcut olduğunu doğrular.
- `--svg` ile en dıştaki matematik ifadeleri ve üst düzey TikZ çizimleri ayrıca bağımsız SVG’ler olarak çıkarılır.

### Birden fazla belge için girdiyi yeniden kullanma {#同じ入力から複数の文書を作る-source-の再利用}

Bir klasörde veya ZIP’te birden çok ana belge varsa girdiyi `source upload` ile bir kez yükleyip kimliğini yeniden kullanın. Her iş için ayrı bir çıktı klasörü (`--output`) seçin.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Hedef temizliği, dışlanan dosyalar ve yinelenen yüklemeler
>
> - **Önceki çıktıları temizleme.** Aynı hedefi yeniden kullanırken yalnızca önceki `job.json` içinde yer alıp yeni sonuçta bulunmayan PDF, önizleme ve SVG dosyaları kaldırılır. İşle ilgisiz kullanıcı dosyaları korunur.
> - **Hedefi denetleme.** Sembolik bağlantı içeren yollar reddedilir. POSIX sistemlerinde sahiplik ile grup ve diğerlerinin yazma izinleri de denetlenir. Windows POSIX kip bitlerini denetlemez.
> - **Çıktı dizinini dışlama.** `--output` projenin bir alt klasörünü gösteriyorsa sonraki ZIP’ten yalnızca o klasör çıkarılır. Benzer adlı klasörler içinde kalır. Proje kökü hedef olamaz.
> - **Yinelenen yüklemeler.** Aynı sahibin aynı SHA-256 değerine sahip geçerli bir ZIP’i sunucuda duruyorsa sunucu `uploadRequired: false` döndürüp aktarımı atlar. Girdi kimliğini sonraki işlerde yalnızca o sahip kullanabilir.

## Kayıtlı projeler ve revizyonlar {#保存projectと改訂}

CLI ile sunucudaki projeleri ve revizyonları yönetip yeniden derleyebilirsiniz. Web, API, MCP ve aynı kullanıcının diğer anahtarları projeleri paylaşır. Geçici `render` ve `source upload` işlemleri için proje kaydetmek gerekmez.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** klasörü veya ZIP’i girdi olarak hazırlar ve projeye değişmez bir revizyon kaydeder. `--svg` ile revizyonun ilk çıktı biçimleri PDF ve SVG olur.
- **`render`** kayıtlı bir revizyondan iş oluşturur. Yalnızca `--svg` çıktı ayarlarını geçersiz kılar.
- **`list`, `get` ve `jobs`** sonraki sayfayı almak için `--cursor` kabul eder.
- **`delete`** projeyi listeden gizler. Mevcut işler hemen silinmez.

## İş işlemleri {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **İndirme ve bekleme.** Bu komutlar kısa ömürlü bir belirteci API anahtarıyla yeniler. `jobs download` kaydedilmiş kümeyi değiştirmeden önce iş bitene kadar bekler. Bekleme hatayla biter veya kesilirse önceki küme korunur. `delete` yalnızca tamamlanmış işler için geçerlidir.
- **Ek PNG önizlemeleri alma.** Başlangıçta yalnızca ilk sayfa üretilir. Normal indirme zaten üretilmiş PNG’leri alır. Örneğin `--preview-page 2 5` ile seçili sayfaları üretin, boyut ve SHA-256 değerlerini doğrulayın ve kaydedin. PDF yeniden derlenmez ve saklama süresi uzamaz.
- **PDF’yi erken indirme ve SVG’yi yeniden deneme.** PDF ve SVG işlerinde SVG’yi beklemeden PDF’yi almak için `--pdf-only` kullanın. Yalnızca SVG başarısızsa PDF korunur ve sonuç kısmi başarıdır. `retry-svg` yalnızca çıkarmayı yineler. İlk deneme dahil 8 denemeye izin verilir, saklama süresi uzamaz. Çalışma ortamı değiştiyse yeni iş oluşturun. [PDF’nin erken kullanıma açılması ve SVG’yi yeniden deneme](/tr/docs/api/#pdfの先行公開とsvgの再試行) bölümüne bakın.
- **Ağ sorunlarında yeniden deneme.** Durum sorgusunda geçici hatalar yeniden denenir. Kimlik doğrulama ve izin hataları hemen döner. CLI beklemeyi bırakırsa sunucu çalışmaya devam edebilir. Yeni iş oluşturmadan önce aynı `<jobId>` ile durumu sorgulayın. [CLI’de bekleme ve yeniden deneme](/tr/docs/reference/#cliの待機と再試行) bölümüne bakın.

## Çıktı dosyaları {#成果物}

PDF’yi erken indirmek, PNG sayfalarını seçmek veya SVG’yi yeniden denemek için [PDF, PNG ve SVG alma](/tr/docs/outputs/) bölümüne bakın.

| Yol | İçerik |
| --- | --- |
| `.render/result.pdf` | Başarıyla oluşturulan PDF |
| `.render/compile.log` | LaTeX derleme günlüğü |
| `.render/errors.json` | Yapılandırılmış hata ayrıntıları |
| `.render/job.json` | İşin son durumu |
| `.render/previews/page-N.png` | En fazla 100 sayfanın önizlemesi |
| `.render/svg/manifest.json` | SVG, kaynak konumları ve PDF koordinatları arasındaki eşleme |
| `.render/svg/objects/*.svg` | Matematik ifadesi veya TikZ çizimi başına bir SVG |

## JSON çıktısı {#json出力}

Herhangi bir komuta `--json` ekleyerek ilerleme iletileri olmadan standart çıktıya tek bir JSON nesnesi yazdırın. Normal görünümle aynı `client-core` sonucunu kullanır ve API anahtarlarıyla kısa ömürlü belirteçleri içermez.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Başarı ve hata şemaları ile çıkış kodları için [CLI JSON biçimine](/tr/docs/reference/#cliのjson形式) bakın.
