---
slug: outputs
category: Web a CLI
title: Získání PDF, PNG a SVG
description: Uložte PDF, stáhněte obrázky jednotlivých stran a exportujte vzorce a obrázky TikZ jako SVG nebo jejich extrakci zopakujte.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Otevření a uložení PDF {#pdf-を開く-保存する}

- **Webová aplikace.** V [Historii](/app/history/) vyberte dokument a v seznamu souborů na stránce výsledků otevřete `result.pdf`. Pokud jste požádali o PDF i SVG, PDF můžete stáhnout hned, jak bude připravené.
- **CLI.** Výsledek stáhněte pomocí zobrazeného `<jobId>`. Přidáním `--pdf-only` stáhnete PDF bez čekání na SVG. Chcete-li ponechat soubory jiného dokumentu, zvolte jinou složku `--output`.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Získání obrázků stran {#ページ画像を取得する}

Potřebujete-li obrázky celých stran, použijte náhledy PNG. Na začátku se vytvoří pouze první strana, další se připraví na vyžádání. Pokud se náhled právě připravuje, chvíli počkejte nebo stránku znovu otevřete. Mezitím můžete stáhnout hotové PDF.

- **Webová aplikace.** Na stránce výsledků vyberte náhled požadované strany.
- **CLI.** Tento příkaz stáhne PNG stran 2 a 5. Soubory se ukládají pod názvy jako `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Uložení vzorců a obrázků TikZ jako SVG {#数式と-tikz-を-svg-で保存する}

Vnější matematické výrazy a obrázky TikZ nejvyšší úrovně lze extrahovat jako samostatné vektorové obrázky.

- **Webová aplikace.** Před převodem otevřete **Cíl a možnosti výstupu** a vyberte **Exportovat také vzorce a TikZ jako SVG**. Po dokončení extrakce stáhněte SVG ze stránky výsledků.
- **CLI.** Převádějte s volbou `--svg`. Soubory SVG se uloží do `.render/svg/objects/`. Příslušné řádky původního `.tex` a souřadnice v PDF najdete v `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Když je PDF hotové, ale extrakce SVG selže {#pdf-はあるが-svg-が失敗した場合}

**Částečný úspěch** znamená, že PDF je hotové a selhala pouze extrakce SVG. Uložte PDF a zkuste extrakci znovu bez opětovného překladu.

- **Webová aplikace.** Na stránce výsledků klikněte na **Zkusit znovu jen SVG**.
- **CLI.** Spusťte následující příkaz.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Podmínky a počet pokusů**
- Je povoleno **nejvýše 8 pokusů** včetně prvního, pokud jsou původní vstup a hotové PDF stále dostupné a prostředí TeX na serveru se nezměnilo. Další pokusy neprodlužují dobu uchování souborů.
- Pokud potíže trvají, zkontrolujte diagnostiku na stránce výsledků nebo v `.render/svg/errors.json`.
- Pokud se objeví `SVG_RUNTIME_CHANGED` nebo u starší úlohy není tlačítko pro opakování, [vytvořte nový převod z původního dokumentu nebo uložené revize](/cs/docs/web/#以前の文書や結果を開く).

Viz také [Stažení a opakování prostřednictvím HTTP API](/cs/docs/api/#pdfの先行公開とsvgの再試行) a [specifikace zpracování výstupů](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
