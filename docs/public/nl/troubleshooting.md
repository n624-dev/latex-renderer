---
slug: troubleshooting
category: Problemen oplossen en beveiliging
title: Problemen oplossen
description: Achterhaal de oorzaak van problemen met inloggen, installeren, converteren en downloaden.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Waar begin je? {#確認する順序}

1. **Controleer de [servicestatus](/status/)** op een algemene storing of onderhoud.
2. **Controleer de bestaande taak.** Als de conversie al gestart is, open dan dezelfde taak onder **Geschiedenis** of voer `n624-latex jobs get <jobId>` uit in de CLI.
3. **Bekijk diagnostische informatie en logboeken.** Open op het web de diagnostiek op de resultatenpagina. Bekijk in de CLI `.render/errors.json` en het gedetailleerde logbestand `.render/compile.log`.

## Veelvoorkomende problemen {#代表的な問題}

### Installeren en inloggen {#インストール-ログイン}

- **`n624-latex` of `latex-render` wordt niet gevonden.**
  Open een nieuwe terminal of een nieuw PowerShell-venster. Blijft het probleem bestaan, controleer dan [PATH op Linux of macOS](/nl/docs/client/#linux-macos) of de [installatie-instructies voor Windows](/nl/docs/windows/#インストール).
- **Je kunt niet inloggen bij de webapp.**
  Gebruik je geregistreerde account en de methode die de beheerder aangeeft (wachtwoord, OIDC of Cloudflare Access). Zie [De Remote MCP-verbinding controleren](/nl/docs/mcp/#chatgptなどの接続を確認する) als een verbinding vanuit ChatGPT of Claude vastloopt.
- **De CLI geeft `401` of `403` terug.**
  Voer `n624-latex auth status` uit om de opgeslagen sleutel te controleren. Vraag de beheerder of de sleutel actief is en de rechten `render:create` en `render:read:own` heeft. [Sla de sleutel zo nodig opnieuw op](/nl/docs/cli/#認証). Controleer bij een eigen server ook de [server-URL (`LATEX_RENDER_BASE_URL`)](/nl/docs/cli/#接続先サーバー).

### Uploaden en converteren {#アップロード-変換}

- **Het hoofddocument wordt niet gevonden in de ZIP.**
  De standaardinvoer is `main.tex` in de hoofdmap. Controleer of je de bovenliggende map hebt ingepakt of geef het relatieve pad naar het document op. Zie [De ZIP voorbereiden](/nl/docs/projects/#構成).
- **Een bestand wordt geweigerd vanwege de grootte of extensie.**
  Verwijder onnodige gegenereerde bestanden en niet-ondersteunde bestanden of stel `.latexrenderignore` in. Controleer de [ondersteunde bestanden en limieten](/nl/docs/projects/#制限).
- **De conversie blijft in de wachtrij of de verbinding valt weg.**
  De server kan nog bezig zijn. Open dezelfde resultatenpagina opnieuw of controleer hetzelfde taak-ID voordat je een nieuwe taak aanmaakt.
- **Er ontbreken pakketten of lettertypen, of de tijdslimiet is verstreken.**
  Zoek de beschikbare namen in de [renderomgeving](/app/environment/). Onderzoek bij een time-out complexe macro's, grote afbeeldingen en TikZ-tekeningen rond de plaats waar het logbestand eindigt.

### Bestanden downloaden {#成果物の取得}

- **Er is wel een PDF maar geen SVG.**
  Zie je **Gedeeltelijk geslaagd**, sla dan eerst de PDF op en kies **Alleen SVG opnieuw proberen**. Zie [De SVG-extractie opnieuw uitvoeren](/nl/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **Het PNG-voorbeeld wordt nog voorbereid.**
  Wacht even of open dezelfde pagina opnieuw. De definitieve PDF is al te downloaden.
- **De bestemming is in gebruik of je ziet `OUTPUT_BUSY`.**
  Sluit de viewer waarin de PDF geopend is of wacht tot het proces dat in de map schrijft klaar is. Probeer de download daarna opnieuw.
- **Het resultaat is verlopen of er is te weinig opslagruimte.**
  Converteer bij een verlopen resultaat de opgeslagen revisie of de lokale bestanden opnieuw. Heb je je quotum bereikt, verwijder dan voltooide taken die je niet meer nodig hebt. Is de serverschijf vol, waarschuw de beheerder.

## Hulp vragen {#問い合わせ}

- **Serverbeheerder.** Vermeld het tijdstip, de bewerking die vastliep, de foutcode en indien beschikbaar het taak-ID (`job_...`).
- **Openbare GitHub-melding.** Geef de minimale stappen om het probleem te reproduceren, zonder geheimen of persoonlijke documenten. **Publiceer nooit API-sleutels, cookies, het oorspronkelijke document, de PDF of complete onbewerkte logbestanden.**
