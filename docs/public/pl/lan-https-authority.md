---
slug: lan-https-authority
category: Własny serwer
title: Prowadzenie usługi certyfikatów Akebi
description: Skonfiguruj delegację DNS domeny LAN, wystawianie certyfikatów i rejestrację otwartą lub na zaproszenie.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Ten rozdział jest przeznaczony dla administratorów prowadzących własną usługę certyfikatów. Aby korzystać z usługi współdzielonej w LaTeX Renderer, zobacz [HTTPS w sieci LAN z Akebi](/pl/docs/lan-https/).

Przygotuj strefę DNS, którą możesz delegować, host Linux (amd64 lub arm64) z publicznie dostępnymi usługami DNS i HTTPS, Node.js 24 lub 26 oraz konto w wybranym urzędzie certyfikacji (CA). Użyj dystrybucji serwera, której podpis został sprawdzony zgodnie z [procedurą ręcznego pobierania](/pl/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegowanie strefy DNS {#dns-を委任する}

Skonfiguruj poniższe rekordy w strefie domeny nadrzędnej. DNS Akebi musi być dostępny z Internetu na **porcie 53 przez UDP i TCP**.

| Typ | Nazwa | Wartość |
| --- | --- | --- |
| `A` | `ns1.example.org` | Publiczny adres IPv4 serwera DNS Akebi |
| `A` | `akebi.example.org` | Publiczny adres IPv4 odwrotnego serwera proxy HTTPS obsługującego API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Przeznacz `ns1.example.org` wyłącznie na DNS i umieść host API (`akebi.example.org`) poza strefą certyfikatów LAN (`lan.example.org`).
- Po delegacji strefy Akebi dynamicznie zwraca rekordy `A` i `AAAA` wyprowadzone z adresów IP w sieci LAN oraz rekordy `TXT` do walidacji ACME. W strefie nadrzędnej nie trzeba tworzyć osobnego rekordu dla każdego adresu IP.

## Wdrożenie usługi {#サービスを配置する}

1. **Utwórz użytkownika i katalogi stanu.** Oddziel uprawnienia aplikacji, tworząc dedykowanego użytkownika i grupę o nazwie `latex-renderer-lan-authority`. Utwórz `/var/lib/latex-renderer-lan-authority` i podkatalog `keyless` z tym właścicielem i grupą oraz uprawnieniami `0700`.
2. **Przygotuj katalog konfiguracji.** Utwórz `/etc/latex-renderer-lan-authority` z właścicielem i grupą `root:latex-renderer-lan-authority` oraz uprawnieniami `0750`. Skopiuj tam `deploy/lan-https/examples/authority.json` ze zweryfikowanej dystrybucji, ustaw `root:latex-renderer-lan-authority` i uprawnienia `0640`.
3. **Zmień `authority.json`.**
   - `policy.serverOrigin` określa adres HTTPS API, na przykład `https://akebi.example.org`.
   - `policy.lanDomain` określa delegowaną domenę LAN, na przykład `lan.example.org`.
   - `dns.nameserver` i `dns.listeners` określają publiczny host DNS i jego adresy nasłuchu. Jeśli inny DNS używa portu 53, wybierz publiczny IP, który nie powoduje konfliktu.
   - Powiąż `http` z interfejsem pętli zwrotnej.
   - Skonfiguruj publiczny CA w `issuers`. Jeśli wymaga External Account Binding (EAB), zapisz dane w określonym pliku `eabFile`, którego właścicielem jest użytkownik usługi, z uprawnieniami `0600`. Umieść w nim `kid` i `hmacKey`. Jeśli domena ma rekordy CAA, zezwól na wybrany CA.
4. **Zainstaluj kod i jednostkę systemd.** W przykładzie zweryfikowane źródła należące do roota znajdują się w `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Zainicjuj stan i uruchom usługę.** Uruchom `init` tylko przy pierwszym wdrożeniu.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Uzyskanie certyfikatu HTTPS {#https-証明書を用意する}

Przykład konfiguracji Nginx publikującej API znajduje się w `deploy/lan-https/examples/authority.nginx.conf` i przekazuje żądania do API przez interfejs pętli zwrotnej. Uzyskaj certyfikat API przed włączeniem TLS w Nginx.

Jeśli używasz automatycznego odnawiania przez Certbot, w pliku `/etc/latex-renderer-lan-authority/certbot.ini` dostępnym tylko dla roota podaj CA, dane kontaktowe, akceptację warunków i wymagane dane EAB. Użyj klucza ECDSA P-256. Poczekaj na propagację delegacji DNS i wykonaj poniższe polecenia.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Po wystawieniu dostosuj nazwę serwera i ścieżki certyfikatów w Nginx, sprawdź składnię za pomocą `nginx -t`, zastosuj zmiany i sprawdź czasomierz odnawiania Certbot.

- **Aby udostępnić tryb Keyless**, uzyskaj osobny certyfikat wieloznaczny ECDSA P-256 zawierający wyłącznie `*.lan.example.org`. W poprzednim poleceniu zmień `--cert-name` na `akebi-keyless`, `-d` na `'*.lan.example.org'` i `--deploy-hook` na `"$hooks/operator-certificate-hook.sh"`. Przy samej obsłudze publicznego CA nie jest to konieczne.

## Konfiguracja rejestracji {#登録方法を設定する}

W `authority.json` wybierz metodę rejestracji serwerów klienckich za pomocą `policy.registration`.

- `"open"` umożliwia automatyczną rejestrację.
- `"invite"` wymaga kodu od administratora.

Przy rejestracji na zaproszenie wystaw poniższym poleceniem kod z ograniczoną liczbą użyć i terminem ważności. Przekaż go bezpiecznym kanałem tylko odbiorcy.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

W obu trybach obowiązują ograniczenia liczby rejestracji, częstości wystawiania i ilości przechowywanych elementów oraz zasady wystawiania certyfikatów przez CA.

## Weryfikacja z zewnątrz {#外部から確認する}

Na zewnętrznym komputerze sprawdź delegację DNS, odpowiedzi SOA przez UDP i TCP, rozpoznawanie nazw wyprowadzonych z adresów IP i odpowiedź wykrywania usługi przez HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Kiedy wszystkie testy się powiodą, połącz testowy serwer LaTeX Renderer zgodnie z instrukcją [konfiguracji dostępu z sieci LAN](/pl/docs/lan-https/#lan-向けに設定する) i sprawdź wydanie certyfikatu i logowanie. Jeśli CA podał czas ponowienia, zaczekaj do tego terminu.

**Kopie zapasowe.** Uwzględnij `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, konta w CA i ustawienia odnawiania Certbot w szyfrowanych kopiach. Dla działającej bazy SQLite korzystaj z funkcji tworzenia kopii online.

Zobacz [Przykłady konfiguracji i specyfikacja Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
