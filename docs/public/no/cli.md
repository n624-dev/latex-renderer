---
slug: cli
category: CLI
title: Konverter dokumenter og last ned resultater med CLI
description: Kompiler TeX i terminalen og hent PDF-filer, logger og forhåndsvisninger.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

I mappen med `main.tex` kjører du `n624-latex main.tex` for å lagre PDF-filen i samme mappe. Ved første gangs bruk, [installer CLI](/no/docs/client/) og sett opp tilkoblingen.

## Autentisering {#認証}

Åpne innstillingene i en nettleser for å lagre API-nøkkelen.

```sh
n624-latex setup --gui
```

Hvis du ikke kan åpne en nettleser, for eksempel over SSH, les inn nøkkelen via **standard inndata** slik at den ikke vises i kommandoargumentene. I Bash eller Zsh kjører du den første linjen, limer inn nøkkelen, trykker på Enter og fortsetter med de andre linjene.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

I Windows kan du også bruke [det skjulte inndatafeltet i installasjonsprogrammet](/no/docs/windows/#インストール).

Den første kommandoen kontrollerer om en nøkkel er lagret, den andre fjerner den.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` viser serveradressen som brukes og kilden til påloggingsinformasjonen: navnet på en lagret profil, miljøvariabelen `LATEX_RENDER_API_KEY` eller ingen kilde. Med `--json` får du feltene `origin` og `credentialSource`.

- Hvis miljøvariabelen `LATEX_RENDER_API_KEY` er satt, har den forrang foran den lokale nøkkelen.
- `logout` fjerner bare den lokalt lagrede nøkkelen. Fjern miljøvariabelen eller trekk nøkkelen tilbake på serveren separat ved behov.

### Velg server {#接続先サーバー}

Som standard kobler CLI til den driftede tjenesten (`https://latex-render.n624.jp`). For en egen server setter du HTTPS-adressen i terminaløkten der kommandoene skal kjøres.

- Utelat endelsene `/app/` og `/api/v1/` fra nettadressen.
- Bruk en API-nøkkel som er utstedt av denne serveren.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Innstillinger og diagnostikk {#セットアップと診断}

Åpne oppsettet for tilkoblinger og integrasjoner med `n624-latex setup`. Hvis tilkoblingen ikke virker, sjekk status med de følgende kommandoene først. Hvis `n624-latex` ikke finnes, se [Installasjon og PATH](/no/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` kontrollerer installasjonen og påloggingsopplysningene uten å endre dem eller vise verdien av API-nøkkelen. Hvis det oppdages problemer, returneres avslutningskoden `2`.

| Installasjon | Oppdatering og reparasjon |
| --- | --- |
| APT | [Oppdater med APT](/no/docs/client/#apt-版の更新) eller [installer skadede pakker på nytt](/no/docs/client/#状態確認と修復). [Registrer Local MCP manuelt](/no/docs/mcp/#local-mcpの登録). |
| Homebrew | [Oppdater med Homebrew](/no/docs/client/#homebrew-版の更新) eller [installer skadede pakker på nytt](/no/docs/client/#状態確認と修復). Sett opp KI-integrasjoner med `n624-latex setup`. |
| Nedlastbart installasjonsprogram | [Oppdater fra innstillingene](/no/docs/client/#配布インストーラー版の更新). Reparer administrerte integrasjoner og startfiler med `n624-latex setup repair`. |

Ved avinstallasjon, følg [veiledningen for din installasjonsmetode](/no/docs/client/#アンインストール). Oppsettsgrensesnittet er lokalt og lukkes når CLI avsluttes.

## Rendering {#レンダリング}

### Konverter en TeX-fil direkte {#tex-ファイルを直接変換する}

Oppgi `.tex`-filen i prosjektmappen for å lage PDF-filen. Du kan vise til bilder, bibliografi og lokale `.sty`-filer med relative stier.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Utelater du `-o`, lagres en PDF med samme grunnnavn, for eksempel `main.pdf`, i mappen der du kjørte kommandoen.
- Ved LaTeX-feil vises filnavn, linje og jobb-ID så langt de kan identifiseres. Den siste vellykkede PDF-filen beholdes hvis kompilering eller nedlasting mislykkes.

#### Velg LaTeX-motor {#latex-のエンジンを選ぶ}

For å bruke XeLaTeX skriver du motornavnet før filen.

```sh
n624-latex xelatex main.tex
```

Hvis ingen motor er oppgitt, ser CLI først i begynnelsen av dokumentet etter `% !TeX program = xelatex` eller
`% !TEX TS-program = xelatex`. Uten et slikt direktiv leser det
`.n624-latex.json` i prosjektroten. Du kan dele denne filen
i Git for å bruke samme motor på andre maskiner.

```json
{"engine":"xelatex"}
```

Uten noen innstilling brukes LuaLaTeX. pLaTeX og upLaTeX krever
at kjøremiljøet på serveren inneholder den japanske språksamlingen.

| Motor | Hva bør kontrolleres når et dokument flyttes? |
| --- | --- |
| LuaLaTeX | Kontroller oppsettet i dokumenter som bruker `fontspec` eller LuaTeX-ja. |
| pdfLaTeX | Støtter ikke `fontspec`. Bruk skriftoppsett for pdfLaTeX. |
| XeLaTeX | Støtter `fontspec`. Se etter pakker som bare virker med LuaTeX. |
| pLaTeX / upLaTeX | Bruk en japansk dokumentklasse som passer til motoren. For `jsarticle` i upLaTeX, oppgi klassevalget `uplatex`. |

Behandling av bibliografi avhenger av pakkene og dokumentoppsettet. Ta med `.bib` og egne `.bst`. BibTeX-dokumenter bruker pBibTeX i pLaTeX og upBibTeX i upLaTeX. Se [renderingsmiljøet](/app/environment/) for kontroll av PDF, SVG og SVG-plassering.

### Konverter et ZIP-arkiv eller be om flere utdatafiler {#zip-複数の出力を指定する}

Bruk underkommandoen `render` for å konvertere en ZIP eller hente hele resultatsettet med logger, forhåndsvisninger og SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Eksempler**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Standard sti er gjeldende mappe, og standardverdien for `--entrypoint` er `main.tex`. CLI klargjør inndata med høyst 500 filer og venter på fullføring. Startfilen kan angis med en relativ sti til en `.tex`. Serveren kontrollerer at stien er trygg, og at filen finnes.
- Med `--svg` hentes også de ytterste matematiske uttrykkene og TikZ-figurer på øverste nivå ut som separate SVG-filer.

### Gjenbruk inndata for flere dokumenter {#同じ入力から複数の文書を作る-source-の再利用}

Hvis en mappe eller ZIP inneholder flere hoveddokumenter, last opp inndataene én gang med `source upload` og bruk ID-en om igjen. Bruk en egen utdatamappe (`--output`) for hver jobb.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Opprydding i målet, unntak og dupliserte opplastinger
>
> - **Opprydding i tidligere utdata.** Ved gjenbruk av et mål fjernes bare PDF-filer, forhåndsvisninger og SVG-filer som stod i forrige `job.json`, men ikke finnes i det nye resultatet. Brukerens øvrige filer beholdes.
> - **Kontroll av mål.** Stier med symbolske lenker avvises. På POSIX-systemer kontrolleres også eierskap og skriverett for gruppe og andre. Windows hopper over kontrollen av POSIX-modusbiter.
> - **Utelat utdatamappen.** Peker `--output` på en undermappe i prosjektet, utelates akkurat denne mappen fra neste ZIP. Mapper med lignende navn blir med. Prosjektroten kan ikke være mål.
> - **Dupliserte opplastinger.** Har serveren en gyldig ZIP fra samme eier med samme SHA-256, returnerer den `uploadRequired: false` og hopper over overføringen. Bare eieren kan bruke inndata-ID-en i senere jobber.

## Lagrede prosjekter og revisjoner {#保存projectと改訂}

Bruk CLI til å administrere og kompilere prosjekter og revisjoner på serveren på nytt. Nettappen, API-et, MCP og andre nøkler fra samme bruker deler prosjektene. Midlertidige operasjoner med `render` og `source upload` krever ikke at prosjektet lagres.

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

- **`save`** klargjør en mappe eller ZIP som inndata og lagrer en uforanderlig revisjon i prosjektet. Med `--svg` blir revisjonens opprinnelige utdata PDF og SVG.
- **`render`** oppretter en jobb fra en lagret revisjon. Bare `--svg` overstyrer utdatainnstillingene.
- **`list`, `get` og `jobs`** godtar `--cursor` for å hente neste side.
- **`delete`** skjuler prosjektet i listen. Eksisterende jobber slettes ikke med en gang.

## Behandle jobber {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Last ned og vent.** Disse kommandoene bruker API-nøkkelen til å fornye et kortlivet token. `jobs download` venter på at jobben blir ferdig før det lagrede settet erstattes. Hvis ventingen mislykkes eller avbrytes, beholdes forrige sett. `delete` gjelder bare avsluttede jobber.
- **Hent flere PNG-forhåndsvisninger.** Først genereres bare den første siden. Vanlig nedlasting henter eksisterende PNG-filer. Bruk for eksempel `--preview-page 2 5` for å generere disse sidene, kontrollere størrelse og SHA-256 og lagre dem. PDF-filen kompileres ikke om, og lagringstiden forlenges ikke.
- **Hent PDF tidlig og prøv SVG på nytt.** For jobber med PDF og SVG bruker du `--pdf-only` for å hente PDF-filen uten å vente på SVG. Hvis bare SVG mislykkes, beholdes PDF-filen, og resultatet er delvis vellykket. `retry-svg` gjentar bare uthentingen. Høyst 8 forsøk medregnet det første er tillatt, uten forlenget lagringstid. Opprett en ny jobb hvis kjøremiljøet er endret. Se [Hent ferdig PDF og prøv SVG på nytt](/no/docs/api/#pdfの先行公開とsvgの再試行).
- **Nye forsøk ved nettverksproblemer.** Forbigående feil under statuskontroll fører til nytt forsøk. Autentiserings- og rettighetsfeil returneres straks. Serveren kan fortsette selv om CLI slutter å vente. Kontroller samme `<jobId>` før du oppretter en ny jobb. Se [Ventetid og nye forsøk i CLI](/no/docs/reference/#cliの待機と再試行).

## Utdatafiler {#成果物}

For å laste ned PDF tidlig, velge PNG-sider eller prøve SVG igjen, se [Hent PDF, PNG og SVG](/no/docs/outputs/).

| Sti | Innhold |
| --- | --- |
| `.render/result.pdf` | PDF fra vellykket kompilering |
| `.render/compile.log` | LaTeX-kompileringslogg |
| `.render/errors.json` | Strukturerte feildetaljer |
| `.render/job.json` | Jobbens sluttstatus |
| `.render/previews/page-N.png` | Forhåndsvisninger av høyst 100 sider |
| `.render/svg/manifest.json` | Kobling mellom SVG, kildeposisjoner og PDF-koordinater |
| `.render/svg/objects/*.svg` | Separat SVG for hvert matematisk uttrykk eller hver TikZ-figur |

## JSON-utdata {#json出力}

Legg til `--json` i en hvilken som helst kommando for å skrive ett JSON-objekt til standard utdata uten fremdriftsmeldinger. Det inneholder samme `client-core`-resultat som den vanlige visningen, uten API-nøkler eller kortlivede token.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Se [JSON-formatet for CLI](/no/docs/reference/#cliのjson形式) for skjemaene for vellykkede svar og feil samt avslutningskodene.
