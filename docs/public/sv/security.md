---
slug: security
category: Felsökning och säkerhet
title: Säkerhet för konton och dokument
description: Skydda inloggningsuppgifter och inskickade filer och förstå åtkomstgränserna för renderaren och administrationen.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Om en API-nyckel läcker, be genast administratören att återkalla den och utfärda en ny.
- Rapportera sårbarheter via [det privata formuläret på GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Publicera inte detaljerna i ett öppet ärende.

## Inloggningsuppgifter {#資格情報}

- Skriv inte API-nycklar i kommandoargument (synliga genom bland annat `ps`), webbadresser, Git-arkiv, loggar eller AI-konversationer.
- För lokal lagring använder du DPAPI i Windows eller en fil med läge `0600` som bara ägaren kan läsa i Linux och macOS.
- Använd webbläsarlösenord, OIDC-klienthemligheter och sessionskakor enbart för avsett ändamål. Håll dem skilda från CLI- och API-nycklar (`lrk_` och `lra_`).

## Projekt {#プロジェクト}

Alla LaTeX-källor och bilagor behandlas som otillförlitliga indata. Symboliska länkar, skalåtkomst från TeX, externa kommandon och nätverksanslutningar utanför containern är avstängda. Respektera isolering, tidsgränser och filgränser.

## Publika ytor och administration {#公開領域と管理領域}

Publika guider och nedladdningar, inloggningsskyddade sidor (`/app/` och `/admin/`) och renderings-API:t har separata sökvägar under ett och samma kanoniska HTTPS-ursprung.

- **Nätverksgräns.** I Cloudflare-profilen är Tunnel/Workers den enda ingången. I standalone-profilen är det en omvänd TLS-proxy. Alla applikationstjänster lyssnar på loopbackgränssnittet. Internt API, SQLite och administrationssocklar hålls privata. Inloggningsskyddade områden ingår inte i sökmotorernas index.
- **Autentisering och webbläsarsessioner.** Inloggning via extern identitetsleverantör kräver exakt matchning av `provider + issuer + subject`. E-post och visningsnamn kopplar inte automatiskt ihop konton. Servern kan återkalla en session omedelbart. Förfrågningar som ändrar tillstånd kräver exakt matchning av `Origin` och en sessionsbunden CSRF-token. Lösenord skyddas med `scrypt` och en extra hemlighet (pepper) som ägs av root. För publik drift behövs också begränsning av anslutningar och anropsfrekvens på proxyn samt DDoS-skydd hos leverantören.
- **Remote MCP.** `/mcp`, OAuth:s tokenändpunkt och metadata för tjänsteidentifiering är publikt tillgängliga. Verktygsanrop kräver en kortlivad Bearer-token med begränsad målgrupp och behörighet. Auktoriseringen använder webbläsarsessionen från `/app/` och knyter uttryckligen åtkomsten till en befintlig aktiv användare.
  - Standardsvaret (`content`) innehåller endast ägaravgränsade ID:n, status, markörer och begränsad diagnostik som krävs för nästa steg. Sökvägar och diagnostik med ursprung hos användaren returneras som otillförlitliga data, med styrtecken borttagna och gränser för längd och antal.
  - Standardinnehållet `content` och diagnostikloggarna utelämnar OAuth-token, API-nycklar, biljetter, rå base64, fullständiga källfiler och loggar, stackspår, Access-subjekt och interna serversökvägar. Fullständiga PDF-filer och loggar kan bara läsas som resurser efter förnyad ägarkontroll.

## Lokalt webbgränssnitt för inställningar {#local-setup-web-ui}

`n624-latex setup --gui` (tidigare `latex-render setup --gui`) lyssnar endast på en slumpmässig port på `127.0.0.1` på den lokala datorn.

- Fragmentet (`#...`) i adressen som CLI öppnar innehåller en starttoken för engångsbruk. Webbläsaren tar genast bort den ur historiken och byter den mot en kortlivad session.
- Alla API-anrop kräver exakt matchning av `Origin`, en Bearer-session och en separat CSRF-token. CORS är avstängt, Host och klientens loopbackadress kontrolleras och gränssnittet tillämpar strikt CSP, `frame-ancestors 'none'` och `no-store`.
- Den angivna nyckeln lämnas bara till sparåtgärden och ingår inte i svar om status, diagnostik eller testkonvertering. Gränssnittet stängs efter 30 minuters inaktivitet eller 2 timmar från start.
