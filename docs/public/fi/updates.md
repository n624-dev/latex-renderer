---
slug: updates
category: Oma palvelin
title: Palvelimen päivittäminen ja edellisen version palauttaminen
description: Ota vakaa versio käyttöön, tarkista päivityksen tulos ja valitse palautustapa, jos päivitys epäonnistuu.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Ennen päivitystä {#更新する前に}

| Päivitettävä kohde | Päivityspaikka |
| --- | --- |
| Palvelinsovellus | **Hallinta → Päivitykset** |
| TeX Liven versio tai kielituki | **Hallinta → TeX-ympäristö**. Katso [TeX-ympäristön vaihtaminen](/fi/docs/self-hosting/#tex環境の初期設定). |
| Paikallinen APT-paketti `n624-latex` | [APT-paketin päivittäminen](/fi/docs/client/#apt-版の更新) |

Tarkista kolme asiaa ennen kuin aloitat.

1. [Luo ja tarkista salattu varmuuskopio](/fi/docs/backups/#手動で作成する).
2. Valitse ajankohta, jolloin aktiivisia muunnostöitä on vähän.
3. Jätä huoltotilan asetukseksi `normal`. Päivitysohjelma pysäyttää ja käynnistää tarvittavat palvelut sekä suorittaa koemuunnoksen.

## Vakaan version asentaminen {#正式版を適用する}

1. Kirjaudu omistajana ja avaa **Hallinta → Päivitykset** (`/admin/updates/`).
2. Jätä versiokenttä tyhjäksi ja valitse **Tarkista päivitykset**. Näet nykyisen ja saatavilla olevan vakaan version.
3. Valitse **Lataa, tarkista ja päivitä**, anna muutoksen syy ja käynnistä päivitys.
4. Kirjaa muistiin **toiminnon tunnus** ja tarkista tilasta, että toiminto onnistui.
   - Jos sovellus on jo ajan tasalla mutta päivitysohjelma tarvitsee päivityksen, tarkista saman toiminnon tulos ja päivitysohjelman tiedot.
   - Toiminto jatkuu, vaikka suljet selaimen. Jos käynnistyksen aikana näkyy `502`, odota, että käyttöliittymä muodostaa yhteyden uudelleen.
5. Kirjaudu toisella selaimella tai yksityisessä ikkunassa. Muunna tyypillinen asiakirja, tarkista PDF-lataus sekä sovelluksen ja päivitysohjelman versiot.

## Ilmoitukset ja automaattiset päivitykset {#通知と自動更新}

Voit valita päivityskäytännöksi tarkistuksen ja ilmoituksen (oletus) tai päivityksen automaattisen asennuksen tarkistuksen jälkeen.

- Automaattinen asennus koskee vain vakaita julkaisuja.
- Jos haluat kokeilla julkaisuehdokasta erillisessä testiympäristössä, määritä julkaistu tunniste muodossa `vX.Y.Z-rc.N`.

## Päivityksen epäonnistuessa {#更新が失敗した場合}

Tarkista toiminnon tunnus ja virheeseen päättynyt vaihe yksityiskohtaisesta lokista. Tarkista sovelluksen ja päivitysohjelman versiot, kirjautuminen, muunnos sekä palautuspisteen tarkistustarve. Pelkkä versionumero ei riitä.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Tarkista, onko huolto käynnissä, ja palauta tila asentoon `normal` ennen päivityksen aloittamista.
- **`RECOVERY_REVIEW_REQUIRED`.** Seuraa ohjetta [palautuspisteen tarkistaminen virheen jälkeen](/fi/docs/backups/#更新失敗後の復旧点を確認する).

## Edelliseen versioon palaaminen {#前の版へ戻す}

- **Jos pelkkä sovelluksen palautus riittää**, tarkista kohde kohdasta **Hallinta → Päivitykset** ja valitse **Palauta edelliseen versioon**, jos toiminto on saatavilla. Testaa sen jälkeen kirjautuminen ja PDF-muunnos.
- **Jos tietokantamuutos ei ole yhteensopiva**, palauta tietokanta ja tallennustila samasta palautuspisteestä. Seuraa [tietojen palautusohjetta](/fi/docs/backups/#データを復旧する場合).

Katso [vanhojen versioiden siirto ja palautus](/fi/docs/reference/#旧版からの移行と特殊復旧) sekä [päivitysohjelman määritys ja säilytyskäytäntö](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
