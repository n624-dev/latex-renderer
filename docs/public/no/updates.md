---
slug: updates
category: Egen server
title: Oppdater serveren eller rull tilbake til forrige versjon
description: Installer en stabil versjon, kontroller resultatet og velg en gjenopprettingsmetode ved feil.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Før oppdatering {#更新する前に}

| Hva vil du endre? | Hvor? |
| --- | --- |
| Serverapplikasjonen | **Administrasjon → Oppdateringer** |
| TeX Live-versjon eller språk | **Administrasjon → TeX-miljø**. Se [Endre TeX-miljøet](/no/docs/self-hosting/#tex環境の初期設定). |
| Lokal APT-pakke `n624-latex` | [Oppdater APT-pakken](/no/docs/client/#apt-版の更新) |

Kontroller disse tre punktene før du begynner.

1. [Opprett og kontroller en kryptert sikkerhetskopi](/no/docs/backups/#手動で作成する).
2. Velg et tidspunkt med få aktive konverteringsjobber.
3. La vedlikeholdsmodus stå på `normal`. Oppdateringsverktøyet stopper og starter de nødvendige tjenestene og kjører en testkonvertering.

## Installer en stabil versjon {#正式版を適用する}

1. Logg inn som eier og åpne **Administrasjon → Oppdateringer** (`/admin/updates/`).
2. La versjonsfeltet stå tomt og klikk på **Se etter oppdateringer** for å vise gjeldende og tilgjengelig stabil versjon.
3. Velg **Last ned, bekreft og oppdater**, oppgi årsaken til endringen og start oppdateringen.
4. Noter **operasjons-ID-en** og kontroller at statusen viser at operasjonen ble fullført.
   - Er applikasjonen allerede oppdatert, men oppdateringsverktøyet må endres, se resultatet av samme operasjon og detaljene om oppdateringsverktøyet.
   - Operasjonen fortsetter selv om du lukker nettleseren. Hvis `502` vises under omstart, vent til grensesnittet kobler til igjen.
5. Logg inn i en annen nettleser eller et privat vindu. Konverter et representativt dokument, test PDF-nedlastingen og kontroller versjonene til applikasjonen og oppdateringsverktøyet.

## Varsler og automatiske oppdateringer {#通知と自動更新}

I oppdateringspolicyen kan du velge mellom å sjekke og varsle (standard) eller å installere automatisk etter verifisering.

- Bare stabile versjoner installeres automatisk.
- Hvis du vil prøve en utgivelseskandidat i et separat testmiljø, oppgir du den publiserte taggen på formen `vX.Y.Z-rc.N`.

## Hvis oppdateringen mislykkes {#更新が失敗した場合}

Kontroller operasjons-ID og fasen der feilen oppstod, i den detaljerte loggen. Kontroller versjonene til applikasjonen og oppdateringsverktøyet, innlogging, konvertering og om gjenopprettingspunktet må gjennomgås. Versjonsnummeret alene er ikke tilstrekkelig.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Kontroller om vedlikehold pågår og gå tilbake til modus `normal` før du starter oppdateringen.
- **`RECOVERY_REVIEW_REQUIRED`.** Følg [Kontroller gjenopprettingspunktet etter feil](/no/docs/backups/#更新失敗後の復旧点を確認する).

## Gå tilbake til forrige versjon {#前の版へ戻す}

- **Hvis det holder å rulle tilbake applikasjonen**, kontroller målversjonen under **Administrasjon → Oppdateringer** og velg **Rull tilbake til forrige** hvis alternativet er tilgjengelig. Test deretter innlogging og konvertering til PDF.
- **Hvis databaseendringen er inkompatibel**, må du gjenopprette databasen og lagringen fra samme gjenopprettingspunkt. Følg [Gjenopprett data](/no/docs/backups/#データを復旧する場合).

Se [Migrering og gjenoppretting av eldre versjoner](/no/docs/reference/#旧版からの移行と特殊復旧) og [spesifikasjon og lagringsregler for oppdateringsverktøyet](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
