---
slug: troubleshooting
category: Sorun giderme ve güvenlik
title: Sorun giderme
description: Giriş, kurulum, dönüştürme ve indirme sorunlarının nedenlerini belirleyin.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Nereden başlamalı {#確認する順序}

1. Genel bir olay veya bakım olup olmadığını görmek için **[hizmet durumunu](/status/) kontrol edin**.
2. **Mevcut işi kontrol edin.** Dönüştürmeyi başlattıysanız **Geçmiş** bölümünde aynı işi açın veya CLI’de `n624-latex jobs get <jobId>` çalıştırın.
3. **Tanılamayı ve günlüğü inceleyin.** Web’de sonuç sayfasındaki tanılamayı açın. CLI’de `.render/errors.json` ile ayrıntılı `.render/compile.log` günlüğüne bakın.

## Sık karşılaşılan sorunlar {#代表的な問題}

### Kurulum ve giriş {#インストール-ログイン}

- **`n624-latex` veya `latex-render` bulunamıyor.**
  Yeni bir terminal veya PowerShell penceresi açın. Sorun sürerse [Linux veya macOS’ta PATH](/tr/docs/client/#linux-macos) ya da [Windows kurulum yönergeleri](/tr/docs/windows/#インストール) bölümünü inceleyin.
- **Web uygulamasına giriş yapılamıyor.**
  Kayıtlı hesabı ve yöneticinin belirttiği yöntemi (parola, OIDC veya Cloudflare Access) kullanın. ChatGPT veya Claude’dan bağlantı takılıyorsa [Remote MCP bağlantısını denetleme](/tr/docs/mcp/#chatgptなどの接続を確認する) bölümüne bakın.
- **CLI `401` veya `403` döndürüyor.**
  Kayıtlı anahtarı denetlemek için `n624-latex auth status` çalıştırın. Yöneticiden anahtarın etkin olduğunu ve `render:create` ile `render:read:own` izinlerine sahip olduğunu doğrulamasını isteyin. Gerekirse [anahtarı yeniden kaydedin](/tr/docs/cli/#認証). Kendi sunucunuz varsa [sunucu URL’sini (`LATEX_RENDER_BASE_URL`)](/tr/docs/cli/#接続先サーバー) de kontrol edin.

### Yükleme ve dönüştürme {#アップロード-変換}

- **ZIP’te ana belge bulunamıyor.**
  Varsayılan giriş kökteki `main.tex` dosyasıdır. Üst klasörü de arşive ekleyip eklemediğinizi denetleyin veya belgenin göreli yolunu belirtin. [ZIP hazırlama](/tr/docs/projects/#構成) bölümüne bakın.
- **Dosya boyutu veya uzantısı reddediliyor.**
  Gereksiz üretilmiş dosyaları ve desteklenmeyen dosyaları kaldırın ya da `.latexrenderignore` yapılandırın. [Kabul edilen dosyaları ve sınırları](/tr/docs/projects/#制限) inceleyin.
- **Dönüştürme kuyrukta kalıyor veya bağlantı kesiliyor.**
  Sunucu çalışmaya devam ediyor olabilir. Yeni iş oluşturmadan önce aynı sonuç sayfasını açın veya aynı iş kimliğini sorgulayın.
- **Paket veya yazı tipi eksik ya da süre doluyor.**
  Kullanılabilir adları [işleme ortamında](/app/environment/) arayın. Süre doluyorsa günlüğün durduğu noktanın yakınında karmaşık makroları, büyük görselleri ve TikZ çizimlerini denetleyin.

### Dosya indirme {#成果物の取得}

- **PDF var ancak SVG yok.**
  **Kısmi başarı** görünüyorsa önce PDF’yi kaydedip **Yalnızca SVG'yi yeniden dene** seçeneğini kullanın. [SVG çıkarmayı yeniden deneme](/tr/docs/outputs/#pdf-はあるが-svg-が失敗した場合) bölümüne bakın.
- **PNG önizlemesi hâlâ hazırlanıyor.**
  Kısa bir süre bekleyin veya aynı sayfayı yeniden açın. Nihai PDF’yi beklemeden indirebilirsiniz.
- **Hedef kullanımda veya `OUTPUT_BUSY` görünüyor.**
  Çıktı PDF’sini açık tutan görüntüleyiciyi kapatın ya da klasöre yazan işlemin bitmesini bekleyip yeniden indirin.
- **Sonucun süresi dolmuş veya depolama alanı yetersiz.**
  Süresi dolan sonuç için kayıtlı revizyonu ya da yerel dosyaları yeniden dönüştürün. Kotanıza ulaştıysanız gereksiz tamamlanmış işleri silin. Sunucu diski doluysa yöneticiye bildirin.

## Yardım isteme {#問い合わせ}

- **Sunucu yöneticisi.** Sorunun saatini, hangi işlemin durduğunu, hata kodunu ve varsa iş kimliğini (`job_...`) iletin.
- **GitHub’da herkese açık bildirim.** Sır veya kişisel belge içermeyen, sorunu yeniden oluşturmaya yetecek en kısa adımları verin. **API anahtarlarını, çerezleri, özgün belgeyi, PDF’yi ve ayıklanmamış tam günlükleri asla yayımlamayın.**
