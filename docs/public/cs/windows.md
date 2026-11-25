---
slug: windows
category: Instalace
title: Instalace CLI ve Windows
description: Nainstalujte CLI z PowerShellu, uložte klíč API a vytvořte PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalace {#インストール}

1. Připravte si **Node.js 24 nebo novější** a klíč API (`lrk_...`) od správce.
2. Otevřete PowerShell pod svým běžným účtem a spusťte následující příkazy.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Vložte klíč do skrytého vstupního pole. Windows jej zašifruje a uloží pro aktuálního uživatele.
4. Po instalaci otevřete **nové okno PowerShellu**. Pokud [používáte vlastní server](/cs/docs/cli/#接続先サーバー), před převodem nastavte jeho adresu.

Chcete-li klíč uložit znovu, otevřete nastavení příkazem `n624-latex setup`.

## První převod {#最初の変換}

1. V Průzkumníku souborů otevřete složku s `main.tex`. Můžete použít [ukázkový dokument](/cs/docs/#最短でpdfを作る).
2. Do adresního řádku Průzkumníka napište `powershell` a stiskněte Enter. V otevřeném okně PowerShellu spusťte následující příkaz.

```powershell
n624-latex main.tex
```

Ve stejné složce se vytvoří `main.pdf`. Pro práci se ZIP nebo stažení více výstupů viz [Převod v CLI](/cs/docs/cli/#レンダリング).

## Aktualizace {#更新}

V PowerShellu spusťte `n624-latex setup` a na obrazovce nastavení aktualizujte klienta.

> [!DETAILS] 履歴資料　Přechod z v1.6.9 nebo starší
>
> Podle [pokynů k instalaci](#インストール) spusťte stejný instalační program s `-SkipCredential`. Zachová se uložený klíč a přidá se `n624-latex`. Pokud jste změnili instalační složku, [uveďte stejné umístění](/cs/docs/reference/#windowsの配置と保護). Stávající skripty mohou nadále používat `latex-render`.

## Odstranění pouze klíče API {#apiキーだけを削除}

Chcete-li ponechat klienta a odebrat pouze uložený klíč, spusťte tento příkaz.

```powershell
n624-latex auth logout
```

## Odinstalace {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Ve výchozím nastavení se odstraní klient, uložený klíč API a spravované dovednosti pro Codex a Claude. Pro zachování přihlašovacích údajů přidejte `-KeepCredential`, pro zachování dovedností `-KeepSkills`.
