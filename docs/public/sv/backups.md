---
slug: backups
category: Egen server
title: Skapa, verifiera och återställ säkerhetskopior
description: Jämför regelbundna säkerhetskopior och återställningspunkter vid uppdatering, verifiera ett arkiv och återställ data.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Vad ingår? {#何が保存されるか}

| Typ | Innehåll | Användning |
| --- | --- | --- |
| **Regelbunden säkerhetskopia** | SQLite-databasen och indataarkiv som aktiva revisioner, utkast och pågående förhandsvisningar hänvisar till | Skydda databas, projekt och dokument under redigering |
| **Återställningspunkt vid uppdatering** | SQLite omedelbart före uppdateringen, all applikationslagring och föregående versionsinformation | Undersöka fel och återställa tidigare tillstånd |
| **Separat kopia av värdens konfiguration** | Filer som `/etc/latex-renderer/`, privata nycklar, TLS-certifikat och Akebis tillstånd | Återskapa värden efter ett haveri |

- Öppna projektet i redigeraren efter återställning av en regelbunden kopia för att skapa förhandsvisningen på nytt. Tillfälliga jobbresultat och arbetscachar ingår inte.
- Skydda konfiguration, certifikat och dekrypteringsnyckel (age-identiteten) separat. **Förvara krypterade kopior och nyckeln på olika säkra platser så att en enskild händelse inte förstör båda.**

## Skapa en säkerhetskopia manuellt {#手動で作成する}

1. Logga in som ägare och öppna **Administration → System → Säkerhetskopior**.
2. Klicka på **Skapa säkerhetskopia** och vänta tills åtgärden är klar.
3. Klicka på **Verifiera senaste säkerhetskopian** och kontrollera arkivets namn och tidpunkten för senaste verifieringen. Dekrypteringsnyckeln måste finnas på servern.

### Skapa och verifiera från kommandoraden {#コマンドで作成-検証する}

1. Skapa en krypterad säkerhetskopia direkt på servern. I `/etc/latex-renderer/backup.env` anger `BACKUP_DIRECTORY` målet, som normalt är `/var/lib/latex-renderer/backups`. Timern `latex-renderer-backup.timer` sköter de regelbundna kopiorna.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopiera arkivet `.tar.age` till en Linuxvärd för verifiering. Förbered GNU `tar`, `age`, en version av Node.js som stöds (24 eller 26) med `node:sqlite` samt dekrypteringsnyckeln. Förvara arkiv och nyckel separat vid långtidslagring.
3. [Hämta, verifiera och packa upp serverdistributionen](/sv/docs/self-hosting/#v1-6-9をダウンロードして検証) som motsvarar versionen som skapade kopian. Ange versionen i det första `version=`, sätt `release_dir` till den uppackade mappen och kör distributionens skript.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Meddelandet `restore_test.completed` anger att verifieringen är klar. Testet kontrollerar SQLite-databasens konsistens och ZIP-indata som packats upp i tillfälligt utrymme. Du kan även verifiera en extern kopia genom att hämta den från lagringsplatsen.

## Granska återställningspunkten efter ett fel {#更新失敗後の復旧点を確認する}

Om `RECOVERY_REVIEW_REQUIRED` visas efter en misslyckad uppdatering, kontrollera återställningspunktens status med administratörsrättigheter.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Kontrollera status i tidigare versioner
>
> Om `n624-latex server recovery status` saknas, kör `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Jämför punktens ID (`POINT_ID`), applikationens och uppdaterarens versioner, databasschemat och tjänsterna som körs. Behöver data återställas, spara först arkivet och den nuvarande konfigurationen på en annan plats.
2. Kör `acknowledge` först när du har undersökt läget och bekräftat att data inte behöver återställas och att skyddet av punkten kan släppas.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` avslutar granskningen och återupptar tjänsterna om villkoren är uppfyllda. Ska du återställa data, behåll punktens skydd och fortsätt enligt följande.

## Återställ data {#データを復旧する場合}

Ändringar som gjorts efter kopian går förlorade. Om databasen är kompatibel och det räcker att återgå till föregående applikation, använd [återgång från Uppdateringar](/sv/docs/updates/#前の版へ戻す). Öva dataåterställningen på en testvärd innan du utför den i produktion.

1. **Fastställ målet och bevara nuläget.** Leta fram kopian och en applikationsversion som stöder dess schema. Spara nuvarande databas, lagring och konfiguration separat före ingrepp i produktion.
2. **Stoppa tjänsterna.** Ta det gemensamma administrationslåset och stoppa alla tjänster och timers som skriver till databasen eller lagringen för att undvika kollision med uppdatering eller rensning.
3. **Packa upp och verifiera.** Dekryptera och packa upp arkivet i en tom privat mapp och kontrollera integriteten. För en uppdateringspunkt, jämför även den root-hanterade `summary.json` med manifestet i arkivet.
4. **Återställ till samma tidpunkt.** SQLite och lagringen för indata och resultat måste komma från **samma återställningspunkt**. För en regelbunden kopia, placera varje ZIP på den verifierade `storage_key`-plats som den återställda databasen anger. Använd tillhörande versioner, konfigurationsfiler, ägare och behörigheter.
5. **Starta och kontrollera.** Testa inloggning, konvertering av ett sparat projekt, nedladdning av resultat och skapande av en ny kopia. Stoppar granskningsloggarnas export på grund av olika positioner, följ [Återställ granskningsloggar](/sv/docs/reference/#監査ログの復旧).

Se [Format och kontroller för driftskopior](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) och [utformningen av återställningspunkter vid uppdatering](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
