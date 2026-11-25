---
slug: lan-https
category: Oma palvelin
title: HTTPS lähiverkossa Akebilla
description: Käytä palvelinta sen paikallisesta IP-osoitteesta muodostetulla HTTPS-osoitteella.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Yhteys lähiverkon IP-osoitteen perusteella {#lan-の-ip-アドレスからアクセスする}

Akebi muuntaa palvelimen yksityisen IP-osoitteen HTTPS-yhteydellä käytettäväksi isäntänimeksi.

Määritä jaettu varmennepalvelu LaTeX Rendererin ohjatussa määrityksessä. Jos haluat tarjota oman palvelun, katso [Akebi-varmennepalvelun ylläpito](/fi/docs/lan-https-authority/).

- **IPv4-esimerkki.** Jos IP-osoite on `192.168.1.50` ja lähiverkon verkkotunnus `lan.example.org`, palvelun osoite on `https://192-168-1-50.lan.example.org`.
- **IPv6.** Isäntänimi sisältää tuetun yksityisen osoitteen kaikki kahdeksan ryhmää täydellisessä muodossa. Käytä täsmälleen määrityksen näyttämää osoitetta.

**Verkko- ja DNS-vaatimukset**
Asiakaslaitteen on päästävä palvelimen lähiverkkoon. Jos nimi ei ratkea, tarkista, estääkö reititin tai DNS-resolveri yksityiset IP-osoitteet sisältävät vastaukset **DNS rebinding -suojauksen** vuoksi. Lisää tarvittaessa poikkeus vain käytettävälle lähiverkon verkkotunnukselle.

## Varmennetyypin valitseminen {#証明書の方式を選ぶ}

| Menetelmä | Vaatimukset ja ominaisuudet |
| --- | --- |
| **Jaettu palvelu, julkinen varmentaja** | Määritä jaettu palvelu ja hyväksy varmentajan ehdot. Varmenteen yksityinen avain säilyy palvelimella. |
| **Oma palvelu, julkinen varmentaja** | [Oman Akebi-palvelun](/fi/docs/lan-https-authority/) osoite ja lähiverkon verkkotunnus sekä tarvittaessa kutsukoodi. |
| **Keyless** | Edellyttää yhteensopivaa palvelua, jolle allekirjoittaminen delegoidaan TLS-kättelyssä. |
| **Nykyinen varmenne tai yksityinen varmentaja** | Palvelimen nimeä vastaava varmenne ja sen yksityinen avain. Määritä yksityisen varmentajan juurivarmenne luotetuksi sekä palvelimella että kaikissa asiakaslaitteissa. |

> [!NOTE]
> - Julkisen varmentajan myöntämien varmenteiden isäntänimet näkyvät **julkisissa Certificate Transparency (CT) -lokeissa**.
> - Selain katsoo eri paikoissa sijaitsevat lähiverkot **samaksi alkuperäksi**, jos niissä on sama yksityinen IP-osoite ja lähiverkon verkkotunnus. Siten ne käyttävät samoja evästeitä ja muita selaimeen tallennettuja tietoja.

## Lähiverkkoyhteyden määrittäminen {#lan-向けに設定する}

1. [Valmistele palvelin](/fi/docs/self-hosting/#準備するもの) uutta asennusta varten ja avaa [ohjattu määritys](/fi/docs/server-setup/#ブラウザで開く) komennolla `sudo n624-latex server setup --web`. Käytä komentoa `sudo n624-latex server setup --ingress --web` muuttaaksesi palvelinta, jossa on hallittu erillinen HTTPS.
2. Valitse yhteystavaksi **LAN** ja anna verkkoliitäntä, yksityinen IP-osoite, sallitut asiakkaiden aliverkot ja HTTPS-portti.
3. Valitse varmennepalvelu ja menetelmä. Jaettu palvelu määrittää osoitteen `https://akebi.n624.net` ja lähiverkon verkkotunnuksen `lan.n624.net` sekä rekisteröi palvelimen, kun otat asetukset käyttöön. Kutsua ei tarvita. Tarkista ja hyväksy julkisen varmentajan ehdot. Jos oma palvelu käyttää kutsuja, anna ylläpitäjältä saamasi koodi.
4. Tarkista muodostettu HTTPS-osoite ja sallitut aliverkot ennen käyttöönottoa. Sovelluksen salasana- tai OIDC-tunnistautuminen pysyy käytössä.
5. Avaa osoite toisella laitteella sallitusta aliverkosta. Tarkista, ettei selain varoita varmenteesta, kirjaudu ja muunna testiasiakirja.

Jos haluat perustaa oman palvelun, katso [Akebi-varmennepalvelun ylläpito](/fi/docs/lan-https-authority/).

## Varmenteen tilan tarkistaminen {#証明書の状態を確認する}

Näillä komennoilla näet palvelun, uusimisajastimen ja nimiavaruuden lokit.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Jos myöntäminen tai uusiminen epäonnistuu, tarkista palvelimen kello, HTTPS-yhteys palveluun, verkkotunnus, IP-osoite ja varmentajan antama uusi yritysaika. Tilapäinen virhe säilyttää voimassa olevan varmenteen. Ajastin jatkaa myöntämistä tallennetusta tilasta. Jos avain ja tila eivät vastaa toisiaan, tarkista saman sukupolven säilytetyt tilatiedostot.

Katso [Akebin rakenne ja vianmääritys](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
