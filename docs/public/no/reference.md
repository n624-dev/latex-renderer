---
slug: reference
category: Drift og utvikling
title: Referanse for drift og utvikling
description: Lagring og gjenoppretting av klientutdata, MCP-autentisering og migrering av eldre installasjoner.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Lagre og gjenopprett resultater {#成果物の保存-復旧の仕様}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> - **Atomisk katalogbytte.** CLI og Local MCP beholder stier som `.render/result.pdf`, `job.json` og forhåndsvisningene. De kontrollerer oppgitt størrelse og SHA-256 for alle filer og bytter katalog når settet er komplett. Katalogen kan være borte et øyeblikk under byttet. Eksterne programmer bør lese den først etter at kommandoen er ferdig.
> - **Automatisk gjenoppretting.** En katalog med navnet `<output-name>.latex-renderer-state` ved siden av utdatamappen lagrer gjenopprettingstilstanden og utelates ved innsamling av inndata. Ved vanlig avslutning slettes midlertidige data. Etter tvungen avslutning gjenoppretter neste nedlasting det gamle settet hvis byttet ikke ble bekreftet. Etter bekreftet bytte beholdes det nye settet, og det gamle ryddes bort. Ikke slett tilstandskatalogen under operasjonen eller før gjenoppretting.
> - **Låsing og avvik.** Samtidige skrivinger til samme mål stoppes med `OUTPUT_BUSY`. Medgått tid alene fortrenger ikke en aktiv prosess. Ved gjenbruk av PID stoppes operasjonen for sikkerhets skyld. Skadde metadata, ukjente filer eller eksterne lenker må undersøkes før noe slettes.
> - **Brukerfiler og grenser.** Vanlige brukerfiler kopieres til det nye settet. Oppdages en redigering under nedlasting, avbrytes publiseringen og endringen beholdes. Bruk helst et eget mål. Hvert sett kan inneholde inntil 1 GiB og 10 000 oppføringer. Det må være plass til begge settene og midlertidige data. Bare lokale filsystemer støttes. Stier med symbolske lenker, harde lenker eller monteringer fra andre filsystemer avvises. Låsing på nettverksressurser og full atomisitet ved strømbrudd er ikke garantert. I Windows beholdes forrige sett hvis en åpen fil blokkerer byttet.

## Tilgangsgrenser for nettappen {#web認証の境界}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Serverøkter beskytter `/app/`, `/admin/` og tilhørende API-er. De er ikke med i den offentlige søkeindeksen. Vanlige brukere bruker `/app/`, mens bare administratorer og eiere får tilgang til `/admin/`. Identiteten bestemmes av `issuer + subject` fra den eksterne leverandøren eller `login name` ved passordinnlogging. E-post og visningsnavn er ikke autentiseringsnøkler. ZIP-opplasting, jobber, utdatafiler og TeX-kompilering går gjennom rendereren på serveren.
>
> > [!NOTE]
> > Nettleseren lagrer ikke kortlivede billetter permanent. Serverøkten utsteder nye ved behov. Ikke del informasjonskapsler for økter, CSRF-token eller billetter.

## Registrering og diagnostikk for Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> - **Dynamisk klientregistrering (DCR).** Ufullførte eller inaktive registreringer ryddes vanligvis etter 30 dager. Registreringer som gyldige autorisasjonskoder eller tokenfamilier viser til, er beskyttet. Global grense er 10 000. Får du `invalid_client` etter opprydding, registrer klienten på nytt. Standard DCR-forespørsler uten klientnavn støttes, med fortsatt validering av navn og omdirigerings-URI.
> - **Midlertidige autorisasjonsforespørsler (skjema 20).** Hvis det kreves innlogging underveis, lagres forespørselen med en kort tilfeldig ID. Dermed kan den hentes uten å legge den lange OAuth-verdien `state` i returadressen. Den er gyldig i 10 minutter og kan brukes én gang når den innloggede nettleseren og den dedikerte informasjonskapselen samsvarer. Samtidige faner får ulike ID-er. Globalt er det høyst 1 000 forespørsler, og hver nettleser kan ha 8 fortsettelseskapsler. Ved grensen returneres `503`, og eksisterende forespørsler beholdes. Databasen lagrer bare hashverdier for ID og kapsel. Verken omstart eller gjenoppretting fra kopi forlenger gyldigheten.
> - **IP-grenser og opphavshoder.** DCR tillater 10 registreringer per klarert kilde-IP på 15 minutter. Klienter bak samme utgående proxy deler kvoten. Fra forsøk 11 returneres HTTP `429`, `temporarily_unavailable` og `Retry-After`. Ugyldige metadata bruker ikke kvote. Hvis IP-en mangler eller er ugyldig, returneres `503` slik at operatøren undersøker proxyen, uten å samle uidentifiserte klienter i én gruppe. Hold tjenerdelen på loopback og konfigurer proxyen til å erstatte `X-Latex-Renderer-Client-IP` med faktisk adresse. Vilkårlige `X-Forwarded-For`-verdier ignoreres. På Cloudflare-ruter behandles også `CF-Connecting-IP` innenfor tillitsgrensen.
> - **Administrativ tilkoblingskontroll.** Følgende kommando tester offentlig tjenesteoppdagelse og Bearer-utfordringen `401` uten å sende påloggingsopplysninger, endre innstillinger, følge omdirigeringer eller vise svarinnhold, informasjonskapsler eller hemmeligheter.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Avgrens feilen etter fase.** Et riktig `200` ved oppdagelse og en riktig `401`-utfordring bekrefter bare disse stegene. Sammenlign fase, tidspunkt og `X-Request-ID` med loggene `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` og `remote_mcp.rpc_result`. Hold OAuth-koder, token, informasjonskapsler, PKCE-verifikatorer, kilder og bruker-ID-er utenfor logger og saker.
> - **Autentiseringen virker, men handlingene blir ikke funnet.** Kontroller `initialize`, initialiseringsmeldingen og `tools/list` separat etter at tokenet er utstedt. HTTP `200` kan også følge en `error` fra JSON-RPC. `remote_mcp.rpc_result` logger HTTP-status, resultatklasse, protokollversjon, antall verktøy, svarstørrelse i byte og listens grunnstruktur. Inspeksjonsbufferen er på høyst 256 KiB. Overskrides grensen, logges bare `inspection_limited` og svaret beholdes uendret. Et SSE-svar eller en `GET`-forespørsel som gir `405`, er alene ikke nok til å slå fast en feil. Kontroller `Accept`, `Content-Type`, protokollforhandlingen og om forespørslene når frem fra proxyen. Verifiser ekstern OIDC, Cloudflare-regler og en reell ChatGPT-konto separat i produksjon.

## MCP-resultater og ressurser {#mcpの結果とresource}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Remote MCP-svar har tre lag.
> 1. **Vanlig `content`.** Inneholder inndata- og jobb-ID, status, forskyvning, markør, tilgjengelighet og begrenset diagnostikk for å ta beslutninger og kalle neste verktøy. Også klienter uten `structuredContent` eller egendefinerte ressurser kan opprette og korrigere inndata og rendre på nytt.
> 2. **`structuredContent`.** Inneholder hele det validerte objektet for maskinell behandling.
> 3. **MCP-ressurser (`latex-renderer://jobs/...`).** Inneholder store data som PDF, hele `compile.log`, rå JSON, `svg/manifest.json` og `svg/objects/*.svg`. Bare samme OAuth-eier kan lese dem. De samme størrelses- og lagringsgrensene som for vanlige filer gjelder. Alle lag utelater API-nøkler, OAuth-token, billetter, kildetekst og rå base64.

## Ventetid og nye forsøk i CLI {#cliの待機と再試行}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Hvis en statusforespørsel får en forbigående HTTP-feil `502`, `503`, `504` eller ugyldig JSON, gjentar CLI bare statuskontrollen for samme jobb **høyst 5 ganger**, etter 1, 2, 4, 8 og 8 sekunder uten å forlenge samlet ventetid. Oppretting av jobber, opplasting, tokenfornyelse og verifisering av filer gjentas ikke automatisk. Autentiserings- og rettighetsfeil returneres straks. At CLI slutter å vente, betyr ikke at serveren har stoppet jobben.

## JSON-format for CLI {#cliのjson形式}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Med `--json` brukes følgende formater på standard utdata. API-nøkkelen, `uploadTicket` og `jobTicket` utelates.
>
> - **Vellykket (avslutningskode `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI- eller API-feil (avslutningskode `1`)**
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
> - **Jobben ble avsluttet med feil, for eksempel en LaTeX-feil (avslutningskode `2`).** `result` inneholder jobbdata og lagrede stier. Svaret inneholder `success: false`.

## Migrering og gjenoppretting av eldre versjoner {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrer eldre oppdateringsverktøy og løs utpakkingsfeil
>
> ### Migrer fra root-oppdatereren i v1.2.x til oppdateringsverktøyet med atskilte rettigheter {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Til og med v1.2.x kjørte Update Manager som en root-tjeneste. Fra v1.3.0 kjører den permanente kontrolleren som `latex-renderer-update`, og en kortlivet root-hjelpeprosess tar imot faste operasjoner. En nettoppdatering fra det eldre verktøyet kan stoppe med `Application Update Manager must use a separate non-root build tree`. Ikke gjenta samme operasjon fra nettgrensesnittet.
>
> Bruk [serverdistribusjonen v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6) for denne engangsmigreringen. Som vanlig bruker følger du [Last ned og verifiser distribusjonen](/no/docs/self-hosting/#v1-6-9をダウンロードして検証) og erstatter første linje `version=` med `version=1.3.6`. Bruk samme terminal slik at `bundle_root` fra verifiseringen og utpakkingen beholdes.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Skriptet laster som root på nytt ned samme uforanderlige versjon og verifiserer kontrollsum, tagg/commit, Sigstore-pakke, arkivgrenser og metadata. Det godtar bare `gh` i `/usr/local/bin/gh` eller `/usr/bin/gh` eid av root og uten skrivetilgang for gruppe eller andre. Det skiller mellom det root-eide treet `verified`, `bootstrap-build` uten root-rettigheter (fast pnpm via en dedikert Corepack-mellomkommando) og root-eid `assembly`. Det stopper gammel administrasjonstjeneste først etter at felles endringslås er tatt, og starter den på nytt ved feil. Etterpå kontrollerer du `User=latex-renderer-update` og status `active` for hver tjeneste med følgende kommandoer. Deretter bruker du vanlige oppdateringer fra nett eller administrasjons-CLI.
> Nettappen og API-et får ikke sudo-rettigheter eller GitHub-token.
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
> ### GNU tar avbryter utpakkingen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Hvis GNU `tar` i Ubuntu bruker `openat2`, kan begrensningen `RestrictSUIDSGID=true` i oppdateringsverktøyet stoppe utpakking av arkiver med underkataloger med `ENOSYS` (Function not implemented). Det korrigerte verktøyet beholder inspeksjon med GNU `tar` og signaturkontroll. Bare utpakkingen flyttes til `/usr/bin/bsdtar`, i en tom privat midlertidig katalog, uten å overta eiere, ACL-er eller utvidede attributter. `RestrictSUIDSGID` og systemets `tar` beholdes.
>
> Det gamle verktøyet kan også mislykkes med å pakke ut sin egen rettelse. Kontroller at ingen operasjoner pågår, at applikasjonen og databasen er i orden, og at en kryptert kopi er verifisert. Bruk installert `bootstrap-v1` til å **oppdatere bare det separate oppdateringsverktøyet først** til en publisert versjon med rettelsen.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Kontroller den nye verktøyversjonen og verdiene `ready` og `pending=false`. Installer så samme applikasjonsversjon via nettgrensesnittet eller den vanlige kommandoen `update apply` i administrasjons-CLI.
>
> Oppdateringsverktøyet `v1.4.0-rc.3` har et kjent problem der root-kopieringen av pakken beholder den uprivilegerte eieren og feiler med `Release extraction requires a private regular bundle`. Behold kontrollene, oppdater først verktøyet til en publisert versjon som retter eierskapet, og oppdater deretter applikasjonen. Du kan teste utpakkingen under root og systemd separat med `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Undersøk låser ved oppdatering eller TeX-endring
>
> ### Endringslåsen er i bruk {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` hindrer en applikasjonsoppdatering og en TeX-endring i å overlappe. Vent til den aktive operasjonen er ferdig. **Slett aldri filen `/run/latex-renderer/mutation.lock`.** Sletting kan tillate to uavhengige låser samtidig. Hvis feilen oppstår ved intern gjenoppretting av et TeX-miljø under oppdatering, kan operasjonen konkurrere med seg selv. Kontroller logger og stoppede tjenester før nytt forsøk.
>
> Bare hvis ingen operasjon pågår og loggen bekrefter at den forrige ble ferdig, stopper du begge administrasjonstjenestene og undersøker prosessen som holder låsen.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Avslutt prosessen og start tjenestene på nytt bare hvis du har bekreftet at det er en foreldreløs låsehjelpeprosess fra en avsluttet operasjon.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Rendereridentitet i eldre utgivelseskandidater {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Kandidater for v1.3.4
>
> Oppdateringen fra `v1.3.4-rc.3` til `v1.3.4-rc.4` mislyktes før tjenestebyttet da antallet filer i identitetshashen til rendereren økte fra 5 til 6. For den migreringen bruker du `v1.3.4-rc.5`, som også inneholder eldre kompatibilitetsdata. Kontrollsummen for hele pakken og opphavssignaturen verifiserer også filen som ble lagt til.

## Kjøremiljøer for oppdateringsverktøyet {#updaterの実行領域}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Update Manager skiller strengt mellom det root-eide treet `verified` med verifisert distribusjon, `build` uten root til installasjon av avhengigheter og bygging, og root-eid `assembly` med tillatte resultater. Utrullingsskript som kjøres som root, bruker alltid den verifiserte kopien fra `assembly`. For trinn som publisering til Cloudflare med utrullingsbrukeren brukes en midlertidig kopi `deployment-build` etter root-kontrollene. Det samme gjelder ved tilbakerulling.

## Installasjonsstier og beskyttelse i Windows {#windowsの配置と保護}

> [!DETAILS] Spesifikasjoner og fremgangsmåter
>
> Når installasjonsstedet i Windows endres, blir underkatalogen `bin` standard kommandokatalog. Angir du `LATEX_RENDER_BIN_DIRECTORY`, plasseres administrerte startfiler der, og brukerens PATH og Local MCP bruker samme sti. Alternative startfiler beholdes. `setup repair` kan rette den tidligere registrerte stien. Den gamle PATH-oppføringen beholdes for andre programmer. Bruk absolutte stier uten semikolon, anførselstegn eller kontrolltegn. Hvis `--open` eller det grafiske grensesnittet ikke kan åpne nettleser eller visningsprogram, beholdes den lagrede PDF-filen.

## Delte prosjekter og lagring {#保存プロジェクトの共有-保持}

> [!DETAILS] Regler for deling og lagring
>
> - Nettappen (`/app/`), CLI, det offentlige API-et, Local MCP og Remote MCP deler prosjekter og historikken med uforanderlige revisjoner per bruker. Flere API-nøkler eller tjenestekontoer for samme bruker kan lese og oppdatere dem. Du kan også bruke midlertidige inndata og jobber uten å lagre dem i et prosjekt.
> - Kombinasjonen av inndata, hoveddokument, motor og utdataformater identifiserer revisjonen. Revisjoner med ulike utdata kan dele inndata. Formatene som velges under **Konverter på nytt**, gjelder bare denne kjøringen. Velg opprinnelige innstillinger for å bruke utdataene som er lagret på revisjonen.
> - Inndata som en aktiv revisjon viser til, beholdes etter fristen for foreldreløse inndata og teller mot brukerens kvote. Når et prosjekt slettes, skjules oppføringen. Når siste prosjekt som viser til inndataene er slettet og tilknyttede jobber er borte, mister inndataene beskyttelsen. De ryddes ved periodisk opprydding når tiden er utløpt. Kontakt administratoren for umiddelbar, fullstendig sletting.

## Grensesnittspråk {#表示言語}

Redigeringsverktøyet lagrer **Visningsspråk** på kontoen. Mangler innstillingen, prøver det nettleserens språk i rekkefølge og bruker engelsk hvis ingen støttes. Dokumentmotor og tegnkoding stilles inn separat.

| Område | Oversettelsesdekning |
| --- | --- |
| Nett og oppsett | Handlinger, kjørestatus, bekreftelser og diagnostikk. |
| CLI og MCP | CLI-hjelp og spørsmål bruker terminalspråket. Beskrivelser i ekstern MCP bruker kontospråket. |
| Redigeringsverktøy | Redigering, søk og erstatt, lagring og konflikter, kompileringsstatuser og forhåndsvisningskontroller er tilgjengelige på 18 språk. |
| Offentlige veiledninger | Alle veiledningene er tilgjengelige på de 18 språkene nedenfor. Bytt språk i menyen øverst på siden. |

Redigeringsverktøyet støtter engelsk, japansk, forenklet kinesisk, koreansk, spansk, portugisisk, fransk, tysk, italiensk, russisk, tyrkisk, polsk, tsjekkisk, nederlandsk, svensk, norsk bokmål, dansk og finsk. Logger fra TeX og eksterne pakker beholder originalteksten av hensyn til feilsøkingen.

## Gjenopprett revisjonslogger {#監査ログの復旧}

Etter gjenoppretting av databasen kan eksportposisjonen (`export_database_id`, radsekvensen `export_sequence` og `export_token`) avvike fra databasens tilstand. Da stoppes eksport og opprydding for å beskytte dataene.

1. Stopp eksport- og oppryddingstjenester og tilhørende tidsur under undersøkelse og gjenoppretting.
2. Bevar den gjenopprettede databasen, eksisterende krypterte eksporter og alle nåværende og eldre kontrollpunktfiler separat. Verifiser integritet, fremmednøkler og migreringstilstand i den gjenopprettede databasen.
3. Hvis det ikke finnes et kompatibelt kontrollpunkt og du velger å eksportere de tilgjengelige radene på nytt, flytt kontrollpunktfilene utenfor aktive stier. Kontroller også stien for `AUDIT_EXPORT_CHECKPOINT` hvis den er satt. Behold revisjonsradene, SQLite-sekvenser og `export.lock`.
4. Kjør en manuell eksport med påloggingsopplysningene for produksjonstjenesten. Kontroller at utdataene kan dekrypteres og at det er opprettet et nytt kontrollpunkt i format 3, før du starter tidsurene på nytt.

Bare radene som faktisk finnes i den gjenopprettede databasen, eksporteres på nytt. Bruk `export_database_id`, `export_sequence` og `export_token` sammen for å finne duplikater. Dato og klokkeslett alene identifiserer ikke en rad.
