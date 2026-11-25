---
slug: updates
category: Eigen server
title: De server bijwerken of een vorige versie terugzetten
description: Installeer een stabiele versie, controleer het resultaat en kies een herstelprocedure als het misgaat.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Voor het bijwerken {#更新する前に}

| Wat wil je wijzigen? | Waar? |
| --- | --- |
| Serverapplicatie | **Beheer → Updates** |
| Versie of talen van TeX Live | **Beheer → TeX-omgeving**. Zie [De TeX-omgeving wijzigen](/nl/docs/self-hosting/#tex環境の初期設定). |
| Lokaal APT-pakket `n624-latex` | [Het APT-pakket bijwerken](/nl/docs/client/#apt-版の更新) |

Controleer deze drie punten voordat je begint.

1. [Maak een versleutelde back-up en verifieer deze](/nl/docs/backups/#手動で作成する).
2. Kies een moment met weinig actieve conversietaken.
3. Laat de onderhoudsmodus op `normal` staan. De updater stopt en start de benodigde diensten en voert een testconversie uit.

## Een stabiele versie installeren {#正式版を適用する}

1. Meld je aan als eigenaar en open **Beheer → Updates** (`/admin/updates/`).
2. Laat het versieveld leeg en klik op **Controleren op updates** voor de huidige en beschikbare stabiele versie.
3. Kies **Downloaden, verifiëren en bijwerken**, voer de reden van de wijziging in en start de update.
4. Noteer het **bewerkings-ID** en controleer of de status aangeeft dat de bewerking geslaagd is.
   - Is de applicatie al bijgewerkt maar de updater nog niet, controleer dan het resultaat van dezelfde bewerking en de details van de updater.
   - De bewerking gaat door als je de browser sluit. Verschijnt er tijdens een herstart een `502`, wacht dan tot de interface opnieuw verbinding maakt.
5. Meld je aan in een andere browser of een privévenster. Converteer een representatief document, controleer de PDF-download en verifieer de versies van de applicatie en de updater.

## Meldingen en automatische updates {#通知と自動更新}

In het updatebeleid kun je kiezen tussen controleren en melden (standaard) of automatisch installeren na verificatie.

- Alleen stabiele versies worden automatisch geïnstalleerd.
- Om een release candidate in een aparte testomgeving te proberen, geef je de gepubliceerde tag op in de vorm `vX.Y.Z-rc.N`.

## Als de update mislukt {#更新が失敗した場合}

Controleer het bewerkings-ID en de fase waarin het misging in het gedetailleerde logboek. Controleer de applicatie- en updaterversies, het inloggen, het converteren en of het herstelpunt moet worden beoordeeld. Alleen het versienummer is onvoldoende.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Controleer of er onderhoud gaande is en herstel de modus `normal` voordat je gaat bijwerken.
- **`RECOVERY_REVIEW_REQUIRED`.** Volg [Een herstelpunt na een fout beoordelen](/nl/docs/backups/#更新失敗後の復旧点を確認する).

## De vorige versie terugzetten {#前の版へ戻す}

- **Als het voldoende is om de applicatie terug te zetten**, bekijk dan de doelversie in **Beheer → Updates** en kies **Terugzetten naar vorige versie** als die optie beschikbaar is. Test na afloop het inloggen en de conversie naar PDF.
- **Als de databasewijziging incompatibel is**, moet je de database en de opslag van hetzelfde herstelpunt terugzetten. Volg de procedure voor [gegevensherstel](/nl/docs/backups/#データを復旧する場合).

Zie [Migratie en herstel van eerdere versies](/nl/docs/reference/#旧版からの移行と特殊復旧) en de [specificatie en het bewaarbeleid van de updater](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
