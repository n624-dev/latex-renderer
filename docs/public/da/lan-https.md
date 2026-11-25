---
slug: lan-https
category: Egen server
title: HTTPS på lokalnettet med Akebi
description: Åbn serveren via en HTTPS-adresse, der er afledt af dens lokale IP-adresse.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Adgang via IP-adressen på lokalnettet {#lan-の-ip-アドレスからアクセスする}

Akebi omsætter serverens private IP-adresse til et værtsnavn, som kan nås via HTTPS.

Sæt den delte certifikattjeneste op i guiden til LaTeX Renderer. Vil du drive din egen tjeneste, se [Drift af en Akebi-certifikattjeneste](/da/docs/lan-https-authority/).

- **IPv4-eksempel.** Med IP-adressen `192.168.1.50` og LAN-domænet `lan.example.org` er URL'en `https://192-168-1-50.lan.example.org`.
- **IPv6.** Navnet bruger alle otte grupper i den understøttede private adresse i fuldt udskrevet form. Brug den nøjagtige adresse, opsætningen viser.

**Netværks- og DNS-krav**
Klienten skal kunne nå serverens lokalnet. Hvis navnet ikke kan slås op, skal du kontrollere, om routeren eller DNS-resolveren blokerer svar med private IP-adresser som **beskyttelse mod DNS-rebinding**. Tilføj om nødvendigt kun en undtagelse for det anvendte LAN-domæne.

## Vælg certifikattype {#証明書の方式を選ぶ}

| Metode | Krav og egenskaber |
| --- | --- |
| **Delt tjeneste, offentlig CA** | Konfigurer den delte tjeneste, og accepter certifikatudstederens vilkår. Certifikatets private nøgle forbliver på serveren. |
| **Egen tjeneste, offentlig CA** | URL og LAN-domæne for [din egen Akebi-tjeneste](/da/docs/lan-https-authority/) og eventuelt en invitationskode. |
| **Keyless** | Kræver en kompatibel tjeneste, som udfører signeringen under TLS-håndtrykket. |
| **Eksisterende certifikat eller privat CA** | Certifikat, der svarer til servernavnet, og dets private nøgle. Ved privat CA skal rodcertifikatet være betroet på serveren og alle klienter. |

> [!NOTE]
> - Med en offentlig CA fremgår værtsnavnene i udstedte certifikater af **offentlige Certificate Transparency-logge (CT)**.
> - To lokalnet på forskellige steder med samme private IP-adresse og LAN-domæne har **samme oprindelse** i browseren og deler cookies og andre lagrede data.

## Konfigurer adgang fra lokalnettet {#lan-向けに設定する}

1. Ved en ny installation skal du [klargøre serveren](/da/docs/self-hosting/#準備するもの) og bruge `sudo n624-latex server setup --web` til at åbne [guiden](/da/docs/server-setup/#ブラウザで開く). For at ændre en eksisterende server med administreret, dedikeret HTTPS skal du bruge `sudo n624-latex server setup --ingress --web`.
2. Vælg **LAN** som adgangsvej, og angiv netværksgrænseflade, privat IP-adresse, tilladte klientundernet og HTTPS-port.
3. Vælg certifikattjeneste og metode. Med den delte tjeneste indstilles URL'en `https://akebi.n624.net` og LAN-domænet `lan.n624.net`, og serveren registreres, når ændringerne anvendes. Der kræves ingen invitation. Gennemgå og accepter vilkårene for en offentlig CA. Kræver din egen tjeneste invitation, skal du indtaste administratorens kode.
4. Kontroller den oprettede HTTPS-URL og de tilladte undernet, før du anvender opsætningen. Applikationens login med adgangskode eller OIDC gælder stadig.
5. Fra en anden computer i et tilladt undernet skal du åbne URL'en, kontrollere at der ikke vises en certifikatadvarsel, logge ind og konvertere et testdokument.

For at oprette din egen tjeneste, se [Drift af en Akebi-certifikattjeneste](/da/docs/lan-https-authority/).

## Kontroller certifikatstatus {#証明書の状態を確認する}

Brug disse kommandoer til at se tjenesten, fornyelsestimeren og loggene i dens navnerum.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Hvis udstedelse eller fornyelse mislykkes, skal du kontrollere serverens ur, HTTPS-forbindelsen til tjenesten, domænet, IP-adressen og tidspunktet for nyt forsøg fra CA'en. En midlertidig fejl bevarer det gyldige certifikat. Timeren genoptager udstedelsen ud fra den gemte tilstand. Stemmer nøglen og tilstanden ikke overens, skal du kontrollere de gemte tilstandsfiler fra samme generation.

Se [Akebis design og fejlfinding](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
