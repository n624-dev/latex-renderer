---
slug: cli
category: CLI
title: Konwersja dokumentów i pobieranie wyników w CLI
description: Kompiluj TeX w terminalu i pobieraj PDF, dzienniki i podglądy.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

W katalogu zawierającym `main.tex` wykonaj `n624-latex main.tex`, aby zapisać PDF w tym samym katalogu. Przy pierwszym użyciu [zainstaluj CLI](/pl/docs/client/) i skonfiguruj połączenie.

## Uwierzytelnianie {#認証}

Otwórz konfigurację w przeglądarce, aby zapisać klucz API.

```sh
n624-latex setup --gui
```

Jeśli nie możesz otworzyć przeglądarki, np. w sesji SSH, przekaż klucz przez **standardowe wejście**, aby nie pojawił się w argumentach polecenia. W Bash lub Zsh uruchom pierwszy wiersz, wklej klucz, naciśnij Enter i wykonaj pozostałe wiersze.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

W Windows możesz również użyć [maskowanego pola instalatora](/pl/docs/windows/#インストール).

Pierwsze polecenie sprawdza, czy zapisano klucz, a drugie usuwa zapisany klucz.

```sh
n624-latex auth status
n624-latex auth logout
```

- Jeśli ustawiono zmienną środowiskową `LATEX_RENDER_API_KEY`, ma ona pierwszeństwo przed kluczem lokalnym.
- `logout` usuwa wyłącznie klucz zapisany lokalnie. W razie potrzeby osobno usuń zmienną środowiskową lub unieważnij klucz na serwerze.

### Wybór serwera {#接続先サーバー}

CLI domyślnie łączy się z usługą hostowaną (`https://latex-render.n624.jp`). Aby korzystać z własnego serwera, ustaw jego adres HTTPS w sesji terminala, w której będziesz wykonywać polecenia.

- Pomiń końcówki `/app/` i `/api/v1/` w adresie URL.
- Użyj klucza API wydanego przez ten serwer.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Konfiguracja i diagnostyka {#セットアップと診断}

Otwórz ustawienia połączenia i integracji za pomocą `n624-latex setup`. Jeśli nie możesz się połączyć, najpierw sprawdź stan poniższymi poleceniami. Jeśli nie znaleziono `n624-latex`, zobacz [Instalacja i PATH](/pl/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` sprawdza instalację i dane dostępowe w trybie tylko do odczytu. Nie wyświetla wartości klucza API. Jeśli wykryje problemy, zwraca kod zakończenia `2`.

| Sposób instalacji | Aktualizacja i naprawa |
| --- | --- |
| APT | [Zaktualizuj pakiety przez APT](/pl/docs/client/#apt-版の更新) lub [zainstaluj ponownie](/pl/docs/client/#状態確認と修復) uszkodzone pakiety. [Zarejestruj Local MCP ręcznie](/pl/docs/mcp/#local-mcpの登録). |
| Homebrew | [Zaktualizuj przez Homebrew](/pl/docs/client/#homebrew-版の更新) lub [zainstaluj ponownie](/pl/docs/client/#状態確認と修復) uszkodzone pakiety. Skonfiguruj integracje AI przez `n624-latex setup`. |
| Pobrany instalator | [Zaktualizuj w ustawieniach](/pl/docs/client/#配布インストーラー版の更新). Napraw zarządzane integracje i programy uruchamiające za pomocą `n624-latex setup repair`. |

Aby odinstalować program, skorzystaj z [instrukcji dla swojej metody instalacji](/pl/docs/client/#アンインストール). Interfejs konfiguracji działa lokalnie i zamyka się po wyjściu z CLI.

## Renderowanie {#レンダリング}

### Bezpośrednia konwersja pliku TeX {#tex-ファイルを直接変換する}

Wskaż plik `.tex` w katalogu projektu, aby utworzyć PDF. Obrazy, bibliografię i lokalne pliki `.sty` możesz wskazywać za pomocą ścieżek względnych.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Jeśli pominiesz `-o`, PDF o tej samej nazwie bazowej, na przykład `main.pdf`, zostanie zapisany w katalogu, z którego uruchamiasz polecenie.
- W razie błędu LaTeX wyświetlane są rozpoznane nazwa pliku, numer wiersza i identyfikator zadania. Błąd kompilacji lub pobierania nie usuwa ostatniego poprawnie zapisanego pliku PDF.

#### Wybór silnika LaTeX {#latex-のエンジンを選ぶ}

Aby użyć XeLaTeX, wpisz nazwę silnika przed nazwą pliku.

```sh
n624-latex xelatex main.tex
```

Jeśli nie wskażesz silnika, CLI szuka na początku dokumentu dyrektywy `% !TeX program = xelatex` lub
`% !TEX TS-program = xelatex`. Jeśli jej nie znajdzie, odczyta
`.n624-latex.json` z katalogu głównego projektu. Możesz udostępnić ten plik
przez Git, aby korzystać z tego samego silnika na innych komputerach.

```json
{"engine":"xelatex"}
```

Domyślnym silnikiem jest LuaLaTeX. Silniki pLaTeX i upLaTeX wymagają,
aby środowisko wykonawcze serwera zawierało japońską kolekcję językową.

| Silnik | Co sprawdzić przy przenoszeniu dokumentu |
| --- | --- |
| LuaLaTeX | Sprawdź konfigurację dokumentów korzystających z `fontspec` lub LuaTeX-ja. |
| pdfLaTeX | Nie obsługuje `fontspec`. Użyj ustawień czcionek dla pdfLaTeX. |
| XeLaTeX | Obsługuje `fontspec`. Sprawdź, czy dokument korzysta z pakietów przeznaczonych wyłącznie dla LuaTeX. |
| pLaTeX / upLaTeX | Użyj japońskiej klasy dokumentu zgodnej z silnikiem. Przy `jsarticle` w upLaTeX podaj opcję klasy `uplatex`. |

Przetwarzanie bibliografii zależy od pakietów i konfiguracji dokumentu. Dołącz pliki `.bib` oraz własne `.bst`. Dokumenty BibTeX w pLaTeX i upLaTeX korzystają odpowiednio z pBibTeX i upBibTeX. Informacje o weryfikacji PDF, SVG i położenia SVG znajdziesz w opisie [środowiska renderowania](/app/environment/).

### Konwersja ZIP i pobieranie wielu plików wynikowych {#zip-複数の出力を指定する}

Użyj podpolecenia `render`, aby przekonwertować ZIP lub pobrać zestaw wyników obejmujący dzienniki, podglądy i SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Przykłady**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Domyślna ścieżka wskazuje bieżący katalog, a domyślną wartością `--entrypoint` jest `main.tex`. CLI przygotowuje dane wejściowe obejmujące do 500 plików i czeka na ukończenie zadania. Plik główny możesz wskazać ścieżką względną do `.tex`. Serwer sprawdzi bezpieczeństwo ścieżki i istnienie pliku.
- Opcja `--svg` pozwala dodatkowo wyodrębnić najbardziej zewnętrzne wyrażenia matematyczne i rysunki TikZ najwyższego poziomu jako osobne pliki SVG.

### Jedno źródło dla wielu dokumentów {#同じ入力から複数の文書を作る-source-の再利用}

Jeśli katalog lub ZIP zawiera kilka dokumentów głównych, prześlij dane wejściowe raz za pomocą `source upload` i wykorzystuj ponownie ich identyfikator. Każdemu zadaniu przypisz osobny katalog wyników (`--output`).

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Czyszczenie katalogu docelowego, wykluczenia i powtarzające się przesyłanie
>
> - **Usuwanie wcześniejszych wyników.** Przy ponownym użyciu katalogu docelowego usuwane są tylko PDF, podglądy i SVG wymienione w poprzednim `job.json`, których nie ma w nowym wyniku. Pozostałe pliki użytkownika są zachowywane.
> - **Weryfikacja miejsca docelowego.** Ścieżki zawierające dowiązania symboliczne są odrzucane. W systemach POSIX sprawdzany jest również właściciel i uprawnienia do zapisu dla grupy i innych użytkowników. W Windows pomijane jest sprawdzenie bitów uprawnień POSIX.
> - **Wykluczanie katalogu wyników.** Jeśli `--output` wskazuje podkatalog projektu, dokładnie ten katalog zostanie pominięty w kolejnym ZIP. Katalogi o podobnych nazwach będą uwzględnione. Katalog główny projektu nie może być miejscem docelowym.
> - **Ponowne przesłanie tych samych danych.** Jeśli serwer ma prawidłowy ZIP tego samego właściciela i o tej samej sumie SHA-256, zwraca `uploadRequired: false` i pomija przesyłanie. Tylko właściciel może użyć identyfikatora wejścia w kolejnych zadaniach.

## Zapisane projekty i rewizje {#保存projectと改訂}

Używaj CLI do zarządzania projektami i rewizjami na serwerze oraz do ich ponownej kompilacji. Aplikacja internetowa, API, MCP i inne klucze tego samego użytkownika współdzielą projekty. Operacje tymczasowe `render` i `source upload` nie wymagają zapisania projektu.

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

- **`save`** przygotowuje katalog lub ZIP jako dane wejściowe i zapisuje w projekcie niezmienną rewizję. Opcja `--svg` ustawia PDF i SVG jako początkowe formaty wyjściowe rewizji.
- **`render`** tworzy zadanie z zapisanej rewizji. Tylko `--svg` nadpisuje ustawienia wyników.
- **`list`, `get` i `jobs`** przyjmują `--cursor`, aby pobrać kolejną stronę.
- **`delete`** ukrywa projekt na liście. Istniejące zadania nie są natychmiast usuwane.

## Operacje na zadaniach {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Pobieranie i oczekiwanie.** Te polecenia używają klucza API do odnowienia krótkotrwałego tokenu. `jobs download` czeka na ukończenie zadania przed zastąpieniem zapisanego zestawu. Jeśli oczekiwanie się nie powiedzie lub zostanie przerwane, poprzedni zestaw pozostaje na dysku. `delete` dotyczy wyłącznie zakończonych zadań.
- **Pobieranie dodatkowych podglądów PNG.** Na początku generowana jest tylko pierwsza strona. Zwykłe pobieranie obejmuje istniejące PNG. Użyj na przykład `--preview-page 2 5`, aby wygenerować wskazane strony, sprawdzić ich rozmiar i SHA-256 i je zapisać. Operacja nie kompiluje ponownie PDF ani nie przedłuża przechowywania.
- **Wcześniejsze pobranie PDF i ponowienie SVG.** Przy zadaniu PDF i SVG użyj `--pdf-only`, by pobrać PDF przed ukończeniem SVG. Jeśli zawiedzie tylko SVG, PDF zostaje zachowany, a wynik jest częściowy. `retry-svg` ponawia samo wyodrębnianie. Limit wynosi 8 prób łącznie z pierwszą, bez przedłużania czasu przechowywania. Jeśli środowisko wykonawcze uległo zmianie, utwórz nowe zadanie. Zobacz [Pobranie gotowego PDF i ponowienie SVG](/pl/docs/api/#pdfの先行公開とsvgの再試行).
- **Ponowienia przy problemach z siecią.** Przejściowe błędy sprawdzania stanu powodują ponowienie próby. Błędy uwierzytelniania i uprawnień są zwracane od razu. Serwer może kontynuować pracę po zakończeniu oczekiwania przez CLI. Sprawdź ten sam `<jobId>` przed utworzeniem kolejnego zadania. Zobacz [Oczekiwanie i ponowienia w CLI](/pl/docs/reference/#cliの待機と再試行).

## Pliki wyjściowe {#成果物}

Aby wcześniej pobrać PDF, wybrać strony PNG lub ponowić SVG, zobacz [Pobieranie PDF, PNG i SVG](/pl/docs/outputs/).

| Ścieżka | Zawartość |
| --- | --- |
| `.render/result.pdf` | Poprawnie wygenerowany PDF |
| `.render/compile.log` | Dziennik kompilacji LaTeX |
| `.render/errors.json` | Ustrukturyzowane informacje o błędach |
| `.render/job.json` | Końcowy stan zadania |
| `.render/previews/page-N.png` | Podglądy maksymalnie 100 stron |
| `.render/svg/manifest.json` | Powiązanie SVG z pozycją w źródle i współrzędnymi PDF |
| `.render/svg/objects/*.svg` | Osobny SVG dla wyrażenia matematycznego lub rysunku TikZ |

## Wynik w formacie JSON {#json出力}

Dodaj `--json` do dowolnego polecenia, aby zapisać na standardowym wyjściu jeden obiekt JSON bez komunikatów o postępie. Zawiera ten sam wynik `client-core` co zwykły widok, z pominięciem kluczy API i krótkotrwałych tokenów.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Schematy wyników i błędów oraz kody zakończenia znajdziesz w [opisie formatu JSON CLI](/pl/docs/reference/#cliのjson形式).
