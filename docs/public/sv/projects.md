---
slug: projects
category: Projekt
title: Förbered TeX- och ZIP-filer
description: Förbered underlaget, kontrollera gränserna och prova ett minimalt LuaLaTeX-projekt.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Projektets struktur {#構成}

- **Dokument med en enda fil.** Ladda upp `.tex` direkt i webbappen eller kör `n624-latex main.tex` i CLI.
- **Dokument med bilder, bibliografi eller flera källfiler.** Packa allt i **ett ZIP-arkiv** som bevarar relativa sökvägar. I CLI kan du även ange en mapp.
- **Skapa arkivet.** Markera mappens innehåll, till exempel `main.tex` och `images/`, när du komprimerar. Om du även tar med den överordnade mappen måste du ange en startsökväg som `project/main.tex` vid konverteringen.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Startfil och relativa sökvägar**
Som standard är huvuddokumentet `main.tex` i projektroten. Även om du väljer en `.tex` i en undermapp, exempelvis `docs/main.tex`, **är projektroten alltid kompileringens arbetskatalog**. För att från `docs/main.tex` inkludera filen `body.tex` i samma undermapp skriver du `\input{docs/body.tex}`. Skriver du `\input{body.tex}` söker kompilatorn efter `body.tex` i roten.

## Minimalt exempel med japansk text {#日本語の最小例}

Standardmotorn är **LuaLaTeX**. För att prova ett japanskt dokument, spara följande som `main.tex` med UTF-8-kodning.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Sök efter paket och typsnitt i [renderingsmiljön](/app/environment/). Listan skapas utifrån serverns container vid driftsättningen och används även av sökfunktionen i Remote MCP. Saknas ett paket, skicka motsvarande meddelande från `compile.log` till administratören.

## Sparade projekt och revisioner {#保存projectと改訂}

Dokument som konverteras i webbappen (`/app/`) sparas i projekt.

- **Automatiska revisioner.** Varje ny kombination av innehåll, huvuddokument, motor och utdataformat sparas som en projektrevision. Äldre revisioner finns kvar i historiken.
- **Konvertera en tidigare revision.** Klicka på **Konvertera igen** för att använda det sparade dokumentet och dess motor. Om du väljer andra utdataformat här läggs resultatet till i samma revisions konverteringshistorik.
- **Delning och borttagning.** Webbappen, CLI, HTTP-API:t och MCP delar användarens projekt och revisioner. När du tar bort ett projekt döljs posten. Befintliga in- och utdata rensas enligt lagringstiden. Kontakta administratören om du behöver fullständig omedelbar radering. Underlag som aktiva revisioner hänvisar till räknas mot användarens kvot. Se [Delning och lagring](/sv/docs/reference/#保存プロジェクトの共有-保持).

### Redigera i webbläsaren {#ブラウザーで編集する}

Öppna ett sparat projekt och välj **Redigera TeX**. Ändringarna sparas i utkastet. Kompileringen startar när du gör en paus i skrivandet och uppdaterar PDF-filen om den lyckas. Misslyckas förhandsvisningen kan du se den senaste tillgängliga PDF-filen och vilken utkastversion den motsvarar.

Nya projekt öppnas med en tom `main.tex`. Så länge huvuddokumentet är tomt kan du börja från en mall. För att fortsätta från en sparad version, välj **Redigera från denna revision**. Bekräfta innan ett befintligt utkast ersätts.

Om du bara vill kompilera vid behov, stäng av **Kompilera automatiskt** och klicka på **Kompilera**. Välj **Utdata för den sparade versionen** och klicka på **Spara en version** för att spara utkastet med inställningarna. För att få SVG öppnar du den sparade revisionen och väljer **Konvertera igen**.
Redigeraren visar kompileringens status och förhandsvisningen medan du arbetar.

## Filer som inte skickas {#送信から除外されるもの}

- **Automatisk uteslutning.** CLI hoppar över `.git`, `.render` och LaTeX-hjälpfiler som `.aux`. Symboliska länkar avvisas.
- **Filer som inte stöds.** Flytta onödiga mappar som `node_modules` ut ur projektet. Om en mapp innehåller en fil med otillåtet tillägg skriver CLI ut sökvägen och avbryter. För att behålla ett projektinnehåll som `README.md` utan att skicka det, lägg till en rad med sökvägsmönstret i `.latexrenderignore` i projektroten: `README.md`. Servern kontrollerar samma filändelseregler i ZIP-arkivet.
- **Tillåtna filändelser** (oberoende av skiftläge)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst`-filer innehåller bibliografistilar för BibTeX och får ligga i undermappar. Om en egen stil har en filändelse som saknas i listan, prata med administratören innan du byter den.

## Gränser {#制限}

- **Antal filer.** Högst 500.
- **Standardstorlekar.** 20 MiB för ZIP-arkivet, 100 MiB totalt efter uppackning och 20 MiB per fil.
- **Startfil.** Relativ sökväg till en `.tex` i underlaget. Som standard används `main.tex` i roten.
- **Säkerhet.** Skalåtkomst från TeX (inklusive `\write18`), externa kommandon och externa nätverksanslutningar är avstängda.
- **Resurser.** Administratören bestämmer tidsgränser, lagringskvot per användare och hur länge resultaten sparas.
