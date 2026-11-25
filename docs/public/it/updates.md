---
slug: updates
category: Hosting in proprio
title: Aggiornare il server o tornare alla versione precedente
description: Applica una versione stabile, verifica il risultato e scegli una procedura di recupero in caso di errore.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Prima dell’aggiornamento {#更新する前に}

| Cosa vuoi cambiare | Dove intervenire |
| --- | --- |
| Applicazione del server | **Amministrazione → Aggiornamenti** |
| Versione o lingue di TeX Live | **Amministrazione → Ambiente TeX**. Consulta [Modificare l’ambiente TeX](/it/docs/self-hosting/#tex環境の初期設定). |
| Pacchetto APT locale `n624-latex` | [Aggiornare il pacchetto APT](/it/docs/client/#apt-版の更新) |

Prima di iniziare, verifica questi tre punti.

1. [Crea e verifica un backup cifrato](/it/docs/backups/#手動で作成する).
2. Scegli un momento con pochi processi di conversione attivi.
3. Mantieni la modalità di manutenzione su `normal`. Il programma di aggiornamento arresta e avvia i servizi necessari ed esegue una conversione di prova.

## Applicare una versione stabile {#正式版を適用する}

1. Accedi come proprietario e apri **Amministrazione → Aggiornamenti** (`/admin/updates/`).
2. Lascia vuoto il campo della versione e fai clic su **Controlla aggiornamenti** per visualizzare la versione attuale e quella stabile disponibile.
3. Seleziona **Scarica, verifica e aggiorna**, indica il motivo del cambiamento e avvia l’aggiornamento.
4. Annota l’**ID operazione** e verifica che lo stato indichi il completamento con successo.
   - Se l’applicazione è aggiornata ma occorre aggiornare il programma di aggiornamento, consulta il risultato della stessa operazione e i relativi dettagli.
   - L’operazione prosegue anche se chiudi il browser. Se compare `502` durante un riavvio, attendi la riconnessione dell’interfaccia.
5. Accedi da un altro browser o da una finestra privata. Converti un documento rappresentativo, controlla il download del PDF e verifica le versioni dell’applicazione e del programma di aggiornamento.

## Notifiche e aggiornamenti automatici {#通知と自動更新}

Nei criteri di aggiornamento puoi scegliere tra controllo con notifica (predefinito) e applicazione automatica dopo la verifica.

- L’applicazione automatica riguarda solo le versioni stabili.
- Per provare una versione candidata in un ambiente di test dedicato, specifica il tag pubblicato nel formato `vX.Y.Z-rc.N`.

## Se l’aggiornamento fallisce {#更新が失敗した場合}

Controlla l’ID operazione e la fase del guasto nel log dettagliato. Verifica le versioni di applicazione e programma di aggiornamento, l’accesso, la conversione e l’eventuale richiesta di esaminare il punto di recupero. Il solo numero di versione non basta.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Verifica se è in corso una manutenzione e torna alla modalità `normal` prima di avviare l’aggiornamento.
- **`RECOVERY_REVIEW_REQUIRED`.** Segui le istruzioni per [esaminare il punto di recupero dopo un errore](/it/docs/backups/#更新失敗後の復旧点を確認する).

## Tornare alla versione precedente {#前の版へ戻す}

- **Se basta ripristinare la versione dell’applicazione**, controlla la destinazione in **Amministrazione → Aggiornamenti** e, se disponibile, scegli **Ripristina versione precedente**. Al termine prova l’accesso e la conversione in PDF.
- **Se la modifica al database è incompatibile**, ripristina il database e lo spazio di archiviazione dello stesso punto di recupero. Segui la procedura di [ripristino dei dati](/it/docs/backups/#データを復旧する場合).

Consulta [Migrazione e recupero da versioni precedenti](/it/docs/reference/#旧版からの移行と特殊復旧) e la [specifica e i criteri di conservazione del programma di aggiornamento](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
