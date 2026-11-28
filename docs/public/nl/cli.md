---
slug: cli
category: CLI
title: Converteren en resultaten downloaden met de CLI
description: Compileer TeX vanuit de terminal en download PDF's, logboeken en voorbeelden.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Voer in de map met `main.tex` de opdracht `n624-latex main.tex` uit om de PDF in diezelfde map op te slaan. [Installeer bij het eerste gebruik de CLI](/nl/docs/client/) en stel de verbinding in.

## Authenticatie {#認証}

Open het instellingenscherm in een browser om de API-sleutel op te slaan.

```sh
n624-latex setup --gui
```

Kun je geen browser openen, bijvoorbeeld via SSH, voer de sleutel dan via **standaardinvoer** in zodat deze niet in de opdrachtargumenten staat. Voer in Bash of Zsh de eerste regel uit, plak de sleutel, druk op Enter en voer daarna de overige regels uit.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Op Windows kun je ook het [afgeschermde invoerveld van het installatieprogramma](/nl/docs/windows/#インストール) gebruiken.

Met de eerste opdracht controleer je of er een sleutel is opgeslagen. Met de tweede verwijder je deze.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` toont de gebruikte serveroorsprong en de bron van de inloggegevens: de naam van een opgeslagen profiel, de omgevingsvariabele `LATEX_RENDER_API_KEY` of geen bron. Met `--json` krijg je de velden `origin` en `credentialSource`.

- Als de omgevingsvariabele `LATEX_RENDER_API_KEY` is ingesteld, heeft deze voorrang op de lokale sleutel.
- `logout` verwijdert alleen de lokaal opgeslagen sleutel. Verwijder zo nodig apart de omgevingsvariabele of trek de sleutel in op de server.

### De server kiezen {#接続先サーバー}

De CLI maakt standaard verbinding met de gehoste dienst (`https://latex-render.n624.jp`). Voor een eigen server stel je de HTTPS-URL in binnen de terminalsessie waarin je de opdrachten gaat uitvoeren.

- Laat de achtervoegsels `/app/` en `/api/v1/` weg uit de URL.
- Gebruik een API-sleutel die door die server is uitgegeven.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Instellingen en diagnostiek {#セットアップと診断}

Open met `n624-latex setup` de instellingen voor verbindingen en integraties. Lukt verbinden niet, controleer dan eerst de status met de volgende opdrachten. Wordt `n624-latex` niet gevonden, zie dan [Installatie en PATH](/nl/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` controleert de installatie en inloggegevens zonder ze te wijzigen en toont de waarde van de API-sleutel niet. Bij problemen is de afsluitcode `2`.

| Installatie | Bijwerken en herstellen |
| --- | --- |
| APT | [Werk bij met APT](/nl/docs/client/#apt-版の更新) of [installeer](/nl/docs/client/#状態確認と修復) beschadigde pakketten opnieuw. [Registreer Local MCP handmatig](/nl/docs/mcp/#local-mcpの登録). |
| Homebrew | [Werk bij met Homebrew](/nl/docs/client/#homebrew-版の更新) of [installeer](/nl/docs/client/#状態確認と修復) beschadigde pakketten opnieuw. Stel AI-integraties in met `n624-latex setup`. |
| Downloadbaar installatieprogramma | [Werk bij in de instellingen](/nl/docs/client/#配布インストーラー版の更新). Herstel beheerde integraties en starters met `n624-latex setup repair`. |

Volg voor verwijdering de [instructies voor je installatiemethode](/nl/docs/client/#アンインストール). Het instellingenscherm werkt lokaal en sluit wanneer de CLI wordt afgesloten.

## Renderen {#レンダリング}

### Een TeX-bestand rechtstreeks converteren {#tex-ファイルを直接変換する}

Geef het `.tex`-bestand in de projectmap op om de PDF te genereren. Je kunt via relatieve paden verwijzen naar afbeeldingen, bibliografieën en lokale `.sty`-bestanden.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Laat je `-o` weg, dan wordt in de map waarin je de opdracht uitvoerde een PDF met dezelfde basisnaam opgeslagen, bijvoorbeeld `main.pdf`.
- Als LaTeX een fout meldt, worden voor zover beschikbaar de bestandsnaam, regel en het taak-ID getoond. Mislukt de compilatie of download, dan blijft de laatste goed opgeslagen PDF behouden.

#### De LaTeX-engine kiezen {#latex-のエンジンを選ぶ}

Zet de naam van de engine vóór het bestand om XeLaTeX te gebruiken.

```sh
n624-latex xelatex main.tex
```

Geef je geen engine op, dan zoekt de CLI bovenaan het document naar `% !TeX program = xelatex` of
`% !TEX TS-program = xelatex`. Ontbreekt zo'n instructie, dan leest de CLI
`.n624-latex.json` in de hoofdmap van het project. Je kunt dit bestand
delen via Git om op andere computers dezelfde engine te gebruiken.

```json
{"engine":"xelatex"}
```

Zonder instelling wordt LuaLaTeX gebruikt. Voor pLaTeX en upLaTeX moet
de Japanse taalcollectie aanwezig zijn in de uitvoeringsomgeving op de server.

| Engine | Wat controleer je bij het overzetten van een document? |
| --- | --- |
| LuaLaTeX | Controleer de instellingen van documenten die `fontspec` of LuaTeX-ja gebruiken. |
| pdfLaTeX | Ondersteunt `fontspec` niet. Gebruik lettertype-instellingen voor pdfLaTeX. |
| XeLaTeX | Ondersteunt `fontspec`. Controleer op pakketten die alleen voor LuaTeX werken. |
| pLaTeX / upLaTeX | Gebruik een Japanse documentklasse voor de gekozen engine. Geef bij `jsarticle` in upLaTeX de klasseoptie `uplatex` op. |

Bibliografieverwerking hangt af van de pakketten en instellingen van het document. Voeg de `.bib`-bestanden en eigen `.bst`-bestanden toe. BibTeX-documenten gebruiken in pLaTeX en upLaTeX respectievelijk pBibTeX en upBibTeX. Zie de [renderomgeving](/app/environment/) voor de verificatie van PDF, SVG en SVG-posities.

### Een ZIP converteren of meerdere uitvoerbestanden opvragen {#zip-複数の出力を指定する}

Gebruik het subcommando `render` om een ZIP te converteren of de hele uitvoerset met onder meer logboeken, voorbeelden en SVG's te downloaden.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Voorbeelden**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Het standaardpad is de huidige map en de standaardwaarde van `--entrypoint` is `main.tex`. De CLI bereidt invoer van maximaal 500 bestanden voor en wacht op voltooiing. Je kunt een relatief pad naar een `.tex` als invoerbestand opgeven. De server controleert of het pad veilig is en het bestand bestaat.
- Met `--svg` worden ook de buitenste wiskundige uitdrukkingen en TikZ-tekeningen op het hoogste niveau als afzonderlijke SVG's geëxtraheerd.

### Invoer hergebruiken voor meerdere documenten {#同じ入力から複数の文書を作る-source-の再利用}

Bevat een map of ZIP meerdere hoofddocumenten, upload de invoer dan één keer met `source upload` en gebruik het ID opnieuw. Gebruik voor elke taak een andere uitvoermap (`--output`).

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Oude uitvoer opruimen, mappen uitsluiten en dubbele uploads
>
> - **Oude uitvoer opruimen.** Bij hergebruik van een bestemming worden alleen PDF's, voorbeelden en SVG's verwijderd die wel in de vorige `job.json` maar niet in het nieuwe resultaat staan. Andere bestanden van de gebruiker blijven behouden.
> - **Bestemming controleren.** Paden met symbolische koppelingen worden geweigerd. Op POSIX worden ook eigendom en schrijfrechten voor de groep en anderen gecontroleerd. Windows slaat de controle op POSIX-modusbits over.
> - **Uitvoermap uitsluiten.** Wijst `--output` naar een submap van het project, dan wordt uitsluitend die map uitgesloten van de volgende ZIP. Mappen met vergelijkbare namen blijven inbegrepen. De projecthoofdmap kan geen bestemming zijn.
> - **Dubbele uploads.** Heeft de server een geldige ZIP van dezelfde eigenaar met dezelfde SHA-256, dan geeft hij `uploadRequired: false` terug en slaat de overdracht over. Alleen deze eigenaar kan het invoer-ID voor latere taken gebruiken.

## Opgeslagen projecten en revisies {#保存projectと改訂}

Met de CLI beheer en hercompileer je projecten en revisies op de server. De webapp, API, MCP en andere sleutels van dezelfde gebruiker delen deze projecten. Voor tijdelijke bewerkingen met `render` en `source upload` hoef je geen project op te slaan.

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

- **`save`** bereidt de map of ZIP als invoer voor en slaat een onveranderlijke revisie in het project op. Met `--svg` worden PDF en SVG de oorspronkelijke uitvoerformaten van de revisie.
- **`render`** maakt een taak vanuit een opgeslagen revisie. Alleen `--svg` overschrijft de uitvoerinstellingen.
- **`list`, `get` en `jobs`** accepteren `--cursor` om de volgende pagina op te halen.
- **`delete`** verbergt het project in de lijst. Bestaande taken worden niet onmiddellijk verwijderd.

## Taken beheren {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Downloaden en wachten.** Deze opdrachten gebruiken de API-sleutel om een kortlevend token te vernieuwen. `jobs download` wacht tot de taak klaar is voordat de opgeslagen set wordt vervangen. Bij een fout of onderbreking tijdens het wachten blijft de vorige set behouden. `delete` geldt alleen voor voltooide taken.
- **Meer PNG-voorbeelden downloaden.** In eerste instantie wordt alleen de eerste pagina gemaakt. Een normale download haalt de bestaande PNG's op. Gebruik bijvoorbeeld `--preview-page 2 5` om die pagina's te genereren, hun grootte en SHA-256 te controleren en ze op te slaan. De PDF wordt niet opnieuw gecompileerd en de bewaartermijn blijft gelijk.
- **PDF eerder downloaden en SVG opnieuw proberen.** Voor een taak met PDF en SVG gebruik je `--pdf-only` om de PDF te downloaden zonder op SVG te wachten. Mislukt alleen SVG, dan blijft de PDF behouden en is het resultaat gedeeltelijk geslaagd. `retry-svg` herhaalt alleen de extractie. Er zijn maximaal 8 pogingen inclusief de eerste, zonder verlenging van de bewaartermijn. Maak een nieuwe taak als de uitvoeringsomgeving veranderd is. Zie [De definitieve PDF downloaden en SVG opnieuw proberen](/nl/docs/api/#pdfの先行公開とsvgの再試行).
- **Opnieuw proberen bij netwerkproblemen.** Tijdelijke fouten bij het opvragen van de status leiden tot een nieuwe poging. Authenticatie- en rechtenfouten worden direct teruggegeven. De server kan doorwerken nadat de CLI is gestopt met wachten. Controleer hetzelfde `<jobId>` voordat je een nieuwe taak maakt. Zie [Wachttijden en nieuwe pogingen in de CLI](/nl/docs/reference/#cliの待機と再試行).

## Uitvoerbestanden {#成果物}

Zie [PDF, PNG en SVG downloaden](/nl/docs/outputs/) voor vroegtijdige PDF-downloads, specifieke PNG-pagina's en het herhalen van SVG-extractie.

| Pad | Inhoud |
| --- | --- |
| `.render/result.pdf` | Succesvol gegenereerde PDF |
| `.render/compile.log` | LaTeX-compilatielogboek |
| `.render/errors.json` | Gestructureerde foutdetails |
| `.render/job.json` | Eindstatus van de taak |
| `.render/previews/page-N.png` | Voorbeelden van maximaal 100 pagina's |
| `.render/svg/manifest.json` | Koppeling van SVG's aan bronposities en PDF-coördinaten |
| `.render/svg/objects/*.svg` | Afzonderlijke SVG voor elke wiskundige uitdrukking of TikZ-tekening |

## JSON-uitvoer {#json出力}

Voeg `--json` toe aan een opdracht om één JSON-object zonder voortgangsberichten naar standaarduitvoer te schrijven. Dit gebruikt hetzelfde `client-core`-resultaat als de normale weergave en bevat geen API-sleutels of kortlevende tokens.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Zie het [JSON-formaat van de CLI](/nl/docs/reference/#cliのjson形式) voor succes- en foutschema's en afsluitcodes.
