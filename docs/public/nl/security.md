---
slug: security
category: Problemen oplossen en beveiliging
title: Beveiliging van accounts en documenten
description: Bescherm inloggegevens en ingezonden bestanden en lees hoe de toegang tot de renderer en het beheer is afgebakend.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Vraag de beheerder onmiddellijk om een gelekte API-sleutel in te trekken en een nieuwe uit te geven.
- Meld kwetsbaarheden via het [besloten formulier op GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Deel de details niet in een openbaar issue.

## Inloggegevens {#資格情報}

- Neem API-sleutels niet op in opdrachtargumenten (zichtbaar via onder andere `ps`), URL's, Git-repository's, logbestanden of gesprekken met AI-assistenten.
- Gebruik voor lokale opslag DPAPI op Windows of een bestand met modus `0600` dat alleen de eigenaar kan lezen op Linux en macOS.
- Gebruik browserwachtwoorden, OIDC-clientgeheimen en sessiecookies alleen voor het doel waarvoor ze zijn bedoeld. Houd ze gescheiden van CLI- en API-sleutels (`lrk_` en `lra_`).

## Projecten {#プロジェクト}

Alle LaTeX-bronnen en bijlagen gelden als onbetrouwbare invoer. Symbolische koppelingen, shelltoegang vanuit TeX, externe opdrachten en netwerkverbindingen buiten de container zijn uitgeschakeld. Houd je aan de isolatie, tijdslimieten en bestandslimieten.

## Openbare pagina's en beheer {#公開領域と管理領域}

Openbare documentatie en downloads, afgeschermde pagina's (`/app/` en `/admin/`) en de render-API gebruiken aparte paden op één canonieke HTTPS-origin.

- **Netwerkgrens.** In het Cloudflare-profiel vormen Tunnel/Workers de enige ingang. In het standalone-profiel is dit een reverse proxy met TLS. De applicatiediensten luisteren op de loopbackinterface. De interne API, SQLite en beheersockets blijven privé. Afgeschermde pagina's worden buiten zoekindexen gehouden.
- **Browserauthenticatie en sessies.** Aanmelden via een externe identiteitsprovider vereist een exacte overeenkomst van `provider + issuer + subject`. Accounts worden niet automatisch gekoppeld op basis van e-mail of weergavenaam. De server kan sessies direct intrekken. Verzoeken die de toestand wijzigen, vereisen een exacte overeenkomst van `Origin` en een sessiegebonden CSRF-token. Wachtwoorden worden beschermd met `scrypt` en een extra geheim (pepper) dat aan root toebehoort. Beperk bij openbare installaties ook verbindingen en verzoekfrequentie op de proxy en gebruik DDoS-bescherming van de provider.
- **Remote MCP.** `/mcp`, het OAuth-tokenendpoint en de metadata voor servicedetectie zijn openbaar bereikbaar. Tools vereisen een kortlevend Bearer-token met beperkte doelgroep en scopes. Autorisatie gebruikt de browsersessie van `/app/` en koppelt toegang expliciet aan een bestaande actieve gebruiker.
  - Het standaardantwoord (`content`) bevat alleen eigenaarsgebonden ID's, statussen, cursors en begrensde diagnostiek die nodig zijn voor een volgende stap. Paden en diagnostiek uit gebruikersinvoer worden als onbetrouwbare gegevens teruggegeven, zonder controletekens en met grenzen aan lengte en aantal.
  - De standaardinhoud `content` en diagnostische logboeken bevatten geen OAuth-tokens, API-sleutels, tickets, onbewerkte base64, volledige bronnen, complete logboeken, stacktraces, subject-ID's van Access of interne serverpaden. Volledige PDF's en logboeken zijn alleen beschikbaar door een resource te lezen, waarbij het eigendom opnieuw wordt gecontroleerd.

## Lokaal webscherm voor instellingen {#local-setup-web-ui}

`n624-latex setup --gui` (voorheen `latex-render setup --gui`) luistert alleen op een willekeurige poort van `127.0.0.1` op de lokale computer.

- Het fragment (`#...`) van de URL die de CLI opent, bevat een eenmalig starttoken. De browser verwijdert het direct uit de geschiedenis en wisselt het in voor een kortdurende sessie.
- Elke API-bewerking vereist een exacte overeenkomst van `Origin`, een Bearer-sessie en een afzonderlijk CSRF-token. CORS is uitgeschakeld, de Host en het loopbackadres van de client worden gecontroleerd en er gelden een strikt CSP-beleid, `frame-ancestors 'none'` en `no-store`.
- De ingevoerde sleutel gaat uitsluitend naar de opslagbewerking en verschijnt niet in antwoorden over status, diagnostiek of testconversies. Het scherm sluit na 30 minuten inactiviteit of 2 uur na het starten.
