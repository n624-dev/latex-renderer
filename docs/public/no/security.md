---
slug: security
category: Feilsøking og sikkerhet
title: Sikkerhet for kontoer og dokumenter
description: Beskytt påloggingsopplysninger og innsendte filer, og bli kjent med tilgangsgrensene for rendereren og administrasjonen.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Hvis en API-nøkkel lekker, be straks administratoren trekke den tilbake og utstede en ny.
- Meld fra om sårbarheter via [det private skjemaet på GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Ikke publiser detaljene i en offentlig sak.

## Påloggingsopplysninger {#資格情報}

- Ikke legg API-nøkler i kommandoargumenter (synlige med blant annet `ps`), nettadresser, Git-repositorier, logger eller KI-samtaler.
- Til lokal lagring bruker du DPAPI i Windows eller en fil med modus `0600` som bare eieren kan lese i Linux og macOS.
- Bruk passord for nettleserinnlogging, OIDC-klienthemmeligheter og øktinformasjonskapsler bare til det tiltenkte formålet. Hold dem atskilt fra CLI- og API-nøkler (`lrk_` og `lra_`).

## Prosjekter {#プロジェクト}

Alle LaTeX-kilder og vedlegg behandles som ikke-klarerte inndata. Symbolske lenker, skalltilgang fra TeX, kjøring av eksterne kommandoer og nettverksforbindelser ut av containeren er deaktivert. Følg reglene for isolasjon, tidsgrenser og filgrenser.

## Offentlige sider og administrasjon {#公開領域と管理領域}

Offentlig dokumentasjon og nedlastinger, innloggingsbeskyttede sider (`/app/` og `/admin/`) og renderings-API-et har separate stier under ett kanonisk HTTPS-opphav.

- **Nettverksgrense.** I Cloudflare-profilen er Tunnel/Workers eneste inngang. I standalone-profilen er det en omvendt TLS-proxy. Alle applikasjonstjenester lytter på loopback-grensesnittet. Internt API, SQLite og administrasjonssokler er ikke offentlige. Innloggingsbeskyttede områder holdes utenfor søkeindeksene.
- **Autentisering og nettleserøkter.** Innlogging via ekstern identitetsleverandør krever nøyaktig samsvar for `provider + issuer + subject`. E-post og visningsnavn knytter ikke kontoer sammen automatisk. Serveren kan avslutte en økt umiddelbart. Forespørsler som endrer tilstand, krever nøyaktig samsvar for `Origin` og et eget CSRF-token for økten. Passord beskyttes med `scrypt` og en ekstra hemmelighet (pepper) eid av root. Ved offentlig drift må du også begrense antall forbindelser og forespørsler på proxyen og bruke leverandørens DDoS-beskyttelse.
- **Remote MCP.** `/mcp`, OAuth-endepunktet for token og metadata for tjenesteoppdagelse er offentlig tilgjengelige. Verktøykall krever et kortlivet Bearer-token med begrenset målgruppe og tilgangsomfang. Autorisasjonen bruker nettleserøkten fra `/app/` og knytter tilgangen uttrykkelig til en eksisterende, aktiv bruker.
  - Standardsvaret (`content`) inneholder bare eieravgrensede ID-er, statuser, markører og begrenset diagnostikk som trengs for å fortsette. Stier og diagnostikk fra brukerinndata returneres som ikke-klarerte data uten kontrolltegn og med grenser for lengde og antall.
  - Standardinnholdet `content` og diagnostikkloggene utelater OAuth-token, API-nøkler, billetter, rå base64, fullstendige kilder og logger, stakkspor, Access-subjekt-ID-er og interne serverstier. Fullstendige PDF-er og logger er bare tilgjengelige ved ressurslesing med ny eierkontroll.

## Lokalt nettgrensesnitt for innstillinger {#local-setup-web-ui}

`n624-latex setup --gui` (tidligere `latex-render setup --gui`) lytter bare på en tilfeldig port på `127.0.0.1` på den lokale maskinen.

- Fragmentet (`#...`) i adressen som CLI åpner, inneholder et oppstartstoken til engangsbruk. Nettleseren fjerner det straks fra historikken og bytter det mot en kortlivet økt.
- Alle API-operasjoner krever nøyaktig samsvar for `Origin`, en Bearer-økt og et separat CSRF-token. CORS er deaktivert, Host og klientens loopback-adresse kontrolleres, og det brukes streng CSP, `frame-ancestors 'none'` og `no-store`.
- Den angitte nøkkelen sendes bare til lagringsoperasjonen og vises ikke i svar om status, diagnostikk eller testkonvertering. Grensesnittet lukkes etter 30 minutter uten aktivitet eller 2 timer fra oppstart.
