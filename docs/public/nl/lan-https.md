---
slug: lan-https
category: Eigen server
title: HTTPS op het LAN met Akebi
description: Open de server via een HTTPS-URL die is afgeleid van het lokale IP-adres.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Toegang via het IP-adres op het LAN {#lan-の-ip-アドレスからアクセスする}

Akebi zet het privé-IP-adres van de server om in een hostnaam die via HTTPS bereikbaar is.

Stel de gedeelde certificaatdienst in met de wizard van LaTeX Renderer. Wil je zelf een dienst aanbieden, zie dan [Een eigen Akebi-certificaatdienst beheren](/nl/docs/lan-https-authority/).

- **IPv4-voorbeeld.** Voor IP-adres `192.168.1.50` en LAN-domein `lan.example.org` is de URL `https://192-168-1-50.lan.example.org`.
- **IPv6.** De naam bevat de acht volledig uitgeschreven groepen van het ondersteunde privéadres. Gebruik de exacte URL uit de configuratie.

**Netwerk- en DNS-vereisten**
De client moet het LAN van de server kunnen bereiken. Wordt de naam niet omgezet, controleer dan of de router of DNS-resolver antwoorden met privé-IP-adressen blokkeert als **bescherming tegen DNS-rebinding**. Voeg zo nodig alleen voor het gebruikte LAN-domein een uitzondering toe.

## Het certificaattype kiezen {#証明書の方式を選ぶ}

| Methode | Vereisten en eigenschappen |
| --- | --- |
| **Gedeelde dienst, openbare CA** | Stel de gedeelde dienst in en accepteer de voorwaarden van de certificaatautoriteit. De privésleutel van het certificaat blijft op de server. |
| **Eigen dienst, openbare CA** | URL en LAN-domein van [je eigen Akebi-dienst](/nl/docs/lan-https-authority/) en indien nodig een uitnodigingscode. |
| **Keyless** | Vereist een compatibele dienst die tijdens de TLS-handshake de ondertekening uitvoert. |
| **Bestaand certificaat of eigen CA** | Certificaat dat overeenkomt met de servernaam en de bijbehorende privésleutel. Stel voor een eigen CA het vertrouwen in het rootcertificaat in op de server en alle clients. |

> [!NOTE]
> - Bij een openbare CA verschijnen de hostnamen uit uitgegeven certificaten in **openbare Certificate Transparency-logboeken (CT)**.
> - Twee LAN's op verschillende locaties met hetzelfde privé-IP-adres en LAN-domein hebben in de browser **dezelfde origin** en delen cookies en andere opgeslagen gegevens.

## Toegang vanaf het LAN instellen {#lan-向けに設定する}

1. [Bereid bij een nieuwe installatie de server voor](/nl/docs/self-hosting/#準備するもの) en open met `sudo n624-latex server setup --web` de [wizard](/nl/docs/server-setup/#ブラウザで開く). Gebruik voor een bestaande server met beheerde eigen HTTPS `sudo n624-latex server setup --ingress --web`.
2. Kies **LAN** als toegangsroute en geef de netwerkinterface, het privé-IP-adres, de toegestane clientsubnetten en de HTTPS-poort op.
3. Kies de certificaatdienst en de methode. Bij de gedeelde dienst worden de URL `https://akebi.n624.net` en het LAN-domein `lan.n624.net` ingevuld en wordt de server bij het toepassen geregistreerd. Een uitnodiging is niet nodig. Lees en accepteer bij een openbare CA de voorwaarden. Gebruikt je eigen dienst uitnodigingen, voer dan de code van de beheerder in.
4. Controleer vóór het toepassen de gegenereerde HTTPS-URL en de toegestane subnetten. Wachtwoord- of OIDC-authenticatie van de applicatie blijft van kracht.
5. Open de URL op een andere computer in een toegestaan subnet. Controleer of er geen certificaatwaarschuwing verschijnt, meld je aan en converteer een testdocument.

Zie [Een eigen Akebi-certificaatdienst beheren](/nl/docs/lan-https-authority/) om zelf de dienst op te zetten.

## De certificaatstatus bekijken {#証明書の状態を確認する}

Met deze opdrachten bekijk je de dienst, de verlengingstimer en de logboeken in de bijbehorende naamruimte.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Mislukt uitgifte of verlenging, controleer dan de serverklok, de HTTPS-verbinding met de dienst, het domein, het IP-adres en het tijdstip voor een nieuwe poging dat de CA aangeeft. Bij een tijdelijke fout blijft het geldige certificaat behouden. De timer hervat de uitgifte vanaf de opgeslagen toestand. Als sleutel en toestand niet bij elkaar passen, controleer dan de bewaarde toestandbestanden van dezelfde generatie.

Zie [Ontwerp en probleemoplossing voor Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
