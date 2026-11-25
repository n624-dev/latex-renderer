---
slug: windows
category: Kurulum
title: Windows’ta CLI kurulumu
description: CLI’yi PowerShell’den kurun, API anahtarınızı kaydedin ve PDF oluşturun.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Kurulum {#インストール}

1. **Node.js 24 veya üzerini** ve yöneticinizin verdiği API anahtarını (`lrk_...`) hazırlayın.
2. Normal kullanıcı hesabınızla PowerShell’i açıp şu komutları çalıştırın.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Anahtarı gizli giriş alanına yapıştırın. Windows anahtarı şifreler ve geçerli kullanıcı için kaydeder.
4. Kurulumdan sonra **yeni bir PowerShell penceresi** açın. [Kendi sunucunuzu kullanıyorsanız](/tr/docs/cli/#接続先サーバー) dönüştürmeden önce adresini belirtin.

Bir anahtarı yeniden kaydetmek için `n624-latex setup` ile ayarları açın.

## İlk dönüştürme {#最初の変換}

1. Dosya Gezgini’nde `main.tex` dosyasını içeren klasörü açın. [Örnek belgeyi](/tr/docs/#最短でpdfを作る) kullanabilirsiniz.
2. Gezginin adres çubuğuna `powershell` yazıp Enter’a basın. Açılan PowerShell penceresinde şu komutu çalıştırın.

```powershell
n624-latex main.tex
```

Aynı klasörde `main.pdf` oluşturulur. ZIP kullanımı veya birden fazla dosya indirme için [CLI ile dönüştürme kılavuzuna](/tr/docs/cli/#レンダリング) bakın.

## Güncelleme {#更新}

PowerShell’de `n624-latex setup` çalıştırıp ayarlar ekranından istemciyi güncelleyin.

> [!DETAILS] 履歴資料　v1.6.9 veya daha eski bir sürümden geçiş
>
> [Kurulum yönergelerindeki](#インストール) aynı yükleyiciyi `-SkipCredential` ile çalıştırın. Kayıtlı anahtar korunur ve `n624-latex` eklenir. Kurulum klasörünü değiştirdiyseniz [aynı konumu belirtin](/tr/docs/reference/#windowsの配置と保護). Mevcut betikler `latex-render` kullanmaya devam edebilir.

## Yalnızca API anahtarını kaldırma {#apiキーだけを削除}

İstemciyi koruyup yalnızca kayıtlı anahtarı kaldırmak için şu komutu çalıştırın.

```powershell
n624-latex auth logout
```

## Kaldırma {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Varsayılan olarak istemci, kayıtlı API anahtarı ve Codex ile Claude için yönetilen beceriler kaldırılır. Kimlik bilgilerini veya becerileri korumak için sırasıyla `-KeepCredential` veya `-KeepSkills` ekleyin.
