---
slug: lan-https-authority
category: Egen server
title: Driv en egen Akebi-certifikattjänst
description: Konfigurera DNS-delegering för LAN-domänen, utfärdande av certifikat och öppen registrering eller inbjudningar.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Guiden är för administratörer som driver en egen certifikattjänst. För att använda den delade tjänsten med LaTeX Renderer, se [HTTPS på det lokala nätet med Akebi](/sv/docs/lan-https/).

Förbered en DNS-zon som du kan delegera, en Linuxvärd (amd64 eller arm64) som kan erbjuda publik DNS och HTTPS, Node.js 24 eller 26 och ett konto hos certifikatutfärdaren. Använd en serverdistribution vars signatur verifierats enligt [anvisningarna för manuell hämtning](/sv/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegera DNS {#dns-を委任する}

Skapa följande poster i den överordnade zonen. Akebis DNS måste nås från internet på **port 53 över både UDP och TCP**.

| Typ | Namn | Värde |
| --- | --- | --- |
| `A` | `ns1.example.org` | Publik IPv4-adress för Akebis DNS-server |
| `A` | `akebi.example.org` | Publik IPv4-adress för Akebi-API:ts omvända HTTPS-proxy |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reservera `ns1.example.org` för DNS och placera API-värden (`akebi.example.org`) utanför zonen för LAN-certifikat (`lan.example.org`).
- Efter delegeringen svarar Akebi dynamiskt med `A`- och `AAAA`-poster härledda från IP-adresserna i LAN och `TXT`-poster för ACME-validering. Den överordnade zonen behöver ingen post för varje IP.

## Driftsätt tjänsten {#サービスを配置する}

1. **Skapa användaren och tillståndskatalogerna.** Avskilj applikationens behörigheter med en särskild användare och grupp som heter `latex-renderer-lan-authority`. Skapa `/var/lib/latex-renderer-lan-authority` och underkatalogen `keyless` med den ägaren och gruppen, båda med läge `0700`.
2. **Förbered konfigurationskatalogen.** Skapa `/etc/latex-renderer-lan-authority` med ägare och grupp `root:latex-renderer-lan-authority` och läge `0750`. Kopiera dit `deploy/lan-https/examples/authority.json` från den verifierade distributionen och ange `root:latex-renderer-lan-authority` och läge `0640`.
3. **Redigera `authority.json`.**
   - `policy.serverOrigin` anger API:ts HTTPS-adress, till exempel `https://akebi.example.org`.
   - `policy.lanDomain` anger den delegerade LAN-domänen, till exempel `lan.example.org`.
   - `dns.nameserver` och `dns.listeners` anger det publika DNS-värdnamnet och lyssningsadresserna. Använder en annan DNS-tjänst port 53, välj en publik IP-adress som inte krockar.
   - Bind `http` till loopbackgränssnittet.
   - Ange den publika utfärdaren i `issuers`. Kräver den External Account Binding (EAB), använd den angivna `eabFile` som ägs av tjänsteanvändaren och har läge `0600` för att lagra `kid` och `hmacKey`. Har domänen CAA-poster, tillåt den valda utfärdaren.
4. **Installera koden och systemd-enheten.** Exemplet utgår från att de verifierade källorna ägs av root och finns i `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initiera tillståndet och starta tjänsten.** Kör `init` bara första gången.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Skaffa HTTPS-certifikatet {#https-証明書を用意する}

Nginx-exemplet för att publicera API:t finns i `deploy/lan-https/examples/authority.nginx.conf` och vidarebefordrar till API:t på loopbackgränssnittet. Skaffa API-certifikatet innan du aktiverar TLS i Nginx.

Använder du automatisk förnyelse med Certbot, ange utfärdare, kontaktuppgift, godkännande av villkor och nödvändiga EAB-uppgifter i `/etc/latex-renderer-lan-authority/certbot.ini`, som bara root kommer åt. Använd en ECDSA P-256-nyckel. Vänta tills DNS-delegeringen har slagit igenom och kör följande.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Efter utfärdandet, anpassa servernamn och certifikatsökvägar i Nginx, kontrollera syntax med `nginx -t`, tillämpa ändringarna och kontrollera Certbots förnyelsetimer.

- **För att erbjuda Keyless**, skaffa ett separat ECDSA P-256-jokerteckencertifikat som endast innehåller `*.lan.example.org`. Ändra i föregående kommando `--cert-name` till `akebi-keyless`, `-d` till `'*.lan.example.org'` och `--deploy-hook` till `"$hooks/operator-certificate-hook.sh"`. Detta behövs inte om du enbart erbjuder publik CA.

## Ställ in registreringen {#登録方法を設定する}

I `authority.json` väljer du registreringsmetod för klientservrar med `policy.registration`.

- `"open"` tillåter automatisk registrering.
- `"invite"` kräver en kod utfärdad av administratören.

Vid registrering med inbjudan, utfärda en kod med begränsad giltighetstid och begränsat antal användningar med följande kommando. Lämna koden endast till mottagaren via en säker kanal.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Båda lägena har gränser för registreringar, utfärdandefrekvens och lagrade poster samt omfattas av utfärdarens policy.

## Verifiera utifrån {#外部から確認する}

Kontrollera från en extern dator DNS-delegeringen, SOA-svaren över UDP och TCP, uppslagning av IP-baserade namn och tjänstens identifieringssvar över HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

När alla kontroller lyckas, anslut en testserver för LaTeX Renderer enligt [Konfigurera åtkomst från det lokala nätet](/sv/docs/lan-https/#lan-向けに設定する) och verifiera utfärdande och inloggning. Vänta till angiven tid om utfärdaren anger när du får försöka igen.

**Säkerhetskopior.** Ta med `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA-konton och Certbots förnyelseinställningar i krypterade kopior. Använd SQLites funktion för säkerhetskopiering under drift för en aktiv databas.

Se [konfigurationsexempel och specifikation för Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
