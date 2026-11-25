---
slug: server-setup
category: Egen server
title: Guide til serveropsætning
description: Konfigurer godkendelse, HTTPS og kørselsgrænser på en klargjort server fra browseren eller terminalen.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Vælg fremgangsmåde {#どの手順を使うか}

Ved en ny installation skal du [klargøre serveren](/da/docs/self-hosting/#準備するもの) og åbne guiden i en **browser**. I en eksisterende installation kan du ændre login og kørselsgrænser med samme guide.

- Kør `sudo n624-latex server setup --plan` på serveren for at kontrollere de nødvendige pakker og den ledige plads. Ret de viste mangler, og gentag kontrollen.
- Tilføj `--ingress` til startkommandoen for at ændre en eksisterende installation med dedikeret HTTPS eller HTTPS på lokalnettet (Akebi).
- Hvis Docker på en minimal vært melder om manglende kernemoduler, så følg anvisningerne, og prøv igen. Hvis f.eks. `nf_tables` kræves, skal en administrator køre `sudo modprobe nf_tables`.

## Åbn i en browser {#ブラウザで開く}

Opret forbindelse via SSH med udrulningskontoen uden root-rettigheder, og kør følgende. **Hold terminalen åben, indtil opsætningen er færdig.**

```sh
sudo n624-latex server setup --web
```

1. Ved den første installation skal du gennemgå forberedelserne og skrive `PREPARE` for at fortsætte. Vent, til den signerede version er hentet, tjenesterne klargjort og det første TeX-miljø bygget og verificeret.
2. Find engangsadressen i terminalen. Den er gyldig i **5 minutter**.
3. Åbn den på serveren, eller brug **SSH-portvideresendelse** til at nå den samme port fra din egen computer. Vises porten `41234`, så kør følgende i en anden lokal terminal, og åbn guidens adresse i browseren.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Del ikke opsætningsadressen, og gør ikke porten tilgængelig på internettet eller via en omvendt proxy.

## Gennemgå og anvend indstillingerne {#プレビューから適用まで}

1. **Vælg adgangsvej og loginmetode.** Ved en ny installation indstiller du HTTPS og den første ejer. Indtast adgangskoder og OIDC-klienthemmeligheder i felterne med skjult indtastning.
2. **Gennemgå forhåndsvisningen.** Kontroller den offentlige adresse og adgangsvejen. Ved metodeskift skal du klargøre ejerens identitet til den nye metode, mens du stadig kan logge ind.
3. **Anvend ændringerne.** Vent på, at tjenesterne starter eller genstarter.
4. **Log ind, og opret en PDF.** Brug et andet browservindue til at [kontrollere installationen](/da/docs/self-hosting/#導入完了の確認).

Hvis du aktiverer både adgangskoder og OIDC ved nyinstallation, skal du først registrere ejeren med adgangskode og derefter føje OIDC-værdierne `issuer` og `subject` til kontoen. Under kørselsgrænser angiver startgrænsen, hvor meget RAM der skal være ledig før jobstart. Kørselsgrænsen angiver, hvor meget RAM containeren må bruge.

## Kontroller en afbrudt ændring {#中断した変更を確認する}

- Hvis forbindelsen går tabt, efter at anvendelsen er begyndt, skal du først kontrollere resultatet af samme handling.
- Hvis guideprocessen er afsluttet, skal du starte den igen for samme mål og vælge **Recover** i browseren eller **`RECOVER`** i terminalen. Hvis en ejer allerede er registreret, bruger guiden den eksisterende registrering og fortsætter til bekræftelsen. Denne gendannelse af opsætningen gendanner ikke en tidligere databasekopi.
- Gendannelsesfiler kan indeholde TLS- eller OIDC-hemmeligheder. Undgå at redigere dem manuelt. Oplys kun fejlkoden og fasen, når du beder om hjælp.

## Åbn i en terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Ved ændring af en eksisterende server kan du angive hver indstilling eller trykke på Enter i et tomt felt for at bevare den. Til automatisk HTTPS på lokalnettet under installation skal du vælge `LAN` og følge anvisningerne. Ved første opsætning af egen HTTPS eller konfiguration af en eksisterende Cloudflare-rute i terminalen indtastes JSON i det angivne format på én linje. Hvis det er første gang, så [begynd i browseren](#ブラウザで開く).

### Tidligere versioner og manuelle installationer {#旧版-手動配置の場合}

> [!DETAILS] Kør server-setup.mjs direkte
>
> Hvis serveren er klargjort uden APT med en dedikeret bruger, Node.js og Docker uden root-rettigheder, og en verificeret distribution ligger i `/opt/latex-renderer/current`, kan du køre `server-setup.mjs` direkte. For en ny vært, se [manuel installation](/da/docs/self-hosting/#現在の提供状況).
>
> | Opgave | Startargument | Betingelser |
> | --- | --- | --- |
> | Ændre eksisterende godkendelse eller grænser | `--existing` | Registreret ejer og fungerende tjenester |
> | Konfigurere og registrere første ejer | `--initial` | Klargjort distribution og miljø, ingen driftskonfiguration eller tidligere database |
> | Ændre administreret, dedikeret HTTPS | `--ingress` | Dedikeret standalone-HTTPS. Migrering fra delt Nginx er en særskilt handling. |
>
> - **Terminalgrænseflade**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Browsergrænseflade**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Se [specifikationen for guidens input og gendannelse](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
