---
slug: server-setup
category: Selbsthosting
title: Einrichtungsassistent für den Server
description: Konfigurieren Sie Anmeldung, HTTPS und Ausführungsgrenzen auf einem vorbereiteten Server im Browser oder Terminal.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Verfahren auswählen {#どの手順を使うか}

Für eine Neuinstallation [bereiten Sie den Server vor](/de/docs/self-hosting/#準備するもの) und öffnen den Assistenten in einem **Browser**. Bei einer bestehenden Installation können Sie mit demselben Assistenten Anmeldung und Ausführungsgrenzen ändern.

- Führen Sie `sudo n624-latex server setup --plan` auf dem Server aus, um die benötigten Pakete und den freien Speicher zu prüfen. Beheben Sie gemeldete Probleme und wiederholen Sie die Prüfung.
- Bei einer bestehenden Installation mit dediziertem HTTPS oder HTTPS im LAN (Akebi) ergänzen Sie den Startbefehl um `--ingress`.
- Meldet Docker auf einem minimalen Host fehlende Kernelmodule, befolgen Sie die Hinweise und versuchen Sie es erneut. Wird beispielsweise `nf_tables` benötigt, führt eine Person mit administrativen Rechten `sudo modprobe nf_tables` aus.

## Im Browser öffnen {#ブラウザで開く}

Verbinden Sie sich per SSH mit dem unprivilegierten Bereitstellungskonto und führen Sie Folgendes aus. **Lassen Sie das Terminal bis zum Abschluss der Einrichtung geöffnet.**

```sh
sudo n624-latex server setup --web
```

1. Prüfen Sie bei der Ersteinrichtung die Vorbereitungsschritte und geben Sie zum Fortfahren `PREPARE` ein. Warten Sie auf den Download der signierten Version, die Vorbereitung der Dienste sowie den Aufbau und die Prüfung der ersten TeX-Umgebung.
2. Suchen Sie im Terminal die einmal verwendbare URL. Sie ist **5 Minuten** gültig.
3. Öffnen Sie sie auf dem Server oder verwenden Sie eine **SSH-Portweiterleitung**, um von Ihrem Rechner auf denselben Port zuzugreifen. Wird der Port `41234` angezeigt, führen Sie Folgendes in einem zweiten lokalen Terminal aus und öffnen Sie die vom Assistenten angezeigte URL im Browser.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Geben Sie die Einrichtungs-URL nicht weiter und veröffentlichen Sie den Port weder im Internet noch über einen Reverse-Proxy.

## Konfiguration prüfen und anwenden {#プレビューから適用まで}

1. **Zugang und Anmeldeverfahren wählen.** Richten Sie bei einer Neuinstallation HTTPS und den ersten Eigentümer ein. Geben Sie Passwörter und OIDC-Clientgeheimnisse in die dafür vorgesehenen verdeckten Felder ein.
2. **Vorschau prüfen.** Kontrollieren Sie die öffentliche URL und das Anmeldeverfahren. Bereiten Sie bei einem Wechsel die Eigentümeridentität für das neue Verfahren vor, solange die bestehende Anmeldung funktioniert.
3. **Änderungen anwenden.** Warten Sie, bis die Dienste gestartet oder neu gestartet wurden.
4. **Anmelden und PDF erstellen.** [Prüfen Sie die Installation](/de/docs/self-hosting/#導入完了の確認) in einem anderen Browserfenster.

Aktivieren Sie bei einer Neuinstallation Passwörter und OIDC, registrieren Sie zuerst den Eigentümer per Passwort und ergänzen beim selben Konto die OIDC-Werte `issuer` und `subject`. Bei den Ausführungsgrenzen bezeichnet die Startschwelle den vor Auftragsbeginn benötigten freien RAM, das Laufzeitlimit den für den Container nutzbaren RAM.

## Unterbrochene Änderungen prüfen {#中断した変更を確認する}

- Bricht die Verbindung nach Beginn der Anwendung ab, prüfen Sie zuerst das Ergebnis desselben Vorgangs.
- Wurde der Assistent beendet, starten Sie ihn für dasselbe Ziel erneut und wählen im Web **Recover** oder im Terminal **`RECOVER`**. Ist ein Eigentümer bereits registriert, verwendet der Assistent den Eintrag und fährt bis zur Bestätigung fort. Diese Konfigurationswiederherstellung spielt keine frühere Datenbanksicherung ein.
- Wiederherstellungsdateien können TLS- oder OIDC-Geheimnisse enthalten. Bearbeiten Sie sie nicht manuell. Geben Sie bei Hilfeanfragen nur den angezeigten Fehlercode und die Phase an.

## Im Terminal öffnen {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Bei einem bestehenden Server geben Sie die Werte einzeln ein oder übernehmen den aktuellen Wert mit der Eingabetaste bei leerem Feld. Für automatisches HTTPS im LAN bei der Ersteinrichtung wählen Sie `LAN` und folgen den Anweisungen. Für eigenes HTTPS bei der Erstinstallation oder eine vorhandene Cloudflare-Route geben Sie in der Terminaloberfläche das angezeigte JSON-Format einzeilig ein. Bei der ersten Einrichtung [beginnen Sie im Browser](#ブラウザで開く).

### Ältere Versionen und manuelle Installationen {#旧版-手動配置の場合}

> [!DETAILS] server-setup.mjs direkt ausführen
>
> Haben Sie den Server ohne APT mit eigenem Dienstkonto, Node.js und Rootless Docker vorbereitet und eine geprüfte Version in `/opt/latex-renderer/current` abgelegt, können Sie `server-setup.mjs` direkt aufrufen. Zum Vorbereiten eines neuen Hosts siehe [Manuelle Installation](/de/docs/self-hosting/#現在の提供状況).
>
> | Aufgabe | Startargument | Voraussetzungen |
> | --- | --- | --- |
> | Bestehende Anmeldung oder Grenzen ändern | `--existing` | Eigentümer registriert, Dienste betriebsbereit |
> | Einrichten und ersten Eigentümer registrieren | `--initial` | Distribution und Umgebung vorbereitet, keine Betriebskonfiguration oder bestehende Datenbank |
> | Verwaltetes dediziertes HTTPS ändern | `--ingress` | Dediziertes HTTPS im Standalone-Profil. Der Wechsel von gemeinsam genutztem Nginx ist ein separater Vorgang. |
>
> - **Terminaloberfläche**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Browseroberfläche**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Siehe [Spezifikation für Eingaben und Wiederherstellung des Assistenten](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
