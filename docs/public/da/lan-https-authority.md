---
slug: lan-https-authority
category: Egen server
title: Drift af en Akebi-certifikattjeneste
description: Konfigurer DNS-delegering af LAN-domænet, certifikatudstedelse og åben registrering eller registrering med invitation.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Vejledningen er til administratorer, som driver deres egen certifikattjeneste. For brug af den delte tjeneste med LaTeX Renderer, se [HTTPS på lokalnettet med Akebi](/da/docs/lan-https/).

Klargør en DNS-zone, du kan delegere, en Linux-vært (amd64 eller arm64) med offentlig DNS og HTTPS, Node.js 24 eller 26 og en konto hos certifikatudstederen. Brug en serverdistribution med en signatur, der er verificeret efter [vejledningen til manuel download](/da/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegér DNS {#dns-を委任する}

Opret følgende poster i den overordnede zone. Akebis DNS skal være tilgængelig fra internettet på **port 53 via både UDP og TCP**.

| Type | Navn | Værdi |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebi-DNS-serverens offentlige IPv4-adresse |
| `A` | `akebi.example.org` | Offentlig IPv4-adresse på den omvendte HTTPS-proxy til Akebi-API'et |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reservér `ns1.example.org` til DNS, og placer API-værten (`akebi.example.org`) uden for zonen for LAN-certifikater (`lan.example.org`).
- Efter delegeringen svarer Akebi dynamisk med `A`- og `AAAA`-poster afledt af IP-adresserne på lokalnettet samt `TXT`-poster til ACME-validering. Den overordnede zone behøver ikke en post for hver IP-adresse.

## Udrul tjenesten {#サービスを配置する}

1. **Opret bruger og tilstandsmapper.** Adskil applikationens rettigheder med en dedikeret bruger og gruppe ved navn `latex-renderer-lan-authority`. Opret `/var/lib/latex-renderer-lan-authority` og dens undermappe `keyless` med dette ejerskab, begge med tilstand `0700`.
2. **Klargør konfigurationsmappen.** Opret `/etc/latex-renderer-lan-authority` med ejer og gruppe `root:latex-renderer-lan-authority` og tilstand `0750`. Kopiér `deploy/lan-https/examples/authority.json` fra den verificerede distribution dertil, og angiv `root:latex-renderer-lan-authority` og tilstand `0640`.
3. **Rediger `authority.json`.**
   - `policy.serverOrigin` angiver API'ets HTTPS-URL, eksempelvis `https://akebi.example.org`.
   - `policy.lanDomain` angiver det delegerede LAN-domæne, eksempelvis `lan.example.org`.
   - `dns.nameserver` og `dns.listeners` angiver DNS-serverens offentlige værtsnavn og lytteadresser. Hvis en anden DNS-tjeneste bruger port 53, skal du vælge en offentlig IP-adresse uden konflikt.
   - Bind `http` til loopback-grænsefladen.
   - Konfigurer den offentlige CA i `issuers`. Hvis den kræver External Account Binding (EAB), så brug den angivne `eabFile` med tjenestebrugeren som ejer og tilstand `0600` til at gemme `kid` og `hmacKey`. Har domænet CAA-poster, skal du tillade den valgte CA.
4. **Installér koden og systemd-enheden.** Eksemplet forudsætter, at de verificerede kilder ejes af root og findes i `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initialiser tilstanden, og start tjenesten.** Kør kun `init` første gang.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Anskaf HTTPS-certifikatet {#https-証明書を用意する}

Nginx-eksemplet til offentliggørelse af API'et ligger i `deploy/lan-https/examples/authority.nginx.conf` og videresender til API'et på loopback-grænsefladen. Anskaf API-certifikatet, før du aktiverer TLS i Nginx.

Ved automatisk fornyelse med Certbot skal du angive CA, kontakt, accept af vilkår og nødvendige EAB-oplysninger i `/etc/latex-renderer-lan-authority/certbot.ini`, som kun root har adgang til. Brug en ECDSA P-256-nøgle. Vent på DNS-delegeringen, og kør følgende.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Efter udstedelsen skal du tilpasse servernavn og certifikatstier i Nginx, kontrollere syntaksen med `nginx -t`, anvende ændringerne og kontrollere Certbots fornyelsestimer.

- **Hvis du vil tilbyde Keyless**, skal du anskaffe et separat ECDSA P-256-wildcardcertifikat, der kun indeholder `*.lan.example.org`. I forrige kommando ændres `--cert-name` til `akebi-keyless`, `-d` til `'*.lan.example.org'` og `--deploy-hook` til `"$hooks/operator-certificate-hook.sh"`. Det er ikke nødvendigt, hvis du kun tilbyder tilstanden med offentlig CA.

## Konfigurer registrering {#登録方法を設定する}

I `authority.json` vælger du registreringsmetoden for klientserverne med `policy.registration`.

- `"open"` tillader automatisk registrering.
- `"invite"` kræver en kode fra administratoren.

Ved registrering med invitation skal du bruge følgende kommando til at udstede en kode med begrænset antal anvendelser og gyldighedstid. Giv den kun til modtageren gennem en sikker kanal.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Begge tilstande er omfattet af grænser for registrering, udstedelsesfrekvens og antal gemte elementer samt CA'ens udstedelsespolitik.

## Verificer udefra {#外部から確認する}

På en ekstern computer skal du kontrollere DNS-delegering, SOA-svar via UDP og TCP, opslag af IP-afledte navne og svaret på tjenesteopdagelse via HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Når alle kontroller lykkes, skal du tilslutte en testserver til LaTeX Renderer ifølge [Konfigurer adgang fra lokalnettet](/da/docs/lan-https/#lan-向けに設定する) og kontrollere certifikatudstedelse og login. Hvis CA'en angiver et tidspunkt for nyt forsøg, skal du vente til da.

**Sikkerhedskopier.** Medtag `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA-konti og Certbots fornyelsesindstillinger i krypterede kopier. Brug SQLites funktion til sikkerhedskopiering under drift til en aktiv database.

Se [konfigurationseksempler og specifikation for Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
