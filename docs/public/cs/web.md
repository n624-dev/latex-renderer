---
slug: web
category: Webová aplikace
title: Převod dokumentů v prohlížeči
description: Vytvořte PDF ze souboru TeX nebo ZIP a prohlédněte si výsledky dřívějších převodů.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Vytvoření PDF v prohlížeči {#ブラウザでpdfへ変換}

1. Otevřete [webovou aplikaci](/app/) a přihlaste se způsobem určeným správcem.
2. Vyberte soubory nebo je přetáhněte na stránku.
   - Pokud je dokument v jediném souboru, vyberte přímo `.tex`.
   - Pokud obsahuje obrázky, bibliografii nebo více souborů `.tex` (například propojených přes `\input`), zabalte dokument i závislosti do `.zip`. Viz [Podporované soubory a struktura ZIP](/cs/docs/projects/).
   - Vyberete-li několik souborů `.tex` jednotlivě, každý se převede jako samostatný dokument.
3. Obsahuje-li ZIP několik souborů `.tex` a zobrazí se výběr, zvolte jako vstupní soubor hlavní dokument.
4. Klikněte na **Převést do PDF**. Po dokončení se na stránce výsledků zobrazí PDF a náhledy stran.

Chcete-li použít jiný engine než LuaLaTeX, vyberte jej v části **Cíl a možnosti výstupu → Sázecí nástroj**. V [prostředí vykreslování](/app/environment/) najdete dostupné enginy i informaci, zda byly ověřeny výstupy PDF, SVG a souřadnice SVG. pLaTeX a upLaTeX vyžadují na serveru japonskou jazykovou kolekci.

## Úprava dokumentu v prohlížeči {#ブラウザーで文書を編集する}

1. V [Projektech](/app/projects/) otevřete dokument a vyberte **Upravit TeX**. Nový projekt začíná prázdným souborem `main.tex`. Můžete také použít šablonu.
2. Změny se automaticky ukládají do konceptu. Obrázky a bibliografické soubory přidáte tlačítkem **Připojit soubor**.
3. Zapněte **Automatická kompilace**, chcete-li aktualizovat PDF po přerušení psaní. Pro okamžitou aktualizaci klikněte na **Kompilovat**.
4. Kliknutím na **Uložit verzi** uložíte vstup do historie. Pomocí **Upravit z této revize** můžete pokračovat ze dříve uložené verze. Pokud už koncept existuje, před přepsáním se zobrazí žádost o potvrzení.

Chcete-li přidat nebo přiložit soubory, otevřete **Spravovat soubory**. V nabídce **Nastavení** můžete změnit sázecí systém, automatickou kompilaci a jazyk rozhraní nebo uložit verzi. Tlačítko **⋯** v panelu PDF otevře možnosti přiblížení a zobrazení PNG.

Při chybě překladu zůstane zachován koncept a poslední úspěšně vytvořené PDF. Kliknutím na chybu s názvem souboru a číslem řádku přejdete na příslušný řádek. Na telefonu přepínejte mezi **Kód**, **PDF** a **Chyby**. Načítá-li se PDF pomalu, použijte **PNG (úsporný náhled)**.

Dočasné náhledy se zobrazují pouze v editoru. Chcete-li PDF uchovat, stáhněte je pomocí **Uložit PDF**.

Editor používá UTF-8. Soubor v Shift_JIS nebo EUC-JP otevřete v textovém editoru s původním kódováním, zkontrolujte znaky a uložte kopii v UTF-8. Připojte ji pod stejným názvem a potvrďte nahrazení.

## Získání vzorců a obrázků TikZ jako SVG {#数式や-tikz-を-svg-で取得する}

1. Před převodem otevřete **Cíl a možnosti výstupu** a zaškrtněte **Exportovat také vzorce a TikZ jako SVG**.
2. PDF můžete stáhnout ihned po jeho dokončení.
3. Stav **Částečný úspěch** znamená, že PDF je hotové, ale extrakce SVG selhala. Nejprve uložte PDF a případně klikněte na **Zkusit znovu jen SVG**.

Na začátku vznikne pouze náhled PNG první strany. Další se vytvoří při otevření. Během přípravy náhledů můžete stáhnout hotové PDF. Viz [Získání PDF, PNG a SVG](/cs/docs/outputs/).

## Otevření dřívějších dokumentů a výsledků {#以前の文書や結果を開く}

- **[Historie](/app/history/)** zobrazuje průběh a výsledné soubory. Na stejnou stránku výsledků se můžete vrátit i po zavření prohlížeče.
- **[Projekty](/app/projects/)** obsahují uložené dokumenty a revize. Otevřete revizi a klikněte na **Převést znovu**, chcete-li použít dřívější vstup.
- V části **[Prostředí vykreslování](/app/environment/)** můžete hledat balíčky LaTeX a písma dostupná na serveru.

## Veřejné a soukromé informace {#公開される情報}

- **Stránky s přihlášením.** Ve webové aplikaci (`/app/`) se přihlaste, abyste v historii a výsledcích viděli své dokumenty a převody. Do správy (`/admin/`) mají přístup pouze správci a vlastníci. Viz [Zabezpečení účtů a dokumentů](/cs/docs/security/).
- **Veřejné stránky.** Pokud se nemůžete přihlásit, zkontrolujte [stav služby](/status/) nebo [řešení potíží](/cs/docs/troubleshooting/). CLI najdete v části [Ke stažení](/downloads/) a specifikace integrace v části [Veřejné API](/cs/docs/api/).
