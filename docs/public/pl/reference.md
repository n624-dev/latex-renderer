---
slug: reference
category: Administracja i programowanie
title: Dokumentacja dla administratorów i programistów
description: Zapis i odzyskiwanie wyników klienta, uwierzytelnianie MCP i procedury migracji.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Zapis i odzyskiwanie wyników {#成果物の保存-復旧の仕様}

> [!DETAILS] Specyfikacje i procedury
>
> - **Atomowa zamiana katalogów.** CLI i Local MCP zachowują ścieżki takie jak `.render/result.pdf`, `job.json` i podglądy. Sprawdzają zadeklarowane rozmiary i SHA-256 wszystkich plików i zamieniają katalog, gdy zestaw jest kompletny. Podczas zamiany katalog może na chwilę zniknąć. Programy zewnętrzne powinny go czytać po zakończeniu polecenia.
> - **Automatyczne odzyskiwanie.** Obok katalogu wyjściowego powstaje katalog `<output-name>.latex-renderer-state` ze stanem odzyskiwania, pomijany przy zbieraniu danych wejściowych. Zwykłe zakończenie usuwa dane tymczasowe. Po wymuszonym zakończeniu kolejne pobieranie przywraca poprzedni zestaw, jeśli zamiana nie została zatwierdzona. Jeśli została zatwierdzona, zachowuje nowy i czyści stary. Nie usuwaj katalogu stanu w trakcie operacji ani przed odzyskaniem.
> - **Blokowanie i nieprawidłowości.** Równoczesny zapis do tego samego miejsca jest zatrzymywany z `OUTPUT_BUSY`. Sam upływ czasu nie usuwa blokady aktywnego procesu. W przypadku ponownego wykorzystania PID operacja zatrzymuje się zapobiegawczo. Uszkodzone metadane, nieznane pliki lub dowiązania poza katalog wymagają sprawdzenia przed usunięciem.
> - **Pliki użytkownika i limity.** Zwykłe pliki użytkownika są kopiowane do nowego zestawu. Jeśli podczas pobierania zostanie wykryta edycja, publikacja zostanie przerwana, a zmiana zachowana. Najlepiej używać osobnego miejsca docelowego. Każdy zestaw ma limit 1 GiB i 10 000 wpisów. Musi wystarczyć miejsca na oba zestawy i dane tymczasowe. Obsługiwane są tylko lokalne systemy plików. Ścieżki z dowiązaniami symbolicznymi, twardymi lub punktami montowania z innego systemu plików są odrzucane. Blokowanie na zasobach sieciowych i pełna atomowość przy zaniku zasilania nie są gwarantowane. W Windows, jeśli otwarty plik uniemożliwi zamianę, poprzedni zestaw zostaje zachowany.

## Granice uwierzytelniania w przeglądarce {#web認証の境界}

> [!DETAILS] Specyfikacje i procedury
>
> Sesje serwerowe chronią `/app/`, `/admin/` i ich API. Nie są one uwzględniane w publicznym indeksie wyszukiwania. Zwykli użytkownicy korzystają z `/app/`, a do `/admin/` mają dostęp wyłącznie administratorzy i właściciele. Tożsamość określa `issuer + subject` zewnętrznego dostawcy lub `login name` użytkownika logującego się hasłem. Adres e-mail i nazwa wyświetlana nie są kluczami uwierzytelniania. Przesyłanie ZIP, zadania, wyniki i kompilacja TeX przechodzą przez renderer na serwerze.
>
> > [!NOTE]
> > Przeglądarka nie zapisuje trwale krótkotrwałych biletów. Sesja na serwerze wystawia je ponownie w razie potrzeby. Nie udostępniaj ciasteczek sesji, tokenów CSRF ani biletów.

## Rejestracja i diagnostyka Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specyfikacje i procedury
>
> - **Dynamiczna rejestracja klientów (DCR).** Nieukończone lub nieaktywne rejestracje są zwykle usuwane po 30 dniach. Chronione są wpisy, do których odwołują się ważne kody autoryzacji lub rodziny tokenów. Limit globalny to 10 000. Jeśli po czyszczeniu wystąpi `invalid_client`, zarejestruj klienta ponownie. Obsługiwane są standardowe żądania DCR bez nazwy klienta, z zachowaniem walidacji nazwy i URI przekierowania.
> - **Tymczasowe żądania autoryzacji (schemat 20).** Jeśli potrzebne jest pośrednie logowanie, żądanie jest zapisywane pod krótkim losowym ID. Pozwala je odzyskać bez umieszczania długiego OAuth `state` w adresie powrotnym. Jest ważne przez 10 minut, jednorazowo i tylko przy zgodności zalogowanej przeglądarki i dedykowanego ciasteczka. Równocześnie otwarte karty mają różne ID. Limit globalny wynosi 1000 żądań, a przeglądarka może mieć do 8 ciasteczek kontynuacji. Po osiągnięciu limitu zwracane jest `503` z zachowaniem istniejących żądań. W bazie zapisywane są wyłącznie skróty ID i ciasteczka. Restart ani odtworzenie kopii nie przedłużają ważności.
> - **Limity na adres IP i nagłówki źródłowe.** DCR zezwala na 10 rejestracji z zaufanego źródłowego IP w ciągu 15 minut. Klienci za tym samym wychodzącym proxy dzielą limit. Od 11. próby zwracane są HTTP `429`, `temporarily_unavailable` i `Retry-After`. Niepoprawne metadane nie zużywają limitu. Jeśli brak prawidłowego IP, zwracane jest `503`, aby operator sprawdził proxy. Niezidentyfikowani klienci nie są grupowani. Utrzymuj backend na interfejsie pętli zwrotnej i ustaw proxy tak, aby zastępowało `X-Latex-Renderer-Client-IP` rzeczywistym adresem. Dowolne wartości `X-Forwarded-For` są ignorowane. W trasach Cloudflare w obrębie granicy zaufania przetwarzane jest również `CF-Connecting-IP`.
> - **Test łączności dla administratora.** Poniższe polecenie sprawdza publiczne wykrywanie i wezwanie Bearer `401` bez wysyłania danych dostępowych, zmiany ustawień, podążania za przekierowaniami ani wyświetlania treści odpowiedzi, ciasteczek czy sekretów.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Izolowanie etapów błędu.** Prawidłowe `200` wykrywania i wezwanie `401` potwierdzają tylko te etapy. Porównaj etap, czas i `X-Request-ID` z dziennikami `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` i `remote_mcp.rpc_result`. Nie umieszczaj kodów OAuth, tokenów, ciasteczek, weryfikatorów PKCE, źródeł ani identyfikatorów użytkowników w dziennikach i zgłoszeniach.
> - **Uwierzytelnianie działa, lecz wykrywanie akcji zawodzi.** Po wydaniu tokenu sprawdź osobno `initialize`, powiadomienie o inicjalizacji i `tools/list`. HTTP `200` może towarzyszyć także `error` w JSON-RPC. `remote_mcp.rpc_result` zapisuje stan HTTP, klasyfikację wyniku, wersję protokołu, liczbę narzędzi, rozmiar odpowiedzi w bajtach i podstawowy kształt listy. Bufor inspekcji ma limit 256 KiB. Po jego przekroczeniu zapisywane jest tylko `inspection_limited`, bez zmiany odpowiedzi. Sama odpowiedź SSE lub żądanie `GET` zwracające `405` nie wystarcza do stwierdzenia awarii. Sprawdź `Accept`, `Content-Type`, negocjację protokołu i przekazywanie żądań przez proxy. Zewnętrzny OIDC, zasady Cloudflare i rzeczywiste konto ChatGPT sprawdź osobno w produkcji.

## Wyniki i zasoby MCP {#mcpの結果とresource}

> [!DETAILS] Specyfikacje i procedury
>
> Odpowiedzi Remote MCP składają się z trzech warstw.
> 1. **Standardowe `content`.** Zawiera identyfikatory wejścia i zadania, stan, przesunięcie, kursor, dostępność i ograniczoną diagnostykę potrzebną do wybrania następnego narzędzia. Nawet klient bez obsługi `structuredContent` i zasobów niestandardowych może tworzyć wejścia, poprawiać je i ponownie renderować.
> 2. **`structuredContent`.** Zawiera pełny, zweryfikowany obiekt przeznaczony do przetwarzania maszynowego.
> 3. **Zasoby MCP (`latex-renderer://jobs/...`).** Obejmują duże dane, np. PDF, pełny `compile.log`, surowy JSON, `svg/manifest.json` i `svg/objects/*.svg`. Może je odczytać wyłącznie ten sam właściciel OAuth. Obowiązują te same ograniczenia rozmiaru i czasu przechowywania co dla zwykłych plików. Wszystkie warstwy pomijają klucze API, tokeny OAuth, bilety, tekst źródłowy i surowe dane base64.

## Oczekiwanie i ponowienia w CLI {#cliの待機と再試行}

> [!DETAILS] Specyfikacje i procedury
>
> Jeśli sprawdzenie stanu zwróci przejściowy błąd HTTP `502`, `503`, `504` lub nieprawidłowy JSON, CLI ponowi tylko zapytanie o to samo zadanie **do 5 razy**, po 1, 2, 4, 8 i 8 sekundach, bez wydłużania łącznego czasu oczekiwania. Tworzenie zadania, przesyłanie, odnawianie tokenu i weryfikacja plików nie są automatycznie ponawiane. Błędy uwierzytelniania i uprawnień są zwracane od razu. Zakończenie oczekiwania przez CLI nie oznacza zatrzymania zadania na serwerze.

## Format JSON CLI {#cliのjson形式}

> [!DETAILS] Specyfikacje i procedury
>
> Przy `--json` standardowe wyjście ma poniższe formaty. Klucz API, `uploadTicket` i `jobTicket` są pomijane.
>
> - **Sukces (kod zakończenia `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Błąd CLI lub API (kod zakończenia `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Zadanie zakończone błędem, np. LaTeX (kod zakończenia `2`).** `result` zawiera dane zadania i zapisane ścieżki. Odpowiedź zawiera `success: false`.

## Migracja i odzyskiwanie starszych wersji {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migracja starego aktualizatora i błędy rozpakowywania
>
> ### Migracja aktualizatora root v1.2.x do aktualizatora z rozdzielonymi uprawnieniami {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Do v1.2.x Update Manager działał jako demon roota. Od v1.3.0 stały kontroler działa jako `latex-renderer-update`, a krótkotrwały pomocnik z uprawnieniami roota akceptuje ustalone operacje. Aktualizacja z przeglądarki starszym aktualizatorem może zatrzymać się z `Application Update Manager must use a separate non-root build tree`. Nie ponawiaj tej samej operacji w przeglądarce.
>
> Do tej jednorazowej migracji użyj [dystrybucji serwera v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Jako zwykły użytkownik wykonaj [pobranie i weryfikację dystrybucji](/pl/docs/self-hosting/#v1-6-9をダウンロードして検証), zmieniając pierwszy wiersz `version=` na `version=1.3.6`. Pozostań w tym samym terminalu, aby zachować `bundle_root` otrzymane przy weryfikacji i rozpakowywaniu.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Skrypt ponownie pobiera jako root to samo niezmienne wydanie i sprawdza sumę kontrolną, znacznik i commit, pakiet Sigstore, ograniczenia archiwum i metadane. Akceptuje tylko `gh` w `/usr/local/bin/gh` lub `/usr/bin/gh` z właścicielem root i bez uprawnień zapisu dla grupy i innych użytkowników. Rozdziela drzewa `verified` roota, `bootstrap-build` użytkownika bez uprawnień (przypięty pnpm przez dedykowany program pośredniczący Corepack) i `assembly` roota. Zatrzymuje stary menedżer dopiero po zdobyciu wspólnej blokady zmian i uruchamia go ponownie w razie błędu. Na końcu sprawdź `User=latex-renderer-update` i stan `active` każdej usługi poniższymi poleceniami. Następnie używaj zwykłej aktualizacji przez stronę lub administracyjne CLI.
> Strona i API nie otrzymują uprawnień sudo ani tokenów GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar przerywa rozpakowywanie z błędem Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> W Ubuntu, jeśli GNU `tar` korzysta z `openat2`, ograniczenie aktualizatora `RestrictSUIDSGID=true` może przerwać rozpakowywanie archiwum z podkatalogami z błędem `ENOSYS` (Function not implemented). Poprawiony aktualizator zachowuje kontrolę przez GNU `tar` i sprawdzanie podpisu. Jedynie rozpakowywanie jest przekazywane do `/usr/bin/bsdtar` w pustym prywatnym katalogu tymczasowym, bez przejmowania właścicieli, ACL i atrybutów rozszerzonych. Ograniczenie `RestrictSUIDSGID` oraz systemowy `tar` pozostają w użyciu.
>
> Starszy aktualizator może nie rozpakować również własnej poprawki. Sprawdź, czy nie trwają żadne operacje, aplikacja i baza są sprawne, a zaszyfrowana kopia została zweryfikowana. Użyj zainstalowanego `bootstrap-v1`, aby **najpierw zaktualizować wyłącznie oddzielny aktualizator** do opublikowanej wersji zawierającej poprawkę.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Sprawdź nową wersję aktualizatora oraz wartości `ready` i `pending=false`. Następnie zastosuj tę samą wersję aplikacji przez stronę lub zwykłe polecenie `update apply` administracyjnego CLI.
>
> Aktualizator `v1.4.0-rc.3` ma znany problem. Root kopiuje pakiet z zachowaniem nieuprzywilejowanego właściciela i operacja kończy się błędem `Release extraction requires a private regular bundle`. Zachowaj kontrole, najpierw zaktualizuj aktualizator do opublikowanej wersji z poprawką właściciela, a potem aplikację. Rozpakowywanie z uprawnieniami roota pod systemd możesz przetestować osobno przez `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Diagnozowanie blokady aktualizacji lub zmiany TeX
>
> ### Blokada zmian jest zajęta {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` zapobiega równoczesnemu wykonaniu aktualizacji aplikacji i zmiany TeX. Poczekaj na zakończenie trwającej operacji. **Nigdy nie usuwaj pliku `/run/latex-renderer/mutation.lock`.** Usunięcie umożliwia powstanie dwóch niezależnych blokad. Jeśli błąd wystąpi przy wewnętrznym odtwarzaniu środowiska TeX podczas aktualizacji, operacja może konkurować sama ze sobą. Przed ponowieniem sprawdź dzienniki i zatrzymane usługi.
>
> Tylko gdy nie trwa żadna operacja, a dziennik potwierdza zakończenie poprzedniej, zatrzymaj oba menedżery i sprawdź proces utrzymujący blokadę.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Zakończ proces i ponownie uruchom menedżery wyłącznie po potwierdzeniu, że to osierocony pomocnik blokady zakończonej operacji.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Tożsamość renderera w starszych wersjach kandydujących {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Wersje kandydujące v1.3.4
>
> Aktualizacja z `v1.3.4-rc.3` do `v1.3.4-rc.4` kończyła się błędem przed przełączeniem usług, ponieważ liczba plików uwzględnianych w skrócie tożsamości renderera wzrosła z 5 do 6. Do tej migracji użyj `v1.3.4-rc.5`, które zawiera też starsze dane zgodności. Suma kontrolna całego pakietu i podpis pochodzenia sprawdzają także dodany plik.

## Środowiska wykonawcze aktualizatora {#updaterの実行領域}

> [!DETAILS] Specyfikacje i procedury
>
> Update Manager ściśle rozdziela drzewo `verified` roota ze zweryfikowaną dystrybucją, `build` bez uprawnień roota do instalacji zależności i budowania oraz `assembly` roota z dozwolonymi wynikami. Skrypty wdrożeniowe wykonywane przez roota zawsze korzystają ze zweryfikowanej kopii `assembly`. Po kontrolach roota kroki takie jak publikacja w Cloudflare przez konto wdrożeniowe korzystają z tymczasowej kopii `deployment-build`. To samo dotyczy wycofywania.

## Ścieżki instalacji i zabezpieczenia w Windows {#windowsの配置と保護}

> [!DETAILS] Specyfikacje i procedury
>
> Po zmianie miejsca instalacji w Windows domyślnym katalogiem poleceń staje się jego podkatalog `bin`. Jeśli ustawisz `LATEX_RENDER_BIN_DIRECTORY`, zarządzane programy uruchamiające trafią do niego i będą używać jednej ścieżki dla PATH użytkownika i Local MCP. Alternatywne programy uruchamiające są zachowywane. `setup repair` może poprawić wcześniej zarejestrowaną ścieżkę. Stary wpis PATH pozostaje dla innych aplikacji. Podawaj ścieżki bezwzględne bez średników, cudzysłowów i znaków sterujących. Jeśli `--open` lub interfejs graficzny nie otworzy przeglądarki lub programu do PDF, zapisany PDF pozostanie dostępny.

## Współdzielenie projektów i przechowywanie {#保存プロジェクトの共有-保持}

> [!DETAILS] Zasady współdzielenia i przechowywania
>
> - Strona (`/app/`), CLI, publiczne API, Local MCP i Remote MCP współdzielą projekty i historię niezmiennych rewizji poszczególnych użytkowników. Różne klucze API i konta usług tego samego użytkownika mają do nich dostęp i mogą je aktualizować. Można także używać tymczasowych wejść i zadań bez zapisywania w projekcie.
> - Rewizję identyfikuje kombinacja wejścia, pliku głównego, silnika i formatów wyjściowych. Rewizje z różnymi wynikami mogą współdzielić wejście. Formaty wybrane w **Konwertuj ponownie** dotyczą tylko danego uruchomienia. Wybierz ustawienia początkowe, aby użyć formatów zapisanych w rewizji.
> - Wejście wskazywane przez aktywną rewizję jest przechowywane także po terminie dla osieroconych wejść i wlicza się do limitu użytkownika. Usunięcie projektu ukrywa jego wpis. Po usunięciu ostatniego projektu wskazującego wejście i wygaśnięciu powiązanych zadań wejście traci ochronę i po upływie ważności podlega okresowemu czyszczeniu. W sprawie natychmiastowego pełnego usunięcia skontaktuj się z administratorem.

## Język interfejsu {#表示言語}

Edytor zapisuje **Język interfejsu** na koncie. Gdy brak ustawienia, sprawdza języki przeglądarki w ich kolejności i wybiera angielski, jeśli żaden nie jest obsługiwany. Silnik i kodowanie dokumentu ustawia się osobno.

| Obszar | Zakres tłumaczenia |
| --- | --- |
| Web i konfiguracja | Operacje, ich stan, potwierdzenia i diagnostyka. |
| CLI i MCP | Pomoc i komunikaty CLI używają języka terminala. Opisy zdalnego MCP używają języka konta. |
| Edytor | Edycja, wyszukiwanie i zamiana, zapis i konflikty, stany kompilacji i obsługa podglądu są dostępne w 18 językach. |
| Publiczne przewodniki | Wszystkie przewodniki są dostępne w 18 językach wymienionych poniżej. Język można zmienić u góry strony. |

Edytor obsługuje angielski, japoński, chiński uproszczony, koreański, hiszpański, portugalski, francuski, niemiecki, włoski, rosyjski, turecki, polski, czeski, niderlandzki, szwedzki, norweski bokmål, duński i fiński. Dzienniki TeX i zewnętrznych pakietów zachowują oryginalną treść na potrzeby diagnostyki.

## Odzyskiwanie dzienników audytu {#監査ログの復旧}

Po odtworzeniu bazy pozycja eksportu (`export_database_id`, kolejność wierszy `export_sequence` i `export_token`) może przestać zgadzać się z jej stanem. Eksport i czyszczenie są wtedy wstrzymywane dla ochrony danych.

1. Na czas diagnozy i odzyskiwania zatrzymaj usługi i czasomierze eksportu i czyszczenia.
2. Zabezpiecz osobno odtworzoną bazę, istniejące zaszyfrowane eksporty i wszystkie pliki bieżących i starszych punktów kontrolnych. Sprawdź integralność, klucze obce i stan migracji odtworzonej bazy.
3. Jeśli nie ma zgodnego punktu kontrolnego i decydujesz się ponownie wyeksportować dostępne wpisy, przenieś pliki kontrolne poza aktywne ścieżki. Sprawdź też ścieżkę `AUDIT_EXPORT_CHECKPOINT`, jeśli jest ustawiona. Zachowaj wiersze audytu, sekwencje SQLite i `export.lock`.
4. Uruchom ręczny eksport z danymi dostępowymi usługi produkcyjnej. Zanim włączysz czasomierze, sprawdź, czy wynik można odszyfrować i czy utworzono nowy punkt kontrolny w formacie 3.

Ponownej operacji eksportu podlegają tylko wiersze obecne w odtworzonej bazie. Do identyfikacji powtórzeń używaj łącznie `export_database_id`, `export_sequence` i `export_token`. Sama data i godzina nie identyfikują wiersza.
