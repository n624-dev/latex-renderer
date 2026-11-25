---
slug: projects
category: Projekty
title: Przygotowanie plików TeX i ZIP
description: Przygotuj źródła, sprawdź limity i przetestuj minimalny projekt LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Struktura projektu {#構成}

- **Dokument jednoplikowy.** Prześlij `.tex` bezpośrednio w aplikacji internetowej lub wykonaj `n624-latex main.tex` w CLI.
- **Dokument z ilustracjami, bibliografią lub kilkoma plikami źródłowymi.** Zbierz wszystko w **jednym archiwum ZIP**, zachowując ścieżki względne. W CLI można też wskazać katalog.
- **Tworzenie ZIP.** Zaznacz do spakowania zawartość katalogu, np. `main.tex` i `images/`. Jeśli spakujesz katalog nadrzędny, podczas konwersji musisz podać ścieżkę wejściową w rodzaju `project/main.tex`.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Punkt wejścia i ścieżki względne**
Domyślny dokument główny to `main.tex` w katalogu głównym projektu. Nawet jeśli wskażesz plik `.tex` w podkatalogu, np. `docs/main.tex`, **katalogiem roboczym kompilacji zawsze jest katalog główny projektu**. Aby z `docs/main.tex` dołączyć plik `body.tex` leżący w tym samym katalogu, wpisz `\input{docs/body.tex}`. Przy zapisie `\input{body.tex}` kompilator będzie szukał `body.tex` w katalogu głównym.

## Minimalny przykład z tekstem japońskim {#日本語の最小例}

Domyślnym silnikiem jest **LuaLaTeX**. Aby przetestować dokument japoński, zapisz poniższy tekst jako `main.tex` w kodowaniu UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Dostępne pakiety i czcionki znajdziesz w [środowisku renderowania](/app/environment/). Lista powstaje na podstawie kontenera serwera podczas wdrażania i jest używana również do wyszukiwania przez Remote MCP. Jeśli brakuje pakietu, przekaż administratorowi odpowiedni komunikat z `compile.log`.

## Zapisane projekty i rewizje {#保存projectと改訂}

Dokumenty konwertowane w aplikacji internetowej (`/app/`) są zapisywane w projektach.

- **Automatyczny zapis rewizji.** Każde nowe połączenie treści, dokumentu głównego, silnika i formatów wyjściowych zostaje zapisane jako rewizja projektu. Wcześniejsze rewizje pozostają w historii.
- **Konwersja wcześniejszej rewizji.** Kliknij **Konwertuj ponownie**, aby użyć zapisanego dokumentu i silnika. Jeśli na tym etapie zmienisz format wyjściowy, wynik trafi do historii konwersji tej samej rewizji.
- **Współdzielenie i usuwanie.** Aplikacja internetowa, CLI, API HTTP i MCP korzystają ze wspólnych projektów i rewizji użytkownika. Usunięcie projektu ukrywa jego wpis. Istniejące źródła i wyniki są usuwane zgodnie z okresem przechowywania. Aby usunąć je natychmiast i w całości, skontaktuj się z administratorem. Źródła wskazywane przez aktywne rewizje wliczają się do limitu użytkownika. Zobacz [Współdzielenie i przechowywanie](/pl/docs/reference/#保存プロジェクトの共有-保持).

### Edycja w przeglądarce {#ブラウザーで編集する}

Otwórz zapisany projekt i wybierz **Edytuj TeX**. Zmiany są zapisywane w szkicu. Po przerwie w pisaniu rozpoczyna się kompilacja, a jeśli się powiedzie, PDF jest odświeżany. Gdy podgląd zawiedzie, możesz sprawdzić ostatni dostępny PDF i odpowiadającą mu wersję szkicu.

Nowe projekty otwierają się z pustym plikiem `main.tex`. Dopóki główny dokument jest pusty, możesz zacząć od szablonu. Wybierz **Edytuj od tej rewizji**, aby kontynuować od zapisanej wersji. Jeśli szkic już istnieje, potwierdź jego zastąpienie.

Aby kompilować tylko na żądanie, wyłącz **Automatyczna kompilacja** i używaj **Kompiluj**. Wybierz **Wyniki zapisanej wersji** i kliknij **Zapisz wersję**, aby zachować szkic z jego ustawieniami. Jeśli potrzebujesz SVG, otwórz zapisaną rewizję i kliknij **Konwertuj ponownie**.
Podczas pracy edytor pokazuje stan kompilacji i podgląd.

## Pliki wykluczone z wysyłania {#送信から除外されるもの}

- **Automatyczne wykluczenia.** CLI pomija `.git`, `.render` oraz pomocnicze pliki LaTeX, takie jak `.aux`. Dowiązania symboliczne są odrzucane.
- **Nieobsługiwane pliki.** Przenieś zbędne katalogi, np. `node_modules`, poza projekt. Jeśli wysyłany katalog zawiera nieobsługiwane rozszerzenia, CLI wypisze ścieżkę i przerwie działanie. Aby pozostawić w projekcie plik taki jak `README.md`, lecz go nie wysyłać, dodaj do `.latexrenderignore` w katalogu głównym wiersz z `README.md`. Serwer sprawdza rozszerzenia w ZIP według tych samych reguł.
- **Dozwolone rozszerzenia** (wielkość liter nie ma znaczenia)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  Pliki `.bst` są stylami bibliografii BibTeX i mogą znajdować się w podkatalogach. Jeśli niestandardowy styl ma rozszerzenie spoza listy, przed jego zmianą zapytaj administratora.

## Limity {#制限}

- **Liczba plików.** Najwyżej 500.
- **Domyślne rozmiary.** 20 MiB na ZIP, 100 MiB łącznie po rozpakowaniu i 20 MiB na plik.
- **Punkt wejścia.** Względna ścieżka do pliku `.tex` w źródłach. Domyślnie `main.tex` w katalogu głównym.
- **Bezpieczeństwo.** Dostęp do powłoki z TeX (w tym `\write18`), wykonywanie poleceń zewnętrznych i zewnętrzne połączenia sieciowe są wyłączone.
- **Zasoby.** Administrator ustala limity czasu, miejsca na użytkownika i czasu przechowywania wyników.
