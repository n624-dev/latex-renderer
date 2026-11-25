---
slug: backups
category: Egen server
title: Opret, verificer og gendan sikkerhedskopier
description: Sammenlign periodiske sikkerhedskopier og gendannelsespunkter ved opdatering, verificer et arkiv, og gendan data.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Hvad gemmes? {#何が保存されるか}

| Type | Indhold | Formål |
| --- | --- | --- |
| **Periodisk sikkerhedskopi** | SQLite-databasen og de input-ZIP'er, som aktive revisioner, kladder og igangværende forhåndsvisninger henviser til | Beskytte databasen, projekter og dokumenter under redigering |
| **Gendannelsespunkt før opdatering** | SQLite umiddelbart før opdateringen, hele applikationslageret og tidligere versionsoplysninger | Undersøge fejl og gendanne den tidligere tilstand |
| **Særskilt kopi af værtskonfigurationen** | Filer som `/etc/latex-renderer/`, private nøgler, TLS-certifikater og Akebi-tilstand | Genopbygge værten efter nedbrud |

- Når du har gendannet en periodisk kopi, kan du åbne projektet i editoren og gendanne forhåndsvisningen. Midlertidige jobresultater og arbejdscacher er ikke med.
- Beskyt konfigurationen, certifikaterne og dekrypteringsnøglen (age-identiteten) separat. **Opbevar krypterede kopier og nøglen på forskellige sikre steder, så en enkelt hændelse ikke ødelægger begge.**

## Opret en sikkerhedskopi manuelt {#手動で作成する}

1. Log ind som ejer, og åbn **Administration → System → Sikkerhedskopier**.
2. Klik på **Opret sikkerhedskopi**, og vent på, at handlingen bliver færdig.
3. Klik på **Bekræft seneste sikkerhedskopi**, og kontroller arkivets navn og tidspunktet for den seneste verificering. Dekrypteringsnøglen skal findes på serveren.

### Opret og verificer fra kommandolinjen {#コマンドで作成-検証する}

1. Opret en krypteret sikkerhedskopi på serveren med det samme. I `/etc/latex-renderer/backup.env` angiver `BACKUP_DIRECTORY` destinationen, som normalt er `/var/lib/latex-renderer/backups`. Timeren `latex-renderer-backup.timer` står for den periodiske sikkerhedskopiering.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopiér arkivet `.tar.age` til en Linux-vært til verificering. Klargør GNU `tar`, `age`, en understøttet version af Node.js (24 eller 26) med `node:sqlite` og dekrypteringsnøglen. Opbevar arkivet og nøglen separat ved langtidsopbevaring.
3. [Hent, verificer og udpak serverdistributionen](/da/docs/self-hosting/#v1-6-9をダウンロードして検証) for den version, der oprettede kopien. Angiv versionen i det første `version=`, sæt `release_dir` til den udpakkede mappe, og kør distributionens script.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Meddelelsen `restore_test.completed` betyder, at verificeringen er færdig. Testen kontrollerer SQLite-databasens konsistens og de input-ZIP'er, som er udpakket på midlertidig lagerplads. Du kan også verificere en ekstern kopi ved at hente den fra opbevaringsstedet.

## Kontroller gendannelsespunktet efter en fejl {#更新失敗後の復旧点を確認する}

Hvis `RECOVERY_REVIEW_REQUIRED` vises efter en mislykket opdatering, skal du kontrollere gendannelsespunktets status med administratorrettigheder.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Kontroller status i tidligere versioner
>
> Findes `n624-latex server recovery status` ikke, skal du køre `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Sammenlign punktets ID (`POINT_ID`), applikationens og opdateringsværktøjets version, databaseskemaet og de kørende tjenester. Skal du gendanne data, så gem først arkivet og den aktuelle konfiguration et andet sted.
2. Kør først `acknowledge`, når du har undersøgt fejlen og bekræftet, at data ikke skal gendannes, og at punktets beskyttelse kan ophæves.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` afslutter gennemgangen og genoptager tjenesterne, hvis betingelserne er opfyldt. Skal du gendanne data, så behold punktet beskyttet, og følg næste fremgangsmåde.

## Gendan data {#データを復旧する場合}

Ændringer efter sikkerhedskopien går tabt. Hvis databasen er kompatibel, og det er nok at gendanne applikationens forrige version, kan du bruge [tilbagerulning under Opdateringer](/da/docs/updates/#前の版へ戻す). Afprøv gendannelsen på en testvært før brug i produktion.

1. **Fastlæg målet, og bevar den aktuelle tilstand.** Find kopien og en applikationsversion, som understøtter dens skema. Gem den nuværende database, lager og konfiguration separat før indgreb i produktion.
2. **Stop tjenesterne.** Tag den fælles administrationslås, og stop alle tjenester og timere, som skriver til databasen eller lageret, så opdateringer eller oprydning ikke kan kollidere med gendannelsen.
3. **Udpak og verificer.** Dekrypter og udpak arkivet i en tom privat mappe, og kontroller integriteten. For et opdateringspunkt skal du også sammenligne den root-administrerede `summary.json` med det interne manifest.
4. **Gendan til samme tidspunkt.** SQLite og lageret for input og resultater skal svare til **samme gendannelsespunkt**. Ved en periodisk kopi skal hver ZIP placeres på den verificerede `storage_key`-placering i den gendannede database. Brug de tilhørende versioner, konfigurationsfiler, ejere og rettigheder.
5. **Start og kontroller.** Kontroller login, konvertering af et gemt projekt, download af resultater og oprettelse af en ny kopi. Stopper eksporten af revisionsloggen på grund af en afvigende position, så følg [Gendan revisionslogge](/da/docs/reference/#監査ログの復旧).

Se [Format og kontroller for driftskopier](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) og [udformningen af gendannelsespunkter ved opdatering](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
