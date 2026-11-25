---
slug: server-setup
category: Egen server
title: Guiden för serverkonfiguration
description: Ställ in autentisering, HTTPS och körningsgränser på en förberedd server via webbläsaren eller terminalen.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Välj metod {#どの手順を使うか}

För en ny installation, [förbered servern](/sv/docs/self-hosting/#準備するもの) och öppna guiden i en **webbläsare**. På en befintlig installation kan samma guide ändra inloggning och körningsgränser.

- Kör `sudo n624-latex server setup --plan` på servern för att kontrollera nödvändiga paket och ledigt utrymme. Åtgärda bristerna som visas och kör kontrollen på nytt.
- Lägg till `--ingress` i startkommandot för att ändra en befintlig installation med dedikerad HTTPS eller HTTPS i det lokala nätet (Akebi).
- Om Docker rapporterar saknade kärnmoduler på en minimal värd, följ anvisningarna och försök igen. Om till exempel `nf_tables` krävs behöver en administratör köra `sudo modprobe nf_tables`.

## Öppna i en webbläsare {#ブラウザで開く}

Anslut via SSH med driftsättningskontot utan root-behörighet och kör följande. **Håll terminalen öppen tills konfigurationen är klar.**

```sh
sudo n624-latex server setup --web
```

1. Vid den första installationen, granska förberedelserna och skriv `PREPARE` för att fortsätta. Vänta tills den signerade versionen hämtats, tjänsterna förberetts och den första TeX-miljön skapats och verifierats.
2. Leta upp engångsadressen i terminalen. Den är giltig i **5 minuter**.
3. Öppna den på servern eller använd **portvidarebefordran via SSH** för att nå samma port från din dator. Om porten är `41234`, kör följande i en annan lokal terminal och öppna adressen från guiden i webbläsaren.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Dela inte konfigurationsadressen och exponera inte porten på internet eller via en omvänd proxy.

## Granska och tillämpa inställningarna {#プレビューから適用まで}

1. **Välj åtkomstväg och inloggningsmetod.** Ställ in HTTPS och den första ägaren vid nyinstallation. Ange lösenord och OIDC-klienthemligheter i fälten med dold inmatning.
2. **Granska förhandsvisningen.** Kontrollera den publika adressen och åtkomstvägen. Vid byte av metod, förbered ägarens identitet för den nya metoden medan du fortfarande kan logga in.
3. **Tillämpa ändringarna.** Vänta tills tjänsterna har startats eller startats om.
4. **Logga in och skapa en PDF.** Använd ett annat webbläsarfönster för att [verifiera installationen](/sv/docs/self-hosting/#導入完了の確認).

Om du aktiverar både lösenord och OIDC vid nyinstallation, registrera först ägaren med lösenord och lägg sedan till OIDC-värdena `issuer` och `subject` på kontot. Bland körningsgränserna anger starttröskeln hur mycket RAM som måste vara ledigt innan jobbet startar. Körningsgränsen anger hur mycket RAM containern får använda.

## Granska en avbruten ändring {#中断した変更を確認する}

- Om anslutningen bryts när inställningar redan börjat tillämpas, kontrollera först resultatet för samma åtgärd.
- Om guidens process avslutats, starta den för samma mål igen och välj **Recover** på webben eller **`RECOVER`** i terminalen. Om ägaren redan registrerats använder guiden den posten och fortsätter till bekräftelsen. Den här konfigurationsåterställningen återläser ingen tidigare databaskopia.
- Återställningsfiler kan innehålla TLS- eller OIDC-hemligheter. Undvik manuell redigering. Ange bara visad felkod och fas om du ber om hjälp.

## Öppna i en terminal {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

När du ändrar en befintlig server, fyll i varje värde eller tryck på Retur i ett tomt fält för att behålla det. För automatisk HTTPS på det lokala nätet vid installation, välj `LAN` och följ anvisningarna. För första konfigurationen av egen HTTPS eller en befintlig Cloudflare-väg i terminalen, ange JSON i efterfrågat format på en rad. Om det är första gången, [börja i webbläsaren](#ブラウザで開く).

### Tidigare versioner och manuella installationer {#旧版-手動配置の場合}

> [!DETAILS] Kör server-setup.mjs direkt
>
> Om du förberett servern utan APT med en särskild användare, Node.js och rootlös Docker, och lagt en verifierad distribution i `/opt/latex-renderer/current`, kör `server-setup.mjs` direkt. För en ny värd, följ de [manuella anvisningarna](/sv/docs/self-hosting/#現在の提供状況).
>
> | Uppgift | Startargument | Villkor |
> | --- | --- | --- |
> | Ändra befintlig autentisering eller körningsgränser | `--existing` | Registrerad ägare och fungerande tjänster |
> | Konfigurera och registrera första ägaren | `--initial` | Förberedd distribution och miljö, ingen driftskonfiguration eller tidigare databas |
> | Ändra hanterad dedikerad HTTPS | `--ingress` | Dedikerad standalone-HTTPS. Migrering från en delad Nginx-installation är en separat åtgärd. |
>
> - **Terminalgränssnitt**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Webbläsargränssnitt**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Se [specifikationen för guidens indata och återställning](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
