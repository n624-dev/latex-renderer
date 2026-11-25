---
slug: reference
category: Ylläpito ja kehitys
title: Ylläpidon ja kehityksen viiteopas
description: Tarkista asiakkaan tallennus ja palautus, MCP-tunnistautuminen sekä versioiden väliset siirtomenettelyt.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Tulosten tallennus ja palautus {#成果物の保存-復旧の仕様}

> [!DETAILS] Määritykset ja menettelyt
>
> - **Hakemistojen atominen vaihto.** Komentorivityökalu ja paikallinen MCP säilyttävät polut, kuten `.render/result.pdf`, `job.json` ja esikatselut. Ne tarkistavat kaikkien tiedostojen ilmoitetut koot ja SHA-256-tiivisteet ja vaihtavat koko hakemiston, kun se on valmis. Hakemisto voi kadota hetkeksi vaihdon aikana. Ulkoisten ohjelmien tulee lukea sitä komennon päätyttyä.
> - **Automaattinen palautus.** Tuloskansion viereinen hakemisto `<output-name>.latex-renderer-state` sisältää palautustilan. Se jätetään pois syötteitä kerättäessä. Normaalin lopetuksen yhteydessä väliaikaiset tiedot siivotaan. Pakotetun lopetuksen jälkeen seuraava lataus palauttaa aiemmat tiedostot, jos vaihtoa ei vielä vahvistettu. Vahvistetun vaihdon jälkeen uusi kokonaisuus säilyy ja vanha siivotaan. Älä poista tilahakemistoa toiminnon aikana tai ennen palautusta.
> - **Lukitus ja poikkeustilanteet.** Samanaikainen kirjoitus samaan kohteeseen pysähtyy virheeseen `OUTPUT_BUSY`. Pelkkä ajan kuluminen ei syrjäytä aktiivista prosessia. Jos prosessitunnus on otettu uudelleen käyttöön, toiminto pysähtyy varotoimena. Vioittuneet metatiedot, tuntemattomat tiedostot ja ulkoiset linkit on tarkistettava ennen poistamista.
> - **Käyttäjän tiedostot ja rajat.** Tavalliset käyttäjätiedostot kopioidaan uuteen kokonaisuuteen. Jos käyttäjä muokkaa tiedostoa latauksen aikana, julkaisu keskeytetään ja muokkaus säilyy. Käytä mieluiten erillistä tuloskansiota. Yksi kokonaisuus voi sisältää enintään 1 GiB:n ja 10 000 kohdetta. Tilaa tarvitaan molemmille kokonaisuuksille ja väliaikaistiedoille. Vain paikallisia tiedostojärjestelmiä tuetaan. Symbolisia linkkejä, kovia linkkejä tai toisen tiedostojärjestelmän liitoksia sisältävät polut hylätään. Lukitusta verkkojaoissa tai vaihdon täydellistä atomisuutta virtakatkossa ei taata. Windowsissa aiempi kokonaisuus säilyy, jos avoin tiedosto estää vaihdon.

## Verkkosovelluksen tunnistautumisrajat {#web認証の境界}

> [!DETAILS] Määritykset ja menettelyt
>
> Palvelinistunnot suojaavat polut `/app/` ja `/admin/` sekä niiden rajapinnat. Ne jätetään julkisen hakuindeksin ulkopuolelle. Tavalliset käyttäjät käyttävät polkua `/app/`. Vain ylläpitäjät ja omistajat pääsevät polkuun `/admin/`. Henkilöllisyys määräytyy ulkoisen palveluntarjoajan arvosta `issuer + subject` tai salasanakirjautumisen arvosta `login name`. Sähköposti ja näyttönimi eivät ole tunnistautumisavaimia. ZIP-lähetykset, työt, tulostiedostot ja TeX-käännökset kulkevat palvelimen käännöspalvelun kautta.
>
> > [!NOTE]
> > Selain ei säilytä lyhytikäisiä lippuja pysyvästi. Palvelinistunto myöntää uusia tarpeen mukaan. Älä jaa istuntoevästeitä, CSRF-tunnisteita tai lippuja.

## Etä-MCP:n rekisteröinti ja diagnostiikka {#remote-mcpの登録-診断}

> [!DETAILS] Määritykset ja menettelyt
>
> - **Dynaaminen asiakasrekisteröinti (DCR).** Keskeneräiset tai käyttämättömät rekisteröinnit siivotaan yleensä 30 päivän kuluttua. Rekisteröinti on suojattu, jos siihen viitataan voimassa olevasta valtuutuskoodista tai tunnisteperheestä. Kokonaisraja on 10 000. Jos saat siivouksen jälkeen virheen `invalid_client`, rekisteröi asiakas uudelleen. Tavallinen DCR-pyyntö hyväksytään ilman asiakasnimeä. Nimen ja uudelleenohjausosoitteen tarkistukset säilyvät.
> - **Väliaikaiset valtuutuspyynnöt (skeema 20).** Jos välissä tarvitaan kirjautuminen, pyyntö tallennetaan lyhyellä satunnaisella tunnuksella, jolla pyyntö noudetaan lisäämättä OAuthin pitkää `state`-arvoa paluuosoitteeseen. Pyyntö on voimassa 10 minuuttia ja kertakäyttöinen, jos kirjautunut selain ja erillinen eväste täsmäävät. Rinnakkaiset välilehdet saavat eri tunnukset. Pyynnöille on yhteensä 1 000 paikkaa ja selaimella voi olla enintään 8 jatkoevästettä. Rajan täyttyessä palautetaan `503` ja nykyiset pyynnöt säilyvät. Tietokannassa säilytetään vain tunnuksen ja evästeen tiivisteet. Uudelleenkäynnistys ja varmuuskopion palautus eivät jatka voimassaoloa.
> - **IP-kohtaiset rajat ja alkuperäotsakkeet.** DCR sallii 10 rekisteröintiä luotettavaa lähde-IP-osoitetta kohden 15 minuutissa. Samaa lähtevää välityspalvelinta käyttävät asiakkaat jakavat kiintiön. Yrityksestä 11 alkaen palautetaan HTTP `429`, `temporarily_unavailable` ja `Retry-After`. Virheelliset metatiedot eivät kuluta kiintiötä. Jos IP puuttuu tai on virheellinen, palautetaan `503`, jotta ylläpitäjä voi tarkistaa välityspalvelimen. Tunnistamattomia asiakkaita ei yhdistetä yhdeksi ryhmäksi. Pidä taustapalvelu paikallisessa silmukkaliitännässä ja aseta välityspalvelin korvaamaan `X-Latex-Renderer-Client-IP` todellisella osoitteella. Mielivaltaiset `X-Forwarded-For`-arvot ohitetaan. Cloudflare-reiteillä myös `CF-Connecting-IP` käsitellään luottamusrajan sisällä.
> - **Ylläpidon yhteystarkistus.** Seuraava komento tarkistaa julkiset palvelutiedot ja Bearer-haasteen `401` lähettämättä tunnistetietoja, muuttamatta asetuksia, seuraamatta uudelleenohjauksia tai näyttämättä vastausrunkoja, evästeitä tai salaisuuksia.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Virheen paikantaminen vaiheittain.** Onnistunut palvelutietojen `200` ja kelvollinen `401`-haaste vahvistavat vain kyseiset vaiheet. Vertaa vaihetta, ajankohtaa ja arvoa `X-Request-ID` lokeihin `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` ja `remote_mcp.rpc_result`. Jätä OAuth-koodit, tunnisteet, evästeet, PKCE-tarkistusarvot, lähdeaineisto ja käyttäjätunnukset pois lokeista ja vikailmoituksista.
> - **Tunnistautuminen onnistuu, mutta toimintoja ei löydy.** Tarkista tunnisteen myöntämisen jälkeen erikseen `initialize`, alustuksen valmistumisilmoitus ja `tools/list`. Myös HTTP-tilalla `200` voi tulla JSON-RPC:n `error`-vastaus. Lokiin `remote_mcp.rpc_result` tallentuvat HTTP-tila, tulosluokka, protokollaversio, työkalujen määrä, vastauksen koko tavuina ja luettelon perusrakenne. Tarkistuspuskuri on rajattu 256 KiB:iin. Jos raja ylittyy, kirjataan vain `inspection_limited`. Vastaukseen ei tehdä muutoksia. SSE-vastaus tai `GET`-pyynnön `405`-vastaus ei yksin osoita virhettä. Tarkista `Accept`, `Content-Type`, protokollaneuvottelu ja pyyntöjen saapuminen välityspalvelimelta. Tarkista ulkoinen OIDC, Cloudflare-käytännöt ja todellinen ChatGPT-tili erikseen tuotannossa.

## MCP-tulokset ja -resurssit {#mcpの結果とresource}

> [!DETAILS] Määritykset ja menettelyt
>
> Etä-MCP:n vastauksissa on kolme kerrosta.
> 1. **Tavallinen `content`.** Sisältää syötteiden ja töiden tunnukset, tilan, siirtymän, kohdistimen, saatavuuden ja rajatut diagnostiikkatiedot päätöksentekoa ja seuraavaa työkalukutsua varten. Myös asiakkaat, joilla ei ole `structuredContent`-tukea tai mukautettuja resursseja, voivat luoda syötteitä, korjata niitä ja muuntaa uudelleen.
> 2. **`structuredContent`.** Sisältää koko tarkistetun objektin automaattista käsittelyä varten.
> 3. **MCP-resurssit (`latex-renderer://jobs/...`).** Sisältävät suuria tietoaineistoja, kuten PDF:n, koko tiedoston `compile.log`, raaka-JSONin sekä tiedostot `svg/manifest.json` ja `svg/objects/*.svg`. Vain sama OAuth-omistaja voi lukea niitä. Samat koko- ja säilytysrajat koskevat niitä kuin tavallisia tiedostoja. Kaikista kerroksista jätetään pois API-avaimet, OAuth-tunnisteet, liput, lähdeteksti ja raaka base64-data.

## Komentorivityökalun odotus ja uudelleenyritykset {#cliの待機と再試行}

> [!DETAILS] Määritykset ja menettelyt
>
> Jos tilakysely palauttaa tilapäisen HTTP-virheen `502`, `503` tai `504` tai virheellistä JSONia, komentorivityökalu toistaa vain saman työn tilakyselyn **enintään viisi kertaa**. Odotusajat ovat 1, 2, 4, 8 ja 8 sekuntia, eikä kokonaisaika pitene. Työn luontia, lähetystä, tunnisteen uusimista tai tiedoston tarkistusta ei toisteta automaattisesti. Tunnistautumis- ja käyttöoikeusvirheet palautetaan heti. Työ voi jatkua palvelimella, vaikka komentorivityökalu lakkaisi odottamasta.

## Komentorivityökalun JSON-muoto {#cliのjson形式}

> [!DETAILS] Määritykset ja menettelyt
>
> Valitsimella `--json` käytetään seuraavia vakiotulosteen muotoja. API-avain, `uploadTicket` ja `jobTicket` jätetään pois.
>
> - **Onnistuminen (paluuarvo `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Komentorivin tai API:n virhe (paluuarvo `1`)**
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
> - **Virheeseen päättynyt työ, esimerkiksi LaTeX-virhe (paluuarvo `2`).** `result` sisältää työn tiedot ja tallennuspolut. Vastaukseen sisältyy `success: false`.

## Vanhojen versioiden siirto ja palautus {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Vanhan päivitysohjelman siirto ja purkuvirheiden ratkaiseminen
>
> ### Version v1.2.x root-päivitysohjelman siirtäminen eriytettyihin oikeuksiin {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Versioon v1.2.x asti Update Manager toimi root-taustaprosessina. Versiosta v1.3.0 alkaen pysyvä ohjain toimii käyttäjänä `latex-renderer-update` ja lyhytikäinen root-apuprosessi hyväksyy ennalta määritettyjä toimia. Vanhan päivitysohjelman verkkopäivitys voi pysähtyä virheeseen `Application Update Manager must use a separate non-root build tree`. Älä toista samaa verkkotoimea.
>
> Käytä tähän kertaluonteiseen siirtoon [palvelinjakelua v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Noudata tavallisella käyttäjätilillä ohjetta [jakelun lataaminen ja tarkistaminen](/fi/docs/self-hosting/#v1-6-9をダウンロードして検証) ja vaihda ensimmäisen rivin `version=` arvoon `version=1.3.6`. Jatka samassa päätteessä, jotta tarkistuksessa ja purussa saatu `bundle_root` säilyy.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Komentosarja lataa saman muuttumattoman julkaisun uudelleen root-käyttäjänä ja tarkistaa tiivisteen, tunnisteen ja commitin, Sigstore-paketin, arkiston rajat ja metatiedot. Se hyväksyy vain kohteen `gh` polussa `/usr/local/bin/gh` tai `/usr/bin/gh`, jos root omistaa sen eikä ryhmällä tai muilla ole kirjoitusoikeutta. Rootin `verified`-puu, tavallisen käyttäjän `bootstrap-build`-puu (pnpm kiinnitetään erillisellä Corepack-käynnistimellä) ja rootin `assembly`-puu pidetään erillään. Vanha hallintapalvelu pysäytetään vasta yhteisen muutoslukon saamisen jälkeen ja käynnistetään uudelleen virheen sattuessa. Tarkista lopuksi seuraavilla komennoilla `User=latex-renderer-update` ja jokaisen palvelun `active`-tila. Käytä tämän jälkeen tavallista verkkopäivitystä tai ylläpidon komentorivityökalua.
> Verkkosovellukselle tai API:lle ei anneta sudo-oikeuksia tai GitHub-tunnisteita.
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
> ### GNU tar keskeyttää purkamisen virheeseen Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Jos GNU `tar` käyttää Ubuntussa kutsua `openat2`, päivitysohjelman rajoitus `RestrictSUIDSGID=true` voi keskeyttää alihakemistoja sisältävän arkiston purkamisen virheeseen `ENOSYS` (Function not implemented). Korjattu päivitysohjelma säilyttää GNU `tar` -tarkistuksen ja allekirjoituksen tarkistuksen. Vain purku tehdään työkalulla `/usr/bin/bsdtar` tyhjään yksityiseen väliaikaiskansioon tuomatta omistajia, ACL-luetteloita tai laajennettuja määritteitä. Asetus `RestrictSUIDSGID` ja järjestelmän `tar` säilyvät.
>
> Vanha päivitysohjelma voi epäonnistua myös oman korjauksensa purkamisessa. Varmista, ettei toimintoja ole kesken, että sovellus ja tietokanta ovat kunnossa ja että salattu varmuuskopio on tarkistettu. Käytä asennettua komentoa `bootstrap-v1` **päivittääksesi ensin vain erillisen päivitysohjelman** julkaistuun versioon, joka sisältää korjauksen.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Tarkista päivitysohjelman uusi versio sekä arvot `ready` ja `pending=false`. Ota sama sovellusversio käyttöön verkkosovelluksella tai ylläpidon komentorivityökalun tavallisella komennolla `update apply`.
>
> Päivitysohjelman versiossa `v1.4.0-rc.3` on tunnettu ongelma. Rootin tekemä pakettikopio säilyttää tavallisen käyttäjän omistajuuden, jolloin tuloksena on `Release extraction requires a private regular bundle`. Säilytä tarkistukset, päivitä ensin päivitysohjelma julkaistuun omistajuuskorjauksen sisältävään versioon ja päivitä sen jälkeen sovellus. Voit testata purun erikseen root- ja systemd-ympäristössä komennolla `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Päivitysten ja TeX-muutosten lukkojen selvittäminen
>
> ### Muutoslukko on käytössä {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` estää sovelluspäivityksen ja TeX-muutoksen suorittamisen samanaikaisesti. Odota aktiivisen toiminnon valmistumista. **Älä koskaan poista tiedostoa `/run/latex-renderer/mutation.lock`.** Muutoin käytössä voi olla kaksi erillistä lukkoa. Jos lukitus ilmenee päivityksen sisäisessä TeX-ympäristön palautuksessa, toiminto voi yrittää saada jo hallussaan olevaa lukkoa. Tarkista lokit ja pysäytetyt palvelut ennen uutta yritystä.
>
> Vasta kun toimintoja ei ole käynnissä ja loki vahvistaa edellisen päättyneen, pysäytä molemmat hallintapalvelut ja tarkista lukkoa pitävä prosessi.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Päätä prosessi ja käynnistä hallintapalvelut uudelleen vain, jos olet varmistanut sen olevan päättyneeltä toiminnolta jäänyt orpo lukitusapuprosessi.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Käännöspalvelun tunniste vanhoissa julkaisuehdokkaissa {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Version v1.3.4 julkaisuehdokkaat
>
> Päivitys versiosta `v1.3.4-rc.3` versioon `v1.3.4-rc.4` epäonnistui ennen palvelujen vaihtoa, koska käännöspalvelun tunnistetiivisteeseen sisältyvien tiedostojen määrä kasvoi viidestä kuuteen. Käytä tähän siirtoon versiota `v1.3.4-rc.5`, joka sisältää myös aiemmat yhteensopivuustiedot. Koko paketin tarkistussumma ja alkuperätodistuksen allekirjoitus varmentavat myös lisätyn tiedoston.

## Päivitysohjelman suoritusympäristöt {#updaterの実行領域}

> [!DETAILS] Määritykset ja menettelyt
>
> Update Manager erottaa tarkasti rootin `verified`-puun tarkistetulle jakelulle, tavallisen käyttäjän `build`-puun riippuvuuksien asennukseen ja koontiin sekä rootin `assembly`-puun sallituille tuloksille. Root-oikeuksin ajettavat käyttöönottoskriptit käyttävät aina kohteen `assembly` tarkistettua kopiota. Kun esimerkiksi julkaistaan Cloudflareen käyttöönottokäyttäjänä, käytetään rootin tarkistusten jälkeen väliaikaista `deployment-build`-kopiota. Sama koskee edellisen version palauttamista.

## Windowsin asennuspolut ja suojaukset {#windowsの配置と保護}

> [!DETAILS] Määritykset ja menettelyt
>
> Windowsissa asennuspaikan vaihto siirtää oletuskomentohakemiston sen alikansioon `bin`. Jos määrität asetuksen `LATEX_RENDER_BIN_DIRECTORY`, hallitut käynnistimet sijoitetaan sinne ja käyttäjän PATH sekä paikallinen MCP viittaavat samaan polkuun. Muut käynnistimet säilyvät. `setup repair` voi korjata aiemmin rekisteröidyn polun. Vanha PATH-merkintä säilyy muita sovelluksia varten. Käytä absoluuttisia polkuja, joissa ei ole puolipisteitä, lainausmerkkejä tai ohjausmerkkejä. Jos `--open` tai graafinen käyttöliittymä ei pysty avaamaan selainta tai katseluohjelmaa, tallennettu PDF säilyy.

## Jaetut projektit ja säilytys {#保存プロジェクトの共有-保持}

> [!DETAILS] Jakamisen ja säilytyksen säännöt
>
> - Verkkosovellus (`/app/`), komentorivityökalu, julkinen API, paikallinen MCP ja etä-MCP käyttävät samoja käyttäjäkohtaisia projekteja ja muuttumattomien versioiden historiaa. Saman käyttäjän eri API-avaimet tai palvelutilit voivat katsella ja päivittää niitä. Tilapäisiä syötteitä ja töitä voi käyttää tallentamatta niitä projektiin.
> - Syötteen, pääasiakirjan, moottorin ja tulostusmuotojen yhdistelmä yksilöi version. Eri tulostusmuotojen versiot voivat käyttää samaa syötettä. Kohdassa **Muunna uudelleen** valitut muodot koskevat vain kyseistä suoritusta. Valitse alkuperäiset asetukset käyttääksesi versioon tallennettuja muotoja.
> - Aktiivisen version käyttämä syöte säilyy viittaamattomille syötteille asetetun määräajan jälkeenkin ja lasketaan käyttäjän kiintiöön. Projektin poistaminen piilottaa tietueen. Kun viimeinen viittaava projekti poistetaan ja siihen liittyvät työt poistuvat, syöte menettää suojauksen. Se poistetaan säännöllisessä siivouksessa määräajan päätyttyä. Jos tarvitset heti täydellisen poiston, ota yhteys ylläpitäjään.

## Käyttöliittymän kieli {#表示言語}

Editori tallentaa asetuksen **Näyttökieli** käyttäjätilille. Jos asetusta ei ole, se tarkistaa selaimen kielet järjestyksessä ja käyttää englantia, jos mitään niistä ei tueta. Asiakirjan moottori ja merkistökoodaus määritetään erikseen.

| Alue | Käännösten kattavuus |
| --- | --- |
| Verkko ja määritys | Toiminnot, suoritustila, vahvistukset ja vianmääritys. |
| CLI ja MCP | Komentorivin ohjeet ja kehotteet käyttävät päätteen kieltä. MCP-etäkäytön kuvaukset käyttävät tilin kieltä. |
| Editori | Muokkaus, haku ja korvaus, tallennus ja ristiriidat, käännöstilat sekä esikatselun ohjaimet ovat saatavilla 18 kielellä. |
| Julkiset ohjeet | Kaikki ohjeet ovat saatavilla alla luetelluilla 18 kielellä. Vaihda kieltä sivun yläreunan valikosta. |

Editori tukee englantia, japania, yksinkertaistettua kiinaa, koreaa, espanjaa, portugalia, ranskaa, saksaa, italiaa, venäjää, turkkia, puolaa, tšekkiä, hollantia, ruotsia, norjan bokmålia, tanskaa ja suomea. TeXin ja ulkoisten pakettien lokit säilyvät alkuperäisinä vianmääritystä varten.

## Tarkastuslokin palautus {#監査ログの復旧}

Tietokannan palautuksen jälkeen viennin sijainti (`export_database_id`, rivin järjestysnumero `export_sequence` ja `export_token`) ei välttämättä enää vastaa tietokannan tilaa. Tällöin vienti ja siivous pysähtyvät tietojen suojaamiseksi.

1. Pysäytä viennin ja siivouksen palvelut ja ajastimet selvityksen ja palautuksen ajaksi.
2. Säilytä palautettu tietokanta, aiemmat salatut viennit sekä kaikki nykyiset ja vanhat tarkistuspistetiedostot erikseen. Tarkista palautetun tietokannan eheys, viiteavaimet ja siirtojen tila.
3. Jos yhteensopivaa tarkistuspistettä ei ole ja päätät viedä palautetut rivit uudelleen, siirrä tarkistuspistetiedostot pois aktiivisista poluista. Tarkista myös asetuksen `AUDIT_EXPORT_CHECKPOINT` polku, jos se on määritetty. Säilytä tarkastuslokin rivit, SQLiten järjestysnumerot ja `export.lock`.
4. Aja vienti käsin tuotantopalvelun tunnistetiedoilla. Varmista, että tuloksen salaus voidaan purkaa ja uusi muodon 3 tarkistuspiste on syntynyt ennen ajastimien käynnistämistä.

Vain palautetussa tietokannassa olevat rivit viedään uudelleen. Vertaa päällekkäisiä rivejä yhdistämällä `export_database_id`, `export_sequence` ja `export_token`. Pelkkä päivämäärä ja kellonaika ei yksilöi riviä.
