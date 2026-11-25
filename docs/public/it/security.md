---
slug: security
category: Risoluzione dei problemi e sicurezza
title: Sicurezza di account e documenti
description: Proteggi le credenziali e i file inviati e scopri i limiti di accesso al renderer e all’amministrazione.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- In caso di divulgazione di una chiave API, chiedi subito all’amministratore di revocarla e di emetterne un’altra.
- Segnala le vulnerabilità tramite il [modulo privato di GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Evita di pubblicare i dettagli in una issue pubblica.

## Credenziali {#資格情報}

- Tieni le chiavi API fuori dagli argomenti della riga di comando (visibili per esempio con `ps`), dagli URL, dai repository Git, dai log e dalle conversazioni con assistenti IA.
- Per la memorizzazione locale usa DPAPI su Windows o un file con modalità `0600` leggibile solo dal proprietario su Linux e macOS.
- Usa password del browser, segreti OIDC e cookie di sessione solo per lo scopo previsto. Tieni separate le chiavi della CLI e dell’API (`lrk_` e `lra_`).

## Progetti {#プロジェクト}

Tutti i sorgenti LaTeX e gli allegati sono trattati come input non attendibili. Sono disattivati i collegamenti simbolici, l’accesso alla shell da TeX, l’esecuzione di comandi esterni e le connessioni di rete fuori dal contenitore. Rispetta l’isolamento, i tempi massimi e i limiti sui file.

## Aree pubbliche e amministrazione {#公開領域と管理領域}

Documentazione e download pubblici, pagine autenticate (`/app/` e `/admin/`) e API di rendering hanno percorsi separati sotto un’unica origine HTTPS canonica.

- **Confine di rete.** L’unico ingresso per il profilo Cloudflare è Tunnel/Workers. Per il profilo standalone è un proxy inverso TLS. Tutti i servizi applicativi ascoltano sull’interfaccia di loopback. L’API interna, SQLite e i socket di amministrazione restano privati. Le aree autenticate vengono escluse dagli indici dei motori di ricerca.
- **Autenticazione e sessioni del browser.** L’identificazione tramite IdP esterno richiede la corrispondenza esatta di `provider + issuer + subject`. L’indirizzo e-mail e il nome visualizzato non collegano automaticamente gli account. Il server può revocare immediatamente una sessione. Le richieste che modificano lo stato richiedono la corrispondenza esatta di `Origin` e un token CSRF specifico della sessione. Le password sono protette da `scrypt` e da un segreto aggiuntivo (pepper) di proprietà di root. Nelle installazioni pubbliche applica anche limiti di connessione e frequenza al proxy e la protezione DDoS del fornitore.
- **Remote MCP.** `/mcp`, l’endpoint dei token OAuth e i metadati di discovery sono accessibili pubblicamente. Per eseguire uno strumento occorre un token Bearer di breve durata con destinatari e ambiti limitati. L’autorizzazione usa la sessione del browser di `/app/` e collega esplicitamente l’accesso a un utente esistente e attivo.
  - La risposta standard (`content`) include solo identificatori limitati al proprietario, stati, cursori e dati diagnostici circoscritti necessari per proseguire. I percorsi e i dati diagnostici forniti dall’utente vengono restituiti come dati non attendibili, senza caratteri di controllo e con limiti di lunghezza e quantità.
  - Il contenuto standard `content` e i log diagnostici escludono token OAuth, chiavi API, ticket, base64 grezzo, sorgenti completi, log integrali, tracce dello stack, identificatori subject di Access e percorsi interni del server. I PDF e i log completi sono disponibili solo tramite letture di risorse che verificano di nuovo la proprietà.

## Interfaccia web per la configurazione locale {#local-setup-web-ui}

`n624-latex setup --gui` (in precedenza `latex-render setup --gui`) ascolta solo su una porta casuale di `127.0.0.1` nella macchina locale.

- Il frammento (`#...`) dell’URL aperto dalla CLI contiene un token di avvio monouso. Il browser lo rimuove immediatamente dalla cronologia e lo scambia con una sessione di breve durata.
- Tutte le operazioni API richiedono la corrispondenza esatta di `Origin`, una sessione Bearer e un token CSRF separato. CORS è disattivato, vengono verificati l’Host e l’indirizzo di loopback del client e si applicano una CSP rigorosa, `frame-ancestors 'none'` e `no-store`.
- La chiave inserita viene trasmessa solo all’operazione di salvataggio ed esclusa dalle risposte di stato, diagnosi e conversione di prova. L’interfaccia si chiude dopo 30 minuti di inattività o 2 ore dall’avvio.
