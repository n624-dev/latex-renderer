---
slug: lan-https
category: Egen server
title: HTTPS i lokalnettet med Akebi
description: Koble til serveren med en HTTPS-adresse avledet fra den lokale IP-adressen.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Tilgang via IP-adressen i lokalnettet {#lan-の-ip-アドレスからアクセスする}

Akebi omsetter serverens private IP-adresse til et vertsnavn du kan nå over HTTPS.

Sett opp den delte sertifikattjenesten i veiviseren for LaTeX Renderer. Vil du tilby en egen tjeneste, se [Drift av egen Akebi-sertifikattjeneste](/no/docs/lan-https-authority/).

- **IPv4-eksempel.** Med IP-adressen `192.168.1.50` og LAN-domenet `lan.example.org` blir adressen `https://192-168-1-50.lan.example.org`.
- **IPv6.** Navnet inneholder alle åtte grupper i den støttede private adressen på utvidet form. Bruk den nøyaktige nettadressen som vises i oppsettet.

**Krav til nettverk og DNS**
Klienten må kunne nå serverens lokalnett. Hvis navnet ikke kan slås opp, kontroller om ruteren eller DNS-resolveren blokkerer svar med private IP-adresser som **beskyttelse mot DNS-rebinding**. Opprett om nødvendig et unntak bare for LAN-domenet som brukes.

## Velg sertifikattype {#証明書の方式を選ぶ}

| Metode | Krav og egenskaper |
| --- | --- |
| **Delt tjeneste, offentlig CA** | Sett opp den delte tjenesten og godta sertifikatutstederens vilkår. Sertifikatets private nøkkel forblir på serveren. |
| **Egen tjeneste, offentlig CA** | URL og LAN-domene for [egen Akebi-tjeneste](/no/docs/lan-https-authority/), og invitasjonskode hvis det kreves. |
| **Keyless** | Krever en kompatibel tjeneste som utfører signeringen ved TLS-håndtrykket. |
| **Eksisterende sertifikat eller privat CA** | Sertifikat som stemmer med servernavnet og tilhørende privat nøkkel. For privat CA må serveren og alle klientene stole på rotsertifikatet. |

> [!NOTE]
> - Med en offentlig CA vises vertsnavnene fra utstedte sertifikater i **offentlige Certificate Transparency-logger (CT)**.
> - To lokalnett på ulike steder med samme private IP-adresse og LAN-domene regnes som **samme opphav** i nettleseren og deler informasjonskapsler og andre lagrede data.

## Konfigurer tilgang fra lokalnettet {#lan-向けに設定する}

1. For en ny installasjon, [klargjør serveren](/no/docs/self-hosting/#準備するもの) og bruk `sudo n624-latex server setup --web` til å åpne [veiviseren](/no/docs/server-setup/#ブラウザで開く). For å endre en eksisterende server med administrert, dedikert HTTPS, bruk `sudo n624-latex server setup --ingress --web`.
2. Velg **LAN** som tilgangsvei og angi nettverksgrensesnitt, privat IP-adresse, tillatte klientundernett og HTTPS-port.
3. Velg sertifikattjeneste og metode. Med den delte tjenesten konfigureres nettadressen `https://akebi.n624.net` og LAN-domenet `lan.n624.net`, og serveren registreres når du bruker endringene. Du trenger ingen invitasjon. For en offentlig CA, les og godta vilkårene. Krever din egen tjeneste invitasjon, oppgi koden fra administratoren.
4. Kontroller den genererte HTTPS-adressen og tillatte undernett før du tar oppsettet i bruk. Applikasjonen krever fortsatt innlogging med passord eller OIDC.
5. Åpne adressen fra en annen maskin i et tillatt undernett, kontroller at det ikke vises noen sertifikatadvarsel, logg inn og konverter et testdokument.

For å opprette din egen tjeneste, se [Drift av egen Akebi-sertifikattjeneste](/no/docs/lan-https-authority/).

## Kontroller sertifikatstatus {#証明書の状態を確認する}

Bruk disse kommandoene for å se tjenesten, fornyelsestidsuret og loggene i navnerommet.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Hvis utstedelse eller fornyelse mislykkes, sjekk serverklokken, HTTPS-forbindelsen til tjenesten, domenet, IP-adressen og tidspunktet for nytt forsøk fra CA-en. Ved en forbigående feil beholdes det gyldige sertifikatet. Tidsuret tar opp igjen utstedelsen fra lagret tilstand. Hvis nøkkel og tilstand ikke stemmer, kontroller bevarte tilstandsfiler fra samme generasjon.

Se [Utforming av Akebi og feilsøking](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
