---
slug: index
category: Başlarken
title: LaTeX Renderer kılavuzu
description: LaTeX belgelerini tarayıcıdan, terminalden veya bir yapay zekâ asistanından PDF’ye dönüştürün.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## İlk PDF’nizi oluşturun {#最短でpdfを作る}

1. [Web uygulamasını](/app/) açın ve yöneticinizin belirttiği yöntemle giriş yapın.
2. `.tex` dosyasını seçip **PDF’ye dönüştür** düğmesine basın. Belge görsel veya kaynakça kullanıyorsa ilgili dosyaları belgeyle birlikte bir ZIP arşivine koyun ve arşivi seçin.
3. Sonuçlarda PDF’yi açın. Daha sonra web uygulamasındaki **Geçmiş** bölümünden yeniden erişebilirsiniz.

Deneme belgeniz yoksa bu örneği UTF-8 kodlamasıyla `main.tex` olarak kaydedin.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Japonca örneği ve ZIP yapısı](/tr/docs/projects/)
- [Web uygulaması kılavuzu](/tr/docs/web/)
- [PDF ile PNG’yi kaydetme ve SVG çıkarmayı yeniden deneme](/tr/docs/outputs/)

Terminalde çalışmak için [sisteminize uygun CLI’yi kurun](/tr/docs/client/). Bağlantıyı `n624-latex setup` ile yapılandırın. `main.tex` dosyasını kaydettiğiniz klasörde `n624-latex main.tex` çalıştırarak `main.pdf` oluşturun.

## Çalışma yönteminizi seçin {#利用方法を選ぶ}

| Yapmak istediğiniz işlem | Araç | Kılavuz |
| --- | --- | --- |
| **Belgeleri tarayıcıda dönüştürme** | Web uygulaması | [Tarayıcıda dönüştürme](/tr/docs/web/) |
| **Terminalden dönüştürüp sonuçları bilgisayara kaydetme** | Windows, macOS veya Linux için CLI | [CLI kurulumu](/tr/docs/client/) |
| **ChatGPT veya Claude üzerinden dönüştürme** | OAuth ile Remote MCP | [ChatGPT veya Claude’u bağlama](/tr/docs/mcp/) |
| **Codex veya Claude Code ile yerel belgeler üzerinde çalışma** | CLI, Local MCP ve beceri | [Codex veya Claude Code kullanımı](/tr/docs/integrations/) |
| **Uygulamanızdan dönüşümleri otomatikleştirme** | HTTP API | [Genel API](/tr/docs/api/) |
| **Hizmeti kendi Linux sunucunuzda çalıştırma** | Kendi sunucunuzda barındırma | [Sunucunuzu yönetme](/tr/docs/self-hosting/) |

## Gereksinimler {#必要なもの}

- **Web uygulaması ve Remote MCP.** Sunucu yöneticisinin belirttiği yöntemle giriş yapabileceğiniz bir hesap gerekir.
- **CLI, Local MCP ve HTTP API.** Yöneticiden `lrk_` ile başlayan bir işleme API anahtarı isteyin.
- **Kurulum yöntemine göre CLI gereksinimleri**
  - Debian ve Ubuntu’da APT: Pakete ayrı bir Node.js sürümü dahildir.
  - macOS’ta Homebrew: Gerekli Node.js sürümünü Homebrew kurar.
  - Windows, macOS veya Linux için indirilebilir yükleyici: Node.js 24 veya üzeri gerekir.

Belgeleri sunucu derler. Bu yöntemlerin hepsini bilgisayarınıza TeX Live kurmadan kullanabilirsiniz.

> [!WARNING]
> API anahtarlarını yapay zekâ sohbetlerine, kaynak koda, Git depolarına veya günlüklere eklemeyin. Bir anahtarın açığa çıktığından şüpheleniyorsanız yöneticiden anahtarı derhal iptal edip yenisini vermesini isteyin.

Giriş veya dönüştürme sorunları için [sorun giderme kılavuzuna](/tr/docs/troubleshooting/) bakın.
