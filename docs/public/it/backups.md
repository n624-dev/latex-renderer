---
slug: backups
category: Hosting in proprio
title: Creare, verificare e ripristinare i backup
description: Confronta backup periodici e punti di recupero degli aggiornamenti, verifica un archivio e ripristina i dati.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Che cosa viene salvato {#何が保存されるか}

| Tipo | Contenuto | Scopo |
| --- | --- | --- |
| **Backup periodico** | Database SQLite e ZIP di input referenziati da revisioni attive, bozze e anteprime in corso | Proteggere database, progetti e documenti in modifica |
| **Punto di recupero per l’aggiornamento** | SQLite immediatamente prima dell’aggiornamento, intero spazio di archiviazione dell’applicazione e informazioni sulla versione precedente | Indagare sugli errori e ripristinare lo stato precedente |
| **Backup separato della configurazione dell’host** | File come `/etc/latex-renderer/`, chiavi private, certificati TLS e stato di Akebi | Ricostruire l’host dopo un guasto |

- Dopo avere ripristinato un backup periodico, apri il progetto nell’editor per rigenerare l’anteprima. Gli output dei processi temporanei e le cache di lavoro sono esclusi.
- Proteggi separatamente configurazioni, certificati e chiave di decifratura (identità age). **Conserva i backup cifrati e la chiave in luoghi sicuri diversi per evitare di perderli entrambi in un unico incidente.**

## Creare manualmente un backup {#手動で作成する}

1. Accedi come proprietario e apri **Amministrazione → Sistema → Backup**.
2. Fai clic su **Crea backup** e attendi il completamento.
3. Fai clic su **Verifica ultimo backup** e controlla il nome dell’archivio e l’ora dell’ultima verifica. Sul server deve essere presente la chiave di decifratura.

### Creare e verificare dalla riga di comando {#コマンドで作成-検証する}

1. Crea subito un backup cifrato sul server. In `/etc/latex-renderer/backup.env`, `BACKUP_DIRECTORY` specifica la destinazione, che per impostazione predefinita è `/var/lib/latex-renderer/backups`. Il timer `latex-renderer-backup.timer` esegue i backup periodici.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Copia il file `.tar.age` su un host Linux di verifica. Prepara GNU `tar`, `age`, una versione supportata di Node.js (24 o 26) con `node:sqlite` e la chiave di decifratura. Per la conservazione a lungo termine, tieni separati l’archivio e la chiave.
3. [Scarica, verifica ed estrai la distribuzione del server](/it/docs/self-hosting/#v1-6-9をダウンロードして検証) corrispondente alla versione che ha creato il backup. Indica tale versione nel primo `version=`, assegna a `release_dir` la cartella estratta ed esegui lo script della distribuzione.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Il messaggio `restore_test.completed` conferma il completamento della verifica. Il test controlla la coerenza di SQLite e degli ZIP di input estratti in uno spazio temporaneo. Puoi verificare anche un backup esterno recuperando l’archivio dal luogo di conservazione.

## Esaminare un punto di recupero dopo un errore {#更新失敗後の復旧点を確認する}

Se dopo un aggiornamento fallito compare `RECOVERY_REVIEW_REQUIRED`, controlla lo stato del punto di recupero con privilegi amministrativi.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Consultare lo stato nelle versioni precedenti
>
> Se `n624-latex server recovery status` non esiste, esegui `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Confronta l’ID del punto (`POINT_ID`), le versioni dell’applicazione e del programma di aggiornamento, lo schema del database e i servizi in esecuzione. Se devi ripristinare i dati, conserva prima l’archivio e la configurazione attuale altrove.
2. Esegui `acknowledge` solo dopo avere verificato che non occorra ripristinare i dati e che sia possibile rimuovere la protezione del punto.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` chiude la verifica e riattiva i servizi se sono soddisfatte le condizioni necessarie. Per ripristinare i dati, mantieni protetto il punto e segui la procedura successiva.

## Ripristinare i dati {#データを復旧する場合}

Le modifiche successive al backup andranno perse. Se il database è compatibile e basta ripristinare l’applicazione precedente, usa il [ripristino dalla pagina Aggiornamenti](/it/docs/updates/#前の版へ戻す). Prova il recupero dei dati su un host di test prima di intervenire in produzione.

1. **Identifica la destinazione e conserva lo stato attuale.** Individua l’archivio e la versione dell’applicazione compatibile con il relativo schema. Prima di intervenire in produzione, salva separatamente database, archiviazione e configurazione attuali.
2. **Arresta i servizi.** Con il blocco amministrativo condiviso, arresta tutti i servizi e i timer che scrivono nel database o nello spazio di archiviazione per evitare conflitti con aggiornamenti e pulizia.
3. **Estrai e verifica.** Decifra ed estrai l’archivio in una cartella privata vuota e verifica l’integrità. Per un punto di aggiornamento, confronta anche `summary.json`, gestito da root, con il manifesto interno.
4. **Ripristina un unico istante.** SQLite e l’archivio degli input e degli output devono provenire dallo **stesso punto di recupero**. Per un backup periodico, colloca ciascuno ZIP nel percorso verificato `storage_key` indicato dal database ripristinato. Usa versioni, file di configurazione, proprietari e permessi corrispondenti.
5. **Avvia e verifica.** Prova l’accesso, la conversione di un progetto salvato, il download dei risultati e la creazione di un nuovo backup. Se l’esportazione di audit si arresta per una discordanza di posizione, segui il [recupero dei log di audit](/it/docs/reference/#監査ログの復旧).

Consulta il [formato e le verifiche dei backup operativi](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) e la [struttura dei punti di recupero degli aggiornamenti](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
