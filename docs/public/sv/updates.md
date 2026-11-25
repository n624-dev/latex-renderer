---
slug: updates
category: Egen server
title: Uppdatera servern eller återgå till föregående version
description: Installera en stabil version, verifiera resultatet och välj en återställningsmetod vid fel.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Före uppdateringen {#更新する前に}

| Vad vill du ändra? | Var? |
| --- | --- |
| Serverapplikationen | **Administration → Uppdateringar** |
| Version eller språk i TeX Live | **Administration → TeX-miljö**. Se [Byt TeX-miljö](/sv/docs/self-hosting/#tex環境の初期設定). |
| Lokalt APT-paket `n624-latex` | [Uppdatera APT-paketet](/sv/docs/client/#apt-版の更新) |

Kontrollera följande tre punkter innan du börjar.

1. [Skapa och verifiera en krypterad säkerhetskopia](/sv/docs/backups/#手動で作成する).
2. Välj en tid då få konverteringsjobb pågår.
3. Lämna underhållsläget på `normal`. Uppdateraren stoppar och startar de tjänster som behövs och kör en testkonvertering.

## Installera en stabil version {#正式版を適用する}

1. Logga in som ägare och öppna **Administration → Uppdateringar** (`/admin/updates/`).
2. Lämna versionsfältet tomt och klicka på **Sök efter uppdateringar** för att se aktuell och tillgänglig stabil version.
3. Välj **Hämta, verifiera och uppdatera**, ange orsaken till ändringen och starta uppdateringen.
4. Anteckna **åtgärds-ID:t** och kontrollera att statusen visar att åtgärden slutfördes.
   - Är applikationen redan uppdaterad men uppdateraren behöver ändras, kontrollera resultatet för samma åtgärd och informationen om uppdateraren.
   - Åtgärden fortsätter om du stänger webbläsaren. Om `502` visas under en omstart, vänta tills gränssnittet återansluter.
5. Logga in i en annan webbläsare eller ett privat fönster. Konvertera ett representativt dokument, kontrollera PDF-nedladdningen och verifiera applikationens och uppdaterarens versioner.

## Aviseringar och automatiska uppdateringar {#通知と自動更新}

I uppdateringspolicyn kan du välja mellan att kontrollera och avisera (standard) eller installera automatiskt efter verifiering.

- Automatisk installation gäller bara stabila versioner.
- För att testa en versionskandidat i en separat testmiljö anger du den publicerade taggen i formatet `vX.Y.Z-rc.N`.

## Om uppdateringen misslyckas {#更新が失敗した場合}

Kontrollera åtgärds-ID och fasen där felet uppstod i den detaljerade loggen. Kontrollera applikationens och uppdaterarens versioner, inloggning, konvertering och om återställningspunkten behöver granskas. Enbart versionsnumret räcker inte.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Kontrollera om underhåll pågår och återgå till läge `normal` innan du startar uppdateringen.
- **`RECOVERY_REVIEW_REQUIRED`.** Följ [Granska återställningspunkten efter ett fel](/sv/docs/backups/#更新失敗後の復旧点を確認する).

## Återgå till föregående version {#前の版へ戻す}

- **Om det räcker att återställa applikationen**, kontrollera målversionen under **Administration → Uppdateringar** och välj **Återställ till föregående** om alternativet är tillgängligt. Testa sedan inloggning och PDF-konvertering.
- **Vid en inkompatibel databasändring** måste databas och lagring återställas från samma återställningspunkt. Följ [Återställ data](/sv/docs/backups/#データを復旧する場合).

Se [Migrering och återställning av tidigare versioner](/sv/docs/reference/#旧版からの移行と特殊復旧) och [specifikationen och lagringspolicyn för uppdateraren](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
