---
slug: security
category: Fejlfinding og sikkerhed
title: Sikkerhed for konti og dokumenter
description: Beskyt loginoplysninger og indsendte filer, og se, hvordan adgangen til rendereren og administrationen er afgrænset.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Hvis en API-nøgle lækker, skal du straks bede administratoren om at tilbagekalde den og udstede en ny.
- Rapportér sårbarheder via [den private formular på GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Offentliggør ikke detaljer i en åben sag.

## Loginoplysninger {#資格情報}

- Placer ikke API-nøgler i kommandoargumenter (synlige med bl.a. `ps`), URL'er, Git-repositorier, logfiler eller samtaler med AI-assistenter.
- Brug DPAPI i Windows eller en fil med tilstand `0600`, som kun ejeren kan læse i Linux og macOS, når du gemmer nøgler lokalt.
- Brug kun adgangskoder til webappen, OIDC-klienthemmeligheder og sessionscookies til deres tilsigtede formål. Hold dem adskilt fra CLI- og API-nøgler (`lrk_` og `lra_`).

## Projekter {#プロジェクト}

Alle LaTeX-kilder og bilag behandles som ikke-betroet input. Symbolske links, skaladgang fra TeX, eksterne kommandoer og netværksforbindelser uden for containeren er deaktiveret. Overhold isoleringen, tidsgrænserne og filbegrænsningerne.

## Offentlige sider og administration {#公開領域と管理領域}

Offentlig dokumentation og downloads, loginbeskyttede sider (`/app/` og `/admin/`) og renderings-API'et har separate stier under én kanonisk HTTPS-oprindelse.

- **Netværksgrænse.** I Cloudflare-profilen er Tunnel/Workers den eneste indgang. I standalone-profilen er det en omvendt TLS-proxy. Applikationstjenesterne lytter på loopback-grænsefladen. Det interne API, SQLite og administrationssokler holdes private. Loginbeskyttede sider holdes ude af søgemaskinernes indeks.
- **Godkendelse og browsersessioner.** Login med en ekstern identitetsudbyder kræver nøjagtigt match af `provider + issuer + subject`. Konti knyttes ikke automatisk sammen ud fra mailadresse eller vist navn. Serveren kan tilbagekalde en session med det samme. Tilstandsændrende forespørgsler kræver nøjagtigt match af `Origin` og et sessionsspecifikt CSRF-token. Adgangskoder beskyttes med `scrypt` og en ekstra hemmelig værdi (pepper), som ejes af root. Ved offentlig drift skal du også begrænse forbindelser og anmodningsfrekvens på proxyen og bruge udbyderens DDoS-beskyttelse.
- **Remote MCP.** `/mcp`, OAuth-tokenendepunktet og metadata til tjenesteregistrering er offentligt tilgængelige. Værktøjskald kræver et kortlivet Bearer-token med begrænset målgruppe og adgangsomfang. Autorisationen bruger browsersessionen fra `/app/` og knytter adgangen udtrykkeligt til en eksisterende, aktiv bruger.
  - Standardsvaret (`content`) indeholder kun ejerafgrænsede ID'er, tilstande, markører og begrænset diagnostik til næste trin. Stier og diagnostik fra brugerinput returneres som ikke-betroede data uden kontroltegn og med grænser for længde og antal.
  - Standardindholdet `content` og diagnostikloggene udelader OAuth-tokens, API-nøgler, billetter, rå base64, fuldstændige kildefiler og logfiler, stakspor, Access-subjekt-ID'er og interne serverstier. Fuldstændige PDF'er og logfiler hentes kun ved ressourcelæsning med fornyet kontrol af ejerskab.

## Lokal webgrænseflade til opsætning {#local-setup-web-ui}

`n624-latex setup --gui` (tidligere `latex-render setup --gui`) lytter kun på en tilfældig port på `127.0.0.1` på den lokale computer.

- Fragmentet (`#...`) i den URL, som CLI åbner, indeholder et starttoken til engangsbrug. Browseren fjerner det straks fra historikken og bytter det til en kortlivet session.
- Alle API-handlinger kræver nøjagtigt match af `Origin`, en Bearer-session og et separat CSRF-token. CORS er slået fra, Host og klientens loopback-adresse kontrolleres, og der håndhæves streng CSP, `frame-ancestors 'none'` og `no-store`.
- Den indtastede nøgle sendes kun til gemmehandlingen og vises ikke i svar om status, diagnostik eller testkonvertering. Grænsefladen lukker efter 30 minutters inaktivitet eller 2 timer fra start.
