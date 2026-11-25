---
slug: lan-https-authority
category: Oma palvelin
title: Akebi-varmennepalvelun ylläpito
description: Määritä lähiverkon verkkotunnuksen DNS-delegointi, varmenteiden myöntäminen sekä avoin tai kutsuun perustuva rekisteröinti.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Tämä ohje on tarkoitettu omaa varmennepalvelua ylläpitäville. Jos käytät LaTeX Rendererin kanssa jaettua palvelua, katso [HTTPS lähiverkossa Akebilla](/fi/docs/lan-https/).

Tarvitset delegoitavan DNS-vyöhykkeen, julkista DNS:ää ja HTTPS:ää palvelevan Linux-koneen (amd64 tai arm64), Node.js:n version 24 tai 26 sekä tilin varmentajalla. Käytä palvelinjakelua, jonka allekirjoituksen olet tarkistanut [käsin tehtävän latauksen ohjeella](/fi/docs/self-hosting/#v1-6-9をダウンロードして検証).

## DNS:n delegoiminen {#dns-を委任する}

Määritä seuraavat tietueet ylemmän verkkotunnuksen vyöhykkeeseen. Akebin DNS-palvelun tulee olla saavutettavissa internetistä **portissa 53 sekä UDP:llä että TCP:llä**.

| Tyyppi | Nimi | Arvo |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebin DNS-palvelimen julkinen IPv4-osoite |
| `A` | `akebi.example.org` | Akebin API:n HTTPS-käänteisvälityspalvelimen julkinen IPv4-osoite |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Varaa `ns1.example.org` DNS:lle ja sijoita API-palvelin (`akebi.example.org`) lähiverkon varmennevyöhykkeen (`lan.example.org`) ulkopuolelle.
- Delegoinnin jälkeen Akebi vastaa dynaamisesti lähiverkon IP-osoitteista johdetuilla `A`- ja `AAAA`-tietueilla sekä ACME-tarkistuksen `TXT`-tietueilla. Ylävyöhykkeeseen ei tarvitse lisätä tietuetta jokaiselle IP-osoitteelle.

## Palvelun käyttöönotto {#サービスを配置する}

1. **Luo käyttäjä ja tilahakemistot.** Erota palvelun oikeudet sovelluksen oikeuksista luomalla oma käyttäjä ja ryhmä nimellä `latex-renderer-lan-authority`. Luo näiden omistukseen `/var/lib/latex-renderer-lan-authority` ja sen alihakemisto `keyless`. Aseta kummankin tilaksi `0700`.
2. **Valmistele asetushakemisto.** Luo `/etc/latex-renderer-lan-authority`, aseta omistajaksi ja ryhmäksi `root:latex-renderer-lan-authority` ja tilaksi `0750`. Kopioi sinne tarkistetusta jakelusta `deploy/lan-https/examples/authority.json` ja aseta sille omistajaksi ja ryhmäksi `root:latex-renderer-lan-authority` sekä tilaksi `0640`.
3. **Muokkaa tiedostoa `authority.json`.**
   - `policy.serverOrigin` on API:n HTTPS-osoite, esimerkiksi `https://akebi.example.org`.
   - `policy.lanDomain` on delegoitu lähiverkon verkkotunnus, esimerkiksi `lan.example.org`.
   - `dns.nameserver` ja `dns.listeners` määrittävät julkisen DNS-palvelimen nimen ja kuunteluosoitteet. Jos toinen DNS-palvelu käyttää porttia 53, valitse vapaa julkinen IP-osoite.
   - Sido `http` paikalliseen silmukkaliitäntään.
   - Määritä julkinen varmentaja kohdassa `issuers`. Jos varmentaja vaatii External Account Bindingin (EAB), tallenna ohjeen mukaiseen tiedostoon `eabFile`, jonka omistaa palvelun käyttäjä ja jonka tila on `0600`, arvot `kid` ja `hmacKey`. Jos verkkotunnus käyttää CAA-tietueita, salli valittu varmentaja.
4. **Asenna koodi ja systemd-yksikkö.** Esimerkissä tarkistetut, rootin omistamat lähteet sijaitsevat kansiossa `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Alusta tila ja käynnistä palvelu.** Suorita `init` vain ensimmäisellä kerralla.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS-varmenteen hankkiminen {#https-証明書を用意する}

Nginx-määritys API:n julkaisemiseen on tiedostossa `deploy/lan-https/examples/authority.nginx.conf`. Se välittää pyynnöt paikallisen silmukkaliitännän API:lle. Hanki API:n varmenne ennen kuin otat TLS:n käyttöön Nginxissä.

Jos käytät Certbotin automaattista uusimista, määritä varmentaja, yhteystiedot, ehtojen hyväksyntä ja tarvittavat EAB-tiedot tiedostossa `/etc/latex-renderer-lan-authority/certbot.ini`, johon on pääsy vain rootilla. Käytä ECDSA P-256 -avainta. Odota DNS-delegoinnin leviämistä ja aja sitten seuraava komento.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Kun varmenne on myönnetty, tarkista Nginxin palvelinnimi ja varmennepolut, testaa syntaksi komennolla `nginx -t`, ota muutokset käyttöön ja tarkista Certbotin uusimisajastin.

- **Jos tarjoat Keyless-palvelua**, hanki erillinen ECDSA P-256 -jokerivarmenne, jossa on vain `*.lan.example.org`. Vaihda edellisessä komennossa `--cert-name` arvoon `akebi-keyless`, `-d` arvoon `'*.lan.example.org'` ja `--deploy-hook` arvoon `"$hooks/operator-certificate-hook.sh"`. Erillistä varmennetta ei tarvita, jos tarjoat vain julkisen varmentajan tilaa.

## Rekisteröinnin määrittäminen {#登録方法を設定する}

Valitse tiedostossa `authority.json` asiakaspalvelinten rekisteröintitapa asetuksella `policy.registration`.

- `"open"` sallii automaattisen rekisteröinnin.
- `"invite"` edellyttää ylläpitäjän myöntämää koodia.

Luo kutsuun perustuvaa rekisteröintiä varten seuraavalla komennolla koodi, jonka käyttömäärää ja voimassaoloaikaa on rajattu. Toimita se vain vastaanottajalle suojatun kanavan kautta.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Kummassakin tilassa sovelletaan rekisteröinnin, myöntämistiheyden ja tallennettujen kohteiden rajoja sekä varmentajan myöntämiskäytäntöjä.

## Tarkistaminen verkon ulkopuolelta {#外部から確認する}

Tarkista ulkoiselta koneelta DNS-delegointi, SOA-vastaukset UDP:llä ja TCP:llä, IP-osoitteista johdettujen nimien ratkeaminen ja HTTPS:n kautta saatava palvelukuvaus.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Kun kaikki vastaavat, yhdistä LaTeX Renderer -testipalvelin ohjeella [lähiverkkoyhteyden määrittäminen](/fi/docs/lan-https/#lan-向けに設定する) ja tarkista varmenteen myöntäminen ja kirjautuminen. Jos varmentaja antaa uuden yritysajan, odota siihen asti.

**Varmuuskopiot.** Sisällytä `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, varmentajan tilit ja Certbotin uusimisasetukset salattuihin varmuuskopioihin. Käytä käynnissä olevan SQLite-tietokannan varmuuskopiointiin SQLiten online-varmuuskopiointia.

Katso [Akebin asetusesimerkit ja määritys](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
