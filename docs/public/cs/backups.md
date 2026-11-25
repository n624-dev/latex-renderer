---
slug: backups
category: Vlastní server
title: Vytváření, ověřování a obnova záloh
description: Porovnejte pravidelné zálohy s body obnovení při aktualizaci, ověřte archiv a obnovte data.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Co se zálohuje {#何が保存されるか}

| Typ | Obsah | Použití |
| --- | --- | --- |
| **Pravidelná záloha** | Databáze SQLite a vstupní ZIP odkazované aktivními revizemi, koncepty a právě vytvářenými náhledy | Ochrana databáze, projektů a rozpracovaných dokumentů |
| **Bod obnovení aktualizace** | SQLite bezprostředně před aktualizací, celé úložiště aplikace a údaje o předchozích verzích | Vyšetření selhání a obnova předchozího stavu |
| **Samostatná záloha konfigurace hostitele** | Soubory jako `/etc/latex-renderer/`, soukromé klíče, certifikáty TLS a stav Akebi | Obnova hostitele po poruše |

- Po obnovení pravidelné zálohy otevřete projekt v editoru a vytvořte nový náhled. Výsledky dočasných úloh a pracovní mezipaměti nejsou součástí zálohy.
- Zabezpečte samostatně konfiguraci, certifikáty a dešifrovací klíč (identitu age). **Šifrované zálohy a klíč uložte na oddělená bezpečná místa, aby při jedné události nedošlo ke ztrátě obou.**

## Ruční vytvoření zálohy {#手動で作成する}

1. Přihlaste se jako vlastník a otevřete **Správa → Systém → Zálohy**.
2. Klikněte na **Vytvořit zálohu** a vyčkejte na dokončení.
3. Klikněte na **Ověřit nejnovější zálohu** a zkontrolujte název archivu a čas posledního ověření. Na serveru je k tomu potřeba dešifrovací klíč.

### Vytvoření a ověření z příkazové řádky {#コマンドで作成-検証する}

1. Vytvořte na serveru okamžitou šifrovanou zálohu. V `/etc/latex-renderer/backup.env` určuje `BACKUP_DIRECTORY` cílové umístění, výchozí je `/var/lib/latex-renderer/backups`. Pravidelné zálohy spouští časovač `latex-renderer-backup.timer`.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Zkopírujte archiv `.tar.age` na ověřovací hostitel s Linuxem. Připravte GNU `tar`, `age`, podporovaný Node.js (24 nebo 26) s `node:sqlite` a dešifrovací klíč. Pro dlouhodobé uchování uložte archiv a klíč odděleně.
3. [Stáhněte, ověřte a rozbalte distribuci serveru](/cs/docs/self-hosting/#v1-6-9をダウンロードして検証) ve verzi použité k vytvoření zálohy. Uveďte ji v prvním `version=`, nastavte `release_dir` na rozbalenou složku a spusťte skript z distribuce.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Zpráva `restore_test.completed` označuje dokončené ověření. Test kontroluje konzistenci SQLite a vstupních ZIP rozbalených v dočasném prostoru. Zálohu mimo server můžete ověřit také jejím stažením z úložiště.

## Kontrola bodu obnovení po selhání {#更新失敗後の復旧点を確認する}

Pokud se po selhání aktualizace zobrazí `RECOVERY_REVIEW_REQUIRED`, zkontrolujte stav bodu obnovení s oprávněním správce.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Kontrola stavu ve starších verzích
>
> Pokud `n624-latex server recovery status` není k dispozici, spusťte `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Porovnejte ID bodu (`POINT_ID`), verze aplikace a aktualizačního nástroje, schéma databáze a stav služeb. Potřebujete-li obnovit data, nejprve uchovejte archiv a současná nastavení na jiném místě.
2. `acknowledge` spusťte až po prověření situace a potvrzení, že obnova dat není potřeba a ochranu bodu lze zrušit.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` dokončí kontrolu a při splnění podmínek obnoví provoz služeb. Při obnově dat nechte bod chráněný a pokračujte následujícím postupem.

## Obnova dat {#データを復旧する場合}

Změny provedené po záloze budou ztraceny. Pokud je databáze kompatibilní a stačí vrátit aplikaci, použijte [návrat k předchozí verzi v Aktualizacích](/cs/docs/updates/#前の版へ戻す). Než obnovíte data v produkci, vyzkoušejte postup na testovacím hostiteli.

1. **Určete cílový stav a uchovejte současný.** Najděte zálohu a verzi aplikace kompatibilní s jejím schématem. Před zásahem v produkci uložte současnou databázi, úložiště a konfiguraci zvlášť.
2. **Zastavte služby.** Pod společným zámkem správy zastavte všechny služby a časovače zapisující do databáze nebo úložiště, abyste vyloučili souběh s aktualizací či čištěním.
3. **Rozbalte a ověřte.** Dešifrujte a rozbalte archiv do prázdné neveřejné složky a zkontrolujte integritu. U bodu aktualizace porovnejte také `summary.json` spravovaný rootem s vnitřním manifestem.
4. **Obnovte data ze stejného okamžiku.** SQLite a úložiště vstupů i výsledků musí odpovídat **stejnému bodu obnovení**. U pravidelné zálohy umístěte každý ZIP na ověřené místo `storage_key` uvedené v obnovené databázi. Použijte odpovídající verze, konfigurační soubory, vlastníky a oprávnění.
5. **Spusťte a ověřte.** Zkontrolujte přihlášení, převod uloženého projektu, stažení výsledků a vytvoření nové zálohy. Pokud se kvůli neshodě pozice zastaví export auditu, pokračujte podle [obnovy auditních protokolů](/cs/docs/reference/#監査ログの復旧).

Viz [Formát a ověření provozních záloh](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) a [návrh bodů obnovení aktualizace](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
