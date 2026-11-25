---
slug: reference
category: Beheer en ontwikkeling
title: Naslag voor beheerders en ontwikkelaars
description: Lees hoe de client resultaten opslaat en herstelt, hoe MCP-authenticatie werkt en hoe je versies migreert.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Resultaten opslaan en herstellen {#成果物の保存-復旧の仕様}

> [!DETAILS] Specificaties en procedures
>
> - **Atomaire mapwisseling.** De CLI en Local MCP behouden paden zoals `.render/result.pdf`, `job.json` en de voorbeelden. Ze controleren de opgegeven grootte en SHA-256 van alle bestanden en wisselen de map pas als de set compleet is. Tijdens de wisseling kan de map even ontbreken. Laat externe programma's deze pas lezen nadat de opdracht is voltooid.
> - **Automatisch herstel.** Een map met de naam `<output-name>.latex-renderer-state` naast de uitvoermap bewaart de herstelstatus en wordt uitgesloten van de invoer. Bij normaal afsluiten worden tijdelijke gegevens opgeruimd. Na gedwongen afsluiten herstelt de volgende download de vorige set als de wisseling nog niet bevestigd was. Was dat wel zo, dan blijft de nieuwe set staan en wordt de oude opgeruimd. Verwijder de statusmap niet tijdens de bewerking of vóór herstel.
> - **Uitsluiting en afwijkingen.** Gelijktijdig schrijven naar dezelfde bestemming wordt gestopt met `OUTPUT_BUSY`. Alleen tijdsverloop verdringt geen actief proces. Bij hergebruik van een PID stopt de bewerking uit voorzorg. Onderzoek beschadigde metadata, onbekende bestanden of koppelingen naar buiten voordat je iets verwijdert.
> - **Gebruikersbestanden en limieten.** Gewone gebruikersbestanden worden naar de nieuwe set gekopieerd. Wordt tijdens het downloaden een wijziging gedetecteerd, dan wordt publicatie afgebroken en blijft de wijziging behouden. Gebruik bij voorkeur een afzonderlijke bestemming. Per set geldt maximaal 1 GiB en 10.000 items. Er moet ruimte zijn voor beide sets en tijdelijke gegevens. Alleen lokale bestandssystemen worden ondersteund. Paden met symbolische koppelingen, harde koppelingen of koppelingen naar andere aangekoppelde bestandssystemen worden geweigerd. Vergrendeling op netwerkschijven en volledige atomiciteit bij stroomuitval vallen buiten de garanties. Blokkeert een open bestand de wisseling op Windows, dan blijft de vorige set bewaard.

## Grenzen van webauthenticatie {#web認証の境界}

> [!DETAILS] Specificaties en procedures
>
> Serversessies beschermen `/app/`, `/admin/` en de bijbehorende API's. Deze staan niet in de openbare zoekindex. Gewone gebruikers werken met `/app/` en alleen beheerders en eigenaren kunnen bij `/admin/`. De identiteit volgt uit `issuer + subject` van de externe provider of `login name` bij een wachtwoordaanmelding. Het e-mailadres en de weergavenaam zijn geen authenticatiesleutels. ZIP-uploads, taken, uitvoerbestanden en TeX-compilatie verlopen via de renderer op de server.
>
> > [!NOTE]
> > De browser bewaart kortlevende tickets niet permanent. De serversessie geeft zo nodig nieuwe tickets uit. Deel geen sessiecookies, CSRF-tokens of tickets.

## Registratie en diagnostiek van Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specificaties en procedures
>
> - **Dynamische clientregistratie (DCR).** Onvoltooide of inactieve registraties worden doorgaans na 30 dagen opgeruimd. Registraties waarnaar geldige autorisatiecodes of tokenfamilies verwijzen, zijn beschermd. De globale limiet is 10.000. Krijg je na opschoning `invalid_client`, registreer de client dan opnieuw. Standaard-DCR-verzoeken zonder clientnaam worden geaccepteerd. Validatie van de naam en de omleidings-URI blijft van kracht.
> - **Tijdelijke autorisatieverzoeken (schema 20).** Is tussentijds inloggen nodig, dan bewaart de dienst het verzoek onder een kort willekeurig ID. Zo kan het worden hervat zonder de lange OAuth-`state` in de terugkeer-URL. Het blijft 10 minuten geldig en kan één keer worden gebruikt bij een overeenkomst tussen de aangemelde browser en de specifieke cookie. Gelijktijdige tabbladen hebben afzonderlijke ID's. De globale limiet is 1.000 verzoeken en per browser zijn er maximaal 8 hervattingscookies. Bij de limiet wordt `503` geretourneerd, met behoud van bestaande verzoeken. De database bevat alleen hashes van ID en cookie. Herstarten of terugzetten van een back-up verlengt de geldigheid niet.
> - **IP-limieten en bronheaders.** DCR staat 10 registraties per vertrouwd bron-IP per 15 minuten toe. Clients achter dezelfde uitgaande proxy delen de limiet. Vanaf de 11e poging volgen HTTP `429`, `temporarily_unavailable` en `Retry-After`. Ongeldige metadata tellen niet mee. Bij een ontbrekend of ongeldig IP wordt `503` geretourneerd zodat de beheerder de proxy controleert, zonder onbekende clients samen te voegen. Houd de backend op de loopbackinterface en laat de proxy `X-Latex-Renderer-Client-IP` overschrijven met het daadwerkelijke adres. Willekeurige waarden van `X-Forwarded-For` worden genegeerd. Bij Cloudflare-routes wordt binnen de vertrouwensgrens ook `CF-Connecting-IP` verwerkt.
> - **Verbindingscontrole voor beheerders.** De volgende opdracht controleert openbare servicedetectie en de Bearer-challenge `401` zonder inloggegevens te versturen, instellingen te wijzigen, omleidingen te volgen of inhoud, cookies en geheimen te tonen.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **De fout per fase onderzoeken.** Een correcte `200` voor detectie en een geldige `401`-challenge bevestigen alleen die fasen. Vergelijk fase, tijd en `X-Request-ID` met logboeken `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` en `remote_mcp.rpc_result`. Houd OAuth-codes, tokens, cookies, PKCE-verifiers, bronnen en gebruikers-ID's uit logboeken en issues.
> - **Authenticatie werkt maar het vinden van acties mislukt.** Controleer na uitgifte van het token afzonderlijk `initialize`, de initialisatiemelding en `tools/list`. HTTP `200` kan samengaan met een JSON-RPC-`error`. `remote_mcp.rpc_result` registreert HTTP-status, resultaatcategorie, protocolversie, aantal tools, antwoordgrootte in bytes en de basisstructuur van de lijst. De inspectiebuffer is beperkt tot 256 KiB. Boven die limiet wordt alleen `inspection_limited` geregistreerd en blijft het antwoord intact. Een SSE-antwoord of een `GET`-verzoek met antwoord `405` is op zich onvoldoende om een fout vast te stellen. Controleer `Accept`, `Content-Type`, de protocolonderhandeling en de doorgifte van verzoeken door de proxy. Controleer externe OIDC, Cloudflare-beleid en een echt ChatGPT-account afzonderlijk in productie.

## MCP-resultaten en -resources {#mcpの結果とresource}

> [!DETAILS] Specificaties en procedures
>
> Antwoorden van Remote MCP hebben drie lagen.
> 1. **Standaard-`content`.** Bevat invoer- en taak-ID, status, offset, cursor, beschikbaarheid en begrensde diagnostiek voor beslissingen en de volgende toolaanroep. Ook clients zonder `structuredContent` of eigen resources kunnen invoer maken, corrigeren en opnieuw renderen.
> 2. **`structuredContent`.** Bevat het volledige gevalideerde object voor automatische verwerking.
> 3. **MCP-resources (`latex-renderer://jobs/...`).** Bevatten omvangrijke gegevens zoals de PDF, het volledige `compile.log`, onbewerkte JSON, `svg/manifest.json` en `svg/objects/*.svg`. Alleen dezelfde OAuth-eigenaar mag deze lezen. Dezelfde grootte- en bewaarlimieten gelden als voor gewone bestanden. Geen van de lagen bevat API-sleutels, OAuth-tokens, tickets, brontekst of onbewerkte base64.

## Wachttijden en nieuwe pogingen in de CLI {#cliの待機と再試行}

> [!DETAILS] Specificaties en procedures
>
> Geeft een statusverzoek een tijdelijke HTTP `502`, `503`, `504` of ongeldige JSON terug, dan herhaalt de CLI uitsluitend de statuscontrole voor dezelfde taak, **maximaal 5 keer**, na 1, 2, 4, 8 en 8 seconden zonder de totale wachttijd te verlengen. Het aanmaken van taken, uploaden, vernieuwen van tokens en verifiëren van bestanden worden niet automatisch herhaald. Authenticatie- en rechtenfouten worden onmiddellijk teruggegeven. Als de CLI stopt met wachten, kan de server nog doorwerken.

## JSON-formaat van de CLI {#cliのjson形式}

> [!DETAILS] Specificaties en procedures
>
> Met `--json` heeft de standaarduitvoer de volgende formaten. API-sleutel, `uploadTicket` en `jobTicket` worden weggelaten.
>
> - **Geslaagd (afsluitcode `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI- of API-fout (afsluitcode `1`)**
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
> - **Taak voltooid met een fout, bijvoorbeeld een LaTeX-fout (afsluitcode `2`).** `result` bevat de taakgegevens en opgeslagen paden. Het antwoord bevat `success: false`.

## Migratie en herstel van eerdere versies {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Een verouderde updater migreren en uitpakfouten oplossen
>
> ### Migreren van de root-updater uit v1.2.x naar een updater met gescheiden rechten {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Tot en met v1.2.x draaide Update Manager als rootdaemon. Vanaf v1.3.0 draait de permanente controller als `latex-renderer-update` en voert een kortlevend hulpproces met rootrechten vaste bewerkingen uit. Een webupdate met de oude updater kan stoppen met `Application Update Manager must use a separate non-root build tree`. Herhaal dezelfde webbewerking niet.
>
> Gebruik voor deze eenmalige migratie de [serverdistributie van v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Volg als gewone gebruiker [De distributie downloaden en verifiëren](/nl/docs/self-hosting/#v1-6-9をダウンロードして検証) en vervang de eerste regel `version=` door `version=1.3.6`. Blijf in dezelfde terminal zodat de bij verificatie en uitpakken verkregen `bundle_root` behouden blijft.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Het script downloadt als root opnieuw dezelfde onveranderlijke versie en verifieert digest, tag/commit, Sigstore-bundel, archiefgrenzen en metadata. Het accepteert alleen `gh` in `/usr/local/bin/gh` of `/usr/bin/gh` waarvan root eigenaar is en waarin de groep en anderen niet kunnen schrijven. De afzonderlijke bomen zijn `verified` van root, `bootstrap-build` zonder rootrechten (vaste pnpm-versie via een speciale Corepack-wrapper) en `assembly` van root. Pas na het verkrijgen van het gedeelde wijzigingsslot stopt het de eerdere beheerder. Bij een fout wordt die opnieuw gestart. Controleer na afloop met de volgende opdrachten `User=latex-renderer-update` en de status `active` van elke dienst. Gebruik daarna de normale updates via web of Admin CLI.
> De webapp en de API krijgen geen sudo-rechten of GitHub-tokens.
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
> ### GNU tar stopt bij het uitpakken met Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Gebruikt GNU `tar` op Ubuntu `openat2`, dan kan de updaterbeperking `RestrictSUIDSGID=true` het uitpakken van archieven met submappen stoppen met `ENOSYS` (Function not implemented). De gecorrigeerde updater behoudt de inspectie door GNU `tar` en de handtekeningcontrole. Alleen het uitpakken gebeurt met `/usr/bin/bsdtar` in een lege afgeschermde tijdelijke map, zonder eigenaar, ACL's of uitgebreide attributen over te nemen. De beperking `RestrictSUIDSGID` en de systeemversie van `tar` blijven behouden.
>
> De oude updater kan ook zijn eigen reparatie mogelijk niet uitpakken. Controleer of er geen bewerkingen lopen, de applicatie en database gezond zijn en een versleutelde back-up is geverifieerd. Gebruik de geïnstalleerde `bootstrap-v1` om **eerst uitsluitend de afzonderlijke updater bij te werken** naar een gepubliceerde versie met de reparatie.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Controleer de nieuwe updaterversie en de waarden van `ready` en `pending=false`. Installeer daarna dezelfde applicatieversie via de webapp of de normale opdracht `update apply` van de Admin CLI.
>
> De updater `v1.4.0-rc.3` heeft een bekend probleem. Wanneer root het pakket kopieert, blijft de onbevoorrechte eigenaar behouden en mislukt de bewerking met `Release extraction requires a private regular bundle`. Laat de controles actief en werk eerst de updater bij naar een gepubliceerde versie die het eigendom corrigeert. Pas daarna de applicatie toe. Los daarvan kun je het uitpakken onder root en systemd testen met `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Sloten bij updates of TeX-wijzigingen onderzoeken
>
> ### Het wijzigingsslot is in gebruik {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` voorkomt dat een applicatie-update en een TeX-wijziging samenvallen. Wacht op de actieve bewerking. **Verwijder nooit het bestand `/run/latex-renderer/mutation.lock`.** Er kunnen anders twee onafhankelijke sloten tegelijk bestaan. Gebeurt dit bij intern herstel van de TeX-omgeving tijdens een update, dan concurreert de bewerking mogelijk met zichzelf. Controleer logboeken en gestopte diensten voordat je het opnieuw probeert.
>
> Stop alleen als er geen bewerking loopt en het logboek de vorige als voltooid vermeldt beide beheerders en onderzoek het proces dat het slot vasthoudt.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Beëindig dat proces en herstart de beheerders alleen als je hebt bevestigd dat het een achtergebleven slothulpproces van een voltooide bewerking is.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Renderer-identiteit in vroegere release candidates {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Release candidates van v1.3.4
>
> De update van `v1.3.4-rc.3` naar `v1.3.4-rc.4` mislukte vóór de omschakeling van diensten doordat het aantal bestanden in de identiteitshash van de renderer van 5 naar 6 ging. Gebruik voor die migratie `v1.3.4-rc.5`, die ook de eerdere compatibiliteitsgegevens bevat. De controlesom van het complete pakket en de herkomsthandtekening verifiëren ook het toegevoegde bestand.

## Uitvoeringsomgevingen van de updater {#updaterの実行領域}

> [!DETAILS] Specificaties en procedures
>
> Update Manager scheidt strikt de boom `verified` van root met de geverifieerde distributie, `build` zonder rootrechten voor de installatie van afhankelijkheden en het bouwen en `assembly` van root met de toegestane resultaten. Implementatiescripts die als root draaien, gebruiken altijd de geverifieerde kopie uit `assembly`. Stappen zoals publiceren naar Cloudflare door de implementatiegebruiker gebruiken na de rootcontroles een tijdelijke kopie `deployment-build`. Dit geldt ook bij terugzetten.

## Installatiepaden en bescherming in Windows {#windowsの配置と保護}

> [!DETAILS] Specificaties en procedures
>
> Als je de installatielocatie op Windows verandert, wordt de submap `bin` daarvan de standaardopdrachtmap. Stel je `LATEX_RENDER_BIN_DIRECTORY` in, dan komen de beheerde starters daarin en gebruiken het gebruikers-PATH en Local MCP hetzelfde pad. Alternatieve starters blijven behouden. `setup repair` kan het eerder geregistreerde pad herstellen. De oude PATH-vermelding blijft voor andere toepassingen beschikbaar. Gebruik absolute paden zonder puntkomma's, aanhalingstekens of controletekens. Kan `--open` of de grafische interface geen browser of viewer openen, dan blijft de opgeslagen PDF behouden.

## Gedeelde projecten en bewaartermijnen {#保存プロジェクトの共有-保持}

> [!DETAILS] Regels voor delen en bewaren
>
> - De webapp (`/app/`), CLI, openbare API, Local MCP en Remote MCP delen de projecten en de onveranderlijke revisiegeschiedenis van iedere gebruiker. Verschillende API-sleutels of serviceaccounts van dezelfde gebruiker kunnen ze lezen en bijwerken. Tijdelijke invoer en taken kun je ook zonder opslag in een project gebruiken.
> - De combinatie van invoer, hoofddocument, engine en uitvoerformaten bepaalt de revisie. Revisies met verschillende uitvoer kunnen invoer delen. De bij **Opnieuw converteren** gekozen formaten gelden alleen voor die uitvoering. Kies de oorspronkelijke instellingen om de bij de revisie opgeslagen formaten te gebruiken.
> - Invoer waarnaar een actieve revisie verwijst, blijft na de termijn voor verweesde invoer behouden en telt mee voor het quotum van de gebruiker. Bij verwijderen wordt de projectvermelding verborgen. Nadat het laatste verwijzende project is verwijderd en de gekoppelde taken zijn verdwenen, vervalt de bescherming van de invoer. Na de vervaltijd volgt periodieke opschoning. Vraag de beheerder om hulp voor directe volledige verwijdering.

## Interfacetaal {#表示言語}

De editor slaat **Weergavetaal** op in het account. Ontbreekt een instelling, dan doorloopt de editor de talen van de browser en gebruikt Engels als geen ervan wordt ondersteund. De engine en documentcodering stel je afzonderlijk in.

| Onderdeel | Vertaaldekking |
| --- | --- |
| Web en configuratie | Acties, uitvoeringsstatus, bevestigingen en diagnostiek. |
| CLI en MCP | CLI-help en invoerprompts gebruiken de terminaltaal. Beschrijvingen voor externe MCP gebruiken de accounttaal. |
| Editor | Bewerken, zoeken en vervangen, opslaan en conflicten, compilatiestatussen en voorbeeldbediening zijn in 18 talen beschikbaar. |
| Openbare handleidingen | Alle handleidingen zijn beschikbaar in de 18 talen hieronder. Wijzig de taal via het menu bovenaan de pagina. |

De editor ondersteunt Engels, Japans, vereenvoudigd Chinees, Koreaans, Spaans, Portugees, Frans, Duits, Italiaans, Russisch, Turks, Pools, Tsjechisch, Nederlands, Zweeds, Noors Bokmål, Deens en Fins. Logboeken van TeX en externe pakketten behouden voor de diagnostiek de oorspronkelijke tekst.

## Auditlogboeken herstellen {#監査ログの復旧}

Na herstel van de database kan de exportpositie (`export_database_id`, rijvolgorde `export_sequence` en `export_token`) afwijken van de toestand van de database. De export en opschoning stoppen dan om de gegevens te beschermen.

1. Stop de diensten en timers voor export en opschoning tijdens het onderzoek en herstel.
2. Bewaar de herstelde database, bestaande versleutelde exports en alle huidige en eerdere controlepuntbestanden afzonderlijk. Verifieer de integriteit, refererende sleutels en migratiestatus van de herstelde database.
3. Is er geen passend controlepunt en kies je ervoor de aanwezige records opnieuw te exporteren, verplaats de controlepuntbestanden dan buiten de actieve paden. Controleer ook het pad van `AUDIT_EXPORT_CHECKPOINT` als dat is ingesteld. Behoud de auditrijen, SQLite-reeksen en `export.lock`.
4. Voer een handmatige export uit met de toegangsgegevens van de productiedienst. Controleer of de uitvoer kan worden ontsleuteld en of een nieuw controlepunt in formaat 3 is gemaakt voordat je de timers opnieuw start.

Alleen rijen die daadwerkelijk in de herstelde database staan, worden opnieuw geëxporteerd. Vergelijk voor het herkennen van duplicaten `export_database_id`, `export_sequence` en `export_token` samen. Alleen het tijdstip identificeert een rij niet.
