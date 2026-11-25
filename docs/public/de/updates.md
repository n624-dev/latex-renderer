---
slug: updates
category: Selbsthosting
title: Server aktualisieren oder zur vorherigen Version zurückkehren
description: Installieren Sie eine stabile Version, prüfen Sie das Ergebnis und wählen Sie bei Fehlern einen Wiederherstellungsweg.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Vor der Aktualisierung {#更新する前に}

| Änderung | Zuständiger Bereich |
| --- | --- |
| Serveranwendung | **Verwaltung → Updates** |
| TeX-Live-Version oder Sprachen | **Verwaltung → TeX-Umgebung**. Siehe [TeX-Umgebung ändern](/de/docs/self-hosting/#tex環境の初期設定). |
| Lokales APT-Paket `n624-latex` | [APT-Paket aktualisieren](/de/docs/client/#apt-版の更新) |

Prüfen Sie vor dem Start diese drei Punkte.

1. [Erstellen und prüfen Sie ein verschlüsseltes Backup](/de/docs/backups/#手動で作成する).
2. Wählen Sie einen Zeitpunkt mit wenigen aktiven Umwandlungsaufträgen.
3. Belassen Sie den Wartungsmodus auf `normal`. Der Updater stoppt und startet die erforderlichen Dienste und führt eine Testumwandlung durch.

## Stabile Version installieren {#正式版を適用する}

1. Melden Sie sich als Eigentümer an und öffnen Sie **Verwaltung → Updates** (`/admin/updates/`).
2. Lassen Sie das Versionsfeld leer und klicken Sie auf **Nach Updates suchen**, um die aktuelle und die verfügbare stabile Version zu sehen.
3. Wählen Sie **Laden, prüfen und aktualisieren**, geben Sie einen Änderungsgrund an und starten Sie die Aktualisierung.
4. Notieren Sie die **Vorgangs-ID** und prüfen Sie, ob der Status den erfolgreichen Abschluss anzeigt.
   - Ist die Anwendung bereits aktuell, aber der Updater muss aktualisiert werden, prüfen Sie das Ergebnis desselben Vorgangs und die Updater-Details.
   - Der Vorgang läuft auch nach dem Schließen des Browsers weiter. Erscheint beim Neustart `502`, warten Sie auf die erneute Verbindung der Oberfläche.
5. Melden Sie sich in einem anderen Browser oder privaten Fenster an. Wandeln Sie ein repräsentatives Dokument um, prüfen Sie den PDF-Download sowie die Anwendungs- und Updater-Versionen.

## Benachrichtigungen und automatische Updates {#通知と自動更新}

In der Update-Richtlinie wählen Sie zwischen Prüfen und Benachrichtigen (Standard) und automatischem Anwenden nach der Prüfung.

- Die automatische Installation gilt nur für stabile Versionen.
- Zum Testen eines Release Candidates in einer eigenen Testumgebung geben Sie dessen veröffentlichtes Tag im Format `vX.Y.Z-rc.N` an.

## Wenn die Aktualisierung fehlschlägt {#更新が失敗した場合}

Ermitteln Sie Vorgangs-ID und fehlgeschlagene Phase im Detailprotokoll. Prüfen Sie Anwendungs- und Updater-Versionen, Anmeldung, Umwandlung und ob der Wiederherstellungspunkt geprüft werden muss. Die Versionsnummer allein reicht nicht aus.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Prüfen Sie, ob eine Wartung läuft, und wechseln Sie vor dem Start der Aktualisierung zurück zu `normal`.
- **`RECOVERY_REVIEW_REQUIRED`.** Folgen Sie der Anleitung zum [Prüfen des Wiederherstellungspunkts nach einem Fehler](/de/docs/backups/#更新失敗後の復旧点を確認する).

## Zur vorherigen Version zurückkehren {#前の版へ戻す}

- **Genügt ein Zurücksetzen der Anwendung**, prüfen Sie das Ziel unter **Verwaltung → Updates** und wählen Sie, falls verfügbar, **Auf vorherige Version zurücksetzen**. Testen Sie anschließend Anmeldung und PDF-Umwandlung.
- **Bei einer inkompatiblen Datenbankänderung** müssen Datenbank und Speicher aus demselben Wiederherstellungspunkt zurückgespielt werden. Folgen Sie der [Datenwiederherstellung](/de/docs/backups/#データを復旧する場合).

Siehe [Migration und Wiederherstellung älterer Versionen](/de/docs/reference/#旧版からの移行と特殊復旧) und die [Updater-Spezifikation und Aufbewahrungsrichtlinie](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
