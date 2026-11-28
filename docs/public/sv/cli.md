---
slug: cli
category: CLI
title: Konvertera dokument och hämta resultat med CLI
description: Kompilera TeX i terminalen och hämta PDF-filer, loggar och förhandsvisningar.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

I mappen med `main.tex` kör du `n624-latex main.tex` för att spara PDF-filen i samma mapp. Om du är ny användare, [installera CLI](/sv/docs/client/) och ställ in anslutningen.

## Autentisering {#認証}

Öppna inställningssidan i en webbläsare för att spara API-nyckeln.

```sh
n624-latex setup --gui
```

Om du inte kan öppna en webbläsare, till exempel via SSH, läs in nyckeln via **standardindata** så att den inte visas i kommandoargumenten. I Bash eller Zsh kör du första raden, klistrar in nyckeln, trycker på Retur och fortsätter med övriga rader.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

I Windows kan du även använda [installationsprogrammets dolda inmatning](/sv/docs/windows/#インストール).

Det första kommandot kontrollerar om en nyckel finns sparad och det andra tar bort den.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` visar serveradressen som används och källan till inloggningsuppgifterna: namnet på en sparad profil, miljövariabeln `LATEX_RENDER_API_KEY` eller ingen källa. Med `--json` får du fälten `origin` och `credentialSource`.

- Miljövariabeln `LATEX_RENDER_API_KEY` har företräde framför den lokala nyckeln om den är satt.
- `logout` tar endast bort den lokalt sparade nyckeln. Ta vid behov bort miljövariabeln eller återkalla nyckeln på servern separat.

### Välj server {#接続先サーバー}

Som standard ansluter CLI till den driftade tjänsten (`https://latex-render.n624.jp`). För en egen server, ange dess HTTPS-adress i terminalsessionen där kommandona ska köras.

- Utelämna ändelserna `/app/` och `/api/v1/` i adressen.
- Använd en API-nyckel som utfärdats av den servern.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Inställningar och diagnostik {#セットアップと診断}

Öppna inställningarna för anslutning och integreringar med `n624-latex setup`. Om anslutningen inte fungerar, kontrollera först status med följande kommandon. Om `n624-latex` inte hittas, se [Installation och PATH](/sv/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` kontrollerar installation och inloggningsuppgifter utan att ändra dem eller skriva ut API-nyckelns värde. Vid problem returneras slutkoden `2`.

| Installation | Uppdatering och reparation |
| --- | --- |
| APT | [Uppdatera med APT](/sv/docs/client/#apt-版の更新) eller [installera om](/sv/docs/client/#状態確認と修復) skadade paket. [Registrera Local MCP manuellt](/sv/docs/mcp/#local-mcpの登録). |
| Homebrew | [Uppdatera med Homebrew](/sv/docs/client/#homebrew-版の更新) eller [installera om](/sv/docs/client/#状態確認と修復) skadade paket. Konfigurera AI-integreringar med `n624-latex setup`. |
| Nedladdat installationsprogram | [Uppdatera via inställningarna](/sv/docs/client/#配布インストーラー版の更新). Reparera hanterade integreringar och startfiler med `n624-latex setup repair`. |

Följ [anvisningarna för din installationsmetod](/sv/docs/client/#アンインストール) för att avinstallera. Inställningsgränssnittet är lokalt och stängs när CLI avslutas.

## Rendering {#レンダリング}

### Konvertera en TeX-fil direkt {#tex-ファイルを直接変換する}

Ange en `.tex`-fil i projektmappen för att skapa PDF-filen. Bilder, bibliografi och lokala `.sty`-filer kan anges med relativa sökvägar.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Om du utelämnar `-o` sparas en PDF med samma basnamn, till exempel `main.pdf`, i den mapp där du kör kommandot.
- Vid LaTeX-fel visas det filnamn, radnummer och jobb-ID som kunnat identifieras. Den senaste korrekt sparade PDF-filen behålls om kompileringen eller nedladdningen misslyckas.

#### Välj LaTeX-motor {#latex-のエンジンを選ぶ}

Skriv motorns namn före filen om du vill använda XeLaTeX.

```sh
n624-latex xelatex main.tex
```

Om du inte anger en motor söker CLI i början av dokumentet efter `% !TeX program = xelatex` eller
`% !TEX TS-program = xelatex`. Hittas inget direktiv läses
`.n624-latex.json` i projektroten. Du kan dela filen
via Git för att använda samma motor på andra datorer.

```json
{"engine":"xelatex"}
```

Om ingen motor anges används LuaLaTeX. pLaTeX och upLaTeX kräver
att serverns körmiljö innehåller den japanska språksamlingen.

| Motor | Vad ska kontrolleras när ett dokument flyttas? |
| --- | --- |
| LuaLaTeX | Granska inställningarna för dokument som använder `fontspec` eller LuaTeX-ja. |
| pdfLaTeX | Stöder inte `fontspec`. Använd typsnittsinställningar för pdfLaTeX. |
| XeLaTeX | Stöder `fontspec`. Kontrollera om dokumentet använder paket som enbart fungerar med LuaTeX. |
| pLaTeX / upLaTeX | Använd en japansk dokumentklass som passar motorn. För `jsarticle` i upLaTeX, ange klassalternativet `uplatex`. |

Bibliografihanteringen beror på dokumentets paket och inställningar. Ta med `.bib` och egna `.bst`. BibTeX-dokument använder pBibTeX i pLaTeX och upBibTeX i upLaTeX. Se [renderingsmiljön](/app/environment/) för kontroller av PDF, SVG och SVG-positioner.

### Konvertera ZIP eller begär flera utdatafiler {#zip-複数の出力を指定する}

Använd underkommandot `render` för att konvertera ett ZIP-arkiv eller hämta alla resultat, inklusive loggar, förhandsvisningar och SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Exempel**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- Standardsökvägen är aktuell mapp och standardvärdet för `--entrypoint` är `main.tex`. CLI förbereder ett underlag med högst 500 filer och väntar tills jobbet är klart. Startfilen kan anges som relativ sökväg till en `.tex`. Servern kontrollerar att sökvägen är säker och att filen finns.
- Med `--svg` extraheras även de yttersta matematiska uttrycken och TikZ-bilder på översta nivån som separata SVG-filer.

### Återanvänd ett underlag för flera dokument {#同じ入力から複数の文書を作る-source-の再利用}

Om en mapp eller ett ZIP-arkiv innehåller flera huvuddokument, ladda upp underlaget en gång med `source upload` och återanvänd ID:t. Använd en separat utdatamapp (`--output`) för varje jobb.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Rensning av mål, uteslutning och dubbla uppladdningar
>
> - **Rensning av tidigare utdata.** Vid återanvändning av ett mål tas endast de PDF-filer, förhandsvisningar och SVG-filer bort som fanns i den tidigare `job.json` men saknas i det nya resultatet. Användarens övriga filer behålls.
> - **Kontroll av målet.** Sökvägar med symboliska länkar avvisas. På POSIX-system kontrolleras även ägare och skrivbehörighet för gruppen och andra. Windows hoppar över kontrollen av POSIX-lägesbitar.
> - **Uteslut utdatamappen.** Om `--output` pekar på en undermapp till projektet utesluts exakt den mappen från nästa ZIP. Mappar med liknande namn tas med. Projektroten får inte användas som mål.
> - **Dubbla uppladdningar.** Finns redan ett giltigt ZIP-arkiv med samma ägare och samma SHA-256 returnerar servern `uploadRequired: false` och hoppar över överföringen. Endast ägaren kan använda underlagets ID i senare jobb.

## Sparade projekt och revisioner {#保存projectと改訂}

Använd CLI för att hantera och kompilera om projekt och revisioner på servern. Webbappen, API:t, MCP och andra nycklar för samma användare delar projekten. Tillfälliga åtgärder med `render` och `source upload` kräver inte att projektet sparas.

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

- **`save`** förbereder en mapp eller ett ZIP-arkiv som underlag och sparar en oföränderlig revision i projektet. Med `--svg` blir PDF och SVG revisionens ursprungliga utdataformat.
- **`render`** skapar ett jobb från en sparad revision. Endast `--svg` skriver över utdatainställningarna.
- **`list`, `get` och `jobs`** tar emot `--cursor` för att hämta nästa sida.
- **`delete`** döljer projektet i listan. Befintliga jobb raderas inte omedelbart.

## Hantera jobb {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Hämta och vänta.** Kommandona använder API-nyckeln för att förnya en kortlivad token. `jobs download` väntar tills jobbet är klart innan den sparade filuppsättningen ersätts. Om väntan avbryts eller misslyckas behålls den tidigare uppsättningen. `delete` gäller bara slutförda jobb.
- **Hämta fler PNG-förhandsvisningar.** Först skapas endast den första sidan. En vanlig nedladdning hämtar befintliga PNG-filer. Använd till exempel `--preview-page 2 5` för att skapa de sidorna, verifiera storlek och SHA-256 och spara dem. PDF-filen kompileras inte om och lagringstiden förlängs inte.
- **Hämta PDF tidigare och försök med SVG igen.** För ett PDF- och SVG-jobb använder du `--pdf-only` för att hämta PDF-filen utan att vänta på SVG. Misslyckas bara SVG behålls PDF-filen och resultatet blir delvis slutfört. `retry-svg` upprepar endast extraktionen. Högst 8 försök inklusive det första tillåts, utan att lagringstiden förlängs. Skapa ett nytt jobb om körmiljön ändrats. Se [Hämta färdig PDF och försök med SVG igen](/sv/docs/api/#pdfの先行公開とsvgの再試行).
- **Nya försök vid nätverksproblem.** Tillfälliga fel vid statuskontroll utlöser nya försök. Autentiserings- och behörighetsfel returneras direkt. Servern kan fortsätta arbeta efter att CLI slutat vänta. Kontrollera samma `<jobId>` innan du skapar ett nytt jobb. Se [Väntetider och nya försök i CLI](/sv/docs/reference/#cliの待機と再試行).

## Utdatafiler {#成果物}

Se [Hämta PDF, PNG och SVG](/sv/docs/outputs/) för att hämta PDF tidigt, välja PNG-sidor eller försöka med SVG på nytt.

| Sökväg | Innehåll |
| --- | --- |
| `.render/result.pdf` | PDF-fil från lyckad kompilering |
| `.render/compile.log` | LaTeX-kompileringens logg |
| `.render/errors.json` | Strukturerade feluppgifter |
| `.render/job.json` | Jobbets slutstatus |
| `.render/previews/page-N.png` | Förhandsvisningar av högst 100 sidor |
| `.render/svg/manifest.json` | Koppling mellan SVG, källposition och PDF-koordinater |
| `.render/svg/objects/*.svg` | En separat SVG-fil per matematiskt uttryck eller TikZ-bild |

## JSON-utdata {#json出力}

Lägg till `--json` i ett kommando för att skriva ett enda JSON-objekt till standardutdata utan förloppsmeddelanden. Det innehåller samma `client-core`-resultat som vanlig visning och utelämnar API-nycklar och kortlivade token.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Se [CLI:s JSON-format](/sv/docs/reference/#cliのjson形式) för scheman vid framgång och fel samt slutkoder.
