---
slug: troubleshooting
category: Fejlfinding og sikkerhed
title: Fejlfinding
description: Find årsagen til problemer med login, installation, konvertering og download.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Begynd her {#確認する順序}

1. **Se [tjenestens status](/status/)** for at finde ud af, om der er et generelt nedbrud eller planlagt vedligeholdelse.
2. **Kontroller det eksisterende job.** Hvis konverteringen er startet, skal du åbne samme job under **Historik** eller køre `n624-latex jobs get <jobId>` i CLI.
3. **Læs diagnostik og log.** Åbn diagnostikken på resultatsiden i webappen. I CLI kontrollerer du `.render/errors.json` og den detaljerede log `.render/compile.log`.

## Almindelige problemer {#代表的な問題}

### Installation og login {#インストール-ログイン}

- **Kan ikke finde `n624-latex` eller `latex-render`.**
  Åbn en ny terminal eller et nyt PowerShell-vindue. Fortsætter problemet, skal du kontrollere [PATH i Linux eller macOS](/da/docs/client/#linux-macos) eller [installationsvejledningen til Windows](/da/docs/windows/#インストール).
- **Du kan ikke logge ind i webappen.**
  Brug den registrerede konto og metoden fra administratoren (adgangskode, OIDC eller Cloudflare Access). Hvis en forbindelse fra ChatGPT eller Claude går i stå, se [Kontroller Remote MCP-forbindelsen](/da/docs/mcp/#chatgptなどの接続を確認する).
- **CLI returnerer `401` eller `403`.**
  Kør `n624-latex auth status` for at kontrollere den gemte nøgle. Bed administratoren bekræfte, at den er aktiv og har rettighederne `render:create` og `render:read:own`. [Registrer om nødvendigt nøglen igen](/da/docs/cli/#認証). Bruger du egen server, skal du også kontrollere [serverens URL (`LATEX_RENDER_BASE_URL`)](/da/docs/cli/#接続先サーバー).

### Upload og konvertering {#アップロード-変換}

- **Hoveddokumentet blev ikke fundet i ZIP-arkivet.**
  Standardstartfilen er `main.tex` i rodmappen. Kontroller, om du har pakket den overordnede mappe med, eller angiv dokumentets relative sti. Se [Klargør ZIP-arkivet](/da/docs/projects/#構成).
- **En fil afvises pga. størrelse eller filendelse.**
  Fjern unødvendige genererede filer eller filer, der ikke understøttes, eller konfigurer `.latexrenderignore`. Se [understøttede filer og grænser](/da/docs/projects/#制限).
- **Konverteringen bliver i køen, eller forbindelsen afbrydes.**
  Serveren kan stadig arbejde. Genåbn samme resultatside, eller kontroller det samme job-ID, før du opretter et nyt job.
- **Der mangler pakker eller skrifttyper, eller tidsgrænsen overskrides.**
  Søg efter de tilgængelige navne i [renderingsmiljøet](/app/environment/). Ved timeout skal du undersøge komplekse makroer, store billeder og TikZ-figurer omkring det sted, hvor loggen slutter.

### Hent filer {#成果物の取得}

- **Der er en PDF, men ingen SVG.**
  Vises **Delvis gennemført**, skal du gemme PDF-filen først og vælge **Prøv kun SVG igen**. Se [Gentag SVG-udtrækket](/da/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **PNG-forhåndsvisningen er stadig under klargøring.**
  Vent et øjeblik, eller åbn samme side igen. Den færdige PDF kan allerede hentes.
- **Destinationen er i brug, eller `OUTPUT_BUSY` vises.**
  Luk det program, der viser outputfilen, eller vent på at den proces, der skriver til mappen, bliver færdig. Prøv derefter at hente igen.
- **Resultatet er udløbet, eller der mangler lagerplads.**
  Hvis resultatet er udløbet, skal du konvertere den gemte revision eller de lokale filer igen. Har du opbrugt din kvote, skal du slette afsluttede job, som du ikke længere har brug for. Kontakt administratoren, hvis serverens disk er fuld.

## Få hjælp {#問い合わせ}

- **Serveradministratoren.** Angiv tidspunktet, den handling der stoppede, fejlkoden og eventuelt job-ID (`job_...`).
- **Offentlig GitHub-sag.** Beskriv de færreste trin, der kan genskabe problemet, uden hemmeligheder eller private dokumenter. **Offentliggør aldrig API-nøgler, cookies, originaldokumentet, PDF-filen eller fuldstændige uredigerede logfiler.**
