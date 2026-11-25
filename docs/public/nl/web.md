---
slug: web
category: Webapp
title: Documenten omzetten in de browser
description: Maak een PDF van een TeX-bestand of ZIP-archief en bekijk de resultaten van eerdere conversies.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Een PDF maken in de browser {#ブラウザでpdfへ変換}

1. Open de [webapp](/app/) en meld je aan op de manier die de beheerder heeft aangegeven.
2. Selecteer de bestanden of sleep ze naar de pagina.
   - Bestaat het document uit één bestand, selecteer dan rechtstreeks het `.tex`.
   - Bevat het afbeeldingen, een bibliografie of meerdere `.tex`-bestanden (bijvoorbeeld gekoppeld via `\input`), verpak het document dan samen met de benodigde bestanden in een `.zip`. Zie [Ondersteunde bestanden en ZIP-indeling](/nl/docs/projects/).
   - Selecteer je meerdere losse `.tex`-bestanden, dan wordt elk bestand als afzonderlijk document geconverteerd.
3. Als het ZIP-archief meerdere `.tex`-bestanden bevat en een keuzelijst verschijnt, kies dan het hoofddocument als invoerbestand.
4. Klik op **Omzetten naar PDF**. Na afloop verschijnen de PDF en de paginavoorbeelden op de resultatenpagina.

Wil je een andere engine dan LuaLaTeX gebruiken, kies die dan onder **Bestemming en uitvoeropties → Engine**. In de [renderomgeving](/app/environment/) zie je welke engines beschikbaar zijn en of de PDF, SVG en SVG-posities zijn gecontroleerd. Voor pLaTeX en upLaTeX moet de Japanse taalcollectie op de server aanwezig zijn.

## Een document bewerken in de browser {#ブラウザーで文書を編集する}

1. Open een document in [Projecten](/app/projects/) en kies **TeX bewerken**. Een nieuw project begint met een leeg `main.tex`. Je kunt ook een sjabloon kiezen.
2. Wijzigingen worden automatisch in het concept opgeslagen. Voeg afbeeldingen of bibliografiebestanden toe met **Bestand bijvoegen**.
3. Zet **Automatisch compileren** aan om de PDF bij te werken zodra je stopt met typen. Klik op **Compileren** om de PDF direct bij te werken.
4. Klik op **Versie opslaan** om de invoer in de geschiedenis te bewaren. Met **Bewerken vanaf deze revisie** werk je verder vanaf een opgeslagen versie. Bestaat er al een concept, dan wordt om bevestiging gevraagd voordat het wordt vervangen.

Open **Bestanden beheren** om bestanden toe te voegen of bij te voegen. In **Instellingen** kies je de engine, automatisch compileren en de weergavetaal, of sla je een revisie op. De knop **⋯** in het PDF-paneel opent de zoom- en PNG-opties.

Als het compileren mislukt, blijven het concept en de laatste geslaagde PDF bewaard. Selecteer een foutmelding met bestandsnaam en regelnummer om naar die regel te springen. Op mobiel wissel je tussen **Code**, **PDF** en **Fouten**. Laadt de PDF traag, gebruik dan **PNG (lichte voorvertoning)**.

Tijdelijke voorbeelden verschijnen alleen in de editor. Wil je een PDF bewaren, download deze dan met **PDF opslaan**.

De editor gebruikt UTF-8. Open bestanden in Shift_JIS of EUC-JP in een teksteditor met de oorspronkelijke codering. Controleer de tekens en sla een kopie op in UTF-8. Voeg de kopie onder dezelfde naam toe en bevestig de vervanging.

## Formules en TikZ-tekeningen als SVG verkrijgen {#数式や-tikz-を-svg-で取得する}

1. Open vóór de conversie **Bestemming en uitvoeropties** en vink **Formules en TikZ ook als SVG exporteren** aan.
2. Je kunt de PDF downloaden zodra deze klaar is.
3. **Gedeeltelijk geslaagd** betekent dat de PDF klaar is, maar de SVG-extractie is mislukt. Sla eerst de PDF op en klik zo nodig op **Alleen SVG opnieuw proberen**.

Aanvankelijk wordt alleen het PNG-voorbeeld van de eerste pagina gemaakt. Andere pagina's worden gemaakt wanneer je ze opent. Je kunt de voltooide PDF downloaden terwijl de voorbeelden worden voorbereid. Zie [PDF, PNG en SVG downloaden](/nl/docs/outputs/).

## Eerdere documenten en resultaten openen {#以前の文書や結果を開く}

- **[Geschiedenis](/app/history/)** toont de voortgang en de uitvoerbestanden. Ook na het sluiten van de browser kun je naar dezelfde resultatenpagina terugkeren.
- **[Projecten](/app/projects/)** toont de opgeslagen documenten en revisies. Open een revisie en klik op **Opnieuw converteren** om eerdere invoer opnieuw te gebruiken.
- In de **[renderomgeving](/app/environment/)** kun je zoeken naar LaTeX-pakketten en lettertypen op de server.

## Openbare en afgeschermde informatie {#公開される情報}

- **Pagina's waarvoor je inlogt.** Meld je in de webapp (`/app/`) aan om je documenten en conversies in de geschiedenis of op de resultatenpagina te bekijken. Alleen beheerders en eigenaren hebben toegang tot het beheergedeelte (`/admin/`). Zie [Beveiliging van accounts en documenten](/nl/docs/security/).
- **Openbare pagina's.** Kun je niet inloggen, bekijk dan de [servicestatus](/status/) of [Problemen oplossen](/nl/docs/troubleshooting/). Je vindt de CLI onder [Downloads](/downloads/) en de integratiespecificaties bij de [openbare API](/nl/docs/api/).
