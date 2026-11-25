---
slug: troubleshooting
category: Vianmääritys ja tietoturva
title: Vianmääritys
description: Selvitä kirjautumisessa, asennuksessa, muunnoksessa ja latauksessa ilmenevien ongelmien syy.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Ensimmäiset tarkistukset {#確認する順序}

1. **Tarkista [palvelun tila](/status/).** Selvitä, onko palvelussa yleinen häiriö tai huolto.
2. **Tarkista nykyinen työ.** Jos käynnistit jo muunnoksen, avaa sama työ kohdasta **Historia** tai aja komentorivillä `n624-latex jobs get <jobId>`.
3. **Tarkista diagnostiikkatiedot ja loki.** Avaa verkkosovelluksen tulossivun diagnostiikka. Tarkista komentoriviltä `.render/errors.json` ja yksityiskohtainen loki `.render/compile.log`.

## Yleisiä ongelmia {#代表的な問題}

### Asennus ja kirjautuminen {#インストール-ログイン}

- **Komentoa `n624-latex` tai `latex-render` ei löydy.**
  Avaa uusi pääte- tai PowerShell-ikkuna. Jos ongelma jatkuu, katso [PATH-muuttuja Linuxissa ja macOS:ssä](/fi/docs/client/#linux-macos) tai [Windowsin asennusohje](/fi/docs/windows/#インストール).
- **Verkkosovellukseen kirjautuminen epäonnistuu.**
  Käytä rekisteröityä tiliä ja ylläpitäjän ilmoittamaa menetelmää (salasana, OIDC tai Cloudflare Access). Jos yhteys ChatGPT:stä tai Claudesta pysähtyy, katso [etä-MCP-yhteyden tarkistaminen](/fi/docs/mcp/#chatgptなどの接続を確認する).
- **Komentorivityökalu palauttaa virheen `401` tai `403`.**
  Tarkista tallennettu avain komennolla `n624-latex auth status`. Pyydä ylläpitäjää varmistamaan, että avain on aktiivinen ja sillä on oikeudet `render:create` ja `render:read:own`. Tarvittaessa [tallenna avain uudelleen](/fi/docs/cli/#認証). Tarkista omalla palvelimella myös [palvelimen osoite (`LATEX_RENDER_BASE_URL`)](/fi/docs/cli/#接続先サーバー).

### Lähetys ja muunnos {#アップロード-変換}

- **ZIP-tiedoston pääasiakirjaa ei löydy.**
  Oletusaloitustiedosto on juuressa sijaitseva `main.tex`. Tarkista, pakkasitko mukaan yläkansion, tai anna asiakirjan suhteellinen polku. Katso [ZIP-tiedoston valmistelu](/fi/docs/projects/#構成).
- **Palvelu hylkää tiedoston koon tai päätteen vuoksi.**
  Poista tarpeettomat luodut tiedostot ja tiedostot, joita ei tueta, tai määritä `.latexrenderignore`. Tarkista [tuetut tiedostot ja rajoitukset](/fi/docs/projects/#制限).
- **Muunnos jää jonoon tai yhteys katkeaa.**
  Palvelin saattaa edelleen käsitellä työtä. Avaa sama tulossivu uudelleen tai tarkista saman työn tunnus ennen uuden työn luomista.
- **Paketteja tai fontteja puuttuu tai käännöksen aikaraja ylittyy.**
  Etsi saatavilla olevat nimet [käännösympäristöstä](/app/environment/). Jos aikaraja ylittyy, tarkista raskaat makrot, suuret kuvat ja TikZ-kaaviot kohdasta, johon loki päättyy.

### Tiedostojen lataaminen {#成果物の取得}

- **PDF on saatavilla, mutta SVG puuttuu.**
  Jos tilana on **Osittainen onnistuminen**, tallenna ensin PDF ja valitse **Yritä vain SVG:tä uudelleen**. Katso [SVG-tiedostojen muodostaminen uudelleen](/fi/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **PNG-esikatselua valmistellaan edelleen.**
  Odota hetki tai avaa sama sivu uudelleen. Voit ladata lopullisen PDF:n heti.
- **Kohde on käytössä tai näet virheen `OUTPUT_BUSY`.**
  Sulje tulos-PDF:ää käyttävä katseluohjelma tai odota, että samaan kansioon kirjoittava prosessi valmistuu. Yritä sitten latausta uudelleen.
- **Tulos on vanhentunut tai tallennustila on lopussa.**
  Muunna vanhentunut tulos uudelleen tallennetusta versiosta tai paikallisista tiedostoista. Jos kiintiösi on täynnä, poista tarpeettomia valmiita töitä. Jos palvelimen levy on täynnä, ota yhteys ylläpitäjään.

## Avun pyytäminen {#問い合わせ}

- **Palvelimen ylläpitäjä.** Kerro ongelman ajankohta, keskeytynyt toiminto, virhekoodi ja työn tunnus (`job_...`), jos se on tiedossa.
- **Julkinen ilmoitus GitHubissa.** Anna lyhyet toisto-ohjeet ilman salaisuuksia tai henkilökohtaisia asiakirjoja. **Älä koskaan julkaise API-avaimia, evästeitä, alkuperäistä asiakirjaa, PDF:ää tai kokonaisia siistimättömiä lokeja.**
