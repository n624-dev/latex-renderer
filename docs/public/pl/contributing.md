---
slug: contributing
category: Rozwój i współpraca
title: Współtworzenie dokumentacji
description: Edytuj poradniki w Markdown i sprawdzaj zmiany lokalnie.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Edycja poradnika {#本文を編集する}

- **Zgłoszenie błędu.** Jeśli instrukcja nie odpowiada interfejsowi lub poleceniom, utwórz zgłoszenie w [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose), podając stronę i proponowaną poprawkę.
- **Zgłoszenie zmian.** Zmodyfikuj właściwy plik w [źródłach Markdown publicznych poradników (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) i otwórz pull request.

## Weryfikacja lokalna {#ローカル検証}

Po edycji wykonaj poniższe polecenia i upewnij się, że kompilacja oraz kontrole odsyłaczy i nagłówków kończą się powodzeniem.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Kompilacja `public-web` wykonuje próbne uruchomienie za pomocą Wrangler i uruchamia lokalne środowisko Workers, aby sprawdzić przykładowe strony, indeks wyszukiwania, błędy 404, przekierowania i nagłówki.

## Zgodność {#互換性}

- Zachowaj publiczne ścieżki i kotwice nagłówków (fragmenty `#...` generowane z tekstu). Po zmianie nagłówka sprawdź odsyłacze prowadzące z innych stron.
- Zmieniając opcje CLI lub przykładowe żądania HTTP, sprawdź ich zgodność z implementacją i definicjami OpenAPI.
