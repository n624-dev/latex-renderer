---
slug: web
category: Aplikacja internetowa
title: Konwersja dokumentów w przeglądarce
description: Utwórz PDF z pliku TeX lub archiwum ZIP i przeglądaj wyniki wcześniejszych konwersji.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Tworzenie PDF w przeglądarce {#ブラウザでpdfへ変換}

1. Otwórz [aplikację internetową](/app/) i zaloguj się metodą wskazaną przez administratora.
2. Wybierz pliki lub przeciągnij je na stronę.
   - Jeśli cały dokument mieści się w jednym pliku, wybierz bezpośrednio plik `.tex`.
   - Jeśli zawiera ilustracje, bibliografię lub kilka plików `.tex` (np. dołączanych przez `\input`), spakuj dokument i zależności do jednego `.zip`. Zobacz [obsługiwane pliki i strukturę ZIP](/pl/docs/projects/).
   - Jeśli wybierzesz osobno kilka plików `.tex`, każdy zostanie przekonwertowany jako niezależny dokument.
3. Jeśli ZIP zawiera kilka plików `.tex` i pojawi się pole wyboru, wskaż dokument główny jako punkt wejścia.
4. Kliknij **Konwertuj do PDF**. Po zakończeniu na stronie wyników pojawią się PDF i podglądy stron.

Aby użyć innego silnika niż LuaLaTeX, wybierz go w **Miejsce zapisu i opcje wyjściowe → Silnik**. [Środowisko renderowania](/app/environment/) pokazuje dostępne silniki i wyniki weryfikacji PDF, SVG oraz położenia SVG. pLaTeX i upLaTeX wymagają kolekcji japońskiej na serwerze.

## Edycja dokumentu w przeglądarce {#ブラウザーで文書を編集する}

1. Otwórz dokument w sekcji [Projekty](/app/projects/) i wybierz **Edytuj TeX**. Nowy projekt zawiera pusty `main.tex`. Możesz także wybrać szablon.
2. Zmiany są automatycznie zapisywane w szkicu. Użyj **Dołącz plik**, aby dodać ilustracje lub bibliografię.
3. Włącz **Automatyczna kompilacja**, aby PDF aktualizował się po przerwie w pisaniu. Aby zaktualizować go od razu, kliknij **Kompiluj**.
4. Kliknij **Zapisz wersję**, aby zachować źródła w historii. Polecenie **Edytuj od tej rewizji** pozwala kontynuować pracę od zapisanej wersji. Jeśli szkic już istnieje, aplikacja wymaga potwierdzenia przed jego zastąpieniem.

Aby dodać lub załączyć pliki, wybierz **Zarządzaj plikami**. W sekcji **Ustawienia** możesz zmienić silnik, automatyczną kompilację i język wyświetlania lub zapisać wersję. Przycisk **⋯** w panelu PDF otwiera opcje powiększenia i PNG.

W razie błędu kompilacji szkic i ostatni poprawny PDF pozostają dostępne. Wybierz błąd z nazwą pliku i numerem wiersza, aby przejść do tego wiersza. Na telefonie przełączaj się między **Kod**, **PDF** i **Błędy**. Jeśli PDF wolno się wyświetla, użyj **PNG (lekki podgląd)**.

Tymczasowy podgląd jest dostępny tylko w edytorze. Aby zachować PDF, pobierz go przyciskiem **Zapisz PDF**.

Edytor używa kodowania UTF-8. Pliki Shift_JIS lub EUC-JP otwórz w edytorze tekstowym z oryginalnym kodowaniem, sprawdź poprawność wyświetlania i zapisz kopię w UTF-8. Dołącz kopię pod tą samą nazwą i potwierdź zastąpienie.

## Uzyskiwanie wzorów i rysunków TikZ w formacie SVG {#数式や-tikz-を-svg-で取得する}

1. Przed konwersją otwórz **Miejsce zapisu i opcje wyjściowe** i zaznacz **Eksportuj też wzory i TikZ jako SVG**.
2. PDF możesz pobrać, gdy tylko będzie gotowy.
3. **Częściowy sukces** oznacza, że PDF jest gotowy, ale nie udało się wyodrębnić SVG. Najpierw zapisz PDF, a następnie w razie potrzeby kliknij **Ponów tylko SVG**.

Początkowo powstaje tylko podgląd PNG pierwszej strony. Kolejne są generowane podczas otwierania. Gotowy PDF można pobrać w trakcie przygotowywania podglądów. Zobacz [Pobieranie PDF, PNG i SVG](/pl/docs/outputs/).

## Otwieranie wcześniejszych dokumentów i wyników {#以前の文書や結果を開く}

- **[Historia](/app/history/)** pokazuje postęp i pliki wynikowe. Do tej samej strony wyników możesz wrócić po zamknięciu przeglądarki.
- W sekcji **[Projekty](/app/projects/)** znajdziesz zapisane dokumenty i rewizje. Aby ponownie przetworzyć wcześniejsze źródła, otwórz rewizję i kliknij **Konwertuj ponownie**.
- W sekcji **[Środowisko renderowania](/app/environment/)** możesz wyszukiwać pakiety LaTeX i czcionki dostępne na serwerze.

## Informacje publiczne i prywatne {#公開される情報}

- **Strony wymagające logowania.** Zaloguj się do aplikacji internetowej (`/app/`), aby przejrzeć dokumenty i konwersje w historii lub na stronie wyników. Panel administracyjny (`/admin/`) jest dostępny tylko dla administratorów i właścicieli. Zobacz [Bezpieczeństwo kont i dokumentów](/pl/docs/security/).
- **Strony publiczne.** Jeśli nie możesz się zalogować, sprawdź [stan usługi](/status/) lub [rozwiązywanie problemów](/pl/docs/troubleshooting/). CLI znajdziesz w sekcji [Pobieranie](/downloads/), a specyfikacje integracji na stronie [Publiczne API](/pl/docs/api/).
