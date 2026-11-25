---
slug: troubleshooting
category: Rozwiązywanie problemów i bezpieczeństwo
title: Rozwiązywanie problemów
description: Jak ustalić przyczynę problemów z logowaniem, instalacją, konwersją i pobieraniem.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Od czego zacząć {#確認する順序}

1. **Sprawdź [stan usługi](/status/)**, aby ustalić, czy trwa awaria lub przerwa techniczna.
2. **Sprawdź istniejące zadanie.** Jeśli konwersja już się rozpoczęła, otwórz to samo zadanie w **Historia** lub wykonaj `n624-latex jobs get <jobId>` w CLI.
3. **Przejrzyj diagnostykę i dziennik.** W przeglądarce otwórz diagnostykę na stronie wyniku. W CLI sprawdź `.render/errors.json` i szczegółowy dziennik `.render/compile.log`.

## Typowe problemy {#代表的な問題}

### Instalacja i logowanie {#インストール-ログイン}

- **Nie znaleziono `n624-latex` lub `latex-render`.**
  Otwórz nowy terminal lub okno PowerShell. Jeśli problem się powtarza, sprawdź [PATH w systemie Linux lub macOS](/pl/docs/client/#linux-macos) bądź [instrukcje instalacji w Windows](/pl/docs/windows/#インストール).
- **Nie można zalogować się w aplikacji internetowej.**
  Użyj zarejestrowanego konta i metody wskazanej przez administratora (hasło, OIDC lub Cloudflare Access). Jeśli połączenie z ChatGPT lub Claude utknęło, zobacz [sprawdzanie połączenia Remote MCP](/pl/docs/mcp/#chatgptなどの接続を確認する).
- **CLI zwraca `401` lub `403`.**
  Uruchom `n624-latex auth status` i sprawdź zapisany klucz. Poproś administratora o potwierdzenie, że klucz jest aktywny i ma uprawnienia `render:create` oraz `render:read:own`. W razie potrzeby [zapisz klucz ponownie](/pl/docs/cli/#認証). Przy własnej instalacji sprawdź też [adres serwera (`LATEX_RENDER_BASE_URL`)](/pl/docs/cli/#接続先サーバー).

### Przesyłanie i konwersja {#アップロード-変換}

- **W archiwum ZIP nie znaleziono głównego dokumentu.**
  Domyślnym plikiem wejściowym jest `main.tex` w katalogu głównym. Sprawdź, czy archiwum nie zawiera dodatkowego katalogu nadrzędnego, lub podaj ścieżkę względną dokumentu. Zobacz [Przygotowanie archiwum ZIP](/pl/docs/projects/#構成).
- **Plik został odrzucony ze względu na rozmiar lub rozszerzenie.**
  Usuń zbędne pliki wygenerowane i pliki nieobsługiwane lub skonfiguruj `.latexrenderignore`. Sprawdź [obsługiwane pliki i limity](/pl/docs/projects/#制限).
- **Konwersja czeka w kolejce lub połączenie zostało zerwane.**
  Serwer może nadal przetwarzać zadanie. Zanim utworzysz kolejne, otwórz ponownie tę samą stronę wyniku lub sprawdź ten sam identyfikator zadania.
- **Brakuje pakietów lub czcionek albo upłynął limit czasu.**
  Sprawdź nazwy dostępne w [środowisku renderowania](/app/environment/). Jeśli upłynął limit czasu, przyjrzyj się złożonym makrom, dużym obrazom i rysunkom TikZ w pobliżu miejsca, w którym urwał się dziennik.

### Pobieranie plików {#成果物の取得}

- **Jest PDF, ale brakuje SVG.**
  Jeśli widzisz **Częściowy sukces**, zapisz najpierw PDF i wybierz **Ponów tylko SVG**. Zobacz [Ponawianie wyodrębniania SVG](/pl/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **Podgląd PNG jest nadal przygotowywany.**
  Poczekaj chwilę lub ponownie otwórz tę samą stronę. Gotowy PDF można pobrać od razu.
- **Plik docelowy jest używany lub wyświetla się `OUTPUT_BUSY`.**
  Zamknij przeglądarkę wyświetlającą wynikowy PDF lub poczekaj, aż proces zakończy zapis w katalogu, i ponów pobieranie.
- **Wynik wygasł lub brakuje miejsca.**
  Jeśli wynik wygasł, przekonwertuj ponownie zapisaną rewizję lub pliki lokalne. Jeśli wyczerpiesz swój przydział, usuń zbędne zakończone zadania. Jeśli pełny jest dysk serwera, poinformuj administratora.

## Uzyskiwanie pomocy {#問い合わせ}

- **Administrator serwera.** Podaj godzinę zdarzenia, operację, która się zatrzymała, kod błędu oraz identyfikator zadania (`job_...`), jeśli go masz.
- **Publiczne zgłoszenie na GitHubie.** Podaj minimalne kroki odtworzenia problemu, bez sekretów ani prywatnych dokumentów. **Nigdy nie publikuj kluczy API, ciasteczek, oryginalnego dokumentu, pliku PDF ani pełnych nieocenzurowanych dzienników.**
