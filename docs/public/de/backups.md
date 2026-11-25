---
slug: backups
category: Selbsthosting
title: Backups erstellen, prüfen und wiederherstellen
description: Unterscheiden Sie regelmäßige Backups von Update-Wiederherstellungspunkten, prüfen Sie ein Archiv und stellen Sie Daten wieder her.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## Gesicherte Inhalte {#何が保存されるか}

| Art | Inhalt | Zweck |
| --- | --- | --- |
| **Regelmäßiges Backup** | SQLite-Datenbank und Eingabe-ZIPs, die von aktiven Revisionen, Entwürfen und laufenden Vorschauen referenziert werden | Datenbank, Projekte und Dokumente in Bearbeitung sichern |
| **Update-Wiederherstellungspunkt** | SQLite unmittelbar vor dem Update, gesamter Anwendungsspeicher und frühere Versionsinformationen | Fehler untersuchen und den vorherigen Zustand wiederherstellen |
| **Separate Sicherung der Hostkonfiguration** | Dateien wie `/etc/latex-renderer/`, private Schlüssel, TLS-Zertifikate und Akebi-Zustand | Host nach einem Ausfall wiederherstellen |

- Öffnen Sie ein Projekt nach dem Zurückspielen eines regelmäßigen Backups im Editor, um seine Vorschau neu zu erzeugen. Ausgaben temporärer Aufträge und Arbeits-Caches sind nicht enthalten.
- Sichern Sie Konfiguration, Zertifikate und Entschlüsselungsschlüssel (age-Identität) separat. **Bewahren Sie verschlüsselte Backups und Schlüssel an verschiedenen sicheren Orten auf, damit sie nicht durch denselben Vorfall verloren gehen.**

## Backup manuell erstellen {#手動で作成する}

1. Melden Sie sich als Eigentümer an und öffnen Sie **Verwaltung → System → Backups**.
2. Klicken Sie auf **Backup erstellen** und warten Sie bis zum Abschluss.
3. Klicken Sie auf **Neuestes Backup prüfen** und kontrollieren Sie Archivname und Zeitpunkt der letzten Prüfung. Der Entschlüsselungsschlüssel muss auf dem Server vorliegen.

### Über die Kommandozeile erstellen und prüfen {#コマンドで作成-検証する}

1. Erstellen Sie auf dem Server sofort ein verschlüsseltes Backup. In `/etc/latex-renderer/backup.env` bestimmt `BACKUP_DIRECTORY` das Ziel, standardmäßig `/var/lib/latex-renderer/backups`. Der Timer `latex-renderer-backup.timer` führt die regelmäßigen Sicherungen aus.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. Kopieren Sie die Datei `.tar.age` auf einen Linux-Prüfhost. Sie benötigen GNU `tar`, `age`, eine unterstützte Node.js-Version (24 oder 26) mit `node:sqlite` und den Entschlüsselungsschlüssel. Bewahren Sie das Archiv und den Schlüssel langfristig getrennt auf.
3. [Laden Sie die Serverdistribution in der Version herunter, mit der das Backup erstellt wurde, prüfen Sie sie und entpacken Sie sie](/de/docs/self-hosting/#v1-6-9をダウンロードして検証). Tragen Sie die Version in die erste `version=` ein, setzen Sie `release_dir` auf den entpackten Ordner und führen Sie das Skript der Distribution aus.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Die Meldung `restore_test.completed` bestätigt die erfolgreiche Prüfung. Der Test prüft die Konsistenz von SQLite und der in einem temporären Bereich entpackten Eingabe-ZIPs. Eine externe Sicherung können Sie prüfen, indem Sie das Archiv vom Sicherungsort abrufen.

## Wiederherstellungspunkt nach einem Fehler prüfen {#更新失敗後の復旧点を確認する}

Erscheint nach einem fehlgeschlagenen Update `RECOVERY_REVIEW_REQUIRED`, prüfen Sie mit administrativen Rechten den Zustand des Wiederherstellungspunkts.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Zustand bei älteren Versionen abfragen
>
> Fehlt `n624-latex server recovery status`, führen Sie `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status` aus.

1. Gleichen Sie Punkt-ID (`POINT_ID`), Anwendungs- und Updater-Versionen, Datenbankschema und laufende Dienste ab. Ist eine Datenwiederherstellung nötig, sichern Sie zunächst das Archiv und die aktuelle Konfiguration an anderer Stelle.
2. Führen Sie `acknowledge` erst aus, wenn die Untersuchung ergeben hat, dass keine Daten wiederhergestellt werden müssen und Sie den Schutz des Punkts aufheben können.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` beendet die Prüfung und nimmt die Dienste bei erfüllten Voraussetzungen wieder in Betrieb. Möchten Sie Daten wiederherstellen, lassen Sie den Punkt geschützt und fahren Sie wie folgt fort.

## Daten wiederherstellen {#データを復旧する場合}

Änderungen seit dem Backup gehen verloren. Ist die Datenbank kompatibel und genügt ein Zurücksetzen der Anwendung, verwenden Sie die [Rückkehr zur vorherigen Version unter Updates](/de/docs/updates/#前の版へ戻す). Erproben Sie die Datenwiederherstellung vor dem Produktionseinsatz auf einem Testhost.

1. **Ziel bestimmen und aktuellen Zustand sichern.** Ermitteln Sie das Archiv und die zum Schema passende Anwendungsversion. Sichern Sie vor dem Eingriff in Produktion die aktuelle Datenbank, den Speicher und die Konfiguration separat.
2. **Dienste stoppen.** Halten Sie unter der gemeinsamen administrativen Sperre alle Dienste und Timer an, die in die Datenbank oder den Speicher schreiben. So vermeiden Sie Konflikte mit Updates und Bereinigung.
3. **Entpacken und prüfen.** Entschlüsseln und entpacken Sie das Archiv in einen leeren privaten Ordner und prüfen Sie seine Integrität. Bei einem Update-Wiederherstellungspunkt vergleichen Sie außerdem die von root verwaltete Datei `summary.json` mit dem internen Manifest.
4. **Einen einheitlichen Zeitpunkt wiederherstellen.** SQLite und der Speicher der Eingaben und Ausgaben müssen zum **selben Wiederherstellungspunkt** gehören. Legen Sie bei regelmäßigen Backups jedes ZIP am geprüften Speicherort `storage_key` aus der wiederhergestellten Datenbank ab. Verwenden Sie die zugehörigen Versionen, Konfigurationsdateien, Eigentümer und Berechtigungen.
5. **Starten und prüfen.** Testen Sie Anmeldung, Umwandlung eines gespeicherten Projekts, Download der Ergebnisse und Erstellung eines neuen Backups. Stoppt der Audit-Export wegen einer abweichenden Position, folgen Sie der [Wiederherstellung der Audit-Protokolle](/de/docs/reference/#監査ログの復旧).

Siehe [Format und Prüfungen betrieblicher Backups](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) und [Konzept der Update-Wiederherstellungspunkte](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
