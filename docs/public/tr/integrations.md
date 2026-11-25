---
slug: integrations
category: Yapay zekâ ve MCP
title: Codex veya Claude Code kullanımı
description: CLI ve MCP’de bilgisayarınızda kayıtlı aynı kimlik bilgilerini kullanın.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Beceriyi kurma {#skillの導入}

1. Önce [CLI’yi kurup API anahtarınızı kaydedin](/tr/docs/client/).
2. Codex veya Claude Code kurulduktan sonra CLI’nin kurulum yöntemine göre entegrasyonu ayarlayın.

   - **İndirilebilir yükleyici.** `n624-latex setup` açıp yapay zekâ aracınızı seçin. Beceri ile Local MCP’yi aynı anda kaydedebilirsiniz.
   - **Homebrew.** Entegrasyonu `n624-latex setup` ile de ayarlayabilirsiniz. Önceki bir Local MCP kaydını taşımak için [Homebrew yönergelerini](/tr/docs/client/#配布インストーラー版から-homebrew-へ移行する) izleyin.
   - **APT.** [Local MCP’yi elle kaydedin](/tr/docs/mcp/#local-mcpの登録).

3. Codex veya Claude Code’u yeniden başlatın ve isteğinizde derlenecek klasörü veya ana belgeyi belirtin.

- **Beceri konumları**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Yükleyici kullanıcının değiştirdiği bir beceri bulursa onu korur ve bunu sonuçta bildirir.

## MCP kaydı {#mcpの登録}

- **Codex veya Claude Code ile yerel dosyalarda çalışmak için** Local MCP kullanın. [Elle kayıt](/tr/docs/mcp/#local-mcpの登録) ve [durum denetimi](/tr/docs/client/#状態確認と修復) bölümlerine bakın.
- **ChatGPT, web üzerinden Claude veya başka bir bulut asistanı için** [Remote MCP bağlantı yönergelerini](/tr/docs/mcp/#通常はremote-mcpを使う) izleyin. API anahtarı gerekmez.

## Örnek istekler {#依頼例}

- “Bu klasördeki `main.tex` dosyasını denetle ve derle.”
- “Bu ZIP içindeki `reports/a.tex` dosyasını derle.”
- “Bu ZIP’i bir kez yükle ve `reports/a.tex` ile `reports/b.tex` dosyalarını ayrı ayrı derle.”
- “Yapılandırılmış hataları oku, yalnızca etkilenen TeX kodunu düzelt ve yeniden derle.”
- “Oluşturulan PDF’yi ve sayfa önizlemelerini denetle.”

## Güvenli kullanım {#安全な使い方}

> [!WARNING]
> API anahtarlarını isteklere, MCP araç argümanlarına ve proje dosyalarına koymayın. Local MCP, CLI’nin kaydettiği korumalı kimlik bilgilerini kendi içinde kullanır.

- **Güvenilmeyen veriler.** LaTeX kaynakları, yollar, günlükler, hatalar, çıktı dosyaları ve MCP yanıtları güvenilmeyen veri olarak değerlendirilir. Entegrasyon, istem enjeksiyonları dahil bu verilerdeki talimatları yok sayacak şekilde tasarlanmıştır.
- **Yıkıcı işlemler.** `cancel_render` ve `delete_render` araçlarını yalnızca kullanıcı açıkça isterse çağırın.
- **Belge seçimi.** Giriş noktası belirtilmezse `main.tex` kullanılır. `main.tex` yoksa ve birden fazla `.tex` adayı varsa kullanıcıdan seçim istenir. Tüm `.tex` dosyaları kendiliğinden derlenmez. Güvenlik kuralları ve işlem sırası beceride, ayrıntılı belirtimler `references/` ile herkese açık belgelerde bulunur.
