---
slug: backups
category: Eigen server
title: Back-ups maken, verifiëren en terugzetten
description: Vergelijk periodieke back-ups en herstelpunten bij updates, verifieer een archief en herstel je gegevens.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Wat wordt bewaard? {#何が保存されるか}

| Type | Inhoud | Doel |
| --- | --- | --- |
| **Periodieke back-up** | SQLite-database en invoer-ZIP's waarnaar actieve revisies, concepten en lopende voorbeelden verwijzen | Database, projecten en documenten in bewerking beschermen |
| **Herstelpunt vóór een update** | SQLite vlak vóór de update, de volledige applicatieopslag en de vorige versiegegevens | Storingen onderzoeken en de vorige toestand herstellen |
| **Aparte back-up van de hostconfiguratie** | Bestanden zoals `/etc/latex-renderer/`, privésleutels, TLS-certificaten en de Akebi-status | De host opnieuw opbouwen na een storing |

- Open na het terugzetten van een periodieke back-up het project in de editor om het voorbeeld opnieuw te genereren. Resultaten van tijdelijke taken en werkcaches zitten niet in de back-up.
- Bescherm configuratie, certificaten en de ontsleutelingssleutel (age-identiteit) afzonderlijk. **Bewaar de versleutelde back-ups en de sleutel op verschillende veilige locaties, zodat je ze niet door hetzelfde incident kwijtraakt.**

## Handmatig een back-up maken {#手動で作成する}

1. Meld je aan als eigenaar en open **Beheer → Systeem → Back-ups**.
2. Klik op **Back-up maken** en wacht tot de bewerking klaar is.
3. Klik op **Nieuwste back-up verifiëren** en controleer de bestandsnaam en het tijdstip van de laatste verificatie. Hiervoor moet de ontsleutelingssleutel op de server staan.

### Back-ups maken en verifiëren via de opdrachtregel {#コマンドで作成-検証する}

1. Maak direct een versleutelde back-up op de server. In `/etc/latex-renderer/backup.env` bepaalt `BACKUP_DIRECTORY` de bestemming, standaard `/var/lib/latex-renderer/backups`. De timer `latex-renderer-backup.timer` maakt de periodieke back-ups.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopieer het archief `.tar.age` naar een Linux-host voor verificatie. Zorg voor GNU `tar`, `age`, een ondersteunde versie van Node.js (24 of 26) met `node:sqlite` en de ontsleutelingssleutel. Bewaar archief en sleutel afzonderlijk voor langdurige opslag.
3. [Download, verifieer en pak de serverdistributie uit](/nl/docs/self-hosting/#v1-6-9をダウンロードして検証) voor de versie waarmee de back-up is gemaakt. Geef die versie op in de eerste `version=`, stel `release_dir` in op de uitgepakte map en voer het script uit de distributie uit.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

De melding `restore_test.completed` betekent dat de verificatie voltooid is. De test controleert de samenhang van SQLite en de invoer-ZIP's in tijdelijke opslag. Je kunt ook een externe back-up verifiëren door deze weer op te halen uit de opslaglocatie.

## Een herstelpunt na een fout beoordelen {#更新失敗後の復旧点を確認する}

Verschijnt `RECOVERY_REVIEW_REQUIRED` na een mislukte update, controleer dan met beheerdersrechten de status van het herstelpunt.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　De status in eerdere versies controleren
>
> Bestaat `n624-latex server recovery status` niet, voer dan `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status` uit.

1. Vergelijk het herstelpunt-ID (`POINT_ID`), de versies van applicatie en updater, het databaseschema en de actieve diensten. Moet je gegevens herstellen, stel dan eerst het archief en de huidige configuratie elders veilig.
2. Voer `acknowledge` alleen uit nadat je hebt vastgesteld dat er geen gegevens hoeven te worden hersteld en de bescherming van het herstelpunt kan worden opgeheven.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` voltooit de beoordeling en hervat de diensten als aan de voorwaarden is voldaan. Wil je gegevens herstellen, houd het herstelpunt dan beschermd en volg de procedure hieronder.

## Gegevens herstellen {#データを復旧する場合}

Wijzigingen sinds de back-up gaan verloren. Is de database compatibel en volstaat de vorige applicatieversie, gebruik dan [terugzetten via Updates](/nl/docs/updates/#前の版へ戻す). Oefen het gegevensherstel op een testhost voordat je productiegegevens terugzet.

1. **Bepaal het hersteldoel en bewaar de huidige toestand.** Zoek de back-up en de applicatieversie die het databaseschema ondersteunt. Bewaar de huidige database, opslag en configuratie apart voordat je de productieomgeving wijzigt.
2. **Stop de diensten.** Gebruik het gedeelde beheerslot en stop alle diensten en timers die naar de database of opslag schrijven, zodat er geen conflict ontstaat met updates of opschoning.
3. **Pak uit en verifieer.** Ontsleutel het archief, pak het uit in een lege afgeschermde map en controleer de integriteit. Vergelijk bij een herstelpunt voor een update ook de door root beheerde `summary.json` met het interne manifest.
4. **Herstel alles naar hetzelfde tijdstip.** SQLite en de opslag voor invoer en resultaten moeten van **hetzelfde herstelpunt** afkomstig zijn. Zet voor een periodieke back-up elke ZIP op de geverifieerde locatie `storage_key` die de herstelde database aangeeft. Gebruik de bijbehorende versies, configuratiebestanden, eigenaren en rechten.
5. **Start de diensten en controleer de werking.** Test inloggen, een opgeslagen project converteren, resultaten downloaden en een nieuwe back-up maken. Stopt de auditexport wegens een afwijkende positie, volg dan [Auditlogboeken herstellen](/nl/docs/reference/#監査ログの復旧).

Zie het [formaat en de controles voor operationele back-ups](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) en het [ontwerp van herstelpunten voor updates](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
