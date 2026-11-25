---
slug: reference
category: Provoz a vývoj
title: Referenční příručka pro provoz a vývoj
description: Ukládání a obnova výstupů klienta, ověřování MCP a postupy migrace.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Ukládání a obnova výsledků {#成果物の保存-復旧の仕様}

> [!DETAILS] Specifikace a postupy
>
> - **Atomická výměna adresářů.** CLI a Local MCP zachovávají cesty jako `.render/result.pdf`, `job.json` a náhledy. Ověří uvedenou velikost a SHA-256 všech souborů a adresář přepnou, až když je kompletní. Během výměny může adresář na okamžik zmizet. Externí programy mají data číst až po dokončení příkazu.
> - **Automatická obnova.** Sousední adresář `<output-name>.latex-renderer-state` vedle výstupu uchovává stav obnovy a nebere se jako vstup. Při běžném ukončení se dočasná data odstraní. Po vynuceném ukončení obnoví další stažení původní sadu, jestliže se výměna nestihla potvrdit. Po potvrzené výměně zachová novou sadu a uklidí starou. Během operace ani před obnovou stavový adresář nemažte.
> - **Uzamykání a nestandardní stav.** Souběžný zápis do stejného cíle zastaví `OUTPUT_BUSY`. Samotný uplynulý čas nepřipraví aktivní proces o zámek. Při opětovném použití PID se operace preventivně zastaví. Poškozená metadata, neznámé soubory nebo odkazy mimo adresář vyžadují kontrolu před jakýmkoli mazáním.
> - **Uživatelské soubory a limity.** Běžné soubory uživatele se zkopírují do nové sady. Pokud je během stahování zjištěna úprava, zveřejnění se přeruší a úprava zůstane zachována. Je vhodné použít vyhrazený cíl. Každá sada má limit 1 GiB a 10 000 položek. Musí být dost místa na obě sady a dočasná data. Podporovány jsou jen místní souborové systémy. Cesty se symbolickými či pevnými odkazy a připojenými jinými souborovými systémy se odmítají. Záruky nepokrývají zamykání v síťových úložištích ani úplnou atomicitu při výpadku napájení. Pokud ve Windows otevřený soubor zablokuje výměnu, zůstane původní sada zachována.

## Hranice ověření webu {#web認証の境界}

> [!DETAILS] Specifikace a postupy
>
> Serverové relace chrání `/app/`, `/admin/` a jejich API. Nejsou součástí veřejného vyhledávacího indexu. Běžní uživatelé používají `/app/`, do `/admin/` mohou pouze správci a vlastníci. Identitu určuje `issuer + subject` externího poskytovatele nebo `login name` při ověření heslem. E-mail ani zobrazované jméno nejsou ověřovacími klíči. Nahrávání ZIP, úlohy, výstupní soubory a překlad TeXu zajišťuje vykreslovací služba serveru.
>
> > [!NOTE]
> > Prohlížeč krátkodobé tikety trvale neukládá. Serverová relace je v případě potřeby znovu vydá. Nesdílejte soubory cookie relace, tokeny CSRF ani tikety.

## Registrace a diagnostika Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specifikace a postupy
>
> - **Dynamická registrace klientů (DCR).** Nedokončené nebo neaktivní registrace se obvykle odstraní po 30 dnech. Chráněné jsou registrace, na které odkazují platné autorizační kódy nebo rodiny tokenů. Celkový limit je 10 000. Pokud se po vyčištění zobrazí `invalid_client`, klienta zaregistrujte znovu. Přijímají se standardní požadavky DCR bez jména klienta a nadále se ověřuje jméno i URI přesměrování.
> - **Dočasné autorizační požadavky (schéma 20).** Pokud je nutné mezitím provést přihlášení, požadavek se uloží pod krátkým náhodným ID. Lze se k němu vrátit bez dlouhého OAuth `state` v návratové URL. Platí 10 minut a jen jednou při shodě přihlášeného prohlížeče a vyhrazeného souboru cookie. Souběžné karty mají odlišná ID. Celkový limit je 1 000 požadavků a na prohlížeč připadá až 8 pokračovacích souborů cookie. Při dosažení limitu se vrátí `503` a stávající požadavky zůstanou zachovány. V databázi se ukládají pouze otisky ID a cookie. Restart ani obnova ze zálohy neprodlužují platnost.
> - **Limity podle IP a hlavičky zdroje.** DCR umožňuje 10 registrací na důvěryhodnou zdrojovou IP za 15 minut. Klienti sdílející odchozí proxy sdílejí i kvótu. Od 11. pokusu se vrací HTTP `429`, `temporarily_unavailable` a `Retry-After`. Neplatná metadata kvótu nespotřebují. Při chybějící nebo neplatné IP se vrátí `503` pro kontrolu proxy správcem, aniž by se slučovali neznámí klienti. Backend ponechte na zpětné smyčce a na proxy přepište `X-Latex-Renderer-Client-IP` skutečnou adresou. Libovolné hodnoty `X-Forwarded-For` se ignorují. V trasách Cloudflare se v rámci hranice důvěry zpracuje také `CF-Connecting-IP`.
> - **Kontrola připojení správcem.** Následující příkaz ověří veřejné vyhledání služby a výzvu Bearer `401` bez odesílání údajů, změn konfigurace, následování přesměrování či zobrazení těl, souborů cookie a tajemství.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Rozlišení fáze selhání.** Správné `200` při vyhledání služby a výzva `401` ověřují pouze tyto fáze. Porovnejte fázi, čas a `X-Request-ID` s protokoly `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` a `remote_mcp.rpc_result`. Do protokolů a hlášení nevkládejte kódy OAuth, tokeny, cookie, ověřovací hodnoty PKCE, zdroje ani ID uživatelů.
> - **Ověření funguje, ale nevyhledají se dostupné akce.** Po vydání tokenu zkontrolujte zvlášť `initialize`, oznámení o inicializaci a `tools/list`. I s HTTP `200` může odpověď obsahovat `error` JSON-RPC. `remote_mcp.rpc_result` zaznamená stav HTTP, kategorii výsledku, verzi protokolu, počet nástrojů, velikost odpovědi v bajtech a základní tvar seznamu. Vyrovnávací paměť pro kontrolu má limit 256 KiB. Při jeho překročení se zaznamená jen `inspection_limited` a odpověď se předá beze změny. Samotná odpověď SSE ani požadavek `GET` vracející `405` nestačí k určení chyby. Zkontrolujte `Accept`, `Content-Type`, dohodnutou verzi protokolu a doručování požadavků z proxy. Externí OIDC, zásady Cloudflare a skutečný účet ChatGPT ověřte zvlášť v produkci.

## Výsledky a zdroje MCP {#mcpの結果とresource}

> [!DETAILS] Specifikace a postupy
>
> Odpovědi Remote MCP mají tři vrstvy.
> 1. **Běžný `content`.** Obsahuje ID vstupu a úlohy, stav, posun, kurzor, dostupnost a omezenou diagnostiku pro rozhodnutí a další volání nástroje. I klienti bez `structuredContent` nebo vlastních zdrojů mohou vytvářet, opravovat a opakovat vykreslování.
> 2. **`structuredContent`.** Obsahuje úplný ověřený objekt pro strojové zpracování.
> 3. **Zdroje MCP (`latex-renderer://jobs/...`).** Obsahují objemná data, například PDF, celý `compile.log`, nezpracovaný JSON, `svg/manifest.json` a `svg/objects/*.svg`. Číst je může jen stejný vlastník OAuth. Uplatní se stejné limity velikosti a uchování jako u běžných souborů. Všechny vrstvy vynechávají klíče API, tokeny OAuth, tikety, zdrojový text i nezpracovaná data base64.

## Čekání a opakování v CLI {#cliの待機と再試行}

> [!DETAILS] Specifikace a postupy
>
> Při přechodné odpovědi HTTP `502`, `503`, `504` nebo neplatném JSON během zjišťování stavu zopakuje CLI pouze dotaz na stejnou úlohu, a to **nejvýše pětkrát** po 1, 2, 4, 8 a 8 sekundách. Celková doba čekání se neprodlužuje. Vytvoření úlohy, nahrání, obnovení tokenu ani kontrola souborů se automaticky neopakují. Chyby přihlášení a oprávnění se vracejí ihned. Konec čekání v CLI nemusí znamenat ukončení úlohy na serveru.

## Formát JSON rozhraní CLI {#cliのjson形式}

> [!DETAILS] Specifikace a postupy
>
> S `--json` má standardní výstup níže uvedené formáty. Vynechává klíč API, `uploadTicket` a `jobTicket`.
>
> - **Úspěch (návratový kód `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Chyba CLI nebo API (návratový kód `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Úloha dokončená s chybou, například chybou LaTeXu (návratový kód `2`).** `result` obsahuje údaje o úloze a uložené cesty. Odpověď obsahuje `success: false`.

## Migrace a obnova starších verzí {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrace starého aktualizačního nástroje a řešení chyb rozbalení
>
> ### Migrace z aktualizačního nástroje root v1.2.x na oddělená oprávnění {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Do v1.2.x běžel Update Manager jako démon s právy roota. Od v1.3.0 běží trvalý kontrolér jako `latex-renderer-update` a krátkodobý pomocný proces roota přijímá pevně určené operace. Aktualizace ze starého nástroje na webu se může zastavit s `Application Update Manager must use a separate non-root build tree`. Stejnou operaci na webu neopakujte.
>
> Pro tuto jednorázovou migraci použijte [distribuci serveru v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Jako běžný uživatel postupujte podle [stažení a ověření distribuce](/cs/docs/self-hosting/#v1-6-9をダウンロードして検証) a v prvním řádku místo `version=` použijte `version=1.3.6`. Zůstaňte ve stejném terminálu, aby bylo zachováno `bundle_root` z ověření a rozbalení.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Skript pod rootem znovu stáhne stejné neměnné vydání a ověří otisk, značku a commit, balíček Sigstore, hranice archivu a metadata. Přijme pouze `gh` v `/usr/local/bin/gh` nebo `/usr/bin/gh` vlastněné rootem a bez zápisu pro skupinu či ostatní. Oddělí strom `verified` roota, `bootstrap-build` bez práv roota (pevná verze pnpm přes vyhrazený zprostředkovací příkaz Corepack) a `assembly` roota. Předchozí správce zastaví až po získání společného zámku změn a při selhání jej znovu spustí. Poté níže uvedenými příkazy ověřte `User=latex-renderer-update` a stav `active` jednotlivých služeb. Následně používejte běžnou aktualizaci z webu nebo správního CLI.
> Web ani API nedostanou oprávnění sudo ani tokeny GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar zastaví rozbalení s chybou Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Pokud v Ubuntu GNU `tar` používá `openat2`, může omezení aktualizačního nástroje `RestrictSUIDSGID=true` zastavit rozbalení archivu s podadresáři chybou `ENOSYS` (Function not implemented). Opravený nástroj zachovává kontrolu pomocí GNU `tar` i ověření podpisu. Pouze rozbalení přebírá `/usr/bin/bsdtar` v prázdném soukromém dočasném adresáři bez převzetí vlastníků, ACL a rozšířených atributů. Omezení `RestrictSUIDSGID` platí dále a systémový `tar` zůstává zachován.
>
> Starší nástroj nemusí umět rozbalit ani vlastní opravu. Zkontrolujte, že neběží žádné operace, aplikace i databáze jsou v pořádku a máte ověřenou šifrovanou zálohu. Pomocí nainstalovaného `bootstrap-v1` **nejprve aktualizujte pouze samostatný aktualizační nástroj** na zveřejněnou verzi s opravou.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Ověřte novou verzi nástroje a hodnoty `ready` a `pending=false`. Poté použijte tutéž verzi aplikace pomocí webu nebo běžného příkazu `update apply` ve správním CLI.
>
> U aktualizačního nástroje `v1.4.0-rc.3` je známá chyba: kopírování balíčku rootem zachová neprivilegovaného vlastníka a selže s `Release extraction requires a private regular bundle`. Ponechte kontroly zapnuté, nejprve aktualizujte nástroj na vydání s opravou vlastnictví a potom použijte aplikaci. Rozbalení pod rootem a systemd lze samostatně vyzkoušet pomocí `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Vyšetření zámku aktualizace nebo změny TeX
>
> ### Zámek změn je obsazený {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` brání souběhu aktualizace aplikace a změny TeX. Vyčkejte na dokončení aktivní operace. **Nikdy nemažte soubor `/run/latex-renderer/mutation.lock`.** Jeho smazáním mohou vzniknout dva současně držené nezávislé zámky. Pokud k tomu dojde při interní obnově prostředí TeX během aktualizace, operace může soutěžit sama se sebou. Před opakováním zkontrolujte protokoly a zastavené služby.
>
> Pouze pokud žádná operace neběží a protokol potvrzuje dokončení předchozí, zastavte oba správce a zjistěte, který proces drží zámek.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Proces ukončete a správce znovu spusťte až po potvrzení, že jde o osiřelý pomocný proces zámku dokončené operace.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Identita vykreslovací služby ve starších kandidátech na vydání {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Kandidáti na vydání v1.3.4
>
> Aktualizace z `v1.3.4-rc.3` na `v1.3.4-rc.4` selhala před přepnutím služeb, protože počet souborů v otisku identity vykreslovací služby vzrostl z 5 na 6. Pro tuto migraci použijte `v1.3.4-rc.5`, které obsahuje také předchozí údaje pro kompatibilitu. Kontrolní součet celého balíčku a podpis původu ověřují rovněž přidaný soubor.

## Běhová prostředí aktualizačního nástroje {#updaterの実行領域}

> [!DETAILS] Specifikace a postupy
>
> Update Manager důsledně odděluje strom `verified` vlastněný rootem s ověřenou distribucí, `build` bez práv roota pro instalaci závislostí a sestavení a `assembly` vlastněný rootem s povolenými výstupy. Skripty nasazení spouštěné rootem vždy používají ověřenou kopii `assembly`. Pro kroky jako publikování v Cloudflare účtem nasazení se po kontrolách roota použije dočasná kopie `deployment-build`. Totéž platí při návratu k předchozí verzi.

## Instalační cesty a ochrana ve Windows {#windowsの配置と保護}

> [!DETAILS] Specifikace a postupy
>
> Při změně umístění instalace ve Windows se výchozím adresářem příkazů stane jeho podsložka `bin`. Pokud nastavíte `LATEX_RENDER_BIN_DIRECTORY`, umístí se do něj spravované spouštěče a stejnou cestu použijí PATH uživatele i Local MCP. Jiné spouštěče zůstanou zachovány. `setup repair` může opravit dříve zaregistrovanou cestu. Starší položka PATH zůstane k dispozici jiným aplikacím. Používejte absolutní cesty bez středníků, uvozovek a řídicích znaků. Pokud `--open` či grafické rozhraní neotevře prohlížeč nebo prohlížeč PDF, uložené PDF se zachová.

## Sdílení projektů a uchování {#保存プロジェクトの共有-保持}

> [!DETAILS] Pravidla sdílení a uchování
>
> - Web (`/app/`), CLI, veřejné API, Local MCP a Remote MCP sdílejí projekty a historii neměnných revizí jednotlivých uživatelů. Různé klíče API či účty služeb stejného uživatele je mohou číst a měnit. Dočasné vstupy a úlohy lze použít i bez uložení do projektu.
> - Revizi určuje kombinace vstupu, hlavního dokumentu, enginu a výstupních formátů. Revize s různými výstupy mohou sdílet vstup. Formáty vybrané v **Převést znovu** platí jen pro dané spuštění. Chcete-li použít uložené výstupy revize, vyberte počáteční nastavení.
> - Vstup odkazovaný aktivní revizí zůstane zachován i po lhůtě pro osiřelá data a započítává se do uživatelské kvóty. Odstranění projektu skryje jeho záznam. Když se odstraní poslední odkazující projekt a zaniknou související úlohy, vstup ztratí ochranu a po vypršení jej odstraní pravidelné čištění. Pro okamžité úplné vymazání se obraťte na správce.

## Jazyk rozhraní {#表示言語}

Editor na účtu ukládá **Jazyk rozhraní**. Není-li nastavena žádná hodnota, postupuje podle seznamu jazyků prohlížeče a při absenci podporovaného jazyka použije angličtinu. Engine i kódování dokumentu se nastavují zvlášť.

| Oblast | Rozsah překladu |
| --- | --- |
| Web a nastavení | Akce, stavy operací, potvrzení a diagnostika. |
| CLI a MCP | Nápověda a výzvy CLI používají jazyk terminálu. Popisy vzdáleného MCP používají jazyk účtu. |
| Editor | Úpravy, hledání a nahrazování, ukládání a konflikty, stavy překladu a ovládání náhledu jsou dostupné v 18 jazycích. |
| Veřejné návody | Všechny návody jsou dostupné v 18 jazycích uvedených níže. Jazyk lze přepnout v horní části stránky. |

Editor podporuje angličtinu, japonštinu, zjednodušenou čínštinu, korejštinu, španělštinu, portugalštinu, francouzštinu, němčinu, italštinu, ruštinu, turečtinu, polštinu, češtinu, nizozemštinu, švédštinu, norštinu bokmål, dánštinu a finštinu. Protokoly TeXu a externích balíčků zachovávají původní znění kvůli diagnostice.

## Obnova auditních protokolů {#監査ログの復旧}

Po obnově databáze nemusí pozice exportu (`export_database_id`, posloupnost řádků `export_sequence` a `export_token`) odpovídat jejímu stavu. K ochraně dat se v takovém případě export a čištění zastaví.

1. Po dobu vyšetřování a obnovy zastavte služby i časovače exportu a čištění.
2. Zvlášť uchovejte obnovenou databázi, existující šifrované exporty a všechny současné i starší soubory kontrolních bodů. Ověřte integritu, cizí klíče a stav migrace obnovené databáze.
3. Pokud není dostupný odpovídající kontrolní bod a rozhodnete se exportovat dostupné záznamy znovu, přesuňte soubory kontrolních bodů mimo aktivní cesty. Zkontrolujte také cestu `AUDIT_EXPORT_CHECKPOINT`, pokud je nastavena. Zachovejte řádky auditu, posloupnosti SQLite a `export.lock`.
4. Proveďte ruční export s přihlašovacími údaji produkční služby. Než znovu spustíte časovače, ověřte dešifrování výstupu a vznik nového kontrolního bodu ve formátu 3.

Znovu se exportují pouze řádky skutečně přítomné v obnovené databázi. Pro určení duplicit použijte společně `export_database_id`, `export_sequence` a `export_token`. Samotný čas ani datum řádek neidentifikuje.
