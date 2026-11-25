---
slug: lan-https
category: Własny serwer
title: HTTPS w sieci LAN z Akebi
description: Uzyskaj dostęp do serwera pod adresem HTTPS utworzonym z jego lokalnego adresu IP.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Dostęp przez adres IP w sieci LAN {#lan-の-ip-アドレスからアクセスする}

Akebi przekształca prywatny adres IP serwera w nazwę hosta dostępną przez HTTPS.

Skonfiguruj współdzieloną usługę certyfikatów w kreatorze LaTeX Renderer. Jeśli chcesz uruchomić własną usługę, zobacz [Prowadzenie usługi certyfikatów Akebi](/pl/docs/lan-https-authority/).

- **Przykład IPv4.** Dla adresu `192.168.1.50` i domeny LAN `lan.example.org` adres URL to `https://192-168-1-50.lan.example.org`.
- **IPv6.** Nazwa zawiera osiem grup obsługiwanego prywatnego adresu w postaci rozwiniętej. Użyj dokładnego adresu URL wyświetlonego podczas konfiguracji.

**Wymagania sieci i DNS**
Klient musi mieć dostęp do sieci LAN serwera. Jeśli nazwa nie jest rozpoznawana, sprawdź, czy router lub resolver DNS nie blokuje odpowiedzi z prywatnymi adresami IP w ramach **ochrony przed DNS rebinding**. W razie potrzeby dodaj wyjątek wyłącznie dla używanej domeny LAN.

## Wybór rodzaju certyfikatu {#証明書の方式を選ぶ}

| Metoda | Wymagania i cechy |
| --- | --- |
| **Usługa współdzielona, publiczny urząd certyfikacji** | Skonfiguruj usługę i zaakceptuj warunki urzędu certyfikacji (CA). Klucz prywatny certyfikatu pozostaje na serwerze. |
| **Własna usługa, publiczny CA** | Adres URL i domena LAN [własnej usługi Akebi](/pl/docs/lan-https-authority/) oraz kod zaproszenia, jeśli jest wymagany. |
| **Keyless** | Wymaga zgodnej usługi, której powierzane jest podpisywanie podczas negocjacji TLS. |
| **Istniejący certyfikat lub prywatny CA** | Certyfikat zgodny z nazwą serwera i odpowiadający mu klucz prywatny. Dla prywatnego CA skonfiguruj zaufanie do certyfikatu głównego na serwerze i wszystkich klientach. |

> [!NOTE]
> - Przy publicznym CA nazwy hostów z wystawionych certyfikatów trafiają do **publicznych dzienników przejrzystości certyfikatów (CT)**.
> - Dwie sieci LAN w różnych miejscach z tym samym prywatnym adresem IP i domeną LAN stanowią dla przeglądarki **to samo źródło** i współdzielą ciasteczka oraz inne dane.

## Konfiguracja dostępu z sieci LAN {#lan-向けに設定する}

1. W nowej instalacji [przygotuj serwer](/pl/docs/self-hosting/#準備するもの) i za pomocą `sudo n624-latex server setup --web` otwórz [kreator](/pl/docs/server-setup/#ブラウザで開く). Do zmiany konfiguracji działającego serwera z zarządzanym dedykowanym HTTPS użyj `sudo n624-latex server setup --ingress --web`.
2. Wybierz **LAN** jako drogę dostępu, a następnie wskaż interfejs sieciowy, prywatny IP, dozwolone podsieci klientów i port HTTPS.
3. Wybierz usługę i metodę obsługi certyfikatów. W usłudze współdzielonej ustawiane są adres URL `https://akebi.n624.net` i domena LAN `lan.n624.net`, a zastosowanie zmian rejestruje serwer. Zaproszenie nie jest potrzebne. W przypadku publicznego CA przeczytaj i zaakceptuj jego warunki. Jeśli własna usługa wymaga zaproszeń, wpisz kod od administratora.
4. Przed zastosowaniem sprawdź wygenerowany adres HTTPS i dozwolone podsieci. W dalszym ciągu obowiązuje uwierzytelnianie aplikacji hasłem lub OIDC.
5. Z innego komputera w dozwolonej podsieci otwórz adres, sprawdź, czy przeglądarka nie ostrzega o certyfikacie, zaloguj się i przekonwertuj dokument testowy.

Aby uruchomić własną usługę, zobacz [Prowadzenie usługi certyfikatów Akebi](/pl/docs/lan-https-authority/).

## Sprawdzanie stanu certyfikatu {#証明書の状態を確認する}

Następujące polecenia pokazują usługę, czasomierz odnawiania i dzienniki w jej przestrzeni nazw.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Jeśli wystawienie lub odnowienie się nie powiedzie, sprawdź zegar serwera, połączenie HTTPS z usługą, domenę, adres IP oraz czas ponowienia wskazany przez CA. Chwilowy błąd nie usuwa ważnego certyfikatu. Czasomierz wznowi wystawianie od zapisanego stanu. Jeśli klucz i stan się różnią, sprawdź zachowane pliki stanu z tej samej generacji.

Zobacz [Projekt Akebi i rozwiązywanie problemów](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
