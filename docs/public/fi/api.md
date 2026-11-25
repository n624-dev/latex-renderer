---
slug: api
category: API
title: Julkinen API
description: Lähetä ZIP HTTP:n kautta, seuraa muunnosta ja lataa PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Työnkulku {#利用の流れ}

Tarvitset käännösrajapinnan API-avaimen (`lrk_...`) ja [tuetun ZIP-tiedoston](/fi/docs/projects/#構成). Kokeile koko työnkulkua [curl-esimerkillä](#curlの例).

1. **Varaa syöte.** Laske ZIP-tiedoston koko tavuina ja sen SHA-256-tiiviste. Varaa tiedostokokonaisuus (Source) pyynnöllä `POST /api/v1/source-tickets`.
2. **Lähetä ZIP.** Vain jos `uploadRequired` on `true`, lähetä ZIP palautettuun osoitteeseen lyhytikäisen tunnisteen `uploadTicket` avulla käyttäen menetelmää `PUT`. Saman käyttäjän identtinen ja kelvollinen ZIP käytetään uudelleen, jos se on jo palvelimella.
3. **Luo työ.** Anna valmis `sourceId` ja pääasiakirjan suhteellinen polku (`entrypoint`) pyynnössä `POST /api/v1/render-tickets`. Voit myös käyttää yksittäiselle muunnokselle [aiempaa työnkulkua](#ジョブ作成), jossa vaiheet 1–3 on yhdistetty.
4. **Tarkista tila ja lataa tulokset.** Kysele tila säännöllisesti lyhytikäisellä tunnisteella `jobTicket` osoitteesta `GET /api/v1/jobs/{jobId}` ja nouda työn päätteeksi PDF ja muut tiedostot.

OpenAPI-määritykset kattavat [varaukset ja töiden luomisen (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) sekä [syötteiden lähettämisen ja tulosten lataamisen (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Tunnistautuminen ja käyttöoikeudet {#認証とスコープ}

Lähetä kaikki tunnistetiedot HTTP-otsakkeessa `Authorization: Bearer <TOKEN>`.

- **API-avain (`lrk_...`).** Avaimella varataan syötteitä, luodaan töitä, käsitellään projekteja, myönnetään töille uusia tunnisteita (`job-tickets`) ja yritetään SVG-vaihetta uudelleen.
  - `render:create` sallii töiden luomisen, projektien luomisen, nimeämisen ja poistamisen sekä versioiden tallentamisen.
  - `render:read:own` sallii omien töiden lyhytikäisten tunnisteiden uusimisen sekä projektien ja historian lukemisen.
- **Lyhytikäiset tunnisteet (`uploadTicket` ja `jobTicket`).** Niillä lähetetään ZIP, tarkistetaan tila, perutaan työ, ladataan tiedostoja tai poistetaan työ.

> [!WARNING]
> Pidä API-avain, `uploadTicket` ja `jobTicket` poissa lokeista, URL-osoitteiden kyselymerkkijonoista ja syöte-ZIP-tiedostoista.

> [!NOTE]
> **Työ kuuluu sen luoneelle avaimelle.** Toisella avaimella ei voi uusia tunnistetta `job-tickets`, saada samaa luontivastausta samalla `Idempotency-Key`-arvolla tai yrittää SVG-vaihetta uudelleen, vaikka avain kuuluisi samalle käyttäjälle tai palvelutilille. Palvelin palauttaa `404`. Alkuperäisen avaimen mitätöinti ei siirrä omistajuutta. Saman käyttäjän avaimet voivat käyttää samoja syötteitä ja projekteja. Toisella avaimella voidaan luoda jaetusta syötteestä **uusi työ** uudella `Idempotency-Key`-arvolla.

## API:n päätepisteet {#apiエンドポイント}

| Menetelmä | Polku | Tarkoitus |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Varaa syöte tai käytä uudelleen saman käyttäjän ZIP-tiedostoa |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Lähetä ja tarkista syöte-ZIP |
| `POST` | `/api/v1/render-tickets` | Luo työ syötteestä, yritä SVG-vaihetta uudelleen tai varaa lähetys yksittäiselle työlle |
| `POST` | `/api/v1/job-tickets/{jobId}` | Myönnä omalle työlle uusi `jobTicket` |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Lähetä ZIP suoraan aiemmassa yksittäisen työn työnkulussa |
| `GET` | `/api/v1/jobs/{jobId}` | Hae työn tila ja virheet |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Peru jonossa tai käynnissä oleva työ |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Hae PDF, lokit, rakenteiset virheet tai SVG:t |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Hae esikatselu `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Merkitse päättynyt työ poistettavaksi |
| `GET` / `POST` | `/api/v1/projects` | Luettele tai luo tallennettuja projekteja |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Hae tiedot ja versiot, nimeä projekti uudelleen tai poista se (piilottaa tietueen) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Tallenna valmis syöte muuttumattomaksi versioksi |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Hae version työhistoria |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Muunna versio uudelleen |

> [!DETAILS] Tallennetut projektit ja huoltotilat
>
> - **Projektien parametrit.** Sivuta luettelot, tiedot ja työhistoria parametreilla `cursor` ja `pageSize`. Tallenna versio (`POST .../revisions`) antamalla `sourceId`, `entrypoint` (suhteellinen polku `.tex`-tiedostoon), `displayName`, `originalFilename` ja `outputs`. Jos projekti, syöte ja aloitustiedosto täsmäävät, nykyistä versiota käytetään uudelleen. Version muunnos (`POST .../render`) vaatii 16–200 merkin pituisen `Idempotency-Key`-arvon. Jos `outputs` jätetään pois, käytetään alkuperäisiä asetuksia.
> - **Huoltotilan rajoitukset**
>   - `reject-new-jobs` sallii projektien tarkastelun, uudelleennimeämisen ja poistamisen, versioiden tallentamisen ja syötteiden valmistelun. Uudet työt hylätään.
>   - `read-only` ja `lockdown` estävät projekteihin tehtävät muutokset sekä syötteiden varaukset, lähetykset, versiot ja viittaukset. Jo varatun lähetyksen tila tarkistetaan uudelleen ennen julkaisua. Lähetystä ei viimeistellä, jos uusi tila estää sen.

## Työn luominen {#ジョブ作成}

### Tapa 1. Valmistele uudelleenkäytettävä syöte ennen työn luomista (suositus) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Varaa syöte.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Lähetä ZIP vain, kun `uploadRequired: true`. Sen koon ja SHA-256-tiivisteen on vastattava varausta täsmälleen. Onnistuneen vastauksen HTTP-tila on `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Luo työ valmiin `sourceId`-arvon avulla. Asetuksen `entrypoint` oletus on `main.tex` ja asetuksen `outputs` oletus on `["pdf"]`. Pelkkää tulostetta `["svg"]` ei voi pyytää.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

Vastauksesta puuttuvat `uploadTicket` ja `uploadUrl`, koska ZIP on jo käytettävissä.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Tapa 2. Varaa lähetys ja lähetä ZIP suoraan yhdelle työlle {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Lähetä ZIP palautettuun `uploadUrl`-osoitteeseen (`/api/v1/jobs/{jobId}/source`) käyttäen tunnistetta `uploadTicket` ja menetelmää `PUT`. Onnistuneen vastauksen HTTP-tila on `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Syötteiden säilytys ja Idempotency-Key
>
> - **Viittaamattomat syötteet ja viittaukset.** Valmis syöte, johon mikään aktiivinen versio tai työ ei viittaa, siivotaan oletuksena tunnin kuluttua. Myös päättyneet työt lasketaan viittauksiksi tiloja `deleted` ja `expired` lukuun ottamatta. Ylläpitäjä voi säätää asetusta `source_orphan_retention_minutes` välillä 5 minuuttia – 24 tuntia. Kelvollinen viittaus säilyttää syötteen uudelleenkäytettävänä tämän ajan jälkeenkin. Jos aika on jo päättynyt viimeisen viittauksen poistuessa, syöte ei ole enää käytettävissä ja voidaan siivota. Viittaus ei palauta keskeneräistä tai poistettavana olevaa syötettä valmiiksi.
> - **Kentän `expiresAt` merkitys.** Ennen lähetystä arvo kertoo keskeneräisen varauksen vanhenemisajan (10 minuuttia). Valmiilla syötteellä se kertoo, milloin syöte vanhenisi ilman viittauksia. Sama koskee verkkoa, HTTP API:a ja MCP:tä. MCP:n `sourceRef` on voimassa enintään 15 minuuttia eikä pidennä syötteen säilytystä.
> - **Kentän `Idempotency-Key` käsittely.** Kun sama ZIP käytetään uudelleen, avain rekisteröidään 24 tunniksi hyväksynnästä. Pyynnön toistaminen ei pidennä aikaa. Voimassaoloaikana eri sisältö palauttaa `409`, vanhentunut alkuperäinen syöte `410`, poistettu syöte `404` ja keskeneräinen lähetys `409`. Voit käyttää avainta uudelleen 24 tunnin kuluttua odottamatta ajastettua siivousta. Alkuperäinen syöte ei tällöin palaudu.

### PDF:n lataaminen ennen SVG-tiedostoja ja SVG-vaiheen uudelleenyritys {#pdfの先行公開とsvgの再試行}

Katso verkon ja komentorivin käyttöohjeet kohdasta [PDF-, PNG- ja SVG-tiedostojen noutaminen](/fi/docs/outputs/).

- **Varhainen saatavuus ja `stages`.** PDF- ja SVG-työssä voit noutaa tarkistetun PDF:n ja esikatselut ennen SVG-vaiheen päättymistä. Koko työn `status` kertoo kokonaistuloksen. `stages.pdf` (sekä `sha256`) ja `stages.svg` (sekä `attempt`) kertovat kummankin vaiheen tilan, päättymisajan ja virheet. Arvoja ei päätellä vanhoille töille.
- **Vain SVG-vaiheen uudelleenyritys.** Käytä pyyntöä `POST /api/v1/render-tickets` API-avaimella (tunnistetta `jobTicket` ei hyväksytä). Anna rungoksi `{"retrySvgJobId":"job_..."}` ja lisää `Idempotency-Key`. Vastaus sisältää alkuperäisen `jobTicket`-arvon. Muodostus toistetaan kääntämättä PDF:ää uudelleen ja pidentämättä säilytysaikaa. Jos syöte, PDF ja suoritusympäristö vastaavat alkuperäisiä, yrityksiä sallitaan yhteensä kahdeksan ensimmäinen mukaan lukien. SVG-diagnostiikka on kohteissa `svg/compile.log`, `svg/errors.json` ja `svg/dependencies.json`.

> [!DETAILS] Tiedoston `svg/manifest.json` koordinaatit ja skeema (schemaVersion 2)
>
> SVG:t tallennetaan nimillä `svg/objects/math-NNNNNN.svg` tai `tikz-NNNNNN.svg` työkalujen `Content-Type: image/svg+xml` ja `Content-Disposition: attachment` avulla. Jos objektimäärä poikkeaa odotetusta tai sisällössä on aktiivisia elementtejä (ulkoisia viitteitä, komentosarjoja tai tapahtumamääritteitä), koko työ epäonnistuu. `svg/manifest.json` kertoo vastaavuudet. Uudet tulokset käyttävät aina versiota `schemaVersion: 2`. Version `1` lukua tuetaan edelleen.
>
> - **Koordinaatit (`coordinateSystem`).** `id` ja `page` alkavat arvosta 1. Yksikkö on PDF-piste (1/72 tuumaa). Origo on vasemmassa yläkulmassa, x kasvaa oikealle ja y alaspäin.
> - **Tunnettu sijainti (`placementStatus: "known"`)**
>   ```json
>   {
>     "id": 1,
>     "kind": "math",
>     "artifact": "svg/objects/math-000001.svg",
>     "sourceFile": "chapters/formula.tex",
>     "sourceLine": 18,
>     "placementStatus": "known",
>     "page": 2,
>     "x": 123.4,
>     "y": 85.2,
>     "width": 210.6,
>     "height": 32.8
>   }
>   ```
> - **Tuntematon sijainti (`placementStatus: "unknown"`).** Jos SyncTeX ei pysty erottamaan esimerkiksi samalla rivillä olevia lausekkeita, `page`, `x` ja `y` jätetään pois koordinaattien arvaamisen sijaan. Tällöin `width` ja `height` kuvaavat muodostetun SVG:n kokoa, eivät sen sijaintia PDF:ssä. Tarkista `schemaVersion` ja `placementStatus` ennen objektin sijoittamista PDF:n päälle.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## ZIP-tiedoston lähettäminen {#zipアップロード}

Tässä päätepisteessä lähetetään ZIP aiemmalla työnkululla varattuun työhön. Käytä erikseen valmistellulle syötteelle päätepistettä `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Työn tilat {#ジョブ状態}

| Tila | Merkitys | Asiakkaan toimenpide |
| --- | --- | --- |
| `reserved` / `uploading` | Varattu tai lähetys käynnissä | Lähetä ZIP ennen varauksen vanhenemista |
| `queued` / `validating` / `running` | Jonossa, tarkistettavana tai käännettävänä | Odota tilakyselyjen välillä |
| `succeeded` | Onnistunut | Lataa PDF ja tarvittavat tiedostot |
| `failed` / `timeout` / `rejected` | Epäonnistunut, aikakatkaisu tai hylätty | Tarkista virheet |
| `canceled` | Peruttu | Luo tarvittaessa uusi työ |
| `deleting` / `deleted` / `expired` | Poistettavana, poistettu tai vanhentunut | Luo tarvittaessa uusi työ |

**Säilytys ja käynnissä olevien latausten suojaus**
Kun `ARTIFACT_RETENTION_HOURS` (oletuksena 24 tuntia) on kulunut työn päättymisestä tai vanhan työn viimeisimmästä päivityksestä, jos päättymisaikaa ei ole, uusia latauksia ei voi aloittaa, vaikka tiedostoja ei olisi vielä siivottu. Tämä koskee verkkoa, API:a, käännöspalvelua ja etä-MCP:tä. Ajoissa alkaneet lataukset, ZIP-noudot ja MCP-lukuoperaatiot uusivat poiston estävää varausta vain tiedonsiirron aikana. Varaus vapautuu siirron valmistuttua tai yhteyden sulkeutuessa. Poikkeavasti katkenneen siirron varaus vanhenee viiden minuutin kuluttua viimeisestä uusimisesta. Jos uusiminen epäonnistuu, siirto keskeytetään. Vanhentuneita tiedostoja ei aktivoida uudelleen.

## Yleisimmät virheet {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP-tila | Merkitys | Milloin kannattaa yrittää uudelleen |
| --- | --- | --- |
| `400` | Virheellinen syöte, otsaketiedot tai ZIP-sisältö | Korjaa tiedot ennen lähettämistä |
| `401` / `403` | Tunniste ei kelpaa, on vanhentunut tai sen oikeudet eivät riitä | Tarkista tunnistetiedot ja käyttöoikeudet |
| `404` / `410` | Työtä tai tiedostoa ei löydy, se kuuluu toiselle avaimelle tai syöte on vanhentunut | Luo tarvittaessa uusi työ |
| `409` | Ristiriitainen tila tai `Idempotency-Key`-ristiriita | Tarkista nykyinen tila |
| `429` / `503` | Liikaa pyyntöjä, kapasiteetti lopussa, jono täynnä tai huolto käynnissä | Odota ennen uutta yritystä |

## curl-esimerkki {#curlの例}

Tämä Linuxin Bash-esimerkki tekee varauksen, lähettää tiedoston `source.zip`, kyselee tilaa kahden sekunnin välein enintään 60 kertaa ja tallentaa PDF:n. Aja se ZIP-tiedoston kansiossa. Tarvitset työkalut `curl`, `jq`, `sha256sum` ja `uuidgen`. Jos käytät omaa palvelinta, vaihda `base`.

> [!DETAILS] ZIP-tiedoston lähettäminen ja PDF:n lataaminen
>
> ```bash
> (
>   set -euo pipefail
>   base=https://latex-render.n624.jp
>   zip=source.zip
>   read -rs -p 'Rendering API key: ' api_key
>   printf '\n'
>   size=$(wc -c < "$zip")
>   digest=$(sha256sum "$zip")
>   idempotency_key=$(uuidgen)
>   request=$(jq -n --argjson size "$size" --arg sha "${digest%% *}" \
>     '{size: $size, sha256: $sha}')
>
>   reservation=$(curl -fsS "$base/api/v1/render-tickets" \
>     --header @- \
>     -H "Idempotency-Key: $idempotency_key" \
>     -H 'Content-Type: application/json' --data "$request" <<< "Authorization: Bearer $api_key")
>   job_id=$(jq -er '.jobId' <<< "$reservation")
>   token=$(jq -er '.jobTicket' <<< "$reservation")
>   upload_token=$(jq -er '.uploadTicket' <<< "$reservation")
>   printf 'Job ID: %s\n' "$job_id"
>
>   curl -fsS --upload-file "$zip" "$base/api/v1/jobs/$job_id/source" \
>     --header @- \
>     -H 'Content-Type: application/zip' <<< "Authorization: Bearer $upload_token"
>
>   for attempt in {1..60}; do
>     status=$(curl -fsS "$base/api/v1/jobs/$job_id" \
>       --header @- <<< "Authorization: Bearer $token" | jq -er '.status')
>     case "$status" in
>       succeeded)
>         curl -fsS "$base/api/v1/jobs/$job_id/artifacts/result.pdf" \
>           --header @- --output result.pdf <<< "Authorization: Bearer $token"
>         printf 'Saved result.pdf\n'
>         exit 0
>         ;;
>       reserved|uploading|queued|validating|running) sleep 2 ;;
>       *) printf 'Job %s: %s\n' "$job_id" "$status" >&2; exit 1 ;;
>     esac
>   done
>   printf 'Job %s is still pending; check the same job later.\n' "$job_id" >&2
>   exit 1
> )
> ```

Jos työ on kesken 60 kyselyn jälkeen, käytä näytettyä tunnusta `jobId` saman työn kyselyyn myöhemmin. Jos `jobTicket` vanhenee, kutsu päätepistettä `POST /api/v1/job-tickets/{jobId}` työn luoneella API-avaimella. Seuraavissa esimerkeissä tehdään varaus ja lähetetään ZIP.

## PowerShell {#powershell}

> [!DETAILS] PowerShell-esimerkki
>
> ```powershell
> $zip = Resolve-Path .\source.zip
> $bytes = [IO.File]::ReadAllBytes($zip)
> $sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
> $headers = @{
>   Authorization = "Bearer $env:LATEX_RENDER_API_KEY"
>   "Idempotency-Key" = [guid]::NewGuid().ToString()
> }
> $ticket = Invoke-RestMethod -Method Post `
>   -Uri https://latex-render.n624.jp/api/v1/render-tickets `
>   -Headers $headers -ContentType application/json `
>   -Body (@{size=$bytes.Length;sha256=$sha} | ConvertTo-Json)
> Invoke-WebRequest -Method Put -Uri $ticket.uploadUrl `
>   -Headers @{Authorization="Bearer $($ticket.uploadTicket)"} `
>   -ContentType application/zip -InFile $zip
> ```

## JavaScript / TypeScript {#javascript-typescript}

> [!DETAILS] JavaScript- ja TypeScript-esimerkki
>
> ```typescript
> import { readFile } from "node:fs/promises";
> import { createHash, randomUUID } from "node:crypto";
>
> const zip = await readFile("source.zip");
> const sha256 = createHash("sha256").update(zip).digest("hex");
> const response = await fetch(
>   "https://latex-render.n624.jp/api/v1/render-tickets",
>   {
>     method: "POST",
>     headers: {
>       Authorization: "Bearer " + process.env.LATEX_RENDER_API_KEY,
>       "Content-Type": "application/json",
>       "Idempotency-Key": randomUUID(),
>     },
>     body: JSON.stringify({ size: zip.length, sha256 }),
>   },
> );
> if (!response.ok) throw new Error(`Reservation failed: ${response.status}`);
> const ticket = await response.json();
> const upload = await fetch(ticket.uploadUrl, {
>   method: "PUT",
>   headers: {
>     Authorization: "Bearer " + ticket.uploadTicket,
>     "Content-Type": "application/zip",
>   },
>   body: zip,
> });
> if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
> ```

## Python {#python}

> [!DETAILS] Python-esimerkki
>
> ```python
> import hashlib
> import os
> import pathlib
> import uuid
>
> import requests
>
> data = pathlib.Path("source.zip").read_bytes()
> headers = {
>     "Authorization": "Bearer " + os.environ["LATEX_RENDER_API_KEY"],
>     "Idempotency-Key": str(uuid.uuid4()),
> }
> response = requests.post(
>     "https://latex-render.n624.jp/api/v1/render-tickets",
>     headers=headers,
>     json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
> )
> response.raise_for_status()
> ticket = response.json()
> requests.put(
>     ticket["uploadUrl"],
>     headers={
>         "Authorization": "Bearer " + ticket["uploadTicket"],
>         "Content-Type": "application/zip",
>     },
>     data=data,
> ).raise_for_status()
> ```
