---
slug: lan-https-authority
category: Eigen server
title: Een eigen Akebi-certificaatdienst beheren
description: Stel DNS-delegatie van het LAN-domein, certificaatuitgifte en open registratie of registratie op uitnodiging in.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Deze handleiding is voor beheerders van een eigen certificaatdienst. Wil je de gedeelde dienst met LaTeX Renderer gebruiken, zie dan [HTTPS op het LAN met Akebi](/nl/docs/lan-https/).

Zorg voor een DNS-zone die je kunt delegeren, een Linux-host (amd64 of arm64) die openbare DNS en HTTPS kan aanbieden, Node.js 24 of 26 en een account bij je CA. Gebruik een serverdistributie waarvan je de handtekening via de [handmatige downloadprocedure](/nl/docs/self-hosting/#v1-6-9をダウンロードして検証) hebt geverifieerd.

## DNS delegeren {#dns-を委任する}

Stel de volgende records in de bovenliggende zone in. De Akebi-DNS moet vanaf internet bereikbaar zijn op **poort 53 via zowel UDP als TCP**.

| Type | Naam | Waarde |
| --- | --- | --- |
| `A` | `ns1.example.org` | Openbaar IPv4-adres van de Akebi-DNS-server |
| `A` | `akebi.example.org` | Openbaar IPv4-adres van de HTTPS-reverse-proxy voor de Akebi-API |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reserveer `ns1.example.org` voor DNS en plaats de API-host (`akebi.example.org`) buiten de zone voor LAN-certificaten (`lan.example.org`).
- Na delegatie geeft Akebi dynamisch de uit LAN-IP's afgeleide `A`- en `AAAA`-records en de `TXT`-records voor ACME-validatie terug. De bovenliggende zone heeft geen record voor elk IP-adres nodig.

## De dienst installeren {#サービスを配置する}

1. **Maak de gebruiker en de statusmappen.** Scheid de rechten van de applicatie met een eigen gebruiker en groep met de naam `latex-renderer-lan-authority`. Maak `/var/lib/latex-renderer-lan-authority` en de submap `keyless` met deze eigenaar en groep, beide met modus `0700`.
2. **Bereid de configuratiemap voor.** Maak `/etc/latex-renderer-lan-authority` met eigenaar en groep `root:latex-renderer-lan-authority` en modus `0750`. Kopieer `deploy/lan-https/examples/authority.json` uit de geverifieerde distributie naar die map en stel `root:latex-renderer-lan-authority` en modus `0640` in.
3. **Bewerk `authority.json`.**
   - `policy.serverOrigin` bepaalt de HTTPS-URL van de API, bijvoorbeeld `https://akebi.example.org`.
   - `policy.lanDomain` bepaalt het gedelegeerde LAN-domein, bijvoorbeeld `lan.example.org`.
   - `dns.nameserver` en `dns.listeners` bepalen de openbare DNS-hostnaam en de luisteradressen. Gebruikt een andere DNS-dienst poort 53, kies dan een openbaar IP-adres dat daarmee niet conflicteert.
   - Bind `http` aan de loopbackinterface.
   - Stel in `issuers` de openbare CA in. Vereist deze External Account Binding (EAB), gebruik dan het opgegeven bestand `eabFile` met de servicegebruiker als eigenaar en modus `0600` om `kid` en `hmacKey` te bewaren. Staat op het domein CAA ingesteld, sta dan de gekozen CA toe.
4. **Installeer de code en systemd-unit.** In dit voorbeeld staan de geverifieerde bronbestanden in eigendom van root in `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initialiseer de toestand en start de dienst.** Voer `init` alleen de eerste keer uit.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Het HTTPS-certificaat aanvragen {#https-証明書を用意する}

De Nginx-voorbeeldconfiguratie voor de openbare API staat in `deploy/lan-https/examples/authority.nginx.conf` en stuurt verzoeken door naar de API op de loopbackinterface. Vraag eerst het API-certificaat aan voordat je TLS in Nginx aanzet.

Gebruik je automatische verlenging met Certbot, zet dan de CA, contactgegevens, instemming met de voorwaarden en benodigde EAB-gegevens in `/etc/latex-renderer-lan-authority/certbot.ini`, alleen toegankelijk voor root. Gebruik een ECDSA P-256-sleutel. Wacht tot de DNS-delegatie is doorgevoerd en voer de volgende opdrachten uit.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Pas na uitgifte de servernaam en certificaatpaden in Nginx aan, controleer de syntaxis met `nginx -t`, pas de wijzigingen toe en controleer de verlengingstimer van Certbot.

- **Wil je Keyless aanbieden**, vraag dan een apart ECDSA P-256-wildcardcertificaat aan dat alleen `*.lan.example.org` bevat. Verander in de vorige opdracht `--cert-name` in `akebi-keyless`, `-d` in `'*.lan.example.org'` en `--deploy-hook` in `"$hooks/operator-certificate-hook.sh"`. Dit is niet nodig als je alleen de modus met een openbare CA aanbiedt.

## Registratie instellen {#登録方法を設定する}

Kies in `authority.json` met `policy.registration` de registratiemethode voor clientservers.

- `"open"` staat automatische registratie toe.
- `"invite"` vereist een uitnodigingscode van de beheerder.

Geef voor registratie op uitnodiging met de volgende opdracht een code uit met een beperkte geldigheid en een maximumaantal keren dat deze gebruikt mag worden. Stuur hem via een veilig kanaal alleen naar de ontvanger.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

In beide modi gelden limieten voor registraties, uitgiftefrequentie en opgeslagen items en het uitgiftebeleid van de CA.

## Van buitenaf controleren {#外部から確認する}

Controleer vanaf een externe computer de DNS-delegatie, SOA-antwoorden via UDP en TCP, de naamomzetting voor namen afgeleid van IP-adressen en het antwoord op het HTTPS-detectieverzoek.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Zijn alle controles geslaagd, verbind dan een testserver voor LaTeX Renderer via [Toegang vanaf het LAN instellen](/nl/docs/lan-https/#lan-向けに設定する) en controleer de certificaatuitgifte en het inloggen. Geeft de CA een tijdstip voor een nieuwe poging, wacht dan tot dat tijdstip.

**Back-ups.** Neem `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA-accounts en de verlengingsinstellingen van Certbot op in de versleutelde back-ups. Gebruik de online back-upfunctie van SQLite voor een actieve database.

Zie de [configuratievoorbeelden en specificatie van Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
