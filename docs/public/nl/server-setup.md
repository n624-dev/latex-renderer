---
slug: server-setup
category: Eigen server
title: De installatiewizard voor de server
description: Stel authenticatie, HTTPS en uitvoeringslimieten in op een voorbereide server via de browser of terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Een werkwijze kiezen {#どの手順を使うか}

[Bereid de server voor](/nl/docs/self-hosting/#準備するもの) bij een nieuwe installatie en open de wizard in een **browser**. Bij een bestaande installatie kun je met dezelfde wizard de aanmeldmethode en uitvoeringslimieten wijzigen.

- Voer `sudo n624-latex server setup --plan` uit op de server om de vereiste pakketten en vrije ruimte te controleren. Verhelp gemelde tekorten en herhaal de controle.
- Voeg `--ingress` toe aan de startopdracht als je een bestaande installatie met eigen HTTPS of HTTPS op het LAN (Akebi) wilt wijzigen.
- Meldt Docker op een minimale host dat er kernelmodules ontbreken, volg dan de aanwijzingen en probeer het opnieuw. Is bijvoorbeeld `nf_tables` vereist, dan moet een beheerder `sudo modprobe nf_tables` uitvoeren.

## Openen in een browser {#ブラウザで開く}

Maak via SSH verbinding met het implementatieaccount zonder rootrechten en voer de volgende opdracht uit. **Houd de terminal open tot de configuratie is voltooid.**

```sh
sudo n624-latex server setup --web
```

1. Bekijk bij de eerste installatie de voorbereidende stappen en typ `PREPARE` om door te gaan. Wacht tot het ondertekende pakket is gedownload, de diensten zijn voorbereid en de eerste TeX-omgeving is gebouwd en geverifieerd.
2. Zoek de eenmalige URL in de terminal. Deze is **5 minuten** geldig.
3. Open de URL op de server of gebruik **SSH-poortdoorsturing** om dezelfde poort vanaf je eigen computer te bereiken. Is de weergegeven poort `41234`, voer dan de volgende opdracht uit in een tweede lokale terminal en open de URL van de wizard in de browser.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Deel de configuratie-URL niet en stel de poort niet bloot aan internet of via een reverse proxy.

## Instellingen controleren en toepassen {#プレビューから適用まで}

1. **Kies de toegangsroute en de aanmeldmethode.** Stel bij een nieuwe installatie HTTPS en de eerste eigenaar in. Voer wachtwoorden en OIDC-clientgeheimen in de afgeschermde velden in.
2. **Controleer het overzicht.** Controleer de openbare URL en toegangsroute. Verander je de aanmeldmethode, bereid dan de eigenaarsidentiteit voor de nieuwe methode voor terwijl je nog kunt inloggen.
3. **Pas de wijzigingen toe.** Wacht tot de diensten gestart of opnieuw gestart zijn.
4. **Meld je aan en maak een PDF.** [Controleer de installatie](/nl/docs/self-hosting/#導入完了の確認) in een ander browservenster.

Schakel je bij een nieuwe installatie wachtwoorden en OIDC in, registreer de eigenaar dan eerst met een wachtwoord en voeg `issuer` en `subject` van OIDC toe aan dat account. Bij uitvoeringslimieten geeft de startdrempel aan hoeveel RAM vrij moet zijn voor de taak start. De limiet tijdens uitvoering bepaalt hoeveel RAM de container mag gebruiken.

## Een onderbroken wijziging controleren {#中断した変更を確認する}

- Valt de verbinding weg nadat het toepassen van wijzigingen is gestart, controleer dan eerst het resultaat van dezelfde bewerking.
- Is de wizard afgesloten, start hem dan opnieuw voor hetzelfde doel en kies **Recover** op het web of **`RECOVER`** in de terminal. Als de eigenaar al geregistreerd is, gebruikt de wizard de bestaande registratie en gaat door naar de bevestiging. Met dit configuratieherstel wordt geen eerdere databaseback-up teruggezet.
- Herstelbestanden kunnen TLS- of OIDC-geheimen bevatten. Bewerk ze niet handmatig. Vermeld bij een hulpvraag alleen de weergegeven foutcode en de fase.

## Openen in een terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Geef bij een bestaande installatie voor elke instelling een waarde op of druk in een leeg veld op Enter om deze te behouden. Kies bij installatie voor automatische HTTPS op het LAN `LAN` en volg de aanwijzingen. Stel je voor het eerst eigen HTTPS in of configureer je een bestaande Cloudflare-route via de terminal, voer dan de JSON in het opgegeven formaat op één regel in. [Begin in de browser](#ブラウザで開く) als je dit voor het eerst doet.

### Eerdere versies en handmatige installaties {#旧版-手動配置の場合}

> [!DETAILS] server-setup.mjs rechtstreeks starten
>
> Heb je zonder APT een server voorbereid met een afzonderlijke gebruiker, Node.js en rootless Docker, en een geverifieerde distributie in `/opt/latex-renderer/current` geplaatst, start dan rechtstreeks `server-setup.mjs`. Voor een nieuwe host zie je de [handmatige instructies](/nl/docs/self-hosting/#現在の提供状況).
>
> | Taak | Startargument | Voorwaarden |
> | --- | --- | --- |
> | Bestaande authenticatie of limieten wijzigen | `--existing` | Geregistreerde eigenaar en werkende diensten |
> | Eerste eigenaar instellen en registreren | `--initial` | Distributie en omgeving voorbereid, nog geen operationele configuratie of bestaande database |
> | Beheerde eigen HTTPS wijzigen | `--ingress` | Eigen standalone-HTTPS. Migratie vanaf een gedeelde Nginx-installatie is een aparte bewerking. |
>
> - **Terminalinterface**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Browserinterface**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Zie de [specificatie voor invoer en herstel van de wizard](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
