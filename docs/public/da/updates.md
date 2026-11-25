---
slug: updates
category: Egen server
title: Opdater serveren, eller gå tilbage til en tidligere version
description: Installér en stabil version, kontroller resultatet, og vælg en gendannelsesmetode ved fejl.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Før opdatering {#更新する前に}

| Hvad vil du ændre? | Hvor? |
| --- | --- |
| Serverapplikationen | **Administration → Opdateringer** |
| TeX Live-version eller sprog | **Administration → TeX-miljø**. Se [Skift TeX-miljø](/da/docs/self-hosting/#tex環境の初期設定). |
| Lokal APT-pakke `n624-latex` | [Opdater APT-pakken](/da/docs/client/#apt-版の更新) |

Kontroller følgende tre punkter, før du begynder.

1. [Opret og verificer en krypteret sikkerhedskopi](/da/docs/backups/#手動で作成する).
2. Vælg et tidspunkt med få aktive konverteringsjob.
3. Lad vedligeholdelsestilstanden stå på `normal`. Opdateringsværktøjet stopper og starter de nødvendige tjenester og udfører en testkonvertering.

## Installér en stabil version {#正式版を適用する}

1. Log ind som ejer, og åbn **Administration → Opdateringer** (`/admin/updates/`).
2. Lad versionsfeltet være tomt, og klik på **Søg efter opdateringer** for at se den aktuelle version og den tilgængelige stabile version.
3. Vælg **Hent, bekræft og opdater**, angiv årsagen til ændringen, og start opdateringen.
4. Notér **handlings-ID'et**, og kontroller, at status viser, at handlingen blev gennemført.
   - Hvis applikationen allerede er ajour, men opdateringsværktøjet mangler at blive opdateret, skal du se resultatet af samme handling og oplysningerne om opdateringsværktøjet.
   - Handlingen fortsætter, selvom du lukker browseren. Vises `502` under en genstart, så vent, til grænsefladen opretter forbindelse igen.
5. Log ind i en anden browser eller et privat vindue. Konvertér et repræsentativt dokument, test PDF-download, og kontroller applikationens og opdateringsværktøjets version.

## Meddelelser og automatiske opdateringer {#通知と自動更新}

I opdateringspolitikken kan du vælge kontrol med meddelelse (standard) eller automatisk installation efter verificering.

- Kun stabile versioner installeres automatisk.
- For at prøve en udgivelseskandidat i et særskilt testmiljø skal du angive det offentliggjorte tag på formen `vX.Y.Z-rc.N`.

## Hvis opdateringen mislykkes {#更新が失敗した場合}

Kontroller handlings-ID og fejlfasen i den detaljerede log. Kontroller applikationens og opdateringsværktøjets version, login, konvertering og eventuelt krav om at gennemgå gendannelsespunktet. Versionsnummeret alene er ikke nok.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Kontroller, om der udføres vedligeholdelse, og skift tilbage til tilstanden `normal`, før du starter opdateringen.
- **`RECOVERY_REVIEW_REQUIRED`.** Følg [Kontroller gendannelsespunktet efter en fejl](/da/docs/backups/#更新失敗後の復旧点を確認する).

## Gå tilbage til forrige version {#前の版へ戻す}

- **Hvis det er nok at rulle applikationen tilbage**, skal du kontrollere målversionen under **Administration → Opdateringer** og vælge **Rul tilbage til forrige**, hvis valget er tilgængeligt. Test derefter login og konvertering til PDF.
- **Hvis databaseændringen er inkompatibel**, skal du gendanne database og lager fra samme gendannelsespunkt. Følg [Gendan data](/da/docs/backups/#データを復旧する場合).

Se [Migrering og gendannelse af tidligere versioner](/da/docs/reference/#旧版からの移行と特殊復旧) og [specifikationen og opbevaringspolitikken for opdateringsværktøjet](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
