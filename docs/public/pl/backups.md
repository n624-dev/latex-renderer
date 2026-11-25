---
slug: backups
category: Własny serwer
title: Tworzenie, weryfikowanie i odtwarzanie kopii zapasowych
description: Czym różnią się kopie okresowe od punktów odzyskiwania aktualizacji, jak zweryfikować archiwum i odtworzyć dane.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Zawartość kopii {#何が保存されるか}

| Rodzaj | Zawartość | Zastosowanie |
| --- | --- | --- |
| **Kopia okresowa** | Baza SQLite i wejściowe archiwa ZIP wskazane przez aktywne rewizje, szkice i tworzone podglądy | Ochrona bazy danych, projektów i edytowanych dokumentów |
| **Punkt odzyskiwania aktualizacji** | SQLite tuż przed aktualizacją, cały magazyn aplikacji i informacje o wcześniejszych wersjach | Badanie awarii i odtwarzanie poprzedniego stanu |
| **Osobna kopia konfiguracji hosta** | Pliki takie jak `/etc/latex-renderer/`, klucze prywatne, certyfikaty TLS i stan Akebi | Odbudowa hosta po awarii |

- Po odtworzeniu kopii okresowej otwórz projekt w edytorze, aby ponownie wygenerować podgląd. Wyniki zadań tymczasowych oraz robocze pamięci podręczne nie wchodzą w skład kopii.
- Zabezpiecz osobno konfigurację, certyfikaty i klucz deszyfrujący (tożsamość age). **Przechowuj zaszyfrowane kopie i klucz w różnych bezpiecznych miejscach, by jedno zdarzenie nie pozbawiło Cię obu.**

## Ręczne tworzenie kopii {#手動で作成する}

1. Zaloguj się jako właściciel i otwórz **Administracja → System → Kopie zapasowe**.
2. Kliknij **Utwórz kopię zapasową** i poczekaj na zakończenie.
3. Kliknij **Zweryfikuj najnowszą kopię** i sprawdź nazwę archiwum oraz czas ostatniej weryfikacji. Na serwerze musi znajdować się klucz deszyfrujący.

### Tworzenie i sprawdzanie kopii z wiersza poleceń {#コマンドで作成-検証する}

1. Utwórz teraz zaszyfrowaną kopię na serwerze. W `/etc/latex-renderer/backup.env` zmienna `BACKUP_DIRECTORY` określa miejsce docelowe, domyślnie `/var/lib/latex-renderer/backups`. Za kopie okresowe odpowiada czasomierz `latex-renderer-backup.timer`.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Skopiuj archiwum `.tar.age` na host weryfikacyjny z systemem Linux. Przygotuj GNU `tar`, `age`, obsługiwaną wersję Node.js (24 lub 26) z `node:sqlite` oraz klucz deszyfrujący. Przy długim przechowywaniu umieść archiwum i klucz osobno.
3. [Pobierz, zweryfikuj i rozpakuj dystrybucję serwera](/pl/docs/self-hosting/#v1-6-9をダウンロードして検証) w wersji użytej do utworzenia kopii. Podaj tę wersję w pierwszym `version=`, ustaw `release_dir` na rozpakowany katalog i uruchom skrypt z dystrybucji.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Komunikat `restore_test.completed` wskazuje na zakończenie weryfikacji. Test sprawdza spójność SQLite i wejściowych ZIP rozpakowanych w miejscu tymczasowym. Możesz też sprawdzić kopię zewnętrzną, pobierając ją z miejsca przechowywania.

## Sprawdzanie punktu odzyskiwania po awarii {#更新失敗後の復旧点を確認する}

Jeśli po nieudanej aktualizacji widzisz `RECOVERY_REVIEW_REQUIRED`, sprawdź stan punktu odzyskiwania z uprawnieniami administratora.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Sprawdzanie stanu w starszych wersjach
>
> Jeśli `n624-latex server recovery status` nie istnieje, wykonaj `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Porównaj identyfikator punktu (`POINT_ID`), wersje aplikacji i aktualizatora, schemat bazy oraz stan usług. Jeśli musisz odtworzyć dane, najpierw zabezpiecz archiwum i bieżącą konfigurację w innym miejscu.
2. Uruchom `acknowledge` dopiero po ustaleniu, że odtwarzanie danych jest zbędne i można zwolnić ochronę punktu.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` kończy przegląd i wznawia usługi, gdy są spełnione warunki. Jeśli zamierzasz odtworzyć dane, pozostaw ochronę punktu i przejdź dalej.

## Odtwarzanie danych {#データを復旧する場合}

Zmiany wprowadzone po wykonaniu kopii zostaną utracone. Jeśli baza pozostaje zgodna i wystarczy przywrócić poprzednią aplikację, skorzystaj z [wycofania w Aktualizacjach](/pl/docs/updates/#前の版へ戻す). Przećwicz odtwarzanie na hoście testowym przed wykonaniem go w środowisku produkcyjnym.

1. **Wybierz punkt docelowy i zabezpiecz stan bieżący.** Znajdź kopię i wersję aplikacji zgodną z jej schematem. Przed zmianami w środowisku produkcyjnym zachowaj oddzielnie bieżącą bazę, magazyn plików i konfigurację.
2. **Zatrzymaj usługi.** Używając wspólnej blokady administracyjnej, zatrzymaj wszystkie usługi i czasomierze zapisujące do bazy lub magazynu, aby uniknąć konfliktu z aktualizacją lub czyszczeniem.
3. **Rozpakuj i zweryfikuj.** Odszyfruj i rozpakuj archiwum do pustego prywatnego katalogu i sprawdź jego integralność. W przypadku punktu aktualizacji porównaj także zarządzany przez roota `summary.json` z manifestem wewnątrz archiwum.
4. **Przywróć jeden stan z przeszłości.** SQLite oraz magazyn plików wejściowych i wyników muszą pochodzić z **tego samego punktu odzyskiwania**. W przypadku kopii okresowej umieść każdy ZIP w zweryfikowanym położeniu `storage_key` wskazanym przez odtworzoną bazę. Użyj odpowiednich wersji, plików konfiguracyjnych, właścicieli i uprawnień.
5. **Uruchom i sprawdź.** Sprawdź logowanie, konwersję zapisanego projektu, pobieranie wyników i utworzenie kolejnej kopii. Jeśli eksport dziennika audytu zatrzyma się z powodu niezgodności pozycji, skorzystaj z [odzyskiwania dzienników audytu](/pl/docs/reference/#監査ログの復旧).

Zobacz [Format i weryfikacja kopii operacyjnych](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) oraz [Projekt punktów odzyskiwania aktualizacji](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
