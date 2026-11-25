---
slug: reference
category: Gestione e sviluppo
title: Riferimento per la gestione e lo sviluppo
description: Consulta i dettagli su salvataggio e recupero nel client, autenticazione MCP e procedure di migrazione.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Salvare e recuperare gli output {#成果物の保存-復旧の仕様}

> [!DETAILS] Specifiche e procedure
>
> - **Sostituzione atomica della directory.** La CLI e Local MCP mantengono percorsi come `.render/result.pdf`, `job.json` e quelli delle anteprime. Verificano dimensione e SHA-256 dichiarati per ogni file e sostituiscono la directory quando l’insieme è completo. Durante lo scambio la directory può scomparire brevemente. I programmi esterni devono leggerla dopo il termine del comando.
> - **Recupero automatico.** Una directory accanto a quella di output, di nome `<output-name>.latex-renderer-state`, conserva lo stato di recupero ed è esclusa dalla raccolta degli input. I dati temporanei vengono rimossi all’uscita normale. Dopo un arresto forzato, il download successivo ripristina il vecchio insieme se lo scambio non era stato confermato oppure mantiene il nuovo ed elimina il vecchio se era confermato. Non eliminare la directory di stato durante l’operazione o prima del recupero.
> - **Mutua esclusione e anomalie.** Scritture concorrenti nella stessa destinazione si interrompono con `OUTPUT_BUSY`. Il tempo trascorso da solo non scalza un processo attivo. In caso di riutilizzo del PID l’operazione si ferma per precauzione. Metadati danneggiati, file sconosciuti o collegamenti esterni richiedono una verifica prima di eliminare elementi.
> - **File dell’utente e limiti.** I normali file dell’utente vengono copiati nel nuovo insieme. Se viene rilevata una modifica durante il download, la pubblicazione viene annullata e la modifica è preservata. È preferibile una destinazione dedicata. Ogni insieme ammette fino a 1 GiB e 10.000 elementi. Prevedi spazio per entrambi e per i dati temporanei. Sono supportati solo file system locali. Si rifiutano percorsi con collegamenti simbolici, collegamenti fisici o punti di montaggio di altri file system. Non sono garantiti il blocco su condivisioni di rete né l’atomicità totale in caso di interruzione di corrente. Su Windows, se un file aperto impedisce lo scambio, il vecchio insieme viene mantenuto.

## Limiti dell’autenticazione web {#web認証の境界}

> [!DETAILS] Specifiche e procedure
>
> Le sessioni sul server proteggono `/app/`, `/admin/` e le rispettive API. Sono esclusi dall’indice di ricerca pubblico. Gli utenti normali usano `/app/` e solo amministratori e proprietari possono accedere a `/admin/`. L’identità si basa su `issuer + subject` del provider esterno o sul `login name` dell’autenticazione con password. E-mail e nome visualizzato non sono chiavi di autenticazione. Caricamenti di ZIP, processi, file di output e compilazione TeX passano per il renderer sul server.
>
> > [!NOTE]
> > Il browser non memorizza in modo permanente i ticket di breve durata. La sessione sul server li riemette quando necessario. Non condividere cookie di sessione, token CSRF o ticket.

## Registrazione e diagnostica di Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Specifiche e procedure
>
> - **Registrazione dinamica dei client (DCR).** Le registrazioni incomplete o inattive vengono normalmente rimosse dopo 30 giorni. Sono protette quelle referenziate da codici di autorizzazione validi o da famiglie di token. Il limite globale è 10.000. Se dopo la pulizia compare `invalid_client`, registra nuovamente il client. Sono ammesse richieste DCR standard senza nome del client, mantenendo la validazione del nome e dell’URI di reindirizzamento.
> - **Richieste di autorizzazione temporanee (schema 20).** Se il flusso passa per l’accesso, la richiesta viene salvata con un breve ID casuale che consente di riprenderla senza inserire il lungo `state` OAuth nell’URL di ritorno. Dura 10 minuti ed è utilizzabile una sola volta se corrispondono il browser autenticato e il cookie dedicato. Le schede simultanee hanno ID distinti. Il limite globale è di 1.000 richieste e ogni browser ammette fino a 8 cookie di continuazione. Raggiunto il limite viene restituito `503` mantenendo le richieste esistenti. Il database conserva solo gli hash dell’ID e del cookie. Il riavvio e il ripristino dei backup non ne prolungano la validità.
> - **Limiti per IP e intestazioni di origine.** DCR ammette 10 registrazioni per IP sorgente attendibile ogni 15 minuti. I client dietro lo stesso proxy di uscita condividono il limite. Dall’undicesimo tentativo vengono restituiti HTTP `429`, `temporarily_unavailable` e `Retry-After`. I metadati non validi non consumano la quota. In caso di IP assente o non valido viene restituito `503` perché l’operatore controlli il proxy, senza raggruppare i client non identificati. Mantieni il backend sull’interfaccia di loopback e configura il proxy perché sostituisca `X-Latex-Renderer-Client-IP` con l’indirizzo reale. I valori arbitrari di `X-Forwarded-For` vengono ignorati. Sui percorsi Cloudflare viene trattato anche `CF-Connecting-IP` all’interno del confine di fiducia.
> - **Verifica amministrativa della connettività.** Il comando seguente verifica la discovery pubblica e la challenge Bearer `401` senza inviare credenziali, modificare configurazioni, seguire reindirizzamenti o mostrare corpi, cookie o segreti.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Isolare la fase dell’errore.** Una discovery `200` e una challenge `401` corrette verificano solo queste fasi. Confronta fase, ora e `X-Request-ID` con i log `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` e `remote_mcp.rpc_result`. Tieni codici OAuth, token, cookie, verificatori PKCE, sorgenti e ID utente fuori da log e issue.
> - **L’autenticazione riesce ma fallisce la discovery delle azioni.** Verifica separatamente `initialize`, la notifica di inizializzazione e `tools/list` dopo l’emissione del token. Anche HTTP `200` può accompagnare un `error` JSON-RPC. `remote_mcp.rpc_result` registra stato HTTP, classificazione del risultato, versione del protocollo, numero di strumenti, byte di risposta e struttura di base dell’elenco. Il buffer di ispezione è limitato a 256 KiB. Se il limite viene superato, si registra solo `inspection_limited` e la risposta resta invariata. Una risposta SSE o una richiesta `GET` che restituisce `405` non bastano a diagnosticare un guasto. Controlla `Accept`, `Content-Type`, la negoziazione del protocollo e l’arrivo delle richieste dal proxy. Verifica a parte in produzione l’OIDC esterno, i criteri Cloudflare e un account ChatGPT reale.

## Risultati e risorse MCP {#mcpの結果とresource}

> [!DETAILS] Specifiche e procedure
>
> Le risposte di Remote MCP hanno tre livelli.
> 1. **`content` standard.** Contiene ID di input e processo, stato, offset, cursore, disponibilità e diagnostica limitata per decidere come proseguire e chiamare lo strumento successivo. Anche i client senza `structuredContent` o risorse personalizzate possono creare, correggere e renderizzare di nuovo.
> 2. **`structuredContent`.** Contiene l’oggetto validato completo per l’elaborazione automatica.
> 3. **Risorse MCP (`latex-renderer://jobs/...`).** Contengono dati voluminosi come PDF, `compile.log` completo, JSON grezzo, `svg/manifest.json` e `svg/objects/*.svg`. Solo lo stesso proprietario OAuth può leggerle. Si applicano gli stessi limiti di dimensioni e conservazione dei file normali. Tutti i livelli escludono chiavi API, token OAuth, ticket, testo sorgente e base64 grezzo.

## Attesa e nuovi tentativi della CLI {#cliの待機と再試行}

> [!DETAILS] Specifiche e procedure
>
> Se la richiesta di stato riceve un HTTP transitorio `502`, `503`, `504` o un JSON non valido, la CLI ripete soltanto la richiesta di stato dello stesso processo **fino a 5 volte**, con attese di 1, 2, 4, 8 e 8 secondi senza prolungare il tempo totale. La creazione di processi, il caricamento, il rinnovo di token e la verifica dei file non vengono ripetuti automaticamente. Gli errori di autenticazione e autorizzazione sono restituiti subito. Se la CLI smette di attendere, il server può continuare il processo.

## Formato JSON della CLI {#cliのjson形式}

> [!DETAILS] Specifiche e procedure
>
> Con `--json` lo standard output usa i formati seguenti. Sono esclusi la chiave API, `uploadTicket` e `jobTicket`.
>
> - **Successo (codice di uscita `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Errore della CLI o dell’API (codice di uscita `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Processo terminato con errore, per esempio per un errore LaTeX (codice di uscita `2`).** `result` contiene i dati del processo e i percorsi salvati. La risposta include `success: false`.

## Migrazione e recupero da versioni precedenti {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrare un vecchio programma di aggiornamento e risolvere gli errori di estrazione
>
> ### Migrare dal programma di aggiornamento root v1.2.x alla separazione dei privilegi {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Fino alla v1.2.x, Update Manager operava come demone root. Dalla v1.3.0 il controller permanente viene eseguito come `latex-renderer-update` e un processo ausiliario root di breve durata accetta operazioni fisse. Un aggiornamento web dal vecchio programma può fermarsi con `Application Update Manager must use a separate non-root build tree`. Non ripetere la stessa operazione web.
>
> Per questa migrazione una tantum, usa la [distribuzione server v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Come utente normale, segui [Scaricare e verificare la distribuzione](/it/docs/self-hosting/#v1-6-9をダウンロードして検証) cambiando la prima riga `version=` in `version=1.3.6`. Resta nello stesso terminale per conservare il `bundle_root` ottenuto durante la verifica e l’estrazione.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Lo script scarica di nuovo come root la stessa versione immutabile e verifica digest, tag/commit, pacchetto Sigstore, limiti dell’archivio e metadati. Accetta solo `gh` in `/usr/local/bin/gh` o `/usr/bin/gh`, di proprietà di root e senza scrittura per gruppo o altri utenti. Separa gli alberi `verified` di root, `bootstrap-build` non root (pnpm fissato con uno shim Corepack dedicato) e `assembly` di root. Arresta il vecchio gestore solo dopo avere ottenuto il blocco condiviso delle modifiche e lo riavvia in caso di errore. Al termine verifica `User=latex-renderer-update` e lo stato `active` di ogni servizio con i comandi seguenti. In seguito usa i normali aggiornamenti dal web o dalla CLI di amministrazione.
> Il web e l’API non ricevono privilegi sudo né token GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar interrompe l’estrazione con Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Su Ubuntu, se GNU `tar` usa `openat2`, la restrizione `RestrictSUIDSGID=true` del programma di aggiornamento può interrompere l’estrazione di archivi con sottodirectory con `ENOSYS` (Function not implemented). La versione corretta conserva l’ispezione con GNU `tar` e la verifica delle firme. Solo l’estrazione passa a `/usr/bin/bsdtar` in una directory temporanea privata vuota, senza importare proprietari, ACL o attributi estesi. `RestrictSUIDSGID` resta attivo e il `tar` di sistema viene mantenuto.
>
> Il vecchio programma può fallire anche estraendo la propria correzione. Accertati che non ci siano operazioni in corso, che applicazione e database siano integri e che sia stato verificato un backup cifrato. Usa il `bootstrap-v1` installato per **aggiornare prima solo il programma di aggiornamento indipendente** a una versione pubblicata con la correzione.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Controlla la nuova versione del programma e i valori `ready` e `pending=false`. Applica poi la stessa versione all’applicazione dal web o con il normale comando `update apply` della CLI di amministrazione.
>
> Il programma di aggiornamento `v1.4.0-rc.3` presenta un problema noto. La copia del pacchetto eseguita da root mantiene il proprietario non privilegiato e fallisce con `Release extraction requires a private regular bundle`. Lascia attive le verifiche, aggiorna prima il programma a una versione pubblicata con la correzione di proprietà e poi l’applicazione. Puoi provare separatamente l’estrazione sotto root e systemd con `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Esaminare i blocchi degli aggiornamenti o delle modifiche a TeX
>
> ### Il blocco delle modifiche è occupato {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` evita la sovrapposizione tra aggiornamento dell’applicazione e modifica a TeX. Attendi il termine dell’operazione attiva. **Non eliminare mai il file `/run/latex-renderer/mutation.lock`.** La sua rimozione può far coesistere due blocchi indipendenti. Se il problema si presenta durante il recupero interno di un ambiente TeX in un aggiornamento, potrebbe esserci contesa con la stessa operazione. Verifica log e servizi arrestati prima di riprovare.
>
> Solo se nessuna operazione è in corso e il log conferma il termine di quella precedente, arresta entrambi i gestori e ispeziona il processo che detiene il blocco.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Termina quel processo e riavvia i gestori solo se hai verificato che sia un ausiliario di blocco orfano di un’operazione conclusa.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Identità del renderer in versioni candidate precedenti {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Versioni candidate della v1.3.4
>
> L’aggiornamento da `v1.3.4-rc.3` a `v1.3.4-rc.4` falliva prima del cambio dei servizi quando i file inclusi nell’hash di identità del renderer sono passati da 5 a 6. Per questa migrazione usa `v1.3.4-rc.5`, che include anche i dati di compatibilità precedenti. La checksum dell’intero pacchetto e la firma di provenienza verificano anche il file aggiunto.

## Ambienti di esecuzione del programma di aggiornamento {#updaterの実行領域}

> [!DETAILS] Specifiche e procedure
>
> Update Manager separa rigorosamente l’albero `verified` di root con la distribuzione verificata, `build` non root per installare dipendenze ed eseguire la build e `assembly` di root con i risultati consentiti. Gli script di deployment eseguiti da root usano sempre la copia verificata di `assembly`. I passaggi eseguiti dall’utente di deployment, come la pubblicazione su Cloudflare, usano una copia temporanea `deployment-build` dopo le verifiche di root. Lo stesso vale per il ritorno alla versione precedente.

## Percorsi di installazione e protezioni su Windows {#windowsの配置と保護}

> [!DETAILS] Specifiche e procedure
>
> Quando cambi il percorso di installazione in Windows, la directory predefinita dei comandi diventa la sottocartella `bin`. Se imposti `LATEX_RENDER_BIN_DIRECTORY`, i lanciatori gestiti vengono collocati lì e condividono il percorso fra il PATH dell’utente e Local MCP. Gli altri lanciatori restano intatti. `setup repair` può correggere il percorso registrato in precedenza. La vecchia voce PATH viene conservata per altre applicazioni. Usa percorsi assoluti senza punti e virgola, virgolette o caratteri di controllo. Se `--open` o l’interfaccia grafica non riescono ad aprire il browser o il visualizzatore, il PDF salvato viene conservato.

## Condivisione e conservazione dei progetti {#保存プロジェクトの共有-保持}

> [!DETAILS] Regole di condivisione e conservazione
>
> - Il web (`/app/`), la CLI, l’API pubblica, Local MCP e Remote MCP condividono i progetti e la cronologia di revisioni immutabili di ciascun utente. Più chiavi API o account di servizio dello stesso utente possono consultarli e aggiornarli. Puoi anche usare input e processi temporanei senza salvarli in un progetto.
> - La combinazione di input, documento principale, motore e formati di output identifica la revisione. Revisioni con output diversi possono condividere l’input. I formati scelti in **Converti di nuovo** valgono solo per quella esecuzione. Scegli la configurazione iniziale per usare gli output salvati nella revisione.
> - Un input referenziato da una revisione attiva viene conservato anche oltre il termine per gli input orfani e concorre alla quota dell’utente. Eliminare un progetto ne nasconde la registrazione. Quando viene eliminato l’ultimo progetto che lo referenzia e scompaiono i processi associati, l’input perde la protezione e, dopo la scadenza, viene eliminato nella pulizia periodica. Per una cancellazione completa immediata contatta l’amministratore.

## Lingua dell’interfaccia {#表示言語}

L’editor salva **Lingua dell’interfaccia** nell’account. Se non è impostata, esamina in ordine le lingue del browser e usa l’inglese se nessuna è supportata. Il motore e la codifica del documento si configurano separatamente.

| Area | Copertura della traduzione |
| --- | --- |
| Web e configurazione | Azioni, stato delle operazioni, conferme e diagnostica. |
| CLI e MCP | La guida e le richieste della CLI usano la lingua del terminale. Le descrizioni MCP remote usano la lingua dell’account. |
| Editor | Modifica, ricerca e sostituzione, salvataggio e conflitti, stato di compilazione e controlli di anteprima sono disponibili in 18 lingue. |
| Guide pubbliche | Tutte le guide sono disponibili nelle 18 lingue elencate qui sotto. Usa il menu della lingua in cima alla pagina. |

L’editor supporta inglese, giapponese, cinese semplificato, coreano, spagnolo, portoghese, francese, tedesco, italiano, russo, turco, polacco, ceco, neerlandese, svedese, norvegese bokmål, danese e finlandese. I log di TeX e dei pacchetti esterni mantengono il testo originale per agevolare la diagnosi.

## Recuperare i log di audit {#監査ログの復旧}

Dopo il ripristino del database, la posizione di esportazione (`export_database_id`, numero di sequenza della riga `export_sequence` e `export_token`) può non corrispondere più allo stato del database. In tal caso esportazione e pulizia vengono interrotte per proteggere i dati.

1. Arresta i servizi e i timer di esportazione e pulizia durante l’indagine e il recupero.
2. Conserva separatamente il database ripristinato, le esportazioni cifrate esistenti e tutti i file di checkpoint attuali e precedenti. Verifica integrità, chiavi esterne e stato delle migrazioni del database ripristinato.
3. Se manca un checkpoint compatibile e decidi di esportare di nuovo le righe presenti, sposta i file di checkpoint fuori dai percorsi attivi. Verifica anche il percorso di `AUDIT_EXPORT_CHECKPOINT` se impostato. Conserva righe di audit, sequenze SQLite e `export.lock`.
4. Esegui un’esportazione manuale con le credenziali del servizio di produzione. Prima di riavviare i timer, verifica che l’output sia decifrabile e che sia stato generato un nuovo checkpoint in formato 3.

Saranno esportate di nuovo solo le righe presenti nel database ripristinato. Per riconciliare i duplicati usa insieme `export_database_id`, `export_sequence` e `export_token`. Il solo timestamp non identifica una riga.
