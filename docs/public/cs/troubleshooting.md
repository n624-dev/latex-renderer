---
slug: troubleshooting
category: Řešení potíží a zabezpečení
title: Řešení potíží
description: Najděte příčinu chyb přihlášení, instalace, převodu a stahování.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Kde začít {#確認する順序}

1. **Zkontrolujte [stav služby](/status/)**, zda není hlášen výpadek nebo údržba.
2. **Zkontrolujte existující úlohu.** Pokud převod již začal, otevřete tutéž úlohu v **Historie** nebo v CLI spusťte `n624-latex jobs get <jobId>`.
3. **Přečtěte si diagnostiku a protokol.** Na webu otevřete diagnostiku na stránce výsledku. V CLI zkontrolujte `.render/errors.json` a podrobný protokol `.render/compile.log`.

## Časté potíže {#代表的な問題}

### Instalace a přihlášení {#インストール-ログイン}

- **Nelze najít `n624-latex` nebo `latex-render`.**
  Otevřete nový terminál nebo okno PowerShellu. Pokud potíže trvají, zkontrolujte [PATH v Linuxu či macOS](/cs/docs/client/#linux-macos) nebo [pokyny k instalaci ve Windows](/cs/docs/windows/#インストール).
- **Nelze se přihlásit k webové aplikaci.**
  Použijte zaregistrovaný účet a metodu určenou správcem (heslo, OIDC nebo Cloudflare Access). Pokud uvázlo připojení z ChatGPT či Claude, viz [Kontrola připojení Remote MCP](/cs/docs/mcp/#chatgptなどの接続を確認する).
- **CLI vrací `401` nebo `403`.**
  Příkazem `n624-latex auth status` ověřte uložený klíč. Požádejte správce o ověření, že je aktivní a má oprávnění `render:create` a `render:read:own`. V případě potřeby [uložte klíč znovu](/cs/docs/cli/#認証). U vlastního serveru zkontrolujte také [adresu serveru (`LATEX_RENDER_BASE_URL`)](/cs/docs/cli/#接続先サーバー).

### Nahrávání a převod {#アップロード-変換}

- **V ZIP nebyl nalezen hlavní dokument.**
  Výchozím vstupem je `main.tex` v kořeni. Zkontrolujte, zda jste nezabalili nadřazenou složku, nebo zadejte relativní cestu k dokumentu. Viz [Příprava ZIP](/cs/docs/projects/#構成).
- **Soubor je odmítnut kvůli velikosti nebo příponě.**
  Odstraňte nepotřebné vygenerované a nepodporované soubory nebo nastavte `.latexrenderignore`. Zkontrolujte [podporované soubory a limity](/cs/docs/projects/#制限).
- **Převod zůstává ve frontě nebo se přerušilo spojení.**
  Server může stále pracovat. Než vytvoříte další úlohu, otevřete znovu stejnou stránku výsledku nebo zkontrolujte stejné ID úlohy.
- **Chybějí balíčky či písma nebo vypršel časový limit.**
  Dostupné názvy vyhledejte v [prostředí vykreslování](/app/environment/). Pokud došel čas, prohlédněte složitá makra, velké obrázky a kresby TikZ u místa, kde protokol končí.

### Stahování souborů {#成果物の取得}

- **PDF je hotové, ale chybí SVG.**
  Při stavu **Částečný úspěch** nejprve uložte PDF a klikněte na **Zkusit znovu jen SVG**. Viz [Opakování extrakce SVG](/cs/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **Náhled PNG se stále připravuje.**
  Chvíli počkejte nebo otevřete stejnou stránku znovu. Hotové PDF můžete stáhnout ihned.
- **Cíl je obsazený nebo se zobrazuje `OUTPUT_BUSY`.**
  Zavřete prohlížeč s otevřeným výstupním PDF nebo vyčkejte na dokončení procesu zapisujícího do stejné složky a opakujte stažení.
- **Výsledek vypršel nebo došlo místo.**
  Po vypršení platnosti převeďte znovu uloženou revizi nebo místní soubory. Pokud jste vyčerpali kvótu, smažte nepotřebné dokončené úlohy. Je-li plný disk serveru, obraťte se na správce.

## Žádost o pomoc {#問い合わせ}

- **Správce serveru.** Uveďte čas potíží, operaci, která se zastavila, kód chyby a případně ID úlohy (`job_...`).
- **Veřejné hlášení na GitHubu.** Uveďte minimální postup pro zopakování chyby bez tajných údajů či osobních dokumentů. **Nikdy nezveřejňujte klíče API, soubory cookie, původní dokument, PDF ani úplné neočištěné protokoly.**
