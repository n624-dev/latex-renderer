---
slug: self-hosting
category: Hosting in proprio
title: Gestire LaTeX Renderer sul proprio server
description: Scegli una configurazione supportata, prepara l’host e installa il servizio con aggiornamenti e backup.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Opzioni di installazione {#現在の提供状況}

Per configurare un server, installa il [pacchetto APT](/it/docs/client/#debian-ubuntu-の-apt-パッケージ) ed esegui l’assistente. L’assistente imposta HTTPS, il metodo di accesso e il primo proprietario.

### Ordine della prima installazione {#初回導入の順序}

1. **Prepara il server.** Controlla i [sistemi e le modalità di accesso supportati](#対応する構成) e [installa Docker Engine e Nginx](#準備するもの).
2. **Installa il pacchetto APT.** Segui le [istruzioni per Debian e Ubuntu](/it/docs/client/#debian-ubuntu-の-apt-パッケージ) per installare `n624-latex`.
3. **Configura il server.** Da un account di deployment non root esegui `sudo n624-latex server setup --plan`. Risolvi i prerequisiti mancanti e continua con la [configurazione nel browser](/it/docs/server-setup/#ブラウザで開く).
4. **Crea il primo PDF.** Apri l’URL HTTPS configurato, [accedi e converti un documento di prova](#導入完了の確認). L’assistente prepara il primo ambiente TeX.

Per un server esistente, consulta [Aggiornare dall’amministrazione](/it/docs/updates/). Per installare da un archivio tar, segui le [istruzioni manuali](#v1-6-9をダウンロードして検証).

## HTTPS automatico nella LAN {#lan-内の自動-https}

**Akebi** permette di configurare un URL HTTPS derivato dall’IP privato del server. Puoi iniziare con il servizio di certificati condiviso. Consulta [Usare HTTPS nella LAN con Akebi](/it/docs/lan-https/).

## Configurazioni supportate {#対応する構成}

APT supporta nuove installazioni su un singolo host con `systemd` che esegua Debian 12 o 13 oppure Ubuntu 24.04 o 26.04, su amd64 o arm64. La compilazione LaTeX usa Docker rootless con un utente dedicato.

| Modalità di deployment (`DEPLOYMENT_MODE`) | Ingresso | Metodi di accesso |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache o HTTPS nella LAN (Akebi) | Password locali, OIDC o entrambi |
| `cloudflare` | Cloudflare Tunnel e un Worker | Cloudflare Access o autenticazione nativa (password, OIDC o entrambi) |

- **OIDC.** Permette di usare il provider di identità (IdP) dell’organizzazione.
- **Cloudflare Access.** Prepara un’applicazione Access per gli utenti in Cloudflare.
- **Password locali.** Registra gli utenti nell’amministrazione del server senza un IdP esterno.
- **Password e OIDC.** Attiva entrambi con l’autenticazione nativa usando `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` e `AUTH_OIDC_ENABLED=true`. Per le configurazioni precedenti a metodo singolo usa `AUTH_MODE`.

## Preparare il server {#準備するもの}

- **Account di lavoro.** Collegati con un account non root ed esegui i comandi di configurazione con `sudo`.
- **Disco.** Il controllo iniziale richiede **almeno 5 GiB liberi** in ogni file system che contenga `/opt` o `/var/lib`. Prevedi altro spazio per immagini TeX, versioni, risultati e backup cifrati.
- **Docker Engine.** Installa Docker Engine e `docker-ce-rootless-extras` dal repository ufficiale. L’assistente configura Docker rootless per la compilazione. Consulta le istruzioni ufficiali per [Debian](https://docs.docker.com/engine/install/debian/) o [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installalo con `sudo apt install nginx`. Le nuove installazioni APT verificano che Nginx sia presente anche se esponi il servizio con Caddy, Apache o Cloudflare.
- **Accesso e TLS.** Per HTTPS proprio prepara nome host, certificato e chiave privata, e lascia disponibili indirizzo e porta per HTTPS integrato. Per Cloudflare prepara Tunnel, DNS e Worker. Consulta i [requisiti di HTTPS nella LAN](#lan-内の自動-https).
- **Credenziali**
  - OIDC richiede URL dell’emittente, ID e segreto del client e il `subject` stabile del primo proprietario.
  - Cloudflare Access richiede i dati dell’applicazione Access e il `subject` del proprietario.
  - Per le password prepara nome di accesso e password iniziale del proprietario.
- **Connettività in uscita.** Il server deve poter raggiungere via HTTPS GitHub Releases e Attestations, GHCR (`ghcr.io`), gli archivi di TeX Live e i repository dei pacchetti di Debian o Ubuntu.
- **Pacchetto APT.** Include Node.js. Consulta le [istruzioni APT](/it/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Verificare l’installazione {#導入完了の確認}

1. Apri `/admin/` all’URL HTTPS configurato e accedi come proprietario registrato durante l’installazione.
2. Apri `/app/` allo stesso URL, seleziona il [`main.tex` di esempio](/it/docs/#最短でpdfを作る) e fai clic su **Converti in PDF**.
3. Apri il PDF nella pagina dei risultati e verifica che mostri il testo di esempio.

> [!DETAILS] Verifiche aggiuntive di servizi e output
>
> Gli amministratori possono provare la conversione dall’URL pubblico. La chiave API emessa per la verifica viene revocata subito dopo.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Puoi verificare anche l’accesso di un utente normale, le guide pubbliche, le lingue e l’immagine indicate nell’ambiente TeX e gli output usati di frequente, come documenti in giapponese o SVG.

### Registrare utenti ed emettere chiavi {#利用者と-api-キーの発行}

Quando riesci ad accedere come proprietario a `/admin/`, registra gli utenti.

- **Web e Remote MCP.** Crea l’utente in **Utenti**, registrane l’identità per il metodo di accesso scelto e forniscigli l’URL dell’applicazione web.
- **CLI, Local MCP e API HTTP.** Crea un account di servizio collegato all’utente. In **Chiavi API → Emetti chiave API**, emetti una chiave di rendering con `render:create` e `render:read:own` (prefisso `lrk_...`) e consegnala tramite un canale sicuro.

## Aggiornamenti e ripristino della versione {#更新とロールバック}

### Aggiornare l’applicazione {#アプリケーションを更新する}

- Come proprietario, apri **Amministrazione → Aggiornamenti**. Consulta [Aggiornare il server o tornare alla versione precedente](/it/docs/updates/).
- Per cambiare versione o lingue di TeX Live, apri **Amministrazione → Ambiente TeX**. Consulta [Configurare l’ambiente TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migrazione e recupero in casi particolari
>
> ### Migrare il programma di aggiornamento root v1.2.x alla separazione dei privilegi {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Consulta le [istruzioni di migrazione del programma di aggiornamento](/it/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar interrompe l’estrazione con Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Consulta la [procedura per gli errori di estrazione](/it/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Il blocco delle modifiche è occupato {#mutation-lockが使用中と表示される場合}
>
> Consulta come [individuare il processo che detiene il blocco](/it/docs/reference/#mutation-lockが使用中と表示される場合).

## Backup {#バックアップ}

Per backup periodici, punti precedenti a un aggiornamento, prove di ripristino e recupero, consulta [Creare, verificare e ripristinare i backup](/it/docs/backups/). Se la posizione di esportazione di audit non corrisponde dopo il ripristino, consulta [Recuperare i log di audit](/it/docs/reference/#監査ログの復旧).

## Risoluzione dei problemi {#問題が起きた場合}

| Sintomo | Prima verifica |
| --- | --- |
| Impossibile raggiungere `/app/` | DNS, certificato TLS, configurazione di Tunnel o proxy e ordine di avvio dei servizi locali |
| Solo gli amministratori non possono accedere | Identità o credenziale esplicita del proprietario, `AUTH_MODE`, emittente, destinatari e ruoli |
| Impossibile ottenere l’immagine TeX | Accesso HTTPS a `ghcr.io`, visibilità del pacchetto e architettura del tag |
| Una modifica a TeX richiede molto tempo | ID operazione e log di Image Manager con i dati sensibili oscurati |
| Un aggiornamento viene rifiutato | Immutabilità della versione, digest dell’archivio, percorso di aggiornamento e spazio disponibile |
| La preparazione dell’host si ferma per un percorso non sicuro | Verifica che `/var/lib/latex-renderer` appartenga a `root:latex-renderer` e abbia modalità `2770` |
| Fallisce solo la pagina degli aggiornamenti | Presenza di `client-dist/manifest.json` nella distribuzione e stato di Admin Web |
| La conversione non parte | Stato della coda, almeno 5 GiB liberi, servizio worker e socket Docker rootless |
| Si manifestano problemi subito dopo un aggiornamento | Blocca l’ammissione di nuovi processi e confronta le versioni vecchie e nuove di applicazione e ambiente prima di decidere se ripristinare |

Annota l’ID operazione, la fase dell’errore e un codice di errore che puoi condividere. Consulta [Risoluzione dei problemi](/it/docs/troubleshooting/), [Sicurezza di account e documenti](/it/docs/security/) e [Configurazione del deployment e relativi file (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Modificare l’ambiente TeX {#tex環境の初期設定}

La configurazione iniziale prepara l’ambiente di compilazione. Per aggiungere lingue o cambiare la versione di TeX Live, apri **Amministrazione → Ambiente TeX** (`/admin/tex-environment/`). L’esempio seguente supporta inglese e giapponese.

| Impostazione | Valore consigliato |
| --- | --- |
| Image | `latest` (per un tag con data fissa, scegline uno compatibile con la tua architettura) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (disattivato per impostazione predefinita) |

- Dal pacchetto pubblico su GHCR viene scaricata solo l’**immagine di base** priva di lingue, fissata al digest. Il server costruisce un’**immagine di esecuzione** con le lingue scelte e il codice attuale del renderer. Se esiste un’immagine locale con la stessa configurazione, viene riutilizzata. Le immagini di esecuzione non vengono pubblicate all’esterno.
- La build continua anche se chiudi il browser. Controlla poi l’ambiente attivo e le lingue nell’amministrazione. Se il download fallisce, verifica la connessione HTTPS a `ghcr.io` e la compatibilità dell’architettura.

### Pulizia automatica del disco {#自動容量整理}

> [!DETAILS] Pulizia di immagini inutilizzate e cache di build
>
> Per impostazione predefinita Image Manager pulisce le immagini gestite inutilizzate ogni 24 ore. Protegge base e ambiente di esecuzione attivi, quelli precedenti conservati per il ripristino e le immagini referenziate nella configurazione. Le altre possono essere eliminate 24 ore dopo la creazione. La pulizia usa 2 GiB come valore indicativo per la cache di build inutilizzata, senza imporre un limite complessivo a Docker.
>
> Modifica i valori in `/etc/latex-renderer/renderer.env` e applicali con `sudo systemctl restart latex-renderer-image-manager.service` quando non è in corso un aggiornamento di TeX.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` accetta `0` per disattivare la pulizia o un intervallo da `1` a `720` ore. A partire da 5 minuti dopo l’avvio, ogni 5 minuti viene controllato se la pulizia è dovuta. Un blocco comune la rimanda durante aggiornamenti e deployment. La pulizia manuale dal web o dalla CLI elimina gli elementi non protetti senza attendere la fine della conservazione.
> - `RETENTION_HOURS` accetta da `0` a `8760` ore e `BUILD_CACHE_MAX_GIB` da `0` a `1024` GiB.
> - Da `1.3.4-rc.2`, i metadati Buildx di Docker rootless sono isolati in `.docker/buildx-worker` nella home del worker per evitare conflitti di permessi con le build di root. La pulizia automatica ignora le immagini delle configurazioni precedenti e le directory di recupero manuale. Elimina i singoli elementi solo dopo aver verificato che siano superflui. Non eliminare mai direttamente la directory dei dati di Docker.

## Privilegi di installazione e gestione {#sudoと通常運用の境界}

L’installazione iniziale prepara utenti di sistema, directory, unità `systemd`, Docker rootless e file di chiavi con `sudo`. **Durante il normale funzionamento, il web e l’API di amministrazione non ricevono privilegi `sudo`.**

- **Modifiche a TeX.** Vengono richieste a Image Manager, di proprietà di root, tramite un socket Unix con permessi limitati.
- **Aggiornamenti.** Un socket Unix comunica con il controller non root di Update Manager, che delega operazioni fisse a un processo ausiliario root di breve durata.
- **Mutua esclusione.** Un blocco condiviso serializza le modifiche a TeX e gli aggiornamenti. Il web e l’API non possono passare comandi, percorsi o URL arbitrari a root.

## Configurazione e segreti {#設定と秘密情報}

Le impostazioni specifiche dell’host e i segreti sono conservati fuori dall’applicazione e dall’albero di lavoro Git, per esempio in `/etc/latex-renderer/`.

| Percorso | Contenuto | Modalità consigliata |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Profilo di accesso, URL, limiti e configurazione non segreta dell’IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Identificatori e token specifici del profilo Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Account di deployment non root | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Binding e percorsi del Worker di produzione | `0600` |
| `/etc/cloudflared/config.yml` | Ingresso di Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, chiave dei ticket e credenziali dei gestori | Dipende dal file |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Segreto del client per il profilo OIDC | `0440` |

> [!WARNING]
> Non inviare a Git e non incollare in issue o richieste di assistenza file `.env`, token Cloudflare, credenziali di Tunnel, chiavi API, database SQLite, documenti, PDF o log reali non oscurati. I `*.example` nel repository sono modelli per consultare i campi.

## Installazione manuale da archivio tar e versioni precedenti {#手動配置-旧版向けの構築手順-tarball-導入}

Con APT e `sudo n624-latex server setup`, l’assistente esegue o guida l’estrazione, la preparazione dell’host e la registrazione del proprietario. Espandi la sezione seguente se distribuisci `v1.7.1` manualmente o devi controllare i limiti di accesso o il cambio di autenticazione.

> [!DETAILS] Scaricare, verificare, distribuire e registrare il proprietario con v1.7.1
>
> Per una nuova installazione manuale usa la versione stabile [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archivio `latex-renderer-server-1.7.1.tar.gz`. Il tag e i file diventano immutabili dopo la pubblicazione. Il deployment diretto dal ramo di sviluppo `main` e la `docker build` locale di TeX non rientrano nell’uso operativo supportato.
>
> ### Scaricare e verificare v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Prepara `curl`, `jq`, `tar`, `sha256sum` e una CLI GitHub compatibile con `gh attestation verify`. Node.js e Corepack vengono installati più avanti durante la preparazione dell’host.
>
> Come utente normale, esegui i passaggi seguenti nella stessa sessione Bash. Vengono verificati sia lo SHA-256 di GitHub Releases sia la firma di provenienza di GitHub Actions. I dati di provenienza vengono passati dall’API pubblica a `gh` senza account o token GitHub. Se un passaggio fallisce, `bundle_root` resta non definita. Correggi la causa e riprova.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### Preparare l’host {#ホストを準備}
>
> Installa `setfacl` per i permessi di archiviazione, `bsdtar` per l’estrazione nel programma di aggiornamento confinato e `unzip` per controllare gli ZIP. Segui le istruzioni ufficiali per installare Node.js 26 o 24 (`/usr/local/bin/node` e `/usr/local/bin/corepack`) e gli strumenti di Docker rootless. Per `cloudflare` installa anche `cloudflared`. Update Manager installa e verifica con Corepack la versione di pnpm indicata per l’utente di deployment.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> Dall’account di deployment abituale, inizializza l’host e configura Docker rootless per `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Creare la configurazione specifica dell’host {#ホスト固有設定を作成}
>
> Crea `renderer.env` per tutti i profili e configura `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` e `AUTH_MODE`. Non esiste un alias come `ADMIN_ALLOWED_ORIGINS`. L’origine consentita per le operazioni del browser deve coincidere esattamente con `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profilo `cloudflare`.** Sostituisci `example.com`, `REPLACE_*`, tutti gli UUID e l’audience di Access con i valori della tua installazione. Per un Tunnel gestito da remoto, ometti il `config.yml` locale e verifica prima che il connettore sia attivo.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **Profilo `standalone`.** Installa Nginx, Caddy o Apache, copia un esempio da `deploy/reverse-proxy/` e indica FQDN e percorsi dei certificati. Il proxy elimina le intestazioni `CF-Access-*` in ingresso e sovrascrive l’IP del client. Non esporre direttamente i servizi locali sulle porte da 3100 a 3105.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **Con `AUTH_MODE=oidc`.** Registra `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` nell’IdP. In `renderer.env` configura `OIDC_ISSUER` e `OIDC_CLIENT_ID` e salva il segreto in un file separato senza ritorno a capo finale.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Distribuire i servizi {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - L’avvio iniziale scarica e verifica nuovamente l’archivio immutabile pubblicato, separa l’albero di controllo di root dall’albero di build senza privilegi, costruisce `client-dist` e lo distribuisce in `/opt/latex-renderer/releases/$release_id`. Rifiuta host con un database o un `current` esistenti. Dopo l’installazione usa l’aggiornamento normale.
> - Prima del deployment, verifica `renderer.env` (appartenente a root, modalità `0640`, nessuna chiave duplicata), `PUBLIC_ORIGIN`, le impostazioni di autenticazione e proprietà, permessi e lunghezza del pepper e dei segreti, senza mostrarne i valori.
> - Il programma di aggiornamento è conservato separatamente in `/opt/latex-renderer/updater`, come descritto da `docs/independent-updater.md` nel repository. Solo il gruppo primario dell’utente di deployment può attraversare `/opt/latex-renderer/update-staging`. Ogni area di preparazione è isolata con `0700` e viene pulita al termine o, se interrotta, a un avvio successivo trascorse 24 ore.
>
> ### Limiti dell’accesso pubblico {#公開境界}
>
> - **`cloudflare-access`.** Proteggi `/auth/*`, `/app/`, `/admin/` e `/oauth/authorize` con la stessa applicazione Access per utenti umani e verifica l’audience anche all’origine. Con Cloudflare e OIDC o password, evita che Access blocchi `/auth/*`. Documentazione e download sono pubblici. Le Worker Routes servono solo la parte pubblica dell’API di rendering. Nelle regole di ingresso del Tunnel inserisci prima i percorsi specifici di API e amministrazione, poi il web come predefinito e infine `http_status:404`.
> - **`standalone`.** Un proxy inverso TLS distribuisce le richieste per percorso ai servizi locali. Solo le piccole operazioni JSON sui ticket passano allo Standalone Gateway sulla porta 3105. L’esempio Nginx limita connessioni e frequenza per l’accesso con password e l’API dei ticket. Caddy e Apache senza estensioni non forniscono limiti equivalenti per client. È quindi obbligatorio applicarli su un bilanciatore o presso il provider. Tieni privati `/internal/*`, il database e i socket di gestione.
>
> ### Primo proprietario {#最初のowner}
>
> L’identità esterna è determinata da `provider + issuer + subject` e quella con password da `login name`. L’e-mail serve solo per la visualizzazione. Gli account non vengono collegati per coincidenza dell’e-mail né creati automaticamente all’accesso. Esegui una sola volta la procedura del metodo scelto.
>
> **Cloudflare Access o OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **Password locale (esempio con il nome `owner`)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### Modificare AUTH_MODE in seguito {#後からauth-modeを変更する場合}
>
> Usa questa procedura quando l’[assistente del server](/it/docs/server-setup/) non è disponibile.
> Crea un backup cifrato e arresta l’API di amministrazione. Con l’ID immutabile ottenuto dall’amministrazione o tramite `users list` (formato `user_...`), aggiungi il nuovo metodo di autenticazione. La sovrascrittura delle credenziali esistenti viene rifiutata e le sessioni attuali sono revocate. Modifica poi `renderer.env` e riavvia l’API e il web. Conserva le vecchie credenziali finché non hai verificato il nuovo accesso in una finestra privata.
>
> Esegui prima la preparazione seguente e poi solo i comandi del metodo di destinazione.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **Per passare a OIDC o Cloudflare Access**, inserisci `oidc` o `cloudflare-access`.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **Per passare alla password**, inseriscila nel campo nascosto.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
