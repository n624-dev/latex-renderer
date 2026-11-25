---
slug: backups
category: Oma palvelin
title: Varmuuskopioiden luominen, tarkistaminen ja palauttaminen
description: Vertaile ajastettuja varmuuskopioita ja päivitysten palautuspisteitä, tarkista arkisto ja palauta tiedot.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Varmuuskopion sisältö {#何が保存されるか}

| Tyyppi | Sisältö | Käyttötarkoitus |
| --- | --- | --- |
| **Ajastettu varmuuskopio** | SQLite-tietokanta ja aktiivisten versioiden, luonnosten ja käynnissä olevien esikatselujen käyttämät syöte-ZIP-tiedostot | Tietokannan, projektien ja muokattavien asiakirjojen suojaaminen |
| **Päivityksen palautuspiste** | SQLite juuri ennen päivitystä, sovelluksen koko tallennustila ja aiemmat versiotiedot | Virheiden selvittäminen ja aiemman tilan palauttaminen |
| **Erillinen isäntäkoneen asetusten kopio** | Tiedostot kuten `/etc/latex-renderer/`, yksityiset avaimet, TLS-varmenteet ja Akebin tila | Isäntäkoneen rakentaminen uudelleen vian jälkeen |

- Kun olet palauttanut ajastetun varmuuskopion, avaa projekti editorissa luodaksesi esikatselun uudelleen. Väliaikaisten töiden tuloksia ja työvälimuisteja ei varmuuskopioida.
- Suojaa asetukset, varmenteet ja salauksen purkuavain (age-identiteetti) erikseen. **Säilytä salatut varmuuskopiot ja purkuavain eri turvallisissa paikoissa, jotta yksittäinen vahinko ei tuhoa molempia.**

## Varmuuskopion luominen käsin {#手動で作成する}

1. Kirjaudu omistajana ja avaa **Hallinta → Järjestelmä → Varmuuskopiot**.
2. Valitse **Luo varmuuskopio** ja odota toiminnon päättymistä.
3. Valitse **Tarkista uusin varmuuskopio**. Varmista viimeisimmän tarkistuksen tiedoista arkiston nimi ja ajankohta. Palvelimella täytyy olla purkuavain.

### Luominen ja tarkistaminen komentoriviltä {#コマンドで作成-検証する}

1. Luo salattu varmuuskopio heti palvelimella. Tiedostossa `/etc/latex-renderer/backup.env` asetus `BACKUP_DIRECTORY` määrittää tallennuspaikan. Oletus on `/var/lib/latex-renderer/backups`. Ajastin `latex-renderer-backup.timer` luo säännölliset kopiot.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopioi `.tar.age`-arkisto tarkistukseen käytettävälle Linux-koneelle. Tarvitset GNU `tar`- ja `age`-työkalut, tuetun Node.js-version (24 tai 26) ominaisuudella `node:sqlite` sekä purkuavaimen. Pidä pitkäaikaissäilytyksessä arkisto ja avain erillään.
3. [Lataa, tarkista ja pura](/fi/docs/self-hosting/#v1-6-9をダウンロードして検証) sen palvelinversion jakelupaketti, joka loi kopion. Anna kyseinen versio ensimmäisessä `version=`-arvossa, aseta `release_dir` osoittamaan purettuun kansioon ja aja jakelun komentosarja.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Kun näkyviin tulee `restore_test.completed`, tarkistus on valmistunut. Testi tarkistaa SQLiten eheyden ja väliaikaistilaan puretut syöte-ZIP-tiedostot. Myös muualla säilytetyn kopion voi tarkistaa noutamalla sen tallennuspaikastaan.

## Palautuspisteen tarkistaminen virheen jälkeen {#更新失敗後の復旧点を確認する}

Jos epäonnistuneen päivityksen jälkeen näkyy `RECOVERY_REVIEW_REQUIRED`, tarkista palautuspisteen tila ylläpitäjän oikeuksin.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Tilan tarkistaminen vanhemmissa versioissa
>
> Jos komentoa `n624-latex server recovery status` ei ole, suorita `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Vertaa pisteen tunnusta (`POINT_ID`), sovelluksen ja päivitysohjelman versioita, tietokantamallia ja käynnissä olevia palveluja. Jos joudut palauttamaan tietoja, kopioi ensin arkisto ja nykyiset asetukset toiseen paikkaan.
2. Suorita `acknowledge` vasta, kun olet selvittänyt tilanteen ja varmistanut, että tietoja ei tarvitse palauttaa ja pisteen suojauksen voi poistaa.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` päättää tarkistuksen ja jatkaa palvelujen toimintaa, jos tarvittavat ehdot täyttyvät. Jos palautat tietoja, jätä piste suojatuksi ja jatka seuraavaan kohtaan.

## Tietojen palauttaminen {#データを復旧する場合}

Kopioinnin jälkeiset muutokset menetetään. Jos tietokanta on yhteensopiva ja pelkän sovelluksen palautus riittää, käytä [Päivitykset-näkymän palautusta](/fi/docs/updates/#前の版へ戻す). Harjoittele tietojen palauttamista testikoneella ennen tuotantopalautusta.

1. **Valitse kohde ja säilytä nykytila.** Selvitä palautettava kopio ja sen tietokantamallia vastaava sovellusversio. Tallenna nykyinen tietokanta, tallennustila ja asetukset erikseen ennen tuotantoon tehtäviä muutoksia.
2. **Pysäytä palvelut.** Käytä yhteistä hallintalukkoa ja pysäytä kaikki tietokantaan tai tallennustilaan kirjoittavat palvelut ja ajastimet. Näin päivitys tai siivous ei muuta tietoja samaan aikaan.
3. **Pura ja tarkista.** Pura salaus ja arkisto tyhjään yksityiseen kansioon ja tarkista eheys. Jos käytät päivityksen palautuspistettä, vertaa myös rootin hallitsemaa tiedostoa `summary.json` arkiston sisäiseen manifestiin.
4. **Palauta yhden ajankohdan tiedot.** SQLiten sekä syötteiden ja tulosten tallennustilan on oltava **samasta palautuspisteestä**. Jos käytät ajastettua kopiota, sijoita kukin syöte-ZIP palautetun tietokannan ilmoittamaan tarkistettuun `storage_key`-sijaintiin. Käytä vastaavia versioita, asetustiedostoja, omistajia ja käyttöoikeuksia.
5. **Käynnistä ja tarkista.** Testaa kirjautuminen, tallennetun projektin muunnos, tulosten lataus ja uuden varmuuskopion luonti. Jos tarkastuslokin vienti pysähtyy kohdistimen sijaintieroon, seuraa [tarkastuslokin palautusohjetta](/fi/docs/reference/#監査ログの復旧).

Katso [käyttövarmuuskopioiden muoto ja tarkistukset](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) sekä [päivitysten palautuspisteiden rakenne](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
