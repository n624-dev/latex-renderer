---
slug: outputs
category: Aplikacja internetowa i CLI
title: Pobieranie PDF, PNG i SVG
description: Zapisz PDF, pobierz obrazy stron i wyeksportuj lub ponownie wyodrębnij wzory i rysunki TikZ jako SVG.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Otwieranie i zapisywanie PDF {#pdf-を開く-保存する}

- **Aplikacja internetowa.** Wybierz dokument w [historii](/app/history/) i otwórz `result.pdf` na liście plików na stronie wyników. Jeśli wybrano PDF i SVG, PDF można pobrać, gdy tylko będzie gotowy.
- **CLI.** Pobierz wynik, używając wyświetlonego `<jobId>`. Dodaj `--pdf-only`, aby pobrać PDF bez czekania na SVG. Jeśli chcesz zachować pliki innego dokumentu, wybierz osobny katalog za pomocą `--output`.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Pobieranie obrazów stron {#ページ画像を取得する}

Aby uzyskać obraz całej strony, korzystaj z podglądów PNG. Początkowo powstaje tylko strona 1. Pozostałe są generowane na żądanie. Jeśli podgląd jest w przygotowaniu, poczekaj chwilę lub otwórz stronę ponownie. W tym czasie można pobrać gotowy PDF.

- **Aplikacja internetowa.** Na stronie wyników wybierz podgląd odpowiedniej strony.
- **CLI.** Poniższe polecenie pobiera PNG stron 2 i 5. Pliki są zapisywane pod nazwami w rodzaju `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Zapisywanie wzorów i TikZ jako SVG {#数式と-tikz-を-svg-で保存する}

Zewnętrzne wyrażenia matematyczne i rysunki TikZ najwyższego poziomu można wyodrębnić jako odrębne obrazy wektorowe.

- **Aplikacja internetowa.** Przed konwersją otwórz **Miejsce zapisu i opcje wyjściowe** i wybierz **Eksportuj też wzory i TikZ jako SVG**. Po zakończeniu wyodrębniania pobierz pliki SVG ze strony wyników.
- **CLI.** Przekonwertuj dokument z opcją `--svg`. Pliki SVG zapisywane są w `.render/svg/objects/`. Mapowanie wierszy źródłowego pliku `.tex` na współrzędne w PDF znajdziesz w `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Gdy PDF jest gotowy, ale wyodrębnianie SVG nie powiodło się {#pdf-はあるが-svg-が失敗した場合}

**Częściowy sukces** oznacza, że PDF jest gotowy, a nie powiodło się tylko wyodrębnianie SVG. Zapisz PDF i ponów wyodrębnianie bez jego rekompilacji.

- **Aplikacja internetowa.** Kliknij **Ponów tylko SVG** na stronie wyników.
- **CLI.** Wykonaj poniższe polecenie.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Warunki i limit prób**
- Można wykonać **do 8 prób**, łącznie z pierwszą, dopóki dostępne są pierwotne źródła i ostateczny PDF, a środowisko TeX na serwerze nie uległo zmianie. Ponowienia nie wydłużają okresu przechowywania.
- Jeśli problem się utrzymuje, zajrzyj do diagnostyki na stronie wyników lub w `.render/svg/errors.json`.
- Jeśli pojawi się `SVG_RUNTIME_CHANGED` lub w starszym zadaniu nie ma przycisku ponowienia, [rozpocznij nową konwersję z oryginalnego dokumentu lub zapisanej rewizji](/pl/docs/web/#以前の文書や結果を開く).

Zobacz też [Pobieranie i ponawianie przez API HTTP](/pl/docs/api/#pdfの先行公開とsvgの再試行) oraz [specyfikację przetwarzania plików wyjściowych](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
