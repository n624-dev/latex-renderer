---
slug: security
category: Rozwiązywanie problemów i bezpieczeństwo
title: Bezpieczeństwo kont i dokumentów
description: Jak chronić dane dostępowe i przesyłane pliki oraz jak ograniczony jest dostęp do renderera i panelu administracyjnego.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Jeśli klucz API wycieknie, natychmiast poproś administratora o jego unieważnienie i wydanie nowego.
- Zgłoś lukę w zabezpieczeniach za pomocą [prywatnego formularza GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Nie ujawniaj szczegółów w publicznym zgłoszeniu.

## Dane dostępowe {#資格情報}

- Nie umieszczaj kluczy API w argumentach poleceń (widocznych m.in. w `ps`), adresach URL, repozytoriach Git, dziennikach ani rozmowach z asystentem AI.
- Do zapisu lokalnego używaj DPAPI w Windows lub pliku z uprawnieniami `0600`, czytelnego wyłącznie dla właściciela, w systemach Linux i macOS.
- Hasła do logowania w przeglądarce, sekrety OIDC i ciasteczka sesyjne służą wyłącznie do swoich celów. Przechowuj je osobno od kluczy CLI i API (`lrk_` i `lra_`).

## Projekty {#プロジェクト}

System traktuje źródła LaTeX i załączniki jako niezaufane dane wejściowe. Blokuje dowiązania symboliczne, dostęp TeX do powłoki, uruchamianie zewnętrznych poleceń i połączenia sieciowe poza kontener. Przestrzegaj zasad izolacji, limitów czasu i ograniczeń dotyczących plików.

## Część publiczna i administracyjna {#公開領域と管理領域}

Publiczna dokumentacja i pliki do pobrania, strony wymagające uwierzytelnienia (`/app/` i `/admin/`) oraz API renderowania mają osobne ścieżki pod jednym kanonicznym adresem HTTPS.

- **Granica sieci.** W profilu Cloudflare jedynym punktem wejścia jest Tunnel/Workers, a w profilu standalone odwrotny serwer proxy z TLS. Usługi aplikacji nasłuchują na interfejsie pętli zwrotnej. Wewnętrzne API, SQLite i gniazda administracyjne pozostają prywatne. Strony wymagające logowania są wykluczone z indeksów wyszukiwarek.
- **Uwierzytelnianie i sesje w przeglądarce.** Zewnętrzny dostawca tożsamości wymaga dokładnej zgodności `provider + issuer + subject`. Adres e-mail i nazwa wyświetlana nie powodują automatycznego powiązania kont. Serwer może natychmiast unieważnić sesję. Żądania zmieniające stan wymagają dokładnej zgodności `Origin` i tokenu CSRF danej sesji. Hasła zabezpiecza `scrypt` i dodatkowy sekret (pepper) należący do roota. Przy dostępie publicznym zastosuj również limity połączeń i częstości żądań na serwerze proxy oraz ochronę DDoS dostawcy.
- **Remote MCP.** `/mcp`, punkt końcowy tokenów OAuth i metadane wykrywania usługi są publicznie dostępne. Wywołanie narzędzi wymaga krótkotrwałego tokenu Bearer z ograniczonym odbiorcą i zakresem. Autoryzacja korzysta z sesji przeglądarki `/app/` i jawnie przypisuje dostęp istniejącemu, aktywnemu użytkownikowi.
  - Standardowa odpowiedź (`content`) zawiera tylko identyfikatory w zakresie właściciela, stany, kursory i ograniczoną diagnostykę potrzebną do kontynuacji. Ścieżki i diagnostyka pochodzące od użytkownika są zwracane jako dane niezaufane, po usunięciu znaków sterujących i ograniczeniu długości i liczby elementów.
  - Standardowa treść `content` i dzienniki diagnostyczne pomijają tokeny OAuth, klucze API, bilety, surowe dane base64, pełny kod źródłowy, pełne dzienniki, ślady stosu, identyfikatory podmiotów Access i wewnętrzne ścieżki serwera. Pełne pliki PDF i dzienniki są dostępne wyłącznie przy odczycie zasobu po ponownym sprawdzeniu właściciela.

## Lokalny interfejs konfiguracji {#local-setup-web-ui}

`n624-latex setup --gui` (dawniej `latex-render setup --gui`) nasłuchuje wyłącznie na losowym porcie `127.0.0.1` na lokalnym komputerze.

- Fragment (`#...`) adresu URL otwieranego przez CLI zawiera jednorazowy token startowy. Przeglądarka od razu usuwa go z historii i wymienia na krótkotrwałą sesję.
- Każda operacja API wymaga dokładnej zgodności `Origin`, sesji Bearer i osobnego tokenu CSRF. Interfejs wyłącza CORS, sprawdza Host i adres pętli zwrotnej klienta oraz stosuje ścisłe CSP, `frame-ancestors 'none'` i `no-store`.
- Wprowadzony klucz trafia wyłącznie do operacji zapisu. Nie pojawia się w odpowiedziach o stanie, diagnostyce ani wyniku konwersji testowej. Interfejs zamyka się po 30 minutach bezczynności lub 2 godzinach od uruchomienia.
