---
slug: updates
category: Vlastní server
title: Aktualizace serveru a návrat k předchozí verzi
description: Použijte stabilní vydání, ověřte výsledek a zvolte postup obnovy při selhání.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Před aktualizací {#更新する前に}

| Co chcete změnit | Kde |
| --- | --- |
| Serverová aplikace | **Správa → Aktualizace** |
| Verze nebo jazyky TeX Live | **Správa → Prostředí TeX**. Viz [Změna prostředí TeX](/cs/docs/self-hosting/#tex環境の初期設定). |
| Místní balíček APT `n624-latex` | [Aktualizace balíčku APT](/cs/docs/client/#apt-版の更新) |

Před zahájením zkontrolujte tři věci.

1. [Vytvořte a ověřte šifrovanou zálohu](/cs/docs/backups/#手動で作成する).
2. Zvolte dobu, kdy běží málo převodních úloh.
3. Režim údržby ponechte na `normal`. Aktualizační nástroj zastaví a spustí příslušné služby a provede zkušební převod.

## Použití stabilního vydání {#正式版を適用する}

1. Přihlaste se jako vlastník a otevřete **Správa → Aktualizace** (`/admin/updates/`).
2. Pole verze nechte prázdné a klikněte na **Zkontrolovat aktualizace**. Zobrazí se používaná a dostupná stabilní verze.
3. Vyberte **Stáhnout, ověřit a aktualizovat**, zadejte důvod změny a spusťte aktualizaci.
4. Poznamenejte si **ID operace** a zkontrolujte, že stav označuje úspěšné dokončení.
   - Je-li aplikace již aktuální, ale zbývá změnit aktualizační nástroj, podívejte se na výsledek stejné operace a podrobnosti nástroje.
   - Operace pokračuje i po zavření prohlížeče. Pokud se při restartu objeví `502`, vyčkejte na opětovné připojení rozhraní.
5. Přihlaste se v jiném prohlížeči nebo anonymním okně. Převeďte typický dokument, zkontrolujte stažení PDF a ověřte verze aplikace a aktualizačního nástroje.

## Oznámení a automatické aktualizace {#通知と自動更新}

V zásadách aktualizací lze zvolit kontrolu s oznámením (výchozí nastavení) nebo automatické použití po ověření.

- Automaticky se používají pouze stabilní vydání.
- Chcete-li vyzkoušet kandidáta na vydání v odděleném testovacím prostředí, zadejte jeho zveřejněnou značku ve tvaru `vX.Y.Z-rc.N`.

## Pokud aktualizace selže {#更新が失敗した場合}

V podrobném protokolu zkontrolujte ID operace a fázi selhání. Ověřte verze aplikace a aktualizačního nástroje, přihlášení, převod a požadavek na kontrolu bodu obnovení. Samotné číslo verze nestačí.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Zkontrolujte, zda probíhá údržba, a před zahájením aktualizace obnovte režim `normal`.
- **`RECOVERY_REVIEW_REQUIRED`.** Postupujte podle [kontroly bodu obnovení po selhání](/cs/docs/backups/#更新失敗後の復旧点を確認する).

## Návrat k předchozí verzi {#前の版へ戻す}

- **Pokud stačí vrátit aplikaci**, ve **Správa → Aktualizace** zkontrolujte cílovou verzi a vyberte **Vrátit předchozí verzi**, pokud je možnost dostupná. Poté vyzkoušejte přihlášení a převod do PDF.
- **Pokud je změna databáze nekompatibilní**, obnovte databázi i úložiště ze stejného bodu obnovení. Postupujte podle [obnovy dat](/cs/docs/backups/#データを復旧する場合).

Viz [Migrace a obnova starších verzí](/cs/docs/reference/#旧版からの移行と特殊復旧) a [specifikace aktualizačního nástroje a uchovávání dat](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
