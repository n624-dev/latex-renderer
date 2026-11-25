---
slug: server-setup
category: Własny serwer
title: Kreator konfiguracji serwera
description: Skonfiguruj uwierzytelnianie, HTTPS i limity wykonania na przygotowanym serwerze w przeglądarce lub terminalu.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Wybór procedury {#どの手順を使うか}

Przy pierwszej instalacji [przygotuj serwer](/pl/docs/self-hosting/#準備するもの) i otwórz kreator w **przeglądarce**. W działającej instalacji ten sam kreator pozwala zmienić sposób logowania i limity wykonania.

- Uruchom `sudo n624-latex server setup --plan` na serwerze, aby sprawdzić wymagane pakiety i wolne miejsce. Uzupełnij zgłoszone braki i powtórz sprawdzanie.
- Aby zmienić istniejącą instalację z dedykowanym HTTPS lub HTTPS w sieci LAN (Akebi), dodaj `--ingress` do polecenia uruchamiającego.
- Jeśli na minimalnym hoście Docker zgłosi brak modułów jądra, wykonaj podane instrukcje i spróbuj ponownie. Na przykład jeśli brakuje `nf_tables`, administrator powinien uruchomić `sudo modprobe nf_tables`.

## Uruchomienie w przeglądarce {#ブラウザで開く}

Połącz się przez SSH na konto wdrożeniowe bez uprawnień roota i wykonaj poniższe polecenie. **Pozostaw terminal otwarty do zakończenia konfiguracji.**

```sh
sudo n624-latex server setup --web
```

1. Przy pierwszej instalacji przejrzyj zadania przygotowawcze i wpisz `PREPARE`, aby kontynuować. Poczekaj na pobranie podpisanej wersji, przygotowanie usług oraz utworzenie i zweryfikowanie pierwszego środowiska TeX.
2. Odczytaj z terminala jednorazowy adres URL. Jest ważny przez **5 minut**.
3. Otwórz go na serwerze lub użyj **przekierowania portu SSH**, aby połączyć się z tym samym portem z własnego komputera. Jeśli wyświetlany port to `41234`, wykonaj poniższe polecenie w drugim lokalnym terminalu i otwórz w przeglądarce adres podany przez kreator.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Nie udostępniaj adresu kreatora i nie wystawiaj jego portu w Internecie ani przez odwrotny serwer proxy.

## Sprawdzenie i zastosowanie konfiguracji {#プレビューから適用まで}

1. **Wybierz metodę dostępu i logowania.** Przy pierwszej instalacji skonfiguruj HTTPS i konto pierwszego właściciela. Hasła i sekrety klienta OIDC wpisz w pola maskujące treść.
2. **Sprawdź podgląd.** Zweryfikuj publiczny URL i sposób dostępu. Jeśli zmieniasz metodę, przygotuj tożsamość właściciela dla nowej metody, póki możesz się jeszcze zalogować.
3. **Zastosuj zmiany.** Poczekaj na uruchomienie lub ponowne uruchomienie usług.
4. **Zaloguj się i utwórz PDF.** W osobnym oknie przeglądarki [sprawdź instalację](/pl/docs/self-hosting/#導入完了の確認).

Jeśli przy pierwszej instalacji włączasz hasła i OIDC, najpierw zarejestruj właściciela z hasłem, a następnie dodaj do jego konta wartości OIDC `issuer` i `subject`. W limitach wykonania próg uruchomienia oznacza ilość wolnej pamięci RAM wymaganą do rozpoczęcia zadania, a limit działania oznacza ilość RAM dostępną dla kontenera.

## Sprawdzenie przerwanej zmiany {#中断した変更を確認する}

- Jeśli po rozpoczęciu stosowania zmian połączenie zostanie zerwane, najpierw sprawdź wynik tej samej operacji.
- Jeśli zakończył się proces kreatora, uruchom go ponownie dla tego samego celu i wybierz **Recover** w przeglądarce lub **`RECOVER`** w terminalu. Jeśli rejestracja właściciela już nastąpiła, kreator wykorzysta istniejący wpis i przejdzie do potwierdzenia. Odzyskiwanie konfiguracji nie przywraca starszej kopii bazy danych.
- Pliki odzyskiwania mogą zawierać sekrety TLS lub OIDC. Nie edytuj ich ręcznie. Zgłaszając problem, podaj tylko wyświetlony kod błędu i etap.

## Uruchomienie w terminalu {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Zmieniając istniejący serwer, podaj nowe ustawienie lub naciśnij Enter w pustym polu, aby je zachować. Przy instalacji automatycznego HTTPS w sieci LAN wybierz `LAN` i postępuj zgodnie ze wskazówkami. Podczas pierwszej konfiguracji własnego HTTPS lub konfiguracji istniejącej trasy Cloudflare w terminalu wpisz JSON w podanym formacie w jednym wierszu. Jeśli robisz to po raz pierwszy, [zacznij od przeglądarki](#ブラウザで開く).

### Starsze wersje i instalacje ręczne {#旧版-手動配置の場合}

> [!DETAILS] Bezpośrednie uruchamianie server-setup.mjs
>
> Jeśli serwer został przygotowany bez APT, z osobnym użytkownikiem, Node.js i Dockerem bez uprawnień roota, a zweryfikowane wydanie znajduje się w `/opt/latex-renderer/current`, uruchom bezpośrednio `server-setup.mjs`. Aby przygotować nowy host, zobacz [instrukcję ręcznej instalacji](/pl/docs/self-hosting/#現在の提供状況).
>
> | Zadanie | Argument startowy | Warunki |
> | --- | --- | --- |
> | Zmiana istniejącego uwierzytelniania lub limitów | `--existing` | Zarejestrowany właściciel i działające usługi |
> | Konfiguracja i rejestracja pierwszego właściciela | `--initial` | Przygotowana dystrybucja i środowisko, bez działającej konfiguracji i wcześniejszej bazy |
> | Zmiana zarządzanego dedykowanego HTTPS | `--ingress` | Dedykowany HTTPS w trybie standalone. Migracja ze współdzielonego Nginx to osobna operacja. |
>
> - **Interfejs terminalowy**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Interfejs przeglądarkowy**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Zobacz [Specyfikacja danych wejściowych i odzyskiwania kreatora](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
