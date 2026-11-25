---
slug: troubleshooting
category: Feilsøking og sikkerhet
title: Feilsøking
description: Finn årsaken til problemer med innlogging, installasjon, konvertering og nedlasting.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Begynn her {#確認する順序}

1. **Sjekk [tjenestestatus](/status/)** for å se om det er en generell feil eller pågår vedlikehold.
2. **Kontroller den eksisterende jobben.** Hvis konverteringen har startet, åpne samme jobb under **Historikk** eller kjør `n624-latex jobs get <jobId>` i CLI.
3. **Les diagnostikk og logg.** I nettappen åpner du diagnostikken på resultatsiden. I CLI kontrollerer du `.render/errors.json` og den detaljerte loggen `.render/compile.log`.

## Vanlige problemer {#代表的な問題}

### Installasjon og innlogging {#インストール-ログイン}

- **Finner ikke `n624-latex` eller `latex-render`.**
  Åpne en ny terminal eller et nytt PowerShell-vindu. Vedvarer problemet, kontroller [PATH i Linux eller macOS](/no/docs/client/#linux-macos) eller [installasjonsveiledningen for Windows](/no/docs/windows/#インストール).
- **Kan ikke logge inn i nettappen.**
  Bruk den registrerte kontoen og metoden administratoren har angitt (passord, OIDC eller Cloudflare Access). Hvis en tilkobling fra ChatGPT eller Claude stopper opp, se [Kontroller Remote MCP-tilkoblingen](/no/docs/mcp/#chatgptなどの接続を確認する).
- **CLI returnerer `401` eller `403`.**
  Kjør `n624-latex auth status` for å kontrollere den lagrede nøkkelen. Be administratoren bekrefte at den er aktiv og har rettighetene `render:create` og `render:read:own`. [Registrer nøkkelen på nytt](/no/docs/cli/#認証) ved behov. For en egen server, kontroller også [serveradressen (`LATEX_RENDER_BASE_URL`)](/no/docs/cli/#接続先サーバー).

### Opplasting og konvertering {#アップロード-変換}

- **Finner ikke hoveddokumentet i ZIP-arkivet.**
  Standard startfil er `main.tex` i roten. Kontroller om du pakket inn den overordnede mappen, eller oppgi den relative stien til dokumentet. Se [Klargjør ZIP-arkivet](/no/docs/projects/#構成).
- **En fil avvises på grunn av størrelse eller filendelse.**
  Fjern unødvendige genererte filer og filer som ikke støttes, eller konfigurer `.latexrenderignore`. Se [støttede filer og grenser](/no/docs/projects/#制限).
- **Konverteringen står i kø eller forbindelsen blir brutt.**
  Serveren kan fortsatt arbeide. Åpne samme resultatside eller kontroller samme jobb-ID før du lager en ny jobb.
- **Det mangler pakker eller skrifter, eller tidsgrensen er overskredet.**
  Søk etter tilgjengelige navn i [renderingsmiljøet](/app/environment/). Ved tidsavbrudd, undersøk komplekse makroer, store bilder og TikZ-figurer rundt stedet der loggen stopper.

### Last ned filer {#成果物の取得}

- **PDF finnes, men SVG mangler.**
  Ved **Delvis vellykket**, lagre PDF-filen først og velg **Prøv bare SVG på nytt**. Se [Gjenta uthentingen av SVG](/no/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **PNG-forhåndsvisningen klargjøres fortsatt.**
  Vent litt eller åpne samme side på nytt. Den ferdige PDF-filen kan lastes ned med en gang.
- **Målet er i bruk eller `OUTPUT_BUSY` vises.**
  Lukk visningsprogrammet som har PDF-filen åpen, eller vent til prosessen som skriver til mappen er ferdig, og prøv nedlastingen på nytt.
- **Resultatet er utløpt eller lagringsplassen er full.**
  Hvis resultatet er utløpt, konverter den lagrede revisjonen eller de lokale filene på nytt. Har du nådd kvoten, slett ferdige jobber du ikke lenger trenger. Kontakt administratoren hvis disken på serveren er full.

## Be om hjelp {#問い合わせ}

- **Serveradministratoren.** Oppgi tidspunkt, operasjonen som stoppet, feilkode og eventuelt jobb-ID (`job_...`).
- **Offentlig GitHub-sak.** Oppgi færrest mulig trinn for å gjenskape problemet uten hemmeligheter eller private dokumenter. **Publiser aldri API-nøkler, informasjonskapsler, originaldokumentet, PDF-filen eller fullstendige uredigerte logger.**
