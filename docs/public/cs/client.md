---
slug: client
category: Instalace
title: Instalace CLI
description: Nainstalujte CLI ve Windows, macOS nebo Linuxu a vytvořte první PDF z terminálu.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Podporované platformy {#対応環境}

Nainstalujte CLI způsobem odpovídajícím vašemu systému a uložte klíč API (`lrk_...`) od správce. Dokumenty LaTeX překládá server.

| Platforma | Způsob instalace | Node.js |
| --- | --- | --- |
| Debian 12 / 13 nebo Ubuntu 24.04 / 26.04 (amd64 nebo arm64) | **[Balíček APT](#debian-ubuntu-の-apt-パッケージ)** | Součást balíčku |
| Windows | **[Pokyny pro Windows](/cs/docs/windows/)** | 24 nebo novější |
| macOS (Apple Silicon nebo Intel) | **[Homebrew](#homebrew-でインストール)** | Instaluje Homebrew |
| macOS nebo jiné distribuce Linuxu | **[Instalační program ke stažení](#linux-macos)** | 24 nebo novější |

## Instalace přes APT v Debianu nebo Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Stáhněte `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Soubor obsahuje veřejný podpisový klíč repozitáře APT pro LaTeX Renderer.
2. Ve složce se staženým souborem nainstalujte balíček následujícími příkazy.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Pokračujte částí [Vytvoření prvního PDF](#最初の-pdf-を作る). Při instalaci serveru postupujte podle [návodu pro vlastní server](/cs/docs/self-hosting/).

## Instalace přes Homebrew {#homebrew-でインストール}

Na Macu s nainstalovaným Homebrew spusťte tyto příkazy.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Po uložení klíče API pokračujte částí [Vytvoření prvního PDF](#最初の-pdf-を作る).

### Přechod ze staženého instalačního programu na Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Klíč API i nastavení MCP si můžete ponechat. Příkazem `type -a n624-latex` zjistěte, který spustitelný soubor shell najde jako první. Pokud má přednost dřívější instalace, spusťte přímo verzi z Homebrew.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Má-li příkaz `n624-latex` používat verzi z Homebrew, přesuňte v `PATH` shellu adresář `bin` z Homebrew před adresář starší instalace.

Pokud chcete převést i Local MCP, změňte příkaz v položce `latex-renderer` svého nástroje AI na absolutní cestu k `bin/latex-renderer-mcp` z Homebrew. Umístění instalace zjistíte pomocí `brew --prefix`.

Před odstraněním starší verze restartujte nástroj AI a ověřte, že se připojí k Local MCP z Homebrew. Při odinstalaci zadejte absolutní cestu ke staršímu spouštěči a ponechte klíč a dovednosti. Pro výchozí instalaci použijte tento příkaz.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Příprava staženého instalačního programu {#配布インストーラーの準備}

Pod běžným uživatelským účtem nainstalujte **Node.js 24 nebo novější** a ověřte verzi pomocí `node --version`. Ve Windows postupujte podle [pokynů pro Windows](/cs/docs/windows/).

## Linux a macOS {#linux-macos}

V terminálu stáhněte instalační program do dočasné složky a spusťte jej pomocí Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Pokud shell nenajde `n624-latex`, otevřete nový terminál. Jestliže potíže přetrvají, spusťte `export PATH="$HOME/.local/bin:$PATH"` a stejný řádek přidejte do konfiguračního souboru shellu, například `~/.bashrc` nebo `~/.zshrc`.

## Vytvoření prvního PDF {#最初の-pdf-を作る}

1. Pod běžným účtem otevřete nastavení a uložte klíč API. Pro vlastní instalaci [nejprve vyberte server](/cs/docs/cli/#接続先サーバー). Nelze-li otevřít prohlížeč, [předejte klíč přes standardní vstup](/cs/docs/cli/#認証).

```sh
n624-latex setup
```

2. Ve složce obsahující `main.tex` spusťte tento příkaz. Můžete použít [ukázkový dokument](/cs/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

Ve stejné složce se vytvoří `main.pdf`. Volbu cílového umístění a práci se ZIP, PDF a SVG popisuje [Převod a stahování v CLI](/cs/docs/cli/#レンダリング).

## Windows {#windows}

[Pokyny pro Windows](/cs/docs/windows/) používají PowerShell. Windows DPAPI šifruje uložený klíč pro aktuálního uživatele. Viz [Změna umístění a oprava PATH](/cs/docs/reference/#windowsの配置と保護).

## Aktualizace {#更新}

### Aktualizace balíčku APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Připojení a uložený klíč API zůstanou zachovány. Pro aktualizaci vlastního serveru použijte [obrazovku aktualizací ve správě](/cs/docs/updates/).

### Aktualizace balíčku Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Aktualizace klienta ze staženého instalátoru {#配布インストーラー版の更新}

Spusťte níže uvedený příkaz nebo zopakujte příkaz počáteční instalace.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Aktualizace klientů v1.6.9 a starších
>
> Pokud je nainstalován pouze `latex-render`, zopakujte instalaci. [Ve Windows můžete aktualizovat bez nového zadání uloženého klíče](/cs/docs/windows/#更新). V macOS a Linuxu lze také provést aktualizaci pomocí `latex-render setup` a nový příkaz přidat pomocí `latex-render setup repair`. Stávající skripty mohou nadále používat `latex-render`.

> [!DETAILS] Jak funguje instalace a aktualizace
>
> - Pokud SHA-256 staženého ZIP odpovídá nainstalované verzi, zkontrolují se spravovaná nastavení bez opětovné instalace souborů.
> - Při aktualizaci přesune instalační program předchozí verzi do zálohy s časovým razítkem. Zachová jiné spouštěče, registrace MCP a dovednosti upravené uživatelem.

## Kontrola a oprava instalace {#状態確認と修復}

Následujícími příkazy zkontrolujete stav při libovolném způsobu instalace.

```sh
n624-latex setup status
n624-latex doctor --json
```

- U instalace APT přeinstalujte balíček příkazem `sudo apt install --reinstall n624-latex`.
- U Homebrew přeinstalujte balíček příkazem `brew reinstall n624-dev/tap/n624-latex`.
- U staženého instalátoru opravte spravované spouštěče a integrace příkazem `n624-latex setup repair`.

## Uložení a obnova výstupních souborů {#成果物の保存と復旧}

`n624-latex main.tex` uloží PDF do aktuální složky. PDF, protokoly a obrázky ukládané příkazy `render` a `jobs download` popisují [Výstupní soubory CLI](/cs/docs/cli/#成果物). Pokud je cíl obsazený, viz [Řešení potíží](/cs/docs/troubleshooting/#成果物の取得).

## Odinstalace {#アンインストール}

Odeberte balíček APT pomocí `sudo apt remove n624-latex`. Chcete-li odebrat i klíč uživatele, před odinstalací spusťte `n624-latex auth logout`.

Odeberte balíček Homebrew pomocí `brew uninstall n624-dev/tap/n624-latex`. Uložený klíč a nastavení MCP v nástroji AI zůstanou zachovány. Jestliže je již nepotřebujete, před odinstalací se odhlaste a v nástroji AI odstraňte konfiguraci MCP.

Pro stažený instalátor spusťte tento příkaz.

```sh
n624-latex setup remove --yes
```

Pro zachování přihlašovacích údajů přidejte `--keep-credential`, pro zachování dovedností `--keep-skills`. Odinstalaci pomocí skriptu pro Windows popisují [pokyny pro Windows](/cs/docs/windows/#アンインストール).
