---
slug: cli
category: CLI
title: Převod dokumentů a stažení výsledků v CLI
description: Překládejte TeX v terminálu a stahujte PDF, protokoly a náhledy.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Ve složce obsahující `main.tex` spusťte `n624-latex main.tex` a PDF se uloží do stejné složky. Při prvním použití [nainstalujte CLI](/cs/docs/client/) a nastavte připojení.

## Přihlášení {#認証}

Pro uložení klíče API otevřete obrazovku nastavení v prohlížeči.

```sh
n624-latex setup --gui
```

Pokud prohlížeč nelze otevřít, například v relaci SSH, předejte klíč přes **standardní vstup**, aby se neobjevil v argumentech příkazu. V Bashi nebo Zsh spusťte první řádek, vložte klíč, stiskněte Enter a pokračujte dalšími řádky.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Ve Windows lze použít také [skrytý vstup instalačního programu](/cs/docs/windows/#インストール).

První příkaz zkontroluje, zda je klíč uložený, druhý jej odstraní.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` zobrazí skutečnou adresu připojení a zdroj přihlašovacích údajů: název uloženého profilu, proměnnou prostředí `LATEX_RENDER_API_KEY` nebo údaj, že nejsou nastavené. S `--json` se zobrazí pole `origin` a `credentialSource`.

- Je-li nastavena proměnná prostředí `LATEX_RENDER_API_KEY`, má přednost před místním klíčem.
- `logout` odebere jen místně uložený klíč. Proměnnou prostředí v případě potřeby zrušte nebo klíč odvolejte zvlášť na serveru.

### Výběr serveru {#接続先サーバー}

Ve výchozím nastavení se CLI připojuje k hostované službě (`https://latex-render.n624.jp`). Pro vlastní server nastavte jeho adresu HTTPS ve stejné relaci terminálu, v níž budete příkazy spouštět.

- Vynechte přípony `/app/` a `/api/v1/` v adrese URL.
- Použijte klíč API vydaný tímto serverem.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Nastavení a diagnostika {#セットアップと診断}

Příkazem `n624-latex setup` otevřete nastavení připojení a integrací. Při potížích s připojením zkontrolujte nejdříve stav následujícími příkazy. Pokud nelze najít `n624-latex`, viz [Instalace a PATH](/cs/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` zkontroluje instalaci a přihlašovací údaje v režimu pouze pro čtení, aniž by vypsal hodnotu klíče API. Při zjištění potíží vrátí návratový kód `2`.

| Způsob instalace | Aktualizace a oprava |
| --- | --- |
| APT | [Aktualizujte přes APT](/cs/docs/client/#apt-版の更新) nebo poškozené balíčky [přeinstalujte](/cs/docs/client/#状態確認と修復). [Local MCP zaregistrujte ručně](/cs/docs/mcp/#local-mcpの登録). |
| Homebrew | [Aktualizujte přes Homebrew](/cs/docs/client/#homebrew-版の更新) nebo poškozené balíčky [přeinstalujte](/cs/docs/client/#状態確認と修復). Integrace AI nastavte pomocí `n624-latex setup`. |
| Stažený instalátor | [Aktualizujte v nastavení](/cs/docs/client/#配布インストーラー版の更新). Spravované integrace a spouštěče opravte pomocí `n624-latex setup repair`. |

Při odinstalaci postupujte podle [pokynů pro použitý způsob instalace](/cs/docs/client/#アンインストール). Rozhraní nastavení běží místně a ukončí se při zavření CLI.

## Vykreslování {#レンダリング}

### Přímý převod souboru TeX {#tex-ファイルを直接変換する}

Zadejte soubor `.tex` ve složce projektu a vytvořte PDF. Na obrázky, bibliografii a místní soubory `.sty` můžete odkazovat relativními cestami.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Pokud vynecháte `-o`, do složky, ze které jste příkaz spustili, se uloží PDF se stejným základem názvu, například `main.pdf`.
- Při chybě LaTeXu se podle dostupných údajů zobrazí soubor, řádek a ID úlohy. Jestliže se nezdaří překlad nebo stažení, zůstane poslední úspěšně uložené PDF zachováno.

#### Výběr enginu LaTeX {#latex-のエンジンを選ぶ}

Pro XeLaTeX uveďte název enginu před souborem.

```sh
n624-latex xelatex main.tex
```

Pokud engine neurčíte, CLI hledá na začátku dokumentu `% !TeX program = xelatex` nebo
`% !TEX TS-program = xelatex`. Pokud direktiva chybí, načte
`.n624-latex.json` v kořeni projektu. Soubor můžete sdílet
v Gitu, aby se na jiných počítačích používal stejný engine.

```json
{"engine":"xelatex"}
```

Výchozím enginem je LuaLaTeX. pLaTeX a upLaTeX vyžadují,
aby běhové prostředí serveru zahrnovalo japonskou jazykovou kolekci.

| Engine | Co ověřit při přenosu dokumentu |
| --- | --- |
| LuaLaTeX | Zkontrolujte nastavení dokumentů používajících `fontspec` nebo LuaTeX-ja. |
| pdfLaTeX | Nepodporuje `fontspec`. Použijte nastavení písem pro pdfLaTeX. |
| XeLaTeX | Podporuje `fontspec`. Ověřte, zda dokument používá balíčky určené výhradně pro LuaTeX. |
| pLaTeX / upLaTeX | Použijte japonskou dokumentovou třídu odpovídající enginu. U `jsarticle` v upLaTeXu určete volbu třídy `uplatex`. |

Zpracování bibliografie závisí na balíčcích a konfiguraci dokumentu. Zahrňte `.bib` a své vlastní `.bst`. Dokumenty BibTeX používají v pLaTeXu pBibTeX a v upLaTeXu upBibTeX. Ověření PDF, SVG a poloh SVG popisuje [prostředí vykreslování](/app/environment/).

### Převod ZIP nebo získání více výstupů {#zip-複数の出力を指定する}

Podpříkaz `render` slouží k převodu ZIP nebo stažení sady výstupů včetně protokolů, náhledů a SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Příklady**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Výchozí cesta je aktuální složka a výchozí hodnota `--entrypoint` je `main.tex`. CLI připraví vstup s nejvýše 500 soubory a vyčká na dokončení. Hlavní dokument lze uvést relativní cestou k `.tex`. Server ověří bezpečnost cesty a existenci souboru.
- S `--svg` se navíc extrahují vnější matematické výrazy a obrázky TikZ nejvyšší úrovně jako samostatná SVG.

### Opětovné použití vstupu pro více dokumentů {#同じ入力から複数の文書を作る-source-の再利用}

Pokud složka nebo ZIP obsahuje více hlavních dokumentů, nahrajte vstup jednou pomocí `source upload` a jeho ID použijte opakovaně. Pro každou úlohu vyberte jinou výstupní složku (`--output`).

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Čištění cíle, vyloučení a duplicitní nahrávání
>
> - **Čištění předchozích výstupů.** Při opětovném použití cíle se odstraní pouze PDF, náhledy a SVG uvedené v předchozím `job.json`, které v novém výsledku chybějí. Ostatní soubory uživatele zůstanou zachovány.
> - **Ověření cíle.** Cesty se symbolickými odkazy se odmítají. Na systémech POSIX se kontroluje také vlastnictví a oprávnění k zápisu pro skupinu a ostatní. Ve Windows se kontrola bitů režimu POSIX vynechává.
> - **Vyloučení výstupního adresáře.** Pokud `--output` odkazuje na podsložku projektu, bude právě tato složka z dalšího ZIP vyloučena. Podobně pojmenované složky se zahrnou. Kořen projektu nesmí sloužit jako cíl.
> - **Duplicitní nahrávání.** Pokud server již má platný ZIP stejného vlastníka se stejným SHA-256, vrátí `uploadRequired: false` a přenos přeskočí. ID vstupu může v dalších úlohách použít jen vlastník.

## Uložené projekty a revize {#保存projectと改訂}

Pomocí CLI můžete spravovat a opětovně překládat projekty a revize na serveru. Projekty sdílejí web, API, MCP a další klíče stejného uživatele. Dočasné operace `render` a `source upload` nevyžadují uložení projektu.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** připraví složku nebo ZIP jako vstup a uloží do projektu neměnnou revizi. S `--svg` jsou počátečními výstupy revize PDF a SVG.
- **`render`** vytvoří úlohu z uložené revize. Nastavení výstupů přepisuje pouze `--svg`.
- **`list`, `get` a `jobs`** přijímají pro další stránku `--cursor`.
- **`delete`** skryje projekt ze seznamu. Existující úlohy se neodstraní okamžitě.

## Práce s úlohami {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Stažení a čekání.** Tyto příkazy používají klíč API pro obnovení krátkodobého tokenu. `jobs download` vyčká na konec úlohy, než nahradí uloženou sadu. Při selhání nebo přerušení čekání zůstane původní sada zachována. `delete` lze použít jen u dokončených úloh.
- **Stažení dalších náhledů PNG.** Na začátku se generuje jen první strana. Běžné stažení získá již vytvořené PNG. Použijte například `--preview-page 2 5`, chcete-li tyto strany vygenerovat, zkontrolovat jejich velikost a SHA-256 a uložit je. PDF se nepřekládá znovu a doba uchování se neprodlužuje.
- **Dřívější stažení PDF a zopakování SVG.** U úlohy s PDF a SVG použijte `--pdf-only` pro stažení PDF bez čekání na SVG. Selže-li jen SVG, PDF zůstane k dispozici a výsledek je částečný. `retry-svg` zopakuje pouze extrakci. Je povoleno 8 pokusů včetně prvního bez prodloužení doby uchování. Pokud se prostředí změnilo, vytvořte novou úlohu. Viz [Stažení hotového PDF a opakování SVG](/cs/docs/api/#pdfの先行公開とsvgの再試行).
- **Opakování při síťových potížích.** Při přechodné chybě se kontrola stavu zopakuje. Chyby ověření a oprávnění se vracejí okamžitě. Server může pokračovat po ukončení čekání CLI. Než vytvoříte další úlohu, zkontrolujte stejný `<jobId>`. Viz [Čekání a opakování v CLI](/cs/docs/reference/#cliの待機と再試行).

## Výstupní soubory {#成果物}

Dřívější stažení PDF, výběr stran PNG a opakování SVG popisuje [Získání PDF, PNG a SVG](/cs/docs/outputs/).

| Cesta | Obsah |
| --- | --- |
| `.render/result.pdf` | Úspěšně vytvořené PDF |
| `.render/compile.log` | Protokol překladu LaTeX |
| `.render/errors.json` | Strukturované podrobnosti o chybách |
| `.render/job.json` | Konečný stav úlohy |
| `.render/previews/page-N.png` | Náhledy až 100 stran |
| `.render/svg/manifest.json` | Přiřazení SVG k místu ve zdroji a souřadnicím v PDF |
| `.render/svg/objects/*.svg` | Samostatné SVG každého matematického výrazu nebo obrázku TikZ |

## Výstup JSON {#json出力}

Přidejte `--json` k libovolnému příkazu pro zápis jediného objektu JSON na standardní výstup bez zpráv o průběhu. Obsahuje stejný výsledek `client-core` jako běžné zobrazení a vynechává klíče API i krátkodobé tokeny.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Schémata úspěchu a chyb a návratové kódy popisuje [formát JSON rozhraní CLI](/cs/docs/reference/#cliのjson形式).
