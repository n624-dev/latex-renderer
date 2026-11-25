---
slug: lan-https-authority
category: Egen server
title: Drift av egen Akebi-sertifikattjeneste
description: Sett opp DNS-delegering for LAN-domenet, sertifikatutstedelse og åpen registrering eller registrering med invitasjon.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Veiledningen er for administratorer som driver egen sertifikattjeneste. Vil du bruke den delte tjenesten med LaTeX Renderer, se [HTTPS i lokalnettet med Akebi](/no/docs/lan-https/).

Klargjør en DNS-sone du kan delegere, en Linux-vert (amd64 eller arm64) som kan tilby offentlig DNS og HTTPS, Node.js 24 eller 26 og en konto hos sertifikatutstederen. Bruk en serverdistribusjon med signatur kontrollert etter [veiledningen for manuell nedlasting](/no/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Deleger DNS {#dns-を委任する}

Opprett følgende poster i den overordnede sonen. DNS for Akebi må kunne nås fra internett på **port 53 over både UDP og TCP**.

| Type | Navn | Verdi |
| --- | --- | --- |
| `A` | `ns1.example.org` | Offentlig IPv4-adresse til DNS-serveren for Akebi |
| `A` | `akebi.example.org` | Offentlig IPv4-adresse til HTTPS-proxyen foran Akebi-API-et |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reserver `ns1.example.org` for DNS og plasser API-verten (`akebi.example.org`) utenfor sonen for LAN-sertifikater (`lan.example.org`).
- Etter delegering svarer Akebi dynamisk med `A`- og `AAAA`-poster avledet fra IP-adressene i lokalnettet samt `TXT`-poster for ACME-validering. Den overordnede sonen trenger ikke en post for hver IP-adresse.

## Rull ut tjenesten {#サービスを配置する}

1. **Opprett bruker og tilstandskataloger.** Skill applikasjonens rettigheter fra resten med en dedikert bruker og gruppe med navnet `latex-renderer-lan-authority`. Opprett `/var/lib/latex-renderer-lan-authority` og underkatalogen `keyless` med dette eierskapet, begge med modus `0700`.
2. **Klargjør konfigurasjonskatalogen.** Opprett `/etc/latex-renderer-lan-authority` med eier og gruppe `root:latex-renderer-lan-authority` og modus `0750`. Kopier `deploy/lan-https/examples/authority.json` fra den verifiserte distribusjonen dit og sett `root:latex-renderer-lan-authority` og modus `0640`.
3. **Rediger `authority.json`.**
   - `policy.serverOrigin` angir API-ets HTTPS-adresse, for eksempel `https://akebi.example.org`.
   - `policy.lanDomain` angir det delegerte LAN-domenet, for eksempel `lan.example.org`.
   - `dns.nameserver` og `dns.listeners` angir offentlig DNS-vertsnavn og lytteadresser. Hvis en annen DNS-tjeneste bruker port 53, velg en offentlig IP-adresse som ikke gir konflikt.
   - Bind `http` til loopback-grensesnittet.
   - Konfigurer den offentlige CA-en i `issuers`. Krever den External Account Binding (EAB), bruk den angitte `eabFile` som eies av tjenestebrukeren og har modus `0600`, til å lagre `kid` og `hmacKey`. Hvis domenet har CAA-poster, tillat valgt CA.
4. **Installer koden og systemd-enheten.** Eksempelet forutsetter at de verifiserte kildene eies av root og ligger i `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Initialiser tilstanden og start tjenesten.** Kjør `init` bare første gang.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Skaff HTTPS-sertifikatet {#https-証明書を用意する}

Nginx-eksempelet for å eksponere API-et ligger i `deploy/lan-https/examples/authority.nginx.conf` og videresender til API-et på loopback-grensesnittet. Skaff API-sertifikatet før du aktiverer TLS i Nginx.

Hvis du bruker automatisk fornyelse med Certbot, oppgi utsteder, kontaktopplysninger, godkjenning av vilkår og nødvendige EAB-opplysninger i `/etc/latex-renderer-lan-authority/certbot.ini`, som bare root kan lese. Bruk en ECDSA P-256-nøkkel. Vent til DNS-delegeringen er synlig, og kjør følgende.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Etter utstedelse tilpasser du servernavnet og sertifikatstiene i Nginx, kontrollerer syntaksen med `nginx -t`, bruker endringene og kontrollerer tidsuret for Certbot-fornyelse.

- **Hvis du vil tilby Keyless**, skaff et separat ECDSA P-256-jokertegnsertifikat som bare inneholder `*.lan.example.org`. Endre i forrige kommando `--cert-name` til `akebi-keyless`, `-d` til `'*.lan.example.org'` og `--deploy-hook` til `"$hooks/operator-certificate-hook.sh"`. Dette er ikke nødvendig om du bare tilbyr modusen med offentlig CA.

## Sett opp registrering {#登録方法を設定する}

I `authority.json` velger du metode for registrering av klientservere med `policy.registration`.

- `"open"` tillater automatisk registrering.
- `"invite"` krever en kode fra administratoren.

Ved registrering med invitasjon, utsted en kode med begrenset antall bruk og gyldighetstid med følgende kommando. Gi den bare til mottakeren gjennom en sikker kanal.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Begge moduser har grenser for registreringer, utstedelsesfrekvens og lagrede elementer og følger sertifikatutstederens regler.

## Kontroller utenfra {#外部から確認する}

Fra en ekstern maskin kontrollerer du DNS-delegeringen, SOA-svar over UDP og TCP, oppslag av navn avledet fra IP-adresser og svaret på tjenesteoppdagelse over HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Når alle kontrollene lykkes, koble til en testserver for LaTeX Renderer etter [Konfigurer tilgang fra lokalnettet](/no/docs/lan-https/#lan-向けに設定する) og bekreft sertifikatutstedelse og innlogging. Hvis CA-en oppgir et tidspunkt for nytt forsøk, vent til da.

**Sikkerhetskopier.** Ta med `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA-kontoene og Certbots fornyelsesoppsett i krypterte kopier. Bruk SQLites funksjon for sikkerhetskopiering under drift for en aktiv database.

Se [konfigurasjonseksemplene og spesifikasjonen for Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
