---
slug: client
category: Instalacja
title: Instalacja CLI
description: Zainstaluj CLI w systemie Windows, macOS lub Linux i utwórz pierwszy PDF z terminala.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Obsługiwane platformy {#対応環境}

Zainstaluj CLI metodą odpowiednią dla systemu i zarejestruj klucz API (`lrk_...`) otrzymany od administratora. Dokumenty LaTeX kompiluje serwer.

| Platforma | Metoda | Node.js |
| --- | --- | --- |
| Debian 12 / 13 lub Ubuntu 24.04 / 26.04 (amd64 albo arm64) | **[Pakiet APT](#debian-ubuntu-の-apt-パッケージ)** | W pakiecie |
| Windows | **[Instrukcja dla Windows](/pl/docs/windows/)** | Wersja 24 lub nowsza |
| macOS (Apple Silicon lub Intel) | **[Homebrew](#homebrew-でインストール)** | Instaluje Homebrew |
| macOS lub inne dystrybucje Linux | **[Instalator do pobrania](#linux-macos)** | Wersja 24 lub nowsza |

## Instalacja przez APT w Debianie lub Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Pobierz `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). Plik zawiera klucz publiczny do weryfikacji podpisu repozytorium APT LaTeX Renderer.
2. W katalogu, w którym zapisano plik, wykonaj poniższe polecenia, aby zainstalować pakiet.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Przejdź do sekcji [Utwórz pierwszy PDF](#最初の-pdf-を作る). Aby zainstalować serwer, postępuj zgodnie z [instrukcją dla własnego serwera](/pl/docs/self-hosting/).

## Instalacja przez Homebrew {#homebrew-でインストール}

Wykonaj te polecenia na Macu z zainstalowanym Homebrew.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Po zarejestrowaniu klucza API przejdź do sekcji [Utwórz pierwszy PDF](#最初の-pdf-を作る).

### Przejście z instalatora do pobrania na Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Możesz zachować klucz API i konfigurację MCP. Wykonaj `type -a n624-latex`, aby sprawdzić, które polecenie powłoka znajduje pierwsze. Jeśli pierwsza jest starsza instalacja, uruchom bezpośrednio wersję Homebrew.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Aby `n624-latex` używało wersji Homebrew, w zmiennej `PATH` powłoki umieść katalog `bin` Homebrew przed ścieżką wcześniejszej instalacji.

Aby zmienić także Local MCP, w narzędziu AI ustaw polecenie we wpisie `latex-renderer` na bezwzględną ścieżkę do `bin/latex-renderer-mcp` z Homebrew. Położenie instalacji znajdziesz za pomocą `brew --prefix`.

Przed usunięciem starszej wersji uruchom ponownie narzędzie AI i sprawdź połączenie z Local MCP z Homebrew. Podczas odinstalowywania wskaż bezwzględną ścieżkę starszego programu uruchamiającego i zachowaj klucz oraz umiejętności. Dla instalacji w domyślnym miejscu wykonaj to polecenie.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Przygotowanie instalatora do pobrania {#配布インストーラーの準備}

Zainstaluj **Node.js w wersji 24 lub nowszej** dla swojego zwykłego konta i sprawdź wersję poleceniem `node --version`. W Windows skorzystaj z [instrukcji dla Windows](/pl/docs/windows/).

## Linux i macOS {#linux-macos}

W terminalu pobierz instalator do katalogu tymczasowego i uruchom go za pomocą Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Jeśli nie znaleziono `n624-latex`, otwórz nowy terminal. Jeśli to nie pomoże, wykonaj `export PATH="$HOME/.local/bin:$PATH"` i dopisz ten sam wiersz do pliku konfiguracyjnego powłoki, np. `~/.bashrc` lub `~/.zshrc`.

## Utwórz pierwszy PDF {#最初の-pdf-を作る}

1. Otwórz ustawienia jako zwykły użytkownik i zapisz klucz API. Jeśli korzystasz z własnego serwera, [najpierw podaj jego adres](/pl/docs/cli/#接続先サーバー). Jeśli nie można otworzyć przeglądarki, [zarejestruj klucz przez standardowe wejście](/pl/docs/cli/#認証).

```sh
n624-latex setup
```

2. Wykonaj to polecenie w katalogu, który zawiera `main.tex`. Możesz użyć [dokumentu przykładowego](/pl/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

W tym samym katalogu powstanie `main.pdf`. Informacje o wyborze miejsca zapisu oraz pracy z ZIP, PDF i SVG znajdziesz w sekcji [Konwersja i pobieranie za pomocą CLI](/pl/docs/cli/#レンダリング).

## Windows {#windows}

[Instrukcja dla Windows](/pl/docs/windows/) korzysta z PowerShell. Windows DPAPI szyfruje zapisany klucz dla bieżącego użytkownika. Zobacz [Zmiana miejsca instalacji i naprawa PATH](/pl/docs/reference/#windowsの配置と保護).

## Aktualizacje {#更新}

### Aktualizacja pakietu APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Zapisane połączenie i klucz API zostają zachowane. Do aktualizacji własnego serwera użyj [ekranu aktualizacji w administracji](/pl/docs/updates/).

### Aktualizacja pakietu Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Aktualizacja klienta z instalatora do pobrania {#配布インストーラー版の更新}

Wykonaj poniższe polecenie lub ponów polecenie początkowej instalacji.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Aktualizacja klientów w wersji 1.6.9 lub starszej
>
> Jeśli zainstalowano tylko `latex-render`, powtórz instalację. [W Windows możesz zaktualizować klienta bez ponownego podawania zapisanego klucza](/pl/docs/windows/#更新). W macOS i Linux można też zaktualizować go za pomocą `latex-render setup` i dodać nowe polecenie przez `latex-render setup repair`. Dotychczasowe skrypty mogą nadal używać `latex-render`.

> [!DETAILS] Jak działają instalacja i aktualizacja
>
> - Jeśli SHA-256 archiwum ZIP do pobrania zgadza się z zainstalowaną wersją, sprawdzane są zarządzane ustawienia bez ponownej instalacji plików.
> - Podczas aktualizacji instalator przenosi poprzednią wersję do kopii z datą i godziną. Pozostałe programy uruchamiające, wpisy MCP i umiejętności zmienione przez użytkownika zostają zachowane.

## Sprawdzanie i naprawa instalacji {#状態確認と修復}

Te polecenia sprawdzają stan niezależnie od metody instalacji.

```sh
n624-latex setup status
n624-latex doctor --json
```

- W przypadku APT przeinstaluj pakiet poleceniem `sudo apt install --reinstall n624-latex`.
- W przypadku Homebrew przeinstaluj pakiet poleceniem `brew reinstall n624-dev/tap/n624-latex`.
- W przypadku instalatora do pobrania napraw zarządzane programy uruchamiające i integracje poleceniem `n624-latex setup repair`.

## Zapisywanie i odzyskiwanie plików wynikowych {#成果物の保存と復旧}

`n624-latex main.tex` zapisuje PDF w bieżącym katalogu. Informacje o PDF, dziennikach i obrazach zapisywanych przez `render` i `jobs download` znajdziesz w sekcji [Pliki wynikowe CLI](/pl/docs/cli/#成果物). Jeśli miejsce docelowe jest zajęte, zobacz [Rozwiązywanie problemów](/pl/docs/troubleshooting/#成果物の取得).

## Odinstalowanie {#アンインストール}

Odinstaluj pakiet APT poleceniem `sudo apt remove n624-latex`. Aby usunąć również klucz użytkownika, najpierw wykonaj `n624-latex auth logout`.

Odinstaluj pakiet Homebrew poleceniem `brew uninstall n624-dev/tap/n624-latex`. Zapisany klucz i konfiguracja MCP w narzędziu AI pozostaną. Jeśli nie są już potrzebne, przed odinstalowaniem wyloguj się i usuń konfigurację MCP w narzędziu AI.

Dla instalatora do pobrania wykonaj to polecenie.

```sh
n624-latex setup remove --yes
```

Aby zachować dane uwierzytelniające lub umiejętności, dodaj odpowiednio `--keep-credential` lub `--keep-skills`. Odinstalowywanie za pomocą skryptu Windows opisuje [instrukcja dla Windows](/pl/docs/windows/#アンインストール).
