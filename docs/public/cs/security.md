---
slug: security
category: Řešení potíží a zabezpečení
title: Zabezpečení účtů a dokumentů
description: Ochrana přihlašovacích údajů a předávaných souborů a hranice přístupu k vykreslovací službě a správě.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Pokud unikne klíč API, ihned požádejte správce, aby jej zneplatnil a vydal nový.
- Zranitelnosti oznamte přes [soukromý formulář na GitHubu](https://github.com/n624-dev/latex-renderer/security/advisories/new). Podrobnosti nezveřejňujte ve veřejném hlášení.

## Přihlašovací údaje {#資格情報}

- Klíče API neuvádějte v argumentech příkazů (viditelných například přes `ps`), adresách URL, repozitářích Git, protokolech ani konverzacích s AI.
- Pro místní ukládání používejte ve Windows DPAPI, v Linuxu a macOS soubor s režimem `0600` čitelný pouze pro vlastníka.
- Hesla pro web, klientské tajemství OIDC a soubory cookie relací používejte pouze k určenému účelu. Uchovávejte je odděleně od klíčů CLI a API (`lrk_` a `lra_`).

## Projekty {#プロジェクト}

Všechny zdroje LaTeX a přílohy se považují za nedůvěryhodný vstup. Symbolické odkazy, přístup TeXu k shellu, spouštění externích příkazů a síťová spojení mimo kontejner jsou zakázána. Respektujte izolaci, časové limity a omezení souborů.

## Veřejné a správní rozhraní {#公開領域と管理領域}

Veřejná dokumentace a soubory ke stažení, stránky s přihlášením (`/app/` a `/admin/`) a vykreslovací API mají oddělené cesty pod jedním kanonickým počátkem HTTPS.

- **Hranice sítě.** Jediným vstupem v profilu Cloudflare jsou Tunnel/Workers. V profilu standalone jde o reverzní proxy s TLS. Aplikační služby naslouchají na zpětné smyčce. Interní API, SQLite a sokety pro správu zůstávají neveřejné. Stránky s přihlášením jsou vyloučeny z indexů vyhledávačů.
- **Přihlášení a relace v prohlížeči.** Ověření přes externího IdP vyžaduje přesnou shodu `provider + issuer + subject`. E-mail ani zobrazované jméno automaticky nepropojují účty. Server může relaci ihned odvolat. Požadavky měnící stav vyžadují přesnou shodu `Origin` a token CSRF příslušné relace. Hesla chrání `scrypt` a další tajná hodnota (pepper) vlastněná rootem. Při veřejném provozu použijte také omezení počtu spojení a četnosti požadavků na proxy a ochranu proti DDoS u poskytovatele.
- **Remote MCP.** `/mcp`, koncový bod pro tokeny OAuth a metadata pro vyhledání služby jsou veřejné. Volání nástrojů vyžaduje krátkodobý token Bearer s omezeným příjemcem a rozsahem oprávnění. Autorizace využívá relaci prohlížeče `/app/` a výslovně váže přístup na existujícího aktivního uživatele.
  - Standardní odpověď (`content`) obsahuje jen identifikátory omezené na vlastníka, stavy, kurzory a omezenou diagnostiku nutnou k dalšímu kroku. Cesty a diagnostika pocházející od uživatele se vracejí jako nedůvěryhodná data bez řídicích znaků a s omezením délky a počtu položek.
  - Běžný obsah `content` a diagnostické protokoly neobsahují tokeny OAuth, klíče API, tikety, nezpracovaná data base64, úplné zdroje, celé protokoly, výpisy zásobníku, identifikátory subjektů Access ani interní cesty serveru. Celé PDF a protokoly jsou dostupné pouze čtením zdroje po opětovném ověření vlastníka.

## Místní webové nastavení {#local-setup-web-ui}

`n624-latex setup --gui` (dříve `latex-render setup --gui`) naslouchá pouze na náhodném portu `127.0.0.1` místního počítače.

- Fragment (`#...`) adresy URL otevřené CLI obsahuje jednorázový spouštěcí token. Prohlížeč jej okamžitě odstraní z historie a vymění za krátkodobou relaci.
- Každá operace API vyžaduje přesnou shodu `Origin`, relaci Bearer a samostatný token CSRF. CORS je vypnuté, ověřuje se Host a adresa klienta na zpětné smyčce a platí přísná CSP, `frame-ancestors 'none'` a `no-store`.
- Zadaný klíč se předává pouze operaci uložení. Odpovědi o stavu, diagnostice a zkušebním převodu jej neobsahují. Rozhraní se zavře po 30 minutách nečinnosti nebo 2 hodinách od spuštění.
