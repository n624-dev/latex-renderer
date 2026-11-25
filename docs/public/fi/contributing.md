---
slug: contributing
category: Kehitys ja osallistuminen
title: Ohjeiden kehittäminen
description: Muokkaa Markdown-ohjeita ja tarkista muutokset paikallisesti.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Ohjeen muokkaaminen {#本文を編集する}

- **Ilmoita virheestä.** Jos ohje poikkeaa käyttöliittymästä tai komennoista, tee ilmoitus [GitHub Issuesissa](https://github.com/n624-dev/latex-renderer/issues/new/choose). Kerro sivu ja ehdota korjausta.
- **Lähetä muutosehdotus.** Muokkaa vastaavaa tiedostoa [julkisten ohjeiden Markdown-lähteissä (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) ja avaa pull request.

## Paikalliset tarkistukset {#ローカル検証}

Aja muokkauksen jälkeen seuraavat komennot. Varmista, että koonti sekä linkkien ja otsaketietojen tarkistukset onnistuvat.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

Kohteen `public-web` koonti tekee Wranglerilla koeajon ja käynnistää paikallisen Workers-ympäristön. Siinä tarkistetaan valikoidut sivut, hakuhakemisto, 404-vastaukset, uudelleenohjaukset ja otsaketiedot.

## Yhteensopivuus {#互換性}

- Säilytä julkiset polut ja otsikoiden ankkurit (otsikkotekstistä muodostettavat `#...`-osat). Jos muutat otsikkoa, tarkista muilta sivuilta tulevat linkit.
- Kun muutat komentorivivalitsimia tai HTTP-pyyntöesimerkkejä, tarkista ne toteutusta ja OpenAPI-määrityksiä vasten.
