---
slug: lan-https-authority
category: Hosting in proprio
title: Gestire un servizio di certificati Akebi
description: Configura la delega DNS del dominio LAN, l’emissione dei certificati e la registrazione libera o su invito.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Questa guida è rivolta agli amministratori che gestiscono un proprio servizio di certificati. Per usare quello condiviso con LaTeX Renderer, consulta [Usare HTTPS nella LAN con Akebi](/it/docs/lan-https/).

Prepara una zona DNS delegabile, un host Linux (amd64 o arm64) in grado di servire DNS pubblico e HTTPS, Node.js 24 o 26 e un account presso la tua CA. Usa una distribuzione del server di cui hai verificato la firma con la [procedura di download manuale](/it/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegare il DNS {#dns-を委任する}

Configura questi record nella zona del dominio superiore. Il DNS di Akebi deve essere raggiungibile da Internet sulla **porta 53 sia in UDP sia in TCP**.

| Tipo | Nome | Valore |
| --- | --- | --- |
| `A` | `ns1.example.org` | IPv4 pubblico del server DNS di Akebi |
| `A` | `akebi.example.org` | IPv4 pubblico del proxy inverso HTTPS dell’API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Riserva `ns1.example.org` al DNS e colloca l’host dell’API (`akebi.example.org`) fuori dalla zona dei certificati LAN (`lan.example.org`).
- Dopo la delega Akebi risponde dinamicamente con i record `A` e `AAAA` derivati dagli IP della LAN e con i record `TXT` di validazione ACME. Non occorre un record per IP nella zona superiore.

## Distribuire il servizio {#サービスを配置する}

1. **Crea l’utente e le directory di stato.** Separa i permessi dell’applicazione con un utente e un gruppo dedicati di nome `latex-renderer-lan-authority`. Crea `/var/lib/latex-renderer-lan-authority` e la sottodirectory `keyless` con tale proprietà e modalità `0700` per entrambe.
2. **Prepara la directory di configurazione.** Crea `/etc/latex-renderer-lan-authority` con proprietario e gruppo `root:latex-renderer-lan-authority` e modalità `0750`. Copia al suo interno `deploy/lan-https/examples/authority.json` dalla distribuzione verificata e assegnagli `root:latex-renderer-lan-authority` e modalità `0640`.
3. **Modifica `authority.json`.**
   - `policy.serverOrigin` specifica l’URL HTTPS dell’API, per esempio `https://akebi.example.org`.
   - `policy.lanDomain` specifica il dominio LAN delegato, per esempio `lan.example.org`.
   - `dns.nameserver` e `dns.listeners` specificano l’host DNS pubblico e gli indirizzi di ascolto. Se un altro DNS occupa la porta 53, scegli un IP pubblico che non crei conflitti.
   - Associa `http` all’interfaccia di loopback.
   - Configura la CA pubblica in `issuers`. Se richiede External Account Binding (EAB), usa il `eabFile` specificato, di proprietà dell’utente del servizio e con modalità `0600`, per memorizzare `kid` e `hmacKey`. Se il dominio usa record CAA, autorizza la CA scelta.
4. **Installa codice e unità systemd.** L’esempio presuppone che i sorgenti verificati appartengano a root e si trovino in `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Inizializza lo stato e avvia il servizio.** Esegui `init` solo la prima volta.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Ottenere il certificato HTTPS {#https-証明書を用意する}

L’esempio Nginx per pubblicare l’API si trova in `deploy/lan-https/examples/authority.nginx.conf` e inoltra le richieste all’API sull’interfaccia locale. Ottieni il certificato dell’API prima di attivare TLS in Nginx.

Per il rinnovo automatico con Certbot, indica CA, contatto, accettazione delle condizioni e dati EAB necessari in `/etc/latex-renderer-lan-authority/certbot.ini`, accessibile solo a root. Usa una chiave ECDSA P-256. Attendi la propagazione della delega DNS ed esegui i comandi seguenti.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Dopo l’emissione, adegua nome del server e percorsi dei certificati in Nginx, verifica la sintassi con `nginx -t`, applica le modifiche e controlla il timer di rinnovo di Certbot.

- **Per offrire Keyless**, ottieni un ulteriore certificato wildcard ECDSA P-256 che contenga soltanto `*.lan.example.org`. Nel comando precedente sostituisci `--cert-name` con `akebi-keyless`, `-d` con `'*.lan.example.org'` e `--deploy-hook` con `"$hooks/operator-certificate-hook.sh"`. Con la sola modalità CA pubblica questo certificato non occorre.

## Configurare la registrazione {#登録方法を設定する}

In `authority.json` scegli tramite `policy.registration` il metodo di registrazione dei server client.

- `"open"` consente la registrazione automatica.
- `"invite"` richiede un codice emesso dall’amministratore.

Per la registrazione su invito, emetti con il comando seguente un codice limitato per durata e numero di utilizzi e consegnalo esclusivamente al destinatario tramite un canale sicuro.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Entrambe le modalità impongono limiti su registrazioni, frequenza di emissione ed elementi archiviati, oltre ai criteri di emissione della CA.

## Verificare dall’esterno {#外部から確認する}

Da una macchina esterna verifica la delega DNS, le risposte SOA in UDP e TCP, la risoluzione dei nomi derivati dagli IP e la risposta di discovery HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Una volta ottenute tutte le risposte, collega un server di prova LaTeX Renderer seguendo [Configurare l’accesso dalla LAN](/it/docs/lan-https/#lan-向けに設定する) e verifica l’emissione del certificato e l’accesso. Se la CA indica un orario per riprovare, attendi fino a quel momento.

**Backup.** Includi `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, gli account della CA e la configurazione di rinnovo di Certbot nei backup cifrati. Per un database SQLite in uso, usa la funzione di backup online.

Consulta gli [esempi di configurazione e la specifica di Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
