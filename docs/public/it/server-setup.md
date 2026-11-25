---
slug: server-setup
category: Hosting in proprio
title: Assistente di configurazione del server
description: Configura autenticazione, HTTPS e limiti di esecuzione su un server preparato, dal browser o dal terminale.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Scegliere una procedura {#どの手順を使うか}

Per una nuova installazione, [prepara il server](/it/docs/self-hosting/#準備するもの) e apri l’assistente in un **browser**. Su un’installazione esistente, lo stesso assistente permette di modificare l’accesso e i limiti di esecuzione.

- Esegui `sudo n624-latex server setup --plan` sul server per verificare i pacchetti richiesti e lo spazio libero. Risolvi i problemi segnalati e ripeti la verifica.
- Per modificare un’installazione esistente con HTTPS dedicato o HTTPS nella LAN (Akebi), aggiungi `--ingress` al comando di avvio.
- Se Docker segnala moduli del kernel mancanti su un host minimale, segui le indicazioni e riprova. Per esempio, se è richiesto `nf_tables`, un amministratore deve eseguire `sudo modprobe nf_tables`.

## Aprire nel browser {#ブラウザで開く}

Collegati via SSH con l’account di deployment senza privilegi di root ed esegui il comando seguente. **Tieni aperto il terminale fino al termine della configurazione.**

```sh
sudo n624-latex server setup --web
```

1. Alla prima installazione, verifica le attività preparatorie e digita `PREPARE` per proseguire. Attendi il completamento del download della versione firmata, della preparazione dei servizi e della creazione e verifica del primo ambiente TeX.
2. Individua l’URL monouso nel terminale. È valido per **5 minuti**.
3. Aprilo sul server o usa l’**inoltro di porta SSH** per raggiungere la stessa porta dal tuo computer. Se la porta indicata è `41234`, esegui il comando seguente in un altro terminale locale e apri nel browser l’URL indicato dall’assistente.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Non condividere l’URL di configurazione e non esporre la porta su Internet o tramite proxy inverso.

## Controllare e applicare la configurazione {#プレビューから適用まで}

1. **Scegli la modalità di accesso e il metodo di autenticazione.** Per una nuova installazione configura HTTPS e il primo proprietario. Inserisci password e segreti client OIDC nei campi nascosti dedicati.
2. **Controlla l’anteprima.** Verifica l’URL pubblico e il metodo di accesso. Se cambi metodo, prepara l’identità del proprietario per il nuovo metodo mentre riesci ancora ad accedere.
3. **Applica le modifiche.** Attendi l’avvio o il riavvio dei servizi.
4. **Accedi e crea un PDF.** Usa un’altra finestra del browser per [verificare l’installazione](/it/docs/self-hosting/#導入完了の確認).

Se abiliti password e OIDC in una nuova installazione, registra prima il proprietario con password e aggiungi a quell’account i valori OIDC `issuer` e `subject`. Nei limiti di esecuzione, la soglia di avvio indica la RAM libera prima di iniziare il processo, mentre il limite durante l’esecuzione indica la RAM utilizzabile dal contenitore.

## Verificare una modifica interrotta {#中断した変更を確認する}

- Se perdi la connessione dopo avere iniziato ad applicare le modifiche, controlla prima il risultato della stessa operazione.
- Se il processo dell’assistente è terminato, riavvialo per la stessa destinazione e scegli **Recover** sul web o **`RECOVER`** nel terminale. Se è già stato registrato un proprietario, l’assistente riutilizza la registrazione e prosegue fino alla conferma. Questo recupero della configurazione non ripristina un precedente backup del database.
- I file di recupero possono contenere segreti TLS o OIDC. Evita di modificarli manualmente. Quando chiedi assistenza, comunica solo il codice di errore visualizzato e la fase.

## Aprire nel terminale {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Per modificare un server esistente, inserisci ogni impostazione o premi Invio nel campo vuoto per conservare il valore attuale. Per HTTPS automatico nella LAN alla prima installazione, scegli `LAN` e segui le indicazioni. Per configurare nel terminale il primo HTTPS dedicato o un percorso Cloudflare già esistente, immetti su una riga il JSON nel formato mostrato. Se è la prima volta, [inizia dal browser](#ブラウザで開く).

### Versioni precedenti e installazioni manuali {#旧版-手動配置の場合}

> [!DETAILS] Eseguire direttamente server-setup.mjs
>
> Se hai preparato il server senza APT con utente dedicato, Node.js e Docker rootless, e hai collocato una versione verificata in `/opt/latex-renderer/current`, puoi chiamare direttamente `server-setup.mjs`. Per preparare un nuovo host consulta le [istruzioni manuali](/it/docs/self-hosting/#現在の提供状況).
>
> | Attività | Argomento di avvio | Condizioni |
> | --- | --- | --- |
> | Modificare autenticazione o limiti esistenti | `--existing` | Proprietario registrato e servizi operativi |
> | Configurare e registrare il primo proprietario | `--initial` | Distribuzione e ambiente pronti, senza configurazione operativa o database preesistente |
> | Modificare HTTPS dedicato gestito | `--ingress` | HTTPS standalone dedicato. La migrazione da Nginx condiviso è un’operazione distinta. |
>
> - **Interfaccia da terminale**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Interfaccia nel browser**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Consulta la [specifica degli input e del recupero dell’assistente](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
