---
slug: updates
category: Własny serwer
title: Aktualizacja serwera i powrót do poprzedniej wersji
description: Jak zastosować wydanie stabilne, sprawdzić wynik i wybrać metodę odzyskiwania po awarii.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Przed aktualizacją {#更新する前に}

| Co chcesz zmienić | Gdzie to zrobić |
| --- | --- |
| Aplikacja serwera | **Administracja → Aktualizacje** |
| Wersja TeX Live lub języki | **Administracja → Środowisko TeX**. Zobacz [Zmiana środowiska TeX](/pl/docs/self-hosting/#tex環境の初期設定). |
| Lokalny pakiet APT `n624-latex` | [Aktualizacja pakietu APT](/pl/docs/client/#apt-版の更新) |

Zanim zaczniesz, sprawdź trzy rzeczy.

1. [Utwórz i zweryfikuj zaszyfrowaną kopię zapasową](/pl/docs/backups/#手動で作成する).
2. Wybierz porę, gdy trwa niewiele zadań konwersji.
3. Pozostaw tryb konserwacji w stanie `normal`. Aktualizator zatrzyma i uruchomi odpowiednie usługi oraz wykona konwersję testową.

## Zastosowanie wydania stabilnego {#正式版を適用する}

1. Zaloguj się jako właściciel i otwórz **Administracja → Aktualizacje** (`/admin/updates/`).
2. Pozostaw puste pole wersji i kliknij **Sprawdź aktualizacje**, aby zobaczyć aktualną oraz dostępną wersję stabilną.
3. Wybierz **Pobierz, zweryfikuj i zaktualizuj**, wpisz powód zmiany i rozpocznij aktualizację.
4. Zanotuj **identyfikator operacji** i sprawdź, czy stan wskazuje na pomyślne zakończenie.
   - Jeśli aplikacja jest już aktualna, ale trzeba jeszcze zmienić aktualizator, sprawdź wynik tej samej operacji i szczegóły aktualizatora.
   - Operacja trwa także po zamknięciu przeglądarki. Jeśli podczas restartu pojawi się `502`, poczekaj na ponowne połączenie interfejsu.
5. Zaloguj się w innej przeglądarce lub oknie prywatnym. Przekonwertuj typowy dokument, sprawdź pobieranie PDF oraz wersje aplikacji i aktualizatora.

## Powiadomienia i aktualizacje automatyczne {#通知と自動更新}

W zasadach aktualizacji możesz wybrać sprawdzanie z powiadomieniem (domyślnie) lub automatyczne stosowanie po weryfikacji.

- Automatyczne stosowanie obejmuje wyłącznie wydania stabilne.
- Aby przetestować wersję kandydującą w oddzielnym środowisku testowym, podaj jej opublikowany znacznik w formacie `vX.Y.Z-rc.N`.

## Gdy aktualizacja się nie powiedzie {#更新が失敗した場合}

W szczegółowym dzienniku sprawdź identyfikator operacji i etap błędu. Sprawdź wersję aplikacji i aktualizatora, logowanie, konwersję i informację o konieczności przeglądu punktu odzyskiwania. Sam numer wersji nie wystarczy.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Sprawdź, czy trwają prace konserwacyjne, i przed rozpoczęciem aktualizacji przywróć tryb `normal`.
- **`RECOVERY_REVIEW_REQUIRED`.** Postępuj zgodnie z instrukcją [sprawdzania punktu odzyskiwania po awarii](/pl/docs/backups/#更新失敗後の復旧点を確認する).

## Powrót do poprzedniej wersji {#前の版へ戻す}

- **Jeśli wystarczy wycofać aplikację**, sprawdź wersję docelową w **Administracja → Aktualizacje** i wybierz **Wycofaj do poprzedniej wersji**, jeśli ta opcja jest dostępna. Następnie przetestuj logowanie i konwersję do PDF.
- **Jeśli zmiana bazy danych jest niezgodna**, odtwórz bazę i magazyn plików z tego samego punktu odzyskiwania. Skorzystaj z instrukcji [odtwarzania danych](/pl/docs/backups/#データを復旧する場合).

Zobacz [Migracja i odzyskiwanie wcześniejszych wydań](/pl/docs/reference/#旧版からの移行と特殊復旧) oraz [Specyfikacja aktualizatora i zasady przechowywania](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
