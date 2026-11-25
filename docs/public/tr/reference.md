---
slug: reference
category: İşletim ve geliştirme
title: İşletim ve geliştirme başvuru kılavuzu
description: İstemcinin çıktıları saklama ve kurtarma davranışını, MCP kimlik doğrulamasını ve geçiş işlemlerini inceleyin.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Çıktıları saklama ve kurtarma {#成果物の保存-復旧の仕様}

> [!DETAILS] Belirtimler ve işlemler
>
> - **Dizini atomik olarak değiştirme.** CLI ve Local MCP `.render/result.pdf`, `job.json` ve önizleme yollarını korur. Tüm dosyaların bildirilen boyutunu ve SHA-256 değerini denetler, küme tamamlanınca dizini değiştirir. Geçiş sırasında dizin kısa bir an görünmeyebilir. Harici programlar dizini komut tamamlandıktan sonra okumalıdır.
> - **Otomatik kurtarma.** Çıktının yanındaki `<output-name>.latex-renderer-state` adlı dizin kurtarma durumunu saklar ve girdi toplanırken kapsam dışında bırakılır. Normal çıkışta geçici veriler temizlenir. Zorla kapatmadan sonra ilk indirme, geçiş onaylanmamışsa önceki kümeyi geri yükler; onaylanmışsa yeniyi koruyup eskiyi temizler. Çalışma sırasında veya kurtarmadan önce durum dizinini silmeyin.
> - **Kilitleme ve olağan dışı durumlar.** Aynı hedefe eşzamanlı yazma `OUTPUT_BUSY` ile durur. Yalnızca zaman geçmiş olması etkin süreci yerinden etmez. PID yeniden kullanılmışsa işlem güvenlik için durur. Bozuk meta verileri, bilinmeyen dosyaları veya dış bağlantıları silmeden önce inceleyin.
> - **Kullanıcı dosyaları ve sınırlar.** Normal kullanıcı dosyaları yeni kümeye kopyalanır. İndirme sırasında düzenleme algılanırsa yayımlama iptal edilip değişiklik korunur. Ayrı bir hedef kullanılması önerilir. Her küme en fazla 1 GiB ve 10.000 girdi içerebilir. İki küme ve geçici veriler için boş yer gerekir. Yalnızca yerel dosya sistemleri desteklenir; sembolik bağlantı, sabit bağlantı veya başka bir dosya sistemi bağlama noktası içeren yollar reddedilir. Ağ paylaşımlarında kilitleme ve elektrik kesintisinde tam atomiklik garanti edilmez. Windows’ta açık bir dosya geçişi engellerse önceki küme korunur.

## Web kimlik doğrulama sınırları {#web認証の境界}

> [!DETAILS] Belirtimler ve işlemler
>
> Sunucu oturumları `/app/`, `/admin/` ve bunların API’lerini korur. Bu alanlar genel arama dizininde yer almaz. Normal kullanıcılar `/app/` alanını kullanır, `/admin/` yalnızca yöneticilere ve sahiplere açıktır. Kimlik dış sağlayıcının `issuer + subject` değeri veya parolalı girişin `login name` değeriyle belirlenir. E-posta ve görünen ad kimlik doğrulama anahtarı değildir. ZIP yüklemeleri, işler, çıktı dosyaları ve TeX derlemesi sunucudaki işleyiciden geçer.
>
> > [!NOTE]
> > Tarayıcı kısa ömürlü biletleri kalıcı olarak saklamaz. Sunucu oturumu gerektiğinde yeniden verir. Oturum çerezlerini, CSRF belirteçlerini ve biletleri paylaşmayın.

## Remote MCP kaydı ve tanılaması {#remote-mcpの登録-診断}

> [!DETAILS] Belirtimler ve işlemler
>
> - **Dinamik istemci kaydı (DCR).** Tamamlanmamış veya etkin olmayan kayıtlar normalde 30 gün sonra temizlenir. Geçerli yetkilendirme kodlarının veya belirteç ailelerinin başvurduğu kayıtlar korunur. Genel sınır 10.000’dir. Temizlikten sonra `invalid_client` alırsanız istemciyi yeniden kaydedin. İstemci adı içermeyen standart DCR istekleri kabul edilir; ad ve yönlendirme URI’si doğrulamaları sürer.
> - **Geçici yetkilendirme istekleri (şema 20).** Araya giriş adımı girdiğinde istek kısa rastgele bir kimlikle kaydedilir. Böylece uzun OAuth `state` değeri dönüş URL’sine konmadan istek sürdürülebilir. 10 dakika geçerlidir ve giriş yapılan tarayıcıyla özel çerez eşleştiğinde yalnızca bir kez kullanılabilir. Eşzamanlı sekmelerin kimlikleri farklıdır. Genel sınır 1.000 istek, tarayıcı başına en fazla 8 devam çerezidir. Sınıra ulaşıldığında mevcut istekler korunarak `503` döner. Veritabanında yalnızca kimlik ve çerezin özetleri saklanır. Yeniden başlatma ve yedekten dönüş geçerlilik süresini uzatmaz.
> - **IP sınırları ve kaynak üstbilgileri.** DCR, güvenilen kaynak IP başına 15 dakikada 10 kayda izin verir. Aynı çıkış vekilini kullanan istemciler kotayı paylaşır. 11. denemeden itibaren HTTP `429`, `temporarily_unavailable` ve `Retry-After` döner. Geçersiz meta veriler kotayı tüketmez. IP yoksa veya geçersizse kimliği bilinmeyen istemcileri birleştirmek yerine operatörün vekili kontrol etmesi için `503` döner. Arka ucu geri döngü arabiriminde tutun ve vekili `X-Latex-Renderer-Client-IP` değerini gerçek adresle değiştirecek şekilde ayarlayın. Keyfî `X-Forwarded-For` değerleri yok sayılır. Cloudflare yollarında `CF-Connecting-IP` de güven sınırı içinde işlenir.
> - **Yönetici bağlantı denetimi.** Şu komut kimlik bilgisi göndermeden, ayar değiştirmeden, yönlendirme izlemeden, yanıt gövdesi, çerez veya sır göstermeden genel keşif ve Bearer `401` sınamasını doğrular.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Hata aşamasını bulma.** Başarılı bir `200` keşif yanıtı ve `401` sınaması yalnızca o aşamaları doğrular. Aşama, saat ve `X-Request-ID` değerini `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` ve `remote_mcp.rpc_result` günlükleriyle karşılaştırın. OAuth kodlarını, belirteçleri, çerezleri, PKCE doğrulayıcılarını, kaynakları ve kullanıcı kimliklerini günlüklerden ve hata kayıtlarından uzak tutun.
> - **Kimlik doğrulama başarılı ancak eylem keşfi başarısız.** Belirteç verildikten sonra `initialize`, ilklendirme bildirimi ve `tools/list` adımlarını ayrı ayrı kontrol edin. HTTP `200` bir JSON-RPC `error` ile birlikte de gelebilir. `remote_mcp.rpc_result` HTTP durumunu, sonuç sınıfını, protokol sürümünü, araç sayısını, yanıt bayt sayısını ve listenin temel yapısını kaydeder. İnceleme arabelleği 256 KiB ile sınırlıdır. Bu aşılırsa yalnızca `inspection_limited` kaydedilir ve yanıt değiştirilmez. Tek başına SSE yanıtı veya `GET` isteğinin `405` döndürmesi hatayı kanıtlamaz. `Accept`, `Content-Type`, protokol görüşmesi ve isteklerin vekilden ulaşıp ulaşmadığını inceleyin. Üretimde dış OIDC’yi, Cloudflare ilkelerini ve gerçek bir ChatGPT hesabını ayrıca doğrulayın.

## MCP sonuçları ve kaynakları {#mcpの結果とresource}

> [!DETAILS] Belirtimler ve işlemler
>
> Remote MCP yanıtları üç katmandan oluşur.
> 1. **Standart `content`.** Sonraki adıma karar vermek ve aracı çağırmak için gereken girdi ve iş kimliklerini, durumu, konumu, imleci, kullanılabilirliği ve sınırlı tanılamayı içerir. `structuredContent` veya özel kaynak desteği olmayan istemciler de oluşturma, düzeltme ve yeniden işleme yapabilir.
> 2. **`structuredContent`.** Otomatik işlem için doğrulanmış nesnenin tamamını içerir.
> 3. **MCP kaynakları (`latex-renderer://jobs/...`).** PDF, tam `compile.log`, ham JSON, `svg/manifest.json` ve `svg/objects/*.svg` gibi büyük verileri içerir. Yalnızca aynı OAuth sahibi okuyabilir. Normal dosyalarla aynı boyut ve saklama sınırları uygulanır. Hiçbir katman API anahtarları, OAuth belirteçleri, biletler, kaynak metni veya ham base64 içermez.

## CLI’de bekleme ve yeniden deneme {#cliの待機と再試行}

> [!DETAILS] Belirtimler ve işlemler
>
> Durum sorgusunda geçici HTTP `502`, `503`, `504` veya geçersiz JSON alınırsa CLI yalnızca aynı işin durum sorgusunu **en fazla 5 kez** yeniden dener. Beklemeler 1, 2, 4, 8 ve 8 saniyedir, toplam süre uzamaz. İş oluşturma, yükleme, belirteç yenileme ve dosya doğrulama otomatik yinelenmez. Kimlik doğrulama ve izin hataları hemen döner. CLI’nin beklemeyi bırakması sunucudaki işin durduğu anlamına gelmez.

## CLI JSON biçimi {#cliのjson形式}

> [!DETAILS] Belirtimler ve işlemler
>
> `--json` ile standart çıktıda aşağıdaki biçimler kullanılır. API anahtarı, `uploadTicket` ve `jobTicket` dahil edilmez.
>
> - **Başarı (çıkış kodu `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI veya API hatası (çıkış kodu `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **LaTeX hatası gibi bir sorunla sona eren iş (çıkış kodu `2`).** `result` iş verilerini ve kaydedilen yolları içerir. Yanıtta `success: false` bulunur.

## Eski sürümlerden geçiş ve kurtarma {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Eski güncelleyiciyi taşıma ve çıkarma hatalarını giderme
>
> ### v1.2.x root güncelleyiciden ayrıcalıkları ayrılmış güncelleyiciye geçiş {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> v1.2.x dahil bu sürüme kadar Update Manager root hizmeti olarak çalışıyordu. v1.3.0’dan itibaren sürekli denetleyici `latex-renderer-update` olarak çalışır, kısa ömürlü root yardımcısı sabit işlemleri kabul eder. Eski güncelleyiciden web güncellemesi `Application Update Manager must use a separate non-root build tree` ile durabilir. Aynı web işlemini tekrarlamayın.
>
> Bu tek seferlik geçişte [v1.3.6 sunucu dağıtımını](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6) kullanın. Normal kullanıcı olarak [dağıtımı indirme ve doğrulama](/tr/docs/self-hosting/#v1-6-9をダウンロードして検証) adımlarında ilk `version=` satırını `version=1.3.6` olarak değiştirin. Doğrulama ve çıkarma sırasında ayarlanan `bundle_root` değerini korumak için aynı terminalde kalın.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Betik root olarak aynı değişmez sürümü yeniden indirip özeti, etiket/commit’i, Sigstore paketini, arşiv sınırlarını ve meta verileri doğrular. Yalnızca `gh` dosyasını `/usr/local/bin/gh` veya `/usr/bin/gh` içinde, root’a ait ve grup ya da diğerleri için yazılamaz olduğunda kabul eder. Root `verified`, ayrıcalıksız `bootstrap-build` (pnpm ayrı bir Corepack aracısıyla sabitlenir) ve root `assembly` ağaçlarını ayırır. Önceki yöneticiyi ancak ortak değişiklik kilidini aldıktan sonra durdurur, hata olursa yeniden başlatır. Sonrasında şu komutlarla `User=latex-renderer-update` değerini ve her hizmetin `active` durumunu denetleyin. Ardından normal web veya yönetim CLI güncellemelerini kullanın.
> Web ve API sudo ayrıcalığı veya GitHub belirteci almaz.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar çıkarmayı Function not implemented ile durduruyor {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Ubuntu’da GNU `tar` aracı `openat2` kullanıyorsa güncelleyicideki `RestrictSUIDSGID=true` kısıtlaması alt dizinli arşivlerin çıkarılmasını `ENOSYS` (Function not implemented) ile durdurabilir. Düzeltilen güncelleyici GNU `tar` ile incelemeyi ve imza doğrulamasını korur. Yalnızca çıkarma `/usr/bin/bsdtar` aracına geçer ve boş, özel bir geçici klasörde sahiplik, ACL ve genişletilmiş öznitelikler aktarılmadan yapılır. `RestrictSUIDSGID` korunur, sistemdeki `tar` yerinde kalır.
>
> Eski güncelleyici kendi düzeltmesini çıkarırken de hata verebilir. Etkin işlem bulunmadığını, uygulama ve veritabanının sağlam olduğunu, şifrelenmiş bir yedeğin doğrulandığını kontrol edin. Kurulu `bootstrap-v1` ile **önce yalnızca bağımsız güncelleyiciyi** düzeltmeyi içeren yayımlanmış sürüme yükseltin.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Yeni güncelleyici sürümünü ve `ready` ile `pending=false` değerlerini doğrulayın. Sonra aynı sürümü web üzerinden veya yönetim CLI’sinin normal `update apply` komutuyla uygulamaya geçirin.
>
> `v1.4.0-rc.3` güncelleyicisinde bilinen bir sorun vardır. Root tarafından yapılan paket kopyası ayrıcalıksız sahipliği korur ve `Release extraction requires a private regular bundle` ile başarısız olur. Denetimleri kaldırmayın. Önce güncelleyiciyi sahiplik düzeltmesi içeren yayımlanmış bir sürüme, sonra uygulamayı yükseltin. Root/systemd altında çıkarmayı `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs` ile bağımsız olarak sınayabilirsiniz.

> [!DETAILS] Güncelleme veya TeX değişikliği kilitlerini inceleme
>
> ### Değişiklik kilidi kullanımda {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` uygulama güncellemesi ile TeX değişikliğinin çakışmasını önler. Etkin işlemin bitmesini bekleyin. **`/run/latex-renderer/mutation.lock` dosyasını asla silmeyin.** Silmek aynı anda iki bağımsız kilit oluşmasına yol açabilir. Bir güncellemede TeX ortamı içeriden geri yüklenirken yaşanırsa işlem kendi kilidiyle çakışıyor olabilir. Yinelemeden önce günlükleri ve durdurulan hizmetleri inceleyin.
>
> Yalnızca çalışan işlem yoksa ve günlük önceki işlemin bittiğini doğruluyorsa iki yöneticiyi durdurun ve kilidi tutan süreci inceleyin.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Ancak bu sürecin bitmiş bir işlemden kalmış sahipsiz kilit yardımcısı olduğunu doğrularsanız süreci sonlandırıp yöneticileri yeniden başlatın.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Önceki sürüm adaylarında işleyici kimliği {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　v1.3.4 sürüm adayları
>
> İşleyici kimlik özetine giren dosya sayısı 5’ten 6’ya çıkınca `v1.3.4-rc.3` sürümünden `v1.3.4-rc.4` sürümüne güncelleme hizmet geçişinden önce başarısız oldu. Bu geçişte önceki uyumluluk bilgilerini de içeren `v1.3.4-rc.5` kullanın. Eklenen dosya da tüm paketin sağlama toplamı ve kaynak imzasıyla doğrulanır.

## Güncelleyicinin çalışma ortamları {#updaterの実行領域}

> [!DETAILS] Belirtimler ve işlemler
>
> Update Manager doğrulanmış dağıtımı içeren root `verified` ağacını, bağımlılık kurulumu ve derleme için ayrıcalıksız `build` ağacını ve izinli çıktılardan oluşan root `assembly` ağacını kesin olarak ayırır. Root olarak çalışan dağıtım betikleri her zaman `assembly` içindeki doğrulanmış kopyayı kullanır. Dağıtım kullanıcısıyla Cloudflare’a yayımlama gibi adımlar için root denetimlerinden sonra geçici `deployment-build` kopyası kullanılır. Geri almada da bu geçerlidir.

## Windows kurulum yolları ve korumaları {#windowsの配置と保護}

> [!DETAILS] Belirtimler ve işlemler
>
> Windows’ta kurulum konumu değiştirildiğinde varsayılan komut dizini o konumun `bin` alt klasörü olur. `LATEX_RENDER_BIN_DIRECTORY` ayarlanırsa yönetilen başlatıcılar buraya yerleştirilir, kullanıcı PATH’i ve Local MCP aynı yolu kullanır. Alternatif başlatıcılar korunur. `setup repair` önceki kayıtlı yolu düzeltebilir. Eski PATH girdisi diğer uygulamalar için saklanır. Noktalı virgül, tırnak ve denetim karakteri içermeyen mutlak yollar kullanın. `--open` veya grafik arayüzü tarayıcı ya da görüntüleyiciyi açamazsa kaydedilmiş PDF korunur.

## Proje paylaşımı ve saklama {#保存プロジェクトの共有-保持}

> [!DETAILS] Paylaşım ve saklama kuralları
>
> - Web (`/app/`), CLI, genel API, Local MCP ve Remote MCP kullanıcının projelerini ve değişmez revizyon geçmişini paylaşır. Aynı kullanıcının birden çok API anahtarı veya hizmet hesabı bunları görebilir ve güncelleyebilir. Projeye kaydetmeden geçici girdi ve işler de kullanılabilir.
> - Girdi, ana belge, motor ve çıktı biçimlerinin bileşimi revizyonu belirler. Çıktıları farklı revizyonlar aynı girdiyi paylaşabilir. **Yeniden dönüştür** işleminde seçilen biçimler yalnızca o çalıştırmada geçerlidir. Revizyonda kayıtlı çıktılar için ilk yapılandırmayı seçin.
> - Etkin bir revizyonun başvurduğu girdi, başvurusuz saklama süresi dolsa da korunur ve kullanıcının kotasına dahildir. Proje silinince kaydı gizlenir. Başvuran son proje silinip ilişkili işler de ortadan kalktığında girdi korumasını kaybeder; süresi dolunca düzenli temizlikte silinir. Hemen ve tamamen silinmesi için yöneticiye başvurun.

## Arayüz dili {#表示言語}

Düzenleyici **Arayüz dili** tercihini hesapta saklar. Tercih yoksa tarayıcı dillerini sırasıyla dener ve desteklenen dil bulamazsa İngilizce kullanır. Belge motoru ve karakter kodlaması ayrı ayarlanır.

| Alan | Çeviri kapsamı |
| --- | --- |
| Web ve kurulum | Eylemler, işlem durumları, onaylar ve tanılama. |
| CLI ve MCP | CLI yardımı ve istemleri terminal dilini kullanır. Uzak MCP açıklamaları hesap dilini kullanır. |
| Düzenleyici | Düzenleme, bulma ve değiştirme, kaydetme ve çakışmalar, derleme durumları ve önizleme denetimleri 18 dilde sunulur. |
| Herkese açık kılavuzlar | Tüm kılavuzlar aşağıdaki 18 dilde kullanılabilir. Dili sayfanın üst kısmındaki menüden değiştirin. |

Düzenleyici İngilizce, Japonca, Basitleştirilmiş Çince, Korece, İspanyolca, Portekizce, Fransızca, Almanca, İtalyanca, Rusça, Türkçe, Lehçe, Çekçe, Felemenkçe, İsveççe, Norveççe Bokmål, Danca ve Finceyi destekler. TeX ve dış paket günlükleri tanılama için özgün metni korur.

## Denetim günlüklerini kurtarma {#監査ログの復旧}

Veritabanı geri yüklendikten sonra dışa aktarma konumu (`export_database_id`, satır sırası `export_sequence` ve `export_token`) veritabanı durumuyla eşleşmeyebilir. Bu durumda dışa aktarma ve temizlik verileri korumak için durur.

1. İnceleme ve kurtarma boyunca dışa aktarma ve temizlik hizmetleriyle zamanlayıcılarını durdurun.
2. Geri yüklenen veritabanını, mevcut şifrelenmiş dışa aktarımları ve tüm yeni/eski denetim noktası dosyalarını ayrı saklayın. Geri yüklenen veritabanının bütünlüğünü, yabancı anahtarlarını ve geçiş durumunu doğrulayın.
3. Uyumlu denetim noktası yoksa ve mevcut satırları yeniden dışa aktarmaya karar verdiyseniz denetim noktası dosyalarını etkin yolların dışına taşıyın. Ayarlanmışsa `AUDIT_EXPORT_CHECKPOINT` yoluna da bakın. Denetim satırları, SQLite sıra değerleri ve `export.lock` korunmalıdır.
4. Üretim hizmetinin kimlik bilgileriyle elle dışa aktarın. Zamanlayıcıları yeniden başlatmadan önce çıktının şifresinin çözülebildiğini ve biçim 3 ile yeni bir denetim noktası oluşturulduğunu doğrulayın.

Yalnızca geri yüklenen veritabanındaki satırlar yeniden dışa aktarılır. Yinelenen kayıtları eşleştirmek için `export_database_id`, `export_sequence` ve `export_token` değerlerini birlikte kullanın. Tek başına tarih ve saat bir satırı tanımlamaz.
