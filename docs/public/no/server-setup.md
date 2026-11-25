---
slug: server-setup
category: Egen server
title: Veiviser for serveroppsett
description: Konfigurer autentisering, HTTPS og kjøregrenser på en klargjort server fra nettleseren eller terminalen.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Velg fremgangsmåte {#どの手順を使うか}

Ved nyinstallasjon, [klargjør serveren](/no/docs/self-hosting/#準備するもの) og åpne veiviseren i en **nettleser**. I en eksisterende installasjon kan du bruke samme veiviser til å endre innlogging og kjøregrenser.

- Kjør `sudo n624-latex server setup --plan` på serveren for å kontrollere nødvendige pakker og ledig plass. Rett opp manglene som vises og gjenta kontrollen.
- For å endre en eksisterende installasjon med dedikert HTTPS eller HTTPS i lokalnettet (Akebi), legg til `--ingress` i startkommandoen.
- Hvis Docker på en minimal vert melder at kjernemoduler mangler, følg anvisningene og prøv på nytt. Kreves for eksempel `nf_tables`, må en administrator kjøre `sudo modprobe nf_tables`.

## Åpne i nettleseren {#ブラウザで開く}

Koble til med SSH som utrullingsbruker uten root-rettigheter og kjør følgende. **La terminalen stå åpen til oppsettet er fullført.**

```sh
sudo n624-latex server setup --web
```

1. Ved første installasjon, se gjennom forberedelsene og skriv `PREPARE` for å fortsette. Vent til den signerte versjonen er lastet ned, tjenestene er klargjort og det første TeX-miljøet er bygd og kontrollert.
2. Finn engangsadressen i terminalen. Den er gyldig i **5 minutter**.
3. Åpne den på serveren eller bruk **SSH-portvideresending** for å nå samme port fra egen maskin. Hvis den viste porten er `41234`, kjør følgende i en annen lokal terminal og åpne adressen fra veiviseren i nettleseren.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Ikke del oppsettsadressen eller eksponer porten på internett eller via en omvendt proxy.

## Se gjennom og bruk innstillingene {#プレビューから適用まで}

1. **Velg tilgangsvei og innloggingsmetode.** I en ny installasjon konfigurerer du HTTPS og den første eieren. Skriv passord og OIDC-klienthemmeligheter i de skjulte feltene.
2. **Kontroller forhåndsvisningen.** Sjekk den offentlige adressen og tilgangsveien. Skal du bytte innloggingsmetode, gjør klar eierens identitet for den nye metoden mens du fortsatt kan logge inn.
3. **Bruk endringene.** Vent til tjenestene har startet eller startet på nytt.
4. **Logg inn og lag en PDF.** Bruk et annet nettleservindu til å [kontrollere installasjonen](/no/docs/self-hosting/#導入完了の確認).

Aktiverer du både passord og OIDC i en ny installasjon, registrer først eieren med passord og legg deretter OIDC-verdiene `issuer` og `subject` til kontoen. I kjøregrensene angir oppstartsterskelen hvor mye RAM som må være ledig før jobben starter, mens kjøregrensen angir hvor mye RAM containeren kan bruke.

## Kontroller en avbrutt endring {#中断した変更を確認する}

- Hvis forbindelsen brytes etter at endringene er påbegynt, kontroller resultatet av samme operasjon først.
- Hvis veiviserprosessen er avsluttet, start den igjen for samme mål og velg **Recover** i nettleseren eller **`RECOVER`** i terminalen. Hvis en eier allerede er registrert, bruker veiviseren den eksisterende registreringen og fortsetter til bekreftelsen. Denne gjenopprettingen av innstillinger gjenoppretter ikke en eldre databasekopi.
- Gjenopprettingsfiler kan inneholde TLS- eller OIDC-hemmeligheter. Unngå å redigere dem manuelt. Oppgi bare feilkoden og fasen hvis du ber om hjelp.

## Åpne i terminalen {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Ved endring av en eksisterende server skriver du inn hver innstilling eller trykker på Enter i et tomt felt for å beholde verdien. For automatisk HTTPS i lokalnettet ved installasjon velger du `LAN` og følger anvisningene. Ved første oppsett av egen HTTPS eller ved konfigurering av en eksisterende Cloudflare-rute fra terminalen, oppgi JSON i det angitte formatet på én linje. Er dette første gang, [begynn i nettleseren](#ブラウザで開く).

### Eldre versjoner og manuell installasjon {#旧版-手動配置の場合}

> [!DETAILS] Kjør server-setup.mjs direkte
>
> Hvis du klargjorde serveren uten APT med en dedikert bruker, Node.js og Docker uten root-rettigheter, og plasserte en verifisert distribusjon i `/opt/latex-renderer/current`, kan du kjøre `server-setup.mjs` direkte. For klargjøring av en ny vert, se [manuell installasjon](/no/docs/self-hosting/#現在の提供状況).
>
> | Oppgave | Startargument | Vilkår |
> | --- | --- | --- |
> | Endre eksisterende autentisering eller grenser | `--existing` | Registrert eier og fungerende tjenester |
> | Konfigurere og registrere første eier | `--initial` | Klargjort distribusjon og miljø, uten driftsoppsett eller tidligere database |
> | Endre administrert, dedikert HTTPS | `--ingress` | Dedikert standalone-HTTPS. Migrering fra en delt Nginx-installasjon er en separat operasjon. |
>
> - **Terminalgrensesnitt**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Nettlesergrensesnitt**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Se [spesifikasjonen for inndata og gjenoppretting i veiviseren](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
