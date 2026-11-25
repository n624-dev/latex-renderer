---
slug: reference
category: Drift og udvikling
title: Reference til drift og udvikling
description: Find oplysninger om lagring og gendannelse af klientoutput, MCP-godkendelse og migrering.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Gem og gendan resultater {#成果物の保存-復旧の仕様}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> - **Atomisk mappeudskiftning.** CLI og Local MCP bevarer stier som `.render/result.pdf`, `job.json` og forhåndsvisningerne. De kontrollerer den oplyste størrelse og SHA-256 for alle filer og udskifter først mappen, når sættet er komplet. Mappen kan mangle et øjeblik under skiftet. Eksterne programmer bør først læse den, når kommandoen er afsluttet.
> - **Automatisk gendannelse.** En mappe med navnet `<output-name>.latex-renderer-state` ved siden af outputmappen gemmer gendannelsestilstanden og udelades ved indsamling af input. Ved normal afslutning ryddes midlertidige data. Ved tvungen afslutning gendanner næste download det gamle sæt, hvis skiftet ikke var bekræftet. Var det bekræftet, bevares det nye, og det gamle ryddes. Slet ikke tilstandsmappen under handlingen eller før gendannelse.
> - **Låsning og afvigelser.** Samtidig skrivning til samme destination stoppes med `OUTPUT_BUSY`. Den forløbne tid alene fortrænger ikke en aktiv proces. Ved genbrug af PID stoppes handlingen af forsigtighedshensyn. Beskadigede metadata, ukendte filer og links ud af mappen skal undersøges før sletning.
> - **Brugerfiler og grænser.** Almindelige brugerfiler kopieres til det nye sæt. Opdages en ændring under download, afbrydes offentliggørelsen, og ændringen bevares. Brug helst en særskilt destination. Hvert sæt må indeholde højst 1 GiB og 10.000 poster. Der skal være plads til begge sæt og midlertidige data. Kun lokale filsystemer understøttes. Stier med symbolske links, hårde links eller monteringer fra andre filsystemer afvises. Låsning på netværksdrev og fuld atomicitet ved strømsvigt er ikke garanteret. I Windows bevares det tidligere sæt, hvis en åben fil blokerer udskiftningen.

## Grænser for webgodkendelse {#web認証の境界}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Serversessioner beskytter `/app/`, `/admin/` og deres API'er. De indgår ikke i det offentlige søgeindeks. Almindelige brugere anvender `/app/`, mens kun administratorer og ejere kan tilgå `/admin/`. Identiteten bestemmes af `issuer + subject` fra den eksterne udbyder eller `login name` ved adgangskodelogin. Mailadresse og vist navn er ikke godkendelsesnøgler. ZIP-uploads, job, outputfiler og TeX-kompilering går gennem serverens renderer.
>
> > [!NOTE]
> > Browseren gemmer ikke kortlivede billetter permanent. Serversessionen udsteder nye efter behov. Del ikke sessionscookies, CSRF-tokens eller billetter.

## Registrering og diagnostik for Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> - **Dynamisk klientregistrering (DCR).** Ufuldstændige eller inaktive registreringer ryddes normalt efter 30 dage. Registreringer med referencer fra gyldige autorisationskoder eller tokenfamilier er beskyttede. Den globale grænse er 10.000. Vises `invalid_client` efter oprydning, skal du registrere klienten igen. Almindelige DCR-anmodninger uden klientnavn understøttes, og navn samt omdirigerings-URI valideres fortsat.
> - **Midlertidige autorisationsanmodninger (skema 20).** Hvis der skal logges ind undervejs, gemmes anmodningen med et kort tilfældigt ID, så den kan hentes uden at sætte den lange OAuth-værdi `state` i retur-URL'en. Den er gyldig i 10 minutter og kan bruges én gang, hvis den indloggede browser og den særlige cookie stemmer overens. Samtidige faner har forskellige ID'er. Der er en global grænse på 1.000 anmodninger og højst 8 fortsættelsescookies per browser. Ved grænsen returneres `503`, mens eksisterende anmodninger bevares. Databasen gemmer kun hashværdier af ID og cookie. Genstart og gendannelse fra kopi forlænger ikke gyldigheden.
> - **IP-grænser og oprindelsesheadere.** DCR tillader 10 registreringer per betroet kilde-IP på 15 minutter. Klienter med samme udgående proxy deler kvoten. Fra det 11. forsøg returneres HTTP `429`, `temporarily_unavailable` og `Retry-After`. Ugyldige metadata bruger ikke kvote. Hvis IP'en mangler eller er ugyldig, returneres `503`, så operatøren kan tjekke proxyen, uden at uidentificerede klienter slås sammen. Hold backend på loopback-grænsefladen, og lad proxyen erstatte `X-Latex-Renderer-Client-IP` med den faktiske adresse. Vilkårlige `X-Forwarded-For`-værdier ignoreres. På Cloudflare-ruter behandles også `CF-Connecting-IP` inden for tillidsgrænsen.
> - **Administrativ forbindelseskontrol.** Følgende kommando kontrollerer offentlig tjenesteopdagelse og Bearer-udfordringen `401` uden at sende loginoplysninger, ændre opsætning, følge omdirigeringer eller vise svarindhold, cookies eller hemmeligheder.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Isoler fejlen efter fase.** Et korrekt `200` for tjenesteopdagelse og en gyldig `401`-udfordring bekræfter kun disse faser. Sammenlign fase, tidspunkt og `X-Request-ID` med loggene `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` og `remote_mcp.rpc_result`. Hold OAuth-koder, tokens, cookies, PKCE-verifikatorer, kilder og bruger-ID'er ude af logfiler og sager.
> - **Godkendelsen virker, men handlingerne bliver ikke fundet.** Kontroller `initialize`, initialiseringsmeddelelsen og `tools/list` særskilt efter tokenudstedelsen. HTTP `200` kan også ledsage en JSON-RPC-`error`. `remote_mcp.rpc_result` logger HTTP-status, resultatklasse, protokolversion, antal værktøjer, svarstørrelse i byte og listens grundstruktur. Inspektionsbufferen har en grænse på 256 KiB. Overskrides den, logges kun `inspection_limited`, og svaret forbliver uændret. Et SSE-svar eller en `GET`-anmodning, der returnerer `405`, er ikke i sig selv nok til at fastslå en fejl. Kontroller `Accept`, `Content-Type`, protokolforhandlingen og om forespørgslerne når frem fra proxyen. Kontroller ekstern OIDC, Cloudflare-politikker og en reel ChatGPT-konto særskilt i produktion.

## MCP-resultater og ressourcer {#mcpの結果とresource}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Svar fra Remote MCP består af tre lag.
> 1. **Almindeligt `content`.** Indeholder input- og job-ID, status, forskydning, markør, tilgængelighed og afgrænset diagnostik til at træffe beslutninger og kalde næste værktøj. Selv klienter uden `structuredContent` eller særlige ressourcer kan oprette og rette input og rendere igen.
> 2. **`structuredContent`.** Indeholder hele det validerede objekt til maskinel behandling.
> 3. **MCP-ressourcer (`latex-renderer://jobs/...`).** Indeholder store datamængder som PDF, fuld `compile.log`, rå JSON, `svg/manifest.json` og `svg/objects/*.svg`. De kan kun læses af samme OAuth-ejer. Der gælder samme størrelses- og opbevaringsgrænser som for almindelige filer. Alle lag udelader API-nøgler, OAuth-tokens, billetter, kildetekst og rå base64.

## Ventetid og nye forsøg i CLI {#cliの待機と再試行}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Hvis en statusforespørgsel får en forbigående HTTP-fejl `502`, `503`, `504` eller ugyldig JSON, gentager CLI kun statuskontrollen for det samme job **højst 5 gange** med 1, 2, 4, 8 og 8 sekunders ventetid uden at forlænge den samlede ventetid. Oprettelse af job, upload, tokenfornyelse og filverifikation gentages ikke automatisk. Godkendelses- og rettighedsfejl returneres straks. Når CLI holder op med at vente, kan jobbet stadig køre på serveren.

## CLI's JSON-format {#cliのjson形式}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Med `--json` bruges følgende formater på standardoutput. API-nøglen, `uploadTicket` og `jobTicket` udelades.
>
> - **Succes (afslutningskode `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI- eller API-fejl (afslutningskode `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Job afsluttet med fejl, f.eks. en LaTeX-fejl (afslutningskode `2`).** `result` indeholder jobdata og gemte stier. Svaret indeholder `success: false`.

## Migrering og gendannelse af tidligere versioner {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrer et ældre opdateringsværktøj, og løs udpakningsfejl
>
> ### Migrer fra root-opdateringsværktøjet i v1.2.x til adskilte rettigheder {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Til og med v1.2.x kørte Update Manager som en root-dæmon. Fra v1.3.0 kører den permanente controller som `latex-renderer-update`, og en kortlivet hjælpeproces med root-rettigheder modtager faste handlinger. En webopdatering fra et gammelt værktøj kan stoppe med `Application Update Manager must use a separate non-root build tree`. Gentag ikke den samme handling fra webgrænsefladen.
>
> Brug [serverdistributionen v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6) til denne engangsmigrering. Følg som almindelig bruger [Hent og verificer distributionen](/da/docs/self-hosting/#v1-6-9をダウンロードして検証), og skift den første linje `version=` til `version=1.3.6`. Brug samme terminal for at bevare `bundle_root` fra verificeringen og udpakningen.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Scriptet henter som root igen samme uforanderlige version og verificerer kontrolsum, tag/commit, Sigstore-pakke, arkivgrænser og metadata. Kun `gh` i `/usr/local/bin/gh` eller `/usr/bin/gh` med root som ejer og uden skriveadgang for gruppe eller andre accepteres. Det adskiller det root-ejede træ `verified`, `bootstrap-build` uden root-rettigheder (fast pnpm via en dedikeret Corepack-wrapper) og det root-ejede `assembly`. Den forrige administrationstjeneste stoppes først, når den fælles ændringslås er taget, og genstartes ved fejl. Kontroller derefter `User=latex-renderer-update` og status `active` for hver tjeneste med følgende kommandoer. Brug derefter almindelig opdatering via web eller administrations-CLI.
> Webappen og API'et får ikke sudo-rettigheder eller GitHub-tokens.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar stopper udpakningen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Hvis GNU `tar` på Ubuntu bruger `openat2`, kan opdateringsværktøjets begrænsning `RestrictSUIDSGID=true` stoppe udpakning af arkiver med undermapper med `ENOSYS` (Function not implemented). Det rettede værktøj bevarer kontrollen med GNU `tar` og verifikationen af signaturen. Kun udpakning flyttes til `/usr/bin/bsdtar` i en tom privat, midlertidig mappe uden at overtage ejere, ACL'er eller udvidede attributter. `RestrictSUIDSGID` og systemets `tar` bevares.
>
> Det gamle opdateringsværktøj kan også fejle under udpakning af sin egen rettelse. Kontroller, at ingen handlinger er i gang, at applikationen og databasen fungerer, og at en krypteret kopi er verificeret. Brug det installerede `bootstrap-v1` til **først udelukkende at opdatere det separate opdateringsværktøj** til en offentliggjort version med rettelsen.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Kontroller værktøjets nye version samt `ready` og `pending=false`. Installér derefter samme applikationsversion via web eller den almindelige kommando `update apply` i administrations-CLI.
>
> I opdateringsværktøjet `v1.4.0-rc.3` findes en kendt fejl, hvor root-kopieringen af pakken bevarer den uprivilegerede ejer og fejler med `Release extraction requires a private regular bundle`. Bevar kontrollerne, opdater først værktøjet til en offentliggjort version med rettet ejerskab, og installer derefter applikationen. Du kan afprøve udpakningen under root og systemd særskilt med `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Undersøg låse ved opdateringer eller TeX-ændringer
>
> ### Ændringslåsen er i brug {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` forhindrer en applikationsopdatering og en TeX-ændring i at overlappe. Vent på den aktive handling. **Slet aldrig filen `/run/latex-renderer/mutation.lock`.** Ellers kan to uafhængige låse eksistere samtidig. Opstår det ved intern gendannelse af et TeX-miljø under opdatering, kan handlingen konkurrere med sig selv. Kontroller logge og stoppede tjenester før næste forsøg.
>
> Kun hvis ingen handlinger kører, og loggen bekræfter, at den tidligere er afsluttet, skal du stoppe begge administrationstjenester og undersøge den proces, som holder låsen.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Afslut kun processen og genstart tjenesterne, hvis du har bekræftet, at den er en efterladt låsehjælpeproces fra en afsluttet handling.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Rendereridentitet i tidligere udgivelseskandidater {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Kandidater til v1.3.4
>
> Opdateringen fra `v1.3.4-rc.3` til `v1.3.4-rc.4` fejlede før skiftet af tjenester, da antallet af filer i rendererens identitetshash steg fra 5 til 6. Brug `v1.3.4-rc.5` til denne migrering. Den indeholder også de tidligere kompatibilitetsdata. Kontrolsummen for hele pakken og oprindelsessignaturen verificerer også den tilføjede fil.

## Opdateringsværktøjets kørselsmiljøer {#updaterの実行領域}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Update Manager adskiller det root-ejede træ `verified` med den verificerede distribution, `build` uden root til afhængigheder og bygning og det root-ejede `assembly` med tilladte resultater. Udrulningsscripts, som kører under root, bruger altid den verificerede kopi fra `assembly`. Til trin som offentliggørelse på Cloudflare med udrulningsbrugeren bruges en midlertidig kopi `deployment-build` efter roots kontroller. Det gælder også ved tilbagerulning.

## Installationsstier og beskyttelse i Windows {#windowsの配置と保護}

> [!DETAILS] Specifikationer og fremgangsmåder
>
> Ved ændring af installationsstedet i Windows bliver undermappen `bin` standardkommandomappe. Angiver du `LATEX_RENDER_BIN_DIRECTORY`, placeres de administrerede startfiler dér, og brugerens PATH og Local MCP bruger samme sti. Alternative startfiler bevares. `setup repair` kan rette den tidligere registrerede sti. Den gamle PATH-post bevares til andre programmer. Brug absolutte stier uden semikoloner, anførselstegn eller kontroltegn. Hvis `--open` eller den grafiske grænseflade ikke kan åbne en browser eller fremviser, bevares den gemte PDF-fil.

## Deling af projekter og opbevaring {#保存プロジェクトの共有-保持}

> [!DETAILS] Regler for deling og opbevaring
>
> - Webappen (`/app/`), CLI, det offentlige API, Local MCP og Remote MCP deler hver brugers projekter og historik med uforanderlige revisioner. Flere API-nøgler eller tjenestekonti for samme bruger kan læse og opdatere dem. Du kan også bruge midlertidige input og job uden at gemme dem i et projekt.
> - Kombinationen af input, hoveddokument, motor og outputformater identificerer revisionen. Revisioner med forskelligt output kan dele input. Formater valgt under **Konverter igen** gælder kun for den pågældende kørsel. Vælg de oprindelige indstillinger for at bruge revisionens gemte output.
> - Input med en reference fra en aktiv revision bevares ud over fristen for forældreløst input og tæller med i brugerens kvote. Sletning af et projekt skjuler posten. Når det sidste projekt med reference er slettet, og de tilknyttede job er væk, mister inputtet sin beskyttelse og fjernes ved periodisk oprydning efter udløb. Kontakt administratoren for fuldstændig sletning med det samme.

## Grænsefladesprog {#表示言語}

Editoren gemmer **Visningssprog** på kontoen. Hvis der ikke er valgt et sprog, prøves browserens sprog i rækkefølge med engelsk som reserve, hvis ingen understøttes. Dokumentets motor og tegnkodning konfigureres separat.

| Område | Oversættelsesdækning |
| --- | --- |
| Web og opsætning | Handlinger, kørselsstatus, bekræftelser og diagnostik. |
| CLI og MCP | CLI-hjælp og spørgsmål bruger terminalens sprog. Fjern-MCP-beskrivelser bruger kontoens sprog. |
| Editor | Redigering, søgning og erstatning, lagring og konflikter, kompileringsstatus og betjening af forhåndsvisninger findes på 18 sprog. |
| Offentlige vejledninger | Alle vejledninger findes på de 18 sprog nedenfor. Skift sprog med menuen øverst på siden. |

Editoren understøtter engelsk, japansk, forenklet kinesisk, koreansk, spansk, portugisisk, fransk, tysk, italiensk, russisk, tyrkisk, polsk, tjekkisk, nederlandsk, svensk, norsk bokmål, dansk og finsk. Logfiler fra TeX og eksterne pakker bevarer originalteksten til fejlfinding.

## Gendan revisionslogge {#監査ログの復旧}

Efter gendannelse af databasen kan eksportpositionen (`export_database_id`, rækkefølgen af rækker `export_sequence` og `export_token`) afvige fra dens tilstand. I så fald standses eksport og oprydning for at beskytte data.

1. Stop tjenester og timere for eksport og oprydning under undersøgelsen og gendannelsen.
2. Bevar den gendannede database, eksisterende krypterede eksporter og alle nuværende og ældre kontrolpunktfiler separat. Kontroller integritet, fremmednøgler og migreringstilstand i den gendannede database.
3. Hvis der ikke findes et kompatibelt kontrolpunkt, og du vil eksportere de tilgængelige rækker igen, skal du flytte kontrolpunktfilerne væk fra de aktive stier. Kontroller også stien til `AUDIT_EXPORT_CHECKPOINT`, hvis den er angivet. Bevar revisionsrækkerne, SQLite-sekvenserne og `export.lock`.
4. Udfør en manuel eksport med produktionstjenestens loginoplysninger. Kontroller, at outputtet kan dekrypteres, og at et nyt kontrolpunkt i format 3 er oprettet, før du genstarter timerne.

Kun rækker, som er til stede i den gendannede database, bliver eksporteret igen. Brug `export_database_id`, `export_sequence` og `export_token` sammen for at identificere dubletter. Dato og klokkeslæt identificerer ikke alene en række.
