---
slug: projects
category: Projecten
title: TeX- en ZIP-bestanden voorbereiden
description: Bereid de invoer voor, controleer de limieten en probeer een minimaal project met LuaLaTeX uit.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Projectstructuur {#構成}

- **Document van één bestand.** Upload het `.tex` rechtstreeks in de webapp of voer `n624-latex main.tex` uit in de CLI.
- **Document met afbeeldingen, een bibliografie of meerdere bronbestanden.** Verpak alles in **één ZIP-archief** met behoud van relatieve paden. In de CLI kun je ook een map opgeven.
- **Het ZIP-archief maken.** Selecteer de inhoud van de map, bijvoorbeeld `main.tex` en `images/`, bij het comprimeren. Neem je de bovenliggende map op, dan moet je bij het converteren een invoerpad zoals `project/main.tex` opgeven.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Hoofddocument en relatieve paden**
Het standaardhoofddocument is `main.tex` in de hoofdmap van het project. Ook als je een `.tex` in een submap kiest, bijvoorbeeld `docs/main.tex`, **blijft de hoofdmap van het project de werkmap van de compilatie**. Om vanuit `docs/main.tex` het bestand `body.tex` uit dezelfde submap op te nemen, schrijf je `\input{docs/body.tex}`. Gebruik je `\input{body.tex}`, dan zoekt de compiler `body.tex` in de hoofdmap.

## Minimaal voorbeeld met Japanse tekst {#日本語の最小例}

De standaardengine is **LuaLaTeX**. Sla de volgende tekst op als `main.tex` in UTF-8 om een Japans document te testen.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Zoek beschikbare pakketten en lettertypen in de [renderomgeving](/app/environment/). De lijst wordt tijdens de implementatie uit de servercontainer samengesteld en wordt ook door Remote MCP gebruikt om te zoeken. Ontbreekt een pakket, stuur de beheerder dan de bijbehorende melding uit `compile.log`.

## Opgeslagen projecten en revisies {#保存projectと改訂}

Documenten die in de webapp (`/app/`) worden geconverteerd, worden in projecten opgeslagen.

- **Automatische revisies.** Elke nieuwe combinatie van inhoud, hoofddocument, engine en uitvoerformaten wordt als projectrevisie opgeslagen. Eerdere revisies blijven in de geschiedenis staan.
- **Een eerdere revisie converteren.** Klik op **Opnieuw converteren** om het opgeslagen document met de opgeslagen engine te gebruiken. Kies je hier een ander uitvoerformaat, dan wordt het resultaat aan de conversiegeschiedenis van dezelfde revisie toegevoegd.
- **Delen en verwijderen.** De webapp, CLI, HTTP-API en MCP delen de projecten en revisies van de gebruiker. Wanneer je een project verwijdert, wordt de vermelding verborgen. Bestaande invoer en uitvoer worden volgens de bewaartermijn opgeruimd. Vraag de beheerder om hulp als alles onmiddellijk volledig moet worden gewist. Invoer waarnaar actieve revisies verwijzen, telt mee voor je opslagquotum. Zie [Delen en bewaren](/nl/docs/reference/#保存プロジェクトの共有-保持).

### Bewerken in de browser {#ブラウザーで編集する}

Open een opgeslagen project en kies **TeX bewerken**. Wijzigingen worden in het concept opgeslagen. Wanneer je stopt met typen, wordt het document gecompileerd. Bij succes wordt de PDF bijgewerkt. Mislukt het voorbeeld, dan zie je de laatste beschikbare PDF en de versie van het concept die daarbij hoort.

Nieuwe projecten openen met een leeg `main.tex`. Zolang het hoofddocument leeg is, kun je met een sjabloon beginnen. Kies **Bewerken vanaf deze revisie** om verder te gaan vanaf een opgeslagen versie. Bestaat er al een concept, bevestig dan de vervanging.

Schakel **Automatisch compileren** uit en klik op **Compileren** als je alleen op verzoek wilt compileren. Kies **Uitvoer van de opgeslagen versie** en klik op **Versie opslaan** om het concept en de bijbehorende instellingen te bewaren. Open voor SVG de opgeslagen revisie en klik op **Opnieuw converteren**.
Tijdens het bewerken toont de editor de compilatiestatus en het voorbeeld.

## Bestanden uitsluiten van verzending {#送信から除外されるもの}

- **Automatisch uitgesloten.** De CLI slaat `.git`, `.render` en tijdelijke LaTeX-bestanden zoals `.aux` over. Symbolische koppelingen worden geweigerd.
- **Niet-ondersteunde bestanden.** Verplaats onnodige mappen zoals `node_modules` naar buiten het project. Verstuur je een map met een niet-ondersteunde extensie, dan toont de CLI het pad en stopt. Wil je een bestand zoals `README.md` in je project houden maar niet meesturen, voeg dan in `.latexrenderignore` in de hoofdmap een regel met `README.md` toe. De server controleert in de ZIP dezelfde extensieregels.
- **Ondersteunde extensies** (niet hoofdlettergevoelig)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst`-bestanden zijn bibliografiestijlen voor BibTeX en mogen in submappen staan. Heeft een eigen stijl een niet-vermelde extensie, raadpleeg dan de beheerder voordat je deze wijzigt.

## Limieten {#制限}

- **Aantal bestanden.** Maximaal 500.
- **Standaardgrootten.** 20 MiB voor de ZIP, 100 MiB na uitpakken en 20 MiB per bestand.
- **Invoerbestand.** Een relatief pad naar een `.tex` in de invoer. De standaardwaarde is `main.tex` in de hoofdmap.
- **Beveiliging.** Shelltoegang vanuit TeX (inclusief `\write18`), externe opdrachten en externe netwerkverbindingen zijn uitgeschakeld.
- **Systeembronnen.** De beheerder bepaalt de tijdslimieten, opslag per gebruiker en bewaartermijn voor resultaten.
