---
slug: lan-https
category: Hosting in proprio
title: Usare HTTPS nella LAN con Akebi
description: Accedi al server con un URL HTTPS derivato dall’indirizzo IP locale.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Accedere tramite l’indirizzo IP della LAN {#lan-の-ip-アドレスからアクセスする}

Akebi trasforma l’IP privato del server in un nome host raggiungibile tramite HTTPS.

Configura il servizio di certificati condiviso nell’assistente di LaTeX Renderer. Per fornire il tuo servizio, consulta [Gestire un servizio di certificati Akebi](/it/docs/lan-https-authority/).

- **Esempio IPv4.** Per l’IP `192.168.1.50` e il dominio LAN `lan.example.org`, l’URL è `https://192-168-1-50.lan.example.org`.
- **IPv6.** Il nome contiene gli otto gruppi espansi dell’indirizzo privato supportato. Usa l’URL esatto mostrato dalla configurazione.

**Requisiti di rete e DNS**
Il client deve poter raggiungere la LAN del server. Se il nome non si risolve, controlla se il router o il resolver DNS blocca le risposte con IP privati come **protezione dal DNS rebinding**. Se necessario, aggiungi un’eccezione limitata al dominio LAN usato.

## Scegliere il tipo di certificato {#証明書の方式を選ぶ}

| Metodo | Requisiti e caratteristiche |
| --- | --- |
| **Servizio condiviso, CA pubblica** | Configura il servizio condiviso e accetta le condizioni dell’autorità di certificazione (CA). La chiave privata del certificato rimane sul server. |
| **Servizio proprio, CA pubblica** | URL e dominio LAN del [tuo servizio Akebi](/it/docs/lan-https-authority/) e, quando necessario, codice di invito. |
| **Keyless** | Richiede un servizio compatibile a cui delegare la firma durante l’handshake TLS. |
| **Certificato esistente o CA privata** | Certificato corrispondente al nome del server e relativa chiave privata. Per una CA privata, configura la fiducia nella radice sul server e su tutti i client. |

> [!NOTE]
> - Con una CA pubblica, i nomi host dei certificati emessi appaiono nei **registri pubblici di Certificate Transparency (CT)**.
> - Due LAN in luoghi diversi con lo stesso IP privato e lo stesso dominio LAN costituiscono **la stessa origine** per il browser e condividono cookie e altri dati memorizzati.

## Configurare l’accesso dalla LAN {#lan-向けに設定する}

1. Per una nuova installazione, [prepara il server](/it/docs/self-hosting/#準備するもの) e usa `sudo n624-latex server setup --web` per aprire l’[assistente](/it/docs/server-setup/#ブラウザで開く). Per modificare un server con HTTPS dedicato gestito, usa `sudo n624-latex server setup --ingress --web`.
2. Seleziona **LAN** come modalità di accesso e indica interfaccia di rete, IP privato, sottoreti dei client ammesse e porta HTTPS.
3. Scegli servizio e metodo di certificazione. Con il servizio condiviso vengono configurati l’URL `https://akebi.n624.net` e il dominio LAN `lan.n624.net`, e il server viene registrato quando applichi le modifiche. Non occorre un invito. Per una CA pubblica, verifica e accetta le condizioni. Se usi un servizio proprio su invito, inserisci il codice dell’amministratore.
4. Controlla l’URL HTTPS generato e le sottoreti ammesse prima di applicare. L’autenticazione dell’applicazione con password o OIDC resta attiva.
5. Da un altro computer di una sottorete ammessa, apri l’URL, verifica che non compaiano avvisi sul certificato, accedi e converti un documento di prova.

Per ospitare il tuo servizio, consulta [Gestire un servizio di certificati Akebi](/it/docs/lan-https-authority/).

## Controllare lo stato del certificato {#証明書の状態を確認する}

Usa questi comandi per visualizzare il servizio, il timer di rinnovo e i log del relativo spazio dei nomi.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Se l’emissione o il rinnovo fallisce, verifica l’orologio del server, la connessione HTTPS al servizio, il dominio, l’IP e l’ora del prossimo tentativo indicata dalla CA. Un errore temporaneo mantiene il certificato valido. Il timer riprende l’emissione dallo stato registrato. Se chiave e stato non corrispondono, verifica i file di stato conservati della stessa generazione.

Consulta la [progettazione di Akebi e la risoluzione dei problemi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
