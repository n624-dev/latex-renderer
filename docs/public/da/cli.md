---
slug: cli
category: CLI
title: Konvertér dokumenter og hent resultater med CLI
description: Kompilér TeX i terminalen, og hent PDF-filer, logfiler og forhåndsvisninger.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

I mappen med `main.tex` skal du køre `n624-latex main.tex` for at gemme PDF-filen i samme mappe. Er det første gang, så [installér CLI](/da/docs/client/), og konfigurer forbindelsen.

## Godkendelse {#認証}

Åbn indstillingerne i en browser for at gemme API-nøglen.

```sh
n624-latex setup --gui
```

Hvis du ikke kan åbne en browser, f.eks. over SSH, skal du angive nøglen via **standardinput**, så den ikke vises i kommandoargumenterne. I Bash eller Zsh skal du køre første linje, indsætte nøglen, trykke på Enter og fortsætte med de øvrige linjer.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

I Windows kan du også bruge [installationsprogrammets skjulte inputfelt](/da/docs/windows/#インストール).

Den første kommando kontrollerer, om en nøgle er gemt, og den anden fjerner den.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` viser den anvendte serveradresse og kilden til legitimationsoplysningerne: et gemt profilnavn, miljøvariablen `LATEX_RENDER_API_KEY` eller ingen. Brug `--json` for at få felterne `origin` og `credentialSource`.

- Hvis miljøvariablen `LATEX_RENDER_API_KEY` er angivet, har den forrang for den lokale nøgle.
- `logout` fjerner kun den lokalt gemte nøgle. Fjern miljøvariablen, eller tilbagekald nøglen på serveren separat, hvis det er nødvendigt.

### Vælg server {#接続先サーバー}

CLI opretter som standard forbindelse til den hostede tjeneste (`https://latex-render.n624.jp`). Til egen server skal du angive dens HTTPS-URL i den terminalsession, hvor du kører kommandoerne.

- Udelad endelserne `/app/` og `/api/v1/` i URL'en.
- Brug en API-nøgle udstedt af den pågældende server.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Indstillinger og diagnostik {#セットアップと診断}

Åbn opsætningen af forbindelser og integrationer med `n624-latex setup`. Hvis forbindelsen fejler, skal du først kontrollere status med følgende kommandoer. Kan `n624-latex` ikke findes, se [Installation og PATH](/da/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` læser og kontrollerer installationen og loginoplysningerne uden at vise API-nøglens værdi. Værktøjet returnerer afslutningskode `2`, hvis det finder problemer.

| Installation | Opdatering og reparation |
| --- | --- |
| APT | [Opdater med APT](/da/docs/client/#apt-版の更新), eller [geninstallér](/da/docs/client/#状態確認と修復) beskadigede pakker. [Registrer Local MCP manuelt](/da/docs/mcp/#local-mcpの登録). |
| Homebrew | [Opdater med Homebrew](/da/docs/client/#homebrew-版の更新), eller [geninstallér](/da/docs/client/#状態確認と修復) beskadigede pakker. Konfigurer AI-integrationer med `n624-latex setup`. |
| Downloadet installationsprogram | [Opdater i indstillingerne](/da/docs/client/#配布インストーラー版の更新). Reparer administrerede integrationer og startfiler med `n624-latex setup repair`. |

Ved afinstallation skal du følge [vejledningen til din installationsmetode](/da/docs/client/#アンインストール). Opsætningsgrænsefladen kører lokalt og lukker, når CLI afsluttes.

## Rendering {#レンダリング}

### Konvertér en TeX-fil direkte {#tex-ファイルを直接変換する}

Angiv en `.tex`-fil i projektmappen for at oprette en PDF. Du kan bruge relative stier til billeder, bibliografi og lokale `.sty`-filer.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Hvis du udelader `-o`, gemmes en PDF med samme grundnavn, f.eks. `main.pdf`, i den mappe, hvor du kørte kommandoen.
- Ved LaTeX-fejl vises det filnavn, linjenummer og job-ID, der kan identificeres. Den seneste korrekt gemte PDF bevares, hvis kompilering eller download mislykkes.

#### Vælg LaTeX-motor {#latex-のエンジンを選ぶ}

Skriv motornavnet før filen, hvis du vil bruge XeLaTeX.

```sh
n624-latex xelatex main.tex
```

Angiver du ikke en motor, søger CLI i begyndelsen af dokumentet efter `% !TeX program = xelatex` eller
`% !TEX TS-program = xelatex`. Findes ingen af direktiverne, læser det
`.n624-latex.json` i projektets rodmappe. Du kan dele filen
via Git for at bruge samme motor på andre computere.

```json
{"engine":"xelatex"}
```

Uden anden angivelse bruges LuaLaTeX. pLaTeX og upLaTeX kræver,
at serverens kørselsmiljø indeholder den japanske sprogsamling.

| Motor | Hvad skal kontrolleres ved flytning af et dokument? |
| --- | --- |
| LuaLaTeX | Kontroller opsætningen i dokumenter, der bruger `fontspec` eller LuaTeX-ja. |
| pdfLaTeX | Understøtter ikke `fontspec`. Brug skrifttypeindstillinger til pdfLaTeX. |
| XeLaTeX | Understøtter `fontspec`. Se efter pakker, som kun virker med LuaTeX. |
| pLaTeX / upLaTeX | Brug en japansk dokumentklasse, som passer til motoren. Ved `jsarticle` i upLaTeX skal du angive klassevalget `uplatex`. |

Bibliografibehandlingen afhænger af dokumentets pakker og indstillinger. Medtag `.bib` og dine egne `.bst`. BibTeX-dokumenter bruger henholdsvis pBibTeX og upBibTeX i pLaTeX og upLaTeX. Se [renderingsmiljøet](/app/environment/) for verifikation af PDF, SVG og SVG-placering.

### Konvertér et ZIP-arkiv eller anmod om flere outputfiler {#zip-複数の出力を指定する}

Brug underkommandoen `render` til at konvertere et ZIP-arkiv eller hente et sæt resultater med bl.a. logfiler, forhåndsvisninger og SVG.

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

- Standardstien er den aktuelle mappe, og standardværdien for `--entrypoint` er `main.tex`. CLI klargør input med højst 500 filer og venter på afslutning. Startfilen kan angives med en relativ sti til en `.tex`. Serveren kontrollerer, at stien er sikker, og at filen findes.
- Med `--svg` udtrækkes også de yderste matematiske udtryk og TikZ-figurer på øverste niveau som selvstændige SVG-filer.

### Genbrug input til flere dokumenter {#同じ入力から複数の文書を作る-source-の再利用}

Hvis en mappe eller et ZIP-arkiv indeholder flere hoveddokumenter, skal du uploade inputtet én gang med `source upload` og genbruge ID'et. Brug en særskilt outputmappe (`--output`) til hvert job.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Oprydning i destinationen, udeladelser og gentagne uploads
>
> - **Oprydning i tidligere output.** Når en destination genbruges, fjernes kun PDF-filer, forhåndsvisninger og SVG-filer, som stod i den tidligere `job.json` og mangler i det nye resultat. Brugerens øvrige filer bevares.
> - **Kontrol af destination.** Stier med symbolske links afvises. På POSIX-systemer kontrolleres også ejerskab og skriverettigheder for gruppe og andre. Windows springer kontrollen af POSIX-tilstandsbitter over.
> - **Udelad outputmappen.** Hvis `--output` peger på en undermappe i projektet, udelades præcis denne mappe fra næste ZIP-arkiv. Mapper med lignende navne medtages. Projektets rodmappe må ikke bruges som destination.
> - **Gentagne uploads.** Har serveren et gyldigt ZIP-arkiv fra samme ejer med samme SHA-256, returnerer den `uploadRequired: false` og springer overførslen over. Kun ejeren kan bruge input-ID'et i efterfølgende job.

## Gemte projekter og revisioner {#保存projectと改訂}

Brug CLI til at administrere og genkompilere projekter og revisioner på serveren. Webappen, API'et, MCP og andre nøgler for samme bruger deler projekterne. Midlertidige handlinger med `render` og `source upload` kræver ikke, at du gemmer et projekt.

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

- **`save`** klargør en mappe eller et ZIP-arkiv som input og gemmer en uforanderlig revision i projektet. Med `--svg` er revisionens oprindelige output PDF og SVG.
- **`render`** opretter et job ud fra en gemt revision. Kun `--svg` tilsidesætter outputindstillingerne.
- **`list`, `get` og `jobs`** tager imod `--cursor` for at hente næste side.
- **`delete`** skjuler projektet på listen. Eksisterende job slettes ikke med det samme.

## Arbejd med job {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Hent og vent.** Kommandoerne bruger API-nøglen til at forny et kortlivet token. `jobs download` venter, til jobbet er afsluttet, før det gemte sæt erstattes. Hvis ventetiden afbrydes eller ender med en fejl, bevares det tidligere sæt. `delete` virker kun på afsluttede job.
- **Hent flere PNG-forhåndsvisninger.** I begyndelsen oprettes kun første side. Almindelig download henter eksisterende PNG-filer. Brug f.eks. `--preview-page 2 5` til at oprette disse sider, verificere størrelse og SHA-256 og gemme dem. PDF-filen genkompileres ikke, og opbevaringstiden forlænges ikke.
- **Hent PDF tidligere, og prøv SVG igen.** Brug `--pdf-only` til et job med PDF og SVG for at hente PDF-filen uden at vente på SVG. Hvis kun SVG fejler, bevares PDF-filen, og resultatet er delvis gennemført. `retry-svg` gentager kun udtrækket. Højst 8 forsøg inklusive det første er tilladt uden forlænget opbevaring. Opret et nyt job, hvis kørselsmiljøet er ændret. Se [Hent den færdige PDF, og prøv SVG igen](/da/docs/api/#pdfの先行公開とsvgの再試行).
- **Nye forsøg ved netværksproblemer.** Forbigående fejl ved statusforespørgsler medfører nye forsøg. Fejl i godkendelse eller rettigheder returneres straks. Serveren kan stadig arbejde, efter at CLI holder op med at vente. Kontroller samme `<jobId>`, før du opretter et nyt job. Se [Ventetid og nye forsøg i CLI](/da/docs/reference/#cliの待機と再試行).

## Outputfiler {#成果物}

Se [Hent PDF, PNG og SVG](/da/docs/outputs/) for tidlig download af PDF, valg af PNG-sider og gentagelse af SVG-udtræk.

| Sti | Indhold |
| --- | --- |
| `.render/result.pdf` | PDF fra vellykket kompilering |
| `.render/compile.log` | Log fra LaTeX-kompileringen |
| `.render/errors.json` | Strukturerede fejloplysninger |
| `.render/job.json` | Jobbets slutstatus |
| `.render/previews/page-N.png` | Forhåndsvisninger af højst 100 sider |
| `.render/svg/manifest.json` | Sammenhæng mellem SVG, kildeplacering og PDF-koordinater |
| `.render/svg/objects/*.svg` | Separat SVG per matematisk udtryk eller TikZ-figur |

## JSON-output {#json出力}

Føj `--json` til en kommando for at skrive ét JSON-objekt til standardoutput uden statusmeddelelser undervejs. Det bruger samme `client-core`-resultat som normal visning og udelader API-nøgler og kortlivede tokens.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Se [CLI's JSON-format](/da/docs/reference/#cliのjson形式) for skemaer for succes og fejl samt afslutningskoder.
