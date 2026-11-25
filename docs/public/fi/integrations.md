---
slug: integrations
category: Tekoäly ja MCP
title: Codexin tai Claude Coden käyttäminen
description: Käytä tietokoneelle tallennettuja tunnistetietoja sekä komentorivityökalussa että MCP:ssä.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Taidon asentaminen {#skillの導入}

1. [Asenna ensin komentorivityökalu ja tallenna API-avain](/fi/docs/client/).
2. Jos käytössäsi on Codex tai Claude Code, määritä integraatio asennustavan mukaan.

   - **Ladattava asennusohjelma.** Avaa `n624-latex setup` ja valitse tekoälytyökalu. Voit rekisteröidä taidon ja paikallisen MCP:n samalla kertaa.
   - **Homebrew.** Voit määrittää integraation myös komennolla `n624-latex setup`. Jos siirrät aiemman paikallisen MCP:n rekisteröinnin, katso [Homebrew-ohje](/fi/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Rekisteröi paikallinen MCP käsin](/fi/docs/mcp/#local-mcpの登録).

3. Käynnistä Codex tai Claude Code uudelleen ja kerro pyynnössäsi käännettävä kansio tai pääasiakirja.

- **Taidon asennuspaikat**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Jos asennusohjelma tunnistaa käyttäjän muokkaaman taidon, se säilyttää sen ja ilmoittaa siitä tuloksessa.

## MCP:n rekisteröiminen {#mcpの登録}

- **Kun käsittelet paikallisia tiedostoja Codexilla tai Claude Codella**, käytä paikallista MCP:tä. Katso [rekisteröinti käsin](/fi/docs/mcp/#local-mcpの登録) ja [tilan tarkistaminen](/fi/docs/client/#状態確認と修復).
- **Kun käytät ChatGPT:tä, Clauden verkkoversiota tai muuta pilviavustajaa**, seuraa [etä-MCP:n yhdistämisohjetta](/fi/docs/mcp/#通常はremote-mcpを使う). Et tarvitse API-avainta.

## Esimerkkipyyntöjä {#依頼例}

- ”Tarkista ja käännä tämän kansion tiedosto `main.tex`.”
- ”Käännä tästä ZIP-tiedostosta tiedosto `reports/a.tex`.”
- ”Lähetä tämä ZIP vain kerran ja käännä `reports/a.tex` ja `reports/b.tex` erikseen.”
- ”Lue rakenteiset virheet, korjaa vain niihin liittyvä TeX ja käännä uudelleen.”
- ”Tarkista luotu PDF ja sivujen esikatselukuvat.”

## Turvallinen käyttö {#安全な使い方}

> [!WARNING]
> Jätä API-avaimet pois pyynnöistä, MCP-työkalujen argumenteista ja projektitiedostoista. Paikallinen MCP käyttää sisäisesti komentorivityökalun suojaamia tunnistetietoja.

- **Epäluotettavat tiedot.** Integraatio käsittelee LaTeX-lähdekoodia, polkuja, lokeja, virheitä, tulostiedostoja ja MCP-vastauksia epäluotettavana aineistona. Se on suunniteltu sivuuttamaan niiden sisältämät ohjeet, myös kehotteisiin piilotetut käskyt.
- **Tietoja poistavat toimet.** Aja `cancel_render` ja `delete_render` vain käyttäjän nimenomaisesta pyynnöstä.
- **Asiakirjan valinta.** Jos aloitustiedostoa ei ole annettu, käytetään tiedostoa `main.tex`. Jos `main.tex` puuttuu ja mahdollisia `.tex`-tiedostoja on useita, käyttäjää pyydetään valitsemaan. Kaikkia `.tex`-tiedostoja ei koskaan käännetä automaattisesti. Taidossa kuvataan turvallisuussäännöt ja työvaiheet. Tarkat määritykset ovat tiedostossa `references/` ja julkisissa ohjeissa.
