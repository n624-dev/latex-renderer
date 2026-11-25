---
slug: projects
category: Projekty
title: Příprava souborů TeX a ZIP
description: Připravte vstup, zkontrolujte limity a vyzkoušejte minimální projekt s LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Struktura projektu {#構成}

- **Jednosouborový dokument.** Ve webové aplikaci nahrajte přímo `.tex` nebo v CLI spusťte `n624-latex main.tex`.
- **Dokument s obrázky, bibliografií nebo více zdrojovými soubory.** Vše zabalte do **jednoho ZIP** se zachováním relativních cest. V CLI můžete také uvést složku.
- **Vytvoření ZIP.** Ke kompresi vyberte obsah složky, například `main.tex` a `images/`. Přidáte-li i nadřazenou složku, bude při převodu nutné zadat cestu k hlavnímu souboru například jako `project/main.tex`.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Hlavní soubor a relativní cesty**
Výchozím hlavním dokumentem je `main.tex` v kořeni projektu. I pokud vyberete `.tex` v podsložce, například `docs/main.tex`, **pracovním adresářem překladu je vždy kořen projektu**. Potřebujete-li z `docs/main.tex` vložit `body.tex` ze stejné podsložky, napište `\input{docs/body.tex}`. Při zápisu `\input{body.tex}` bude překladač hledat `body.tex` v kořeni.

## Minimální příklad japonské sazby {#日本語の最小例}

Výchozí engine je **LuaLaTeX**. Pro vyzkoušení japonského dokumentu uložte následující ukázku do `main.tex` v UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Dostupné balíčky a písma vyhledejte v [prostředí vykreslování](/app/environment/). Seznam vzniká při nasazení z kontejneru serveru a používá jej také vyhledávání v Remote MCP. Pokud balíček chybí, pošlete správci příslušnou zprávu z `compile.log`.

## Uložené projekty a revize {#保存projectと改訂}

Dokumenty převedené ve webové aplikaci (`/app/`) se ukládají do projektů.

- **Automatické vytváření revizí.** Každá nová kombinace obsahu, hlavního dokumentu, enginu a výstupních formátů se uloží jako revize projektu. Předchozí revize zůstávají v historii.
- **Převod starší revize.** Klikněte na **Převést znovu** pro použití uloženého dokumentu a enginu. Pokud zde změníte výstupní formát, výsledek se přidá do historie převodů stejné revize.
- **Sdílení a odstranění.** Webová aplikace, CLI, HTTP API a MCP sdílejí projekty a revize uživatele. Odstranění projektu skryje jeho záznam. Existující vstupy a výstupy se čistí podle doby uchování. Pokud potřebujete okamžité úplné vymazání, obraťte se na správce. Vstupy odkazované aktivními revizemi se započítávají do kvóty uživatele. Viz [Sdílení a uchování](/cs/docs/reference/#保存プロジェクトの共有-保持).

### Úpravy v prohlížeči {#ブラウザーで編集する}

Otevřete uložený projekt a vyberte **Upravit TeX**. Změny se ukládají do konceptu. Když přestanete psát, začne překlad a po jeho úspěšném dokončení se aktualizuje PDF. Pokud se vytvoření náhledu nezdaří, uvidíte poslední dostupné PDF a verzi konceptu, které odpovídá.

Nový projekt se otevírá s prázdným `main.tex`. Dokud je hlavní dokument prázdný, můžete začít ze šablony. Pokud chcete pokračovat z uložené verze, vyberte **Upravit z této revize**. Existující koncept před nahrazením potvrďte.

Chcete-li překládat jen na vyžádání, vypněte **Automatická kompilace** a použijte **Kompilovat**. Vyberte **Výstupy uložené verze** a klikněte na **Uložit verzi**, čímž uložíte koncept i jeho nastavení. Pro získání SVG otevřete uloženou revizi a klikněte na **Převést znovu**.
Editor při práci zobrazuje stav překladu a náhled.

## Soubory vyloučené z odesílání {#送信から除外されるもの}

- **Automatické vyloučení.** CLI vynechává `.git`, `.render` a pomocné soubory LaTeX, například `.aux`. Symbolické odkazy odmítá.
- **Nepodporované soubory.** Nepotřebné složky, například `node_modules`, přesuňte mimo projekt. Pokud odesílaná složka obsahuje nepodporovanou příponu, CLI vypíše cestu a zastaví se. Chcete-li v projektu ponechat soubor jako `README.md`, ale neodesílat jej, přidejte do `.latexrenderignore` v kořeni řádek `README.md`. Server v ZIP kontroluje stejná pravidla pro přípony.
- **Podporované přípony** (bez rozlišení malých a velkých písmen)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  Soubory `.bst` obsahují bibliografické styly BibTeX a mohou být v podsložkách. Pokud vlastní styl používá neuvedenou příponu, před její změnou se poraďte se správcem.

## Limity {#制限}

- **Počet souborů.** Nejvýše 500.
- **Výchozí velikosti.** 20 MiB pro ZIP, 100 MiB celkem po rozbalení a 20 MiB na soubor.
- **Hlavní soubor.** Relativní cesta k `.tex` ve vstupu. Výchozí je `main.tex` v kořeni.
- **Zabezpečení.** Přístup TeXu k shellu (včetně `\write18`), spouštění externích příkazů a přístup k externí síti jsou vypnuté.
- **Prostředky.** Správce nastavuje časové limity, úložnou kvótu uživatele a dobu uchování výsledků.
