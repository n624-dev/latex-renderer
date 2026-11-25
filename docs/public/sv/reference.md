---
slug: reference
category: Drift och utveckling
title: Referens för drift och utveckling
description: Läs om lagring och återställning i klienten, MCP-autentisering och migreringsprocedurer.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Lagra och återställ resultat {#成果物の保存-復旧の仕様}

> [!DETAILS] Specifikationer och procedurer
>
> - **Atomärt katalogbyte.** CLI och Local MCP bevarar sökvägar som `.render/result.pdf`, `job.json` och förhandsvisningarna. Alla filers angivna storlek och SHA-256 verifieras före bytet till den fullständiga katalogen. Under bytet kan katalogen saknas ett ögonblick. Externa program bör läsa den först när kommandot avslutats.
> - **Automatisk återställning.** En katalog med namnet `<output-name>.latex-renderer-state` bredvid utdatamappen sparar återställningstillstånd och utesluts när indata samlas in. Vid normalt avslut rensas tillfälliga data. Efter ett påtvingat avslut återställer nästa hämtning den tidigare uppsättningen om bytet inte bekräftats. Hade det bekräftats behålls den nya och den tidigare rensas. Ta inte bort tillståndskatalogen under åtgärden eller före återställningen.
> - **Låsning och avvikelser.** Samtidig skrivning till samma mål stoppas med `OUTPUT_BUSY`. Enbart förfluten tid tränger inte undan en aktiv process. Vid återanvändning av PID stoppas åtgärden av försiktighetsskäl. Skadade metadata, okända filer eller externa länkar måste granskas före borttagning.
> - **Användarfiler och gränser.** Vanliga användarfiler kopieras till den nya uppsättningen. Om en ändring märks under hämtningen avbryts publiceringen och ändringen bevaras. Använd helst en separat målkatalog. Varje uppsättning får vara högst 1 GiB och innehålla 10 000 poster. Det ska finnas utrymme för båda samt tillfälliga data. Bara lokala filsystem stöds. Sökvägar med symboliska länkar, hårda länkar eller monteringar från andra filsystem avvisas. Låsning på nätverksenheter och full atomicitet vid strömavbrott garanteras inte. Om en öppen fil blockerar bytet i Windows behålls den tidigare uppsättningen.

## Webbautentiseringens gränser {#web認証の境界}

> [!DETAILS] Specifikationer och procedurer
>
> Serversessioner skyddar `/app/`, `/admin/` och deras API:er. De ingår inte i det publika sökindexet. Vanliga användare använder `/app/` och endast administratörer och ägare kommer åt `/admin/`. Identiteten bestäms av `issuer + subject` från den externa leverantören eller `login name` vid lösenordsautentisering. E-post och visningsnamn är inte autentiseringsnycklar. ZIP-uppladdningar, jobb, utdatafiler och TeX-kompilering går via serverns renderare.
>
> > [!NOTE]
> > Webbläsaren lagrar inte kortlivade biljetter permanent. Serversessionen utfärdar nya vid behov. Dela inte sessionskakor, CSRF-token eller biljetter.

## Registrering och diagnostik för Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specifikationer och procedurer
>
> - **Dynamisk klientregistrering (DCR).** Oavslutade eller inaktiva registreringar rensas normalt efter 30 dagar. Registreringar som giltiga auktoriseringskoder eller tokenfamiljer hänvisar till skyddas. Den globala gränsen är 10 000. Vid `invalid_client` efter rensning, registrera klienten på nytt. Standardförfrågningar för DCR utan klientnamn stöds, med fortsatt validering av namn och omdirigerings-URI.
> - **Tillfälliga auktoriseringsförfrågningar (schema 20).** Om en inloggning behövs på vägen sparas begäran med ett kort slumpmässigt ID så att den kan hämtas utan att lägga den långa OAuth-parametern `state` i returadressen. Den gäller i 10 minuter och kan användas en gång om den inloggade webbläsaren och den särskilda kakan matchar. Samtidiga flikar har olika ID:n. Gränsen är 1 000 begäranden totalt och högst 8 fortsättningskakor per webbläsare. Vid gränsen returneras `503` och befintliga förfrågningar behålls. I databasen sparas endast hashvärden för ID och kaka. Omstart eller återläsning av kopior förlänger inte giltigheten.
> - **IP-gränser och ursprungshuvuden.** DCR tillåter 10 registreringar per betrodd käll-IP under 15 minuter. Klienter bakom samma utgående proxy delar kvot. Från försök 11 returneras HTTP `429`, `temporarily_unavailable` och `Retry-After`. Ogiltiga metadata förbrukar inte kvot. Om IP-adressen saknas eller är ogiltig returneras `503` så att operatören kan kontrollera proxyn, utan att okända klienter grupperas. Behåll backend på loopbackgränssnittet och konfigurera proxyn att ersätta `X-Latex-Renderer-Client-IP` med den riktiga adressen. Godtyckliga `X-Forwarded-For`-värden ignoreras. På Cloudflare-vägar hanteras även `CF-Connecting-IP` inom förtroendegränsen.
> - **Administrativ anslutningskontroll.** Följande kommando kontrollerar publik tjänsteidentifiering och Bearer-utmaningen `401` utan att skicka inloggningsuppgifter, ändra inställningar, följa omdirigeringar eller visa svarsinnehåll, kakor eller hemligheter.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Avgränsa felet per fas.** Ett korrekt `200` för identifiering och en riktig `401`-utmaning bekräftar bara de stegen. Jämför fas, tid och `X-Request-ID` med loggarna `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` och `remote_mcp.rpc_result`. Lägg inte OAuth-koder, token, kakor, PKCE-verifierare, källor eller användar-ID:n i loggar eller ärenden.
> - **Autentiseringen fungerar men åtgärderna hittas inte.** Kontrollera `initialize`, initialiseringsmeddelandet och `tools/list` separat efter tokenutfärdandet. HTTP `200` kan förekomma även med ett `error` från JSON-RPC. `remote_mcp.rpc_result` loggar HTTP-status, resultatklass, protokollversion, antal verktyg, svarsstorlek i byte och listans grundstruktur. Granskningsbufferten begränsas till 256 KiB. Över den gränsen registreras bara `inspection_limited` och svaret förblir oförändrat. Ett SSE-svar eller en `GET`-förfrågan som returnerar `405` räcker inte för att konstatera ett fel. Kontrollera `Accept`, `Content-Type`, protokollförhandlingen och om anropen når fram från proxyn. Verifiera separat extern OIDC, Cloudflare-regler och ett riktigt ChatGPT-konto i produktion.

## MCP-resultat och resurser {#mcpの結果とresource}

> [!DETAILS] Specifikationer och procedurer
>
> Remote MCP:s svar har tre lager.
> 1. **Vanligt `content`.** Innehåller ID för underlag och jobb, status, offset, markör, tillgänglighet och begränsad diagnostik för beslut och nästa verktygsanrop. Även klienter utan `structuredContent` eller egna resurser kan skapa, rätta och rendera på nytt.
> 2. **`structuredContent`.** Innehåller hela det validerade objektet för maskinell behandling.
> 3. **MCP-resurser (`latex-renderer://jobs/...`).** Innehåller stora datamängder som PDF, hela `compile.log`, rå JSON, `svg/manifest.json` och `svg/objects/*.svg`. Endast samma OAuth-ägare får läsa dem. Samma storleks- och lagringsgränser gäller som för vanliga filer. Alla lager utelämnar API-nycklar, OAuth-token, biljetter, källtext och rå base64.

## Väntetider och nya försök i CLI {#cliの待機と再試行}

> [!DETAILS] Specifikationer och procedurer
>
> Om en statusfråga får ett tillfälligt HTTP-fel `502`, `503`, `504` eller ogiltig JSON, upprepar CLI endast frågan om samma jobb **högst 5 gånger** med väntetiderna 1, 2, 4, 8 och 8 sekunder utan att förlänga den totala väntetiden. Skapande av jobb, uppladdning, tokenförnyelse och filverifiering upprepas inte automatiskt. Autentiserings- och behörighetsfel returneras omedelbart. Att CLI slutar vänta betyder inte att jobbet har stoppats på servern.

## CLI:s JSON-format {#cliのjson形式}

> [!DETAILS] Specifikationer och procedurer
>
> Med `--json` används följande format på standardutdata. API-nyckeln, `uploadTicket` och `jobTicket` utelämnas.
>
> - **Lyckat resultat (slutkod `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI- eller API-fel (slutkod `1`)**
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
> - **Jobbet slutfört med fel, till exempel ett LaTeX-fel (slutkod `2`).** `result` innehåller jobbdata och sparade sökvägar. Svaret innehåller `success: false`.

## Migrering och återställning av tidigare versioner {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrera en äldre uppdaterare och åtgärda uppackningsfel
>
> ### Migrera root-uppdateraren i v1.2.x till uppdateraren med delade behörigheter {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Till och med v1.2.x kördes Update Manager som en root-demon. Från v1.3.0 körs den permanenta styrenheten som `latex-renderer-update` och en kortlivad hjälpprocess som root tar emot fasta åtgärder. En webbuppdatering från den äldre uppdateraren kan stoppas med `Application Update Manager must use a separate non-root build tree`. Upprepa inte samma webbåtgärd.
>
> Använd [serverdistributionen för v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6) för denna engångsmigrering. Följ som vanlig användare [Hämta och verifiera distributionen](/sv/docs/self-hosting/#v1-6-9をダウンロードして検証) och ändra första raden `version=` till `version=1.3.6`. Använd samma terminal så att `bundle_root` från verifieringen och uppackningen finns kvar.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Skriptet hämtar om samma oföränderliga version som root och verifierar kontrollsumma, tagg/commit, Sigstore-paket, arkivgränser och metadata. Endast `gh` i `/usr/local/bin/gh` eller `/usr/bin/gh` godtas med root som ägare och utan skrivrätt för grupp eller andra. Det delar upp träden i root-ägt `verified`, `bootstrap-build` utan root-rättigheter (låst pnpm via en särskild Corepack-wrapper) och root-ägt `assembly`. Föregående hanterare stoppas först efter att ändringslåset tagits och startas på nytt vid fel. Verifiera därefter `User=latex-renderer-update` och status `active` för varje tjänst med följande kommandon. Använd sedan vanliga webbuppdateringar eller administratörens CLI.
> Webben och API:t får inte sudo-rättigheter eller GitHub-token.
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
> ### GNU tar avbryter uppackningen med Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Om GNU `tar` använder `openat2` i Ubuntu kan uppdaterarens begränsning `RestrictSUIDSGID=true` stoppa uppackning av arkiv med undermappar med `ENOSYS` (Function not implemented). Den korrigerade uppdateraren behåller granskningen med GNU `tar` och signaturverifieringen. Endast uppackningen flyttas till `/usr/bin/bsdtar` i en tom privat tillfällig katalog, utan att överta ägaruppgifter, ACL:er eller utökade attribut. `RestrictSUIDSGID` och systemets `tar` behålls.
>
> Den gamla uppdateraren kan också misslyckas med att packa upp sin egen rättning. Kontrollera att inga åtgärder pågår, att applikationen och databasen fungerar och att en krypterad kopia har verifierats. Använd installerat `bootstrap-v1` för att **först endast uppdatera den separata uppdateraren** till en publicerad version med rättningen.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Kontrollera den nya uppdaterarversionen samt `ready` och `pending=false`. Installera sedan samma applikationsversion via webben eller vanliga `update apply` i administrationsverktyget.
>
> Uppdateraren `v1.4.0-rc.3` har ett känt problem där roots kopia av paketet behåller ägaren utan root-behörighet och installationen misslyckas med `Release extraction requires a private regular bundle`. Behåll kontrollerna och uppdatera först uppdateraren till en publicerad version med rättat ägarskap och sedan applikationen. Du kan testa uppackningen under root och systemd separat med `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Undersök lås vid uppdatering eller TeX-ändringar
>
> ### Ändringslåset används {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` förhindrar att en applikationsuppdatering och en TeX-ändring överlappar. Vänta tills pågående åtgärd avslutats. **Radera aldrig filen `/run/latex-renderer/mutation.lock`.** Då kan två oberoende lås användas samtidigt. Om felet uppstår vid intern återställning av en TeX-miljö under uppdateringen kan åtgärden konkurrera med sig själv. Kontrollera loggar och stoppade tjänster innan du försöker igen.
>
> Endast om ingen åtgärd pågår och loggen bekräftar att den föregående avslutats, stoppa båda hanterarna och undersök processen som håller låset.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Avsluta processen och starta om hanterarna endast om du bekräftat att det är en kvarlämnad låshjälpprocess från en avslutad åtgärd.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Renderaridentitet i tidigare versionskandidater {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Versionskandidater för v1.3.4
>
> Uppdateringen från `v1.3.4-rc.3` till `v1.3.4-rc.4` misslyckades före tjänstebytet när antalet filer i renderarens identitetshash ökade från 5 till 6. Använd `v1.3.4-rc.5` för den migreringen. Där ingår även tidigare kompatibilitetsdata. Hela paketets kontrollsumma och härkomstsignatur verifierar även den tillagda filen.

## Uppdaterarens körmiljöer {#updaterの実行領域}

> [!DETAILS] Specifikationer och procedurer
>
> Update Manager skiljer strikt på det root-ägda trädet `verified` med verifierad distribution, `build` utan root för beroenden och bygge samt root-ägt `assembly` med tillåtna resultat. Driftsättningsskript som körs med root använder alltid den verifierade kopian från `assembly`. För steg som publicering till Cloudflare med driftsättningsanvändaren används en tillfällig kopia `deployment-build` efter roots kontroller. Samma sak gäller vid återgång.

## Installationssökvägar och skydd i Windows {#windowsの配置と保護}

> [!DETAILS] Specifikationer och procedurer
>
> Om installationsplatsen ändras i Windows blir undermappen `bin` standardkatalog för kommandon. Om `LATEX_RENDER_BIN_DIRECTORY` anges placeras hanterade startfiler där och användarens PATH och Local MCP använder samma sökväg. Alternativa startfiler behålls. `setup repair` kan korrigera en tidigare registrerad sökväg. Den gamla PATH-posten behålls för andra program. Använd absoluta sökvägar utan semikolon, citattecken eller styrtecken. Om `--open` eller det grafiska gränssnittet inte kan öppna webbläsaren eller visaren behålls den sparade PDF-filen.

## Delade projekt och lagring {#保存プロジェクトの共有-保持}

> [!DETAILS] Regler för delning och lagring
>
> - Webbappen (`/app/`), CLI, det publika API:t, Local MCP och Remote MCP delar varje användares projekt och historik med oföränderliga revisioner. Flera API-nycklar eller tjänstekonton för samma användare kan visa och uppdatera dem. Du kan även använda tillfälliga underlag och jobb utan att spara dem i ett projekt.
> - Kombinationen av underlag, huvuddokument, motor och utdataformat identifierar revisionen. Revisioner med olika utdata kan dela underlag. De format du väljer i **Konvertera igen** gäller endast den körningen. Välj ursprungliga inställningar för att använda revisionens sparade utdata.
> - Underlag som en aktiv revision hänvisar till behålls även efter tidsgränsen för föräldralösa underlag och räknas mot användarkvoten. När ett projekt tas bort döljs dess post. När det sista hänvisande projektet tagits bort och tillhörande jobb försvunnit förlorar underlaget sitt skydd och rensas periodiskt när tiden gått ut. Kontakta administratören om du kräver omedelbar fullständig radering.

## Gränssnittsspråk {#表示言語}

Redigeraren sparar **Visningsspråk** på kontot. Saknas inställningen prövas webbläsarens språk i ordning. Om inget stöds används engelska. Dokumentets motor och teckenkodning ställs in separat.

| Område | Översättningens omfattning |
| --- | --- |
| Webb och konfiguration | Åtgärder, körstatus, bekräftelser och diagnostik. |
| CLI och MCP | CLI-hjälp och frågor använder terminalens språk. Fjärranslutna MCP-beskrivningar använder kontots språk. |
| Redigerare | Redigering, sök och ersätt, sparande och konflikter, kompileringsstatus och förhandsvisningskontroller finns på 18 språk. |
| Publika guider | Alla guider finns på de 18 språken nedan. Byt språk via menyn högst upp på sidan. |

Redigeraren stöder engelska, japanska, förenklad kinesiska, koreanska, spanska, portugisiska, franska, tyska, italienska, ryska, turkiska, polska, tjeckiska, nederländska, svenska, norskt bokmål, danska och finska. Loggar från TeX och externa paket behåller originaltexten för diagnostik.

## Återställ granskningsloggar {#監査ログの復旧}

Efter databasåterställning kan exportpositionen (`export_database_id`, radsekvensen `export_sequence` och `export_token`) avvika från databasens tillstånd. Då stoppas export och rensning för att skydda uppgifterna.

1. Stoppa tjänster och timers för export och rensning under utredning och återställning.
2. Spara den återställda databasen, befintliga krypterade exporter och alla nuvarande och äldre kontrollpunktsfiler separat. Verifiera den återställda databasens integritet, främmande nycklar och migreringstillstånd.
3. Om det inte finns en kompatibel kontrollpunkt och du väljer att exportera de tillgängliga raderna igen, flytta kontrollpunktsfilerna utanför de aktiva sökvägarna. Kontrollera även sökvägen för `AUDIT_EXPORT_CHECKPOINT` om den är inställd. Behåll granskningsrader, SQLite-sekvenser och `export.lock`.
4. Kör manuell export med produktionstjänstens inloggningsuppgifter. Kontrollera att resultatet kan dekrypteras och att en ny kontrollpunkt i format 3 har skapats innan du startar om timrarna.

Endast rader som finns i den återställda databasen exporteras på nytt. Identifiera dubbletter genom att kombinera `export_database_id`, `export_sequence` och `export_token`. Datum och tid räcker inte för att identifiera en rad.
