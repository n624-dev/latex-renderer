---
slug: backups
category: Egen server
title: Opprett, kontroller og gjenopprett sikkerhetskopier
description: Sammenlign regelmessige sikkerhetskopier med gjenopprettingspunkter ved oppdatering, kontroller et arkiv og gjenopprett data.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Hva tas det kopi av? {#何が保存されるか}

| Type | Innhold | Bruksområde |
| --- | --- | --- |
| **Regelmessig sikkerhetskopi** | SQLite-databasen og ZIP-inndata som aktive revisjoner, utkast og pågående forhåndsvisninger viser til | Beskytte databasen, prosjekter og dokumenter under redigering |
| **Gjenopprettingspunkt for oppdatering** | SQLite rett før oppdatering, hele applikasjonslageret og tidligere versjonsinformasjon | Undersøke feil og gjenopprette tidligere tilstand |
| **Separat kopi av vertsoppsett** | Filer som `/etc/latex-renderer/`, private nøkler, TLS-sertifikater og Akebi-tilstand | Bygge opp verten etter havari |

- Etter gjenoppretting fra en regelmessig kopi kan du åpne prosjektet i redigeringsverktøyet og opprette forhåndsvisningen på nytt. Resultater fra midlertidige jobber og arbeidsbuffere er ikke med.
- Sikre oppsett, sertifikater og dekrypteringsnøkkelen (age-identiteten) separat. **Oppbevar krypterte kopier og nøkkelen på forskjellige sikre steder, slik at én hendelse ikke ødelegger begge.**

## Opprett en sikkerhetskopi manuelt {#手動で作成する}

1. Logg inn som eier og åpne **Administrasjon → System → Sikkerhetskopier**.
2. Klikk på **Opprett sikkerhetskopi** og vent til operasjonen er ferdig.
3. Klikk på **Bekreft nyeste sikkerhetskopi** og kontroller arkivnavnet og tidspunktet for siste verifisering. Dekrypteringsnøkkelen må være på serveren.

### Opprett og kontroller fra kommandolinjen {#コマンドで作成-検証する}

1. Opprett en kryptert sikkerhetskopi på serveren med en gang. I `/etc/latex-renderer/backup.env` angir `BACKUP_DIRECTORY` målet, som normalt er `/var/lib/latex-renderer/backups`. Tidsuret `latex-renderer-backup.timer` kjører den regelmessige sikkerhetskopieringen.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopier arkivet `.tar.age` til en Linux-vert for verifisering. Ha GNU `tar`, `age`, en støttet versjon av Node.js (24 eller 26) med `node:sqlite` og dekrypteringsnøkkelen tilgjengelig. Ved langtidslagring oppbevarer du arkivet og nøkkelen separat.
3. [Last ned, verifiser og pakk ut serverdistribusjonen](/no/docs/self-hosting/#v1-6-9をダウンロードして検証) som svarer til versjonen som opprettet kopien. Oppgi versjonen i den første `version=`, sett `release_dir` til den utpakkede mappen og kjør skriptet fra distribusjonen.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Meldingen `restore_test.completed` betyr at kontrollen er fullført. Testen kontrollerer konsistensen i SQLite og ZIP-inndataene som ble pakket ut på midlertidig lagringsplass. Du kan også verifisere en ekstern kopi ved å hente den fra lagringsstedet.

## Kontroller gjenopprettingspunktet etter feil {#更新失敗後の復旧点を確認する}

Hvis `RECOVERY_REVIEW_REQUIRED` vises etter en mislykket oppdatering, kontroller statusen for gjenopprettingspunktet med administratorrettigheter.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Kontroller status i eldre versjoner
>
> Hvis `n624-latex server recovery status` ikke finnes, kjør `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Sammenlign punktets ID (`POINT_ID`), versjonene til applikasjonen og oppdateringsverktøyet, databaseskjemaet og kjørende tjenester. Hvis du må gjenopprette data, ta først vare på arkivet og gjeldende konfigurasjon et annet sted.
2. Kjør `acknowledge` først etter at du har undersøkt feilen og bekreftet at data ikke må gjenopprettes, og at beskyttelsen av punktet kan oppheves.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` avslutter gjennomgangen og gjenopptar tjenestene hvis vilkårene er oppfylt. Skal du gjenopprette data, la punktet være beskyttet og fortsett med neste fremgangsmåte.

## Gjenopprett data {#データを復旧する場合}

Endringer etter sikkerhetskopien går tapt. Hvis databasen er kompatibel og det holder å gå tilbake til forrige applikasjon, bruk [tilbakerulling under Oppdateringer](/no/docs/updates/#前の版へ戻す). Prøv gjenopprettingen på en testvert før du utfører den i produksjon.

1. **Finn målet og ta vare på nåtilstanden.** Finn kopien og en applikasjonsversjon som støtter skjemaet. Bevar nåværende database, lagring og konfigurasjon separat før du endrer produksjonsmiljøet.
2. **Stopp tjenestene.** Bruk den felles administrasjonslåsen og stopp alle tjenester og tidsur som skriver til databasen eller lageret for å unngå konflikt med oppdatering eller opprydding.
3. **Pakk ut og verifiser.** Dekrypter og pakk ut arkivet i en tom, privat mappe og kontroller integriteten. For et oppdateringspunkt, sammenlign også den root-administrerte `summary.json` med det interne manifestet.
4. **Gjenopprett til samme tidspunkt.** SQLite og lagringen for inndata og resultater må stamme fra **samme gjenopprettingspunkt**. For en regelmessig kopi plasserer du hver ZIP på den verifiserte `storage_key`-plasseringen i den gjenopprettede databasen. Bruk tilhørende versjoner, konfigurasjonsfiler, eiere og rettigheter.
5. **Start og kontroller.** Test innlogging, konvertering av et lagret prosjekt, nedlasting av resultater og oppretting av en ny kopi. Stopper eksporten av revisjonslogger på grunn av avvikende posisjon, se [Gjenopprett revisjonslogger](/no/docs/reference/#監査ログの復旧).

Se [Format og kontroller for driftskopier](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) og [utformingen av gjenopprettingspunkter for oppdatering](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
