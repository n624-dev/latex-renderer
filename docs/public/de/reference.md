---
slug: reference
category: Betrieb und Entwicklung
title: Referenz für Betrieb und Entwicklung
description: Lesen Sie nach, wie der Client Ergebnisse speichert und wiederherstellt, wie MCP authentifiziert und wie ältere Installationen migriert werden.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Ausgaben speichern und wiederherstellen {#成果物の保存-復旧の仕様}

> [!DETAILS] Spezifikationen und Verfahren
>
> - **Atomarer Verzeichniswechsel.** CLI und Local MCP behalten Pfade wie `.render/result.pdf`, `job.json` und die Vorschaudateien bei. Sie prüfen bei allen Dateien die angekündigte Größe und den SHA-256-Wert und wechseln erst zum vollständigen Verzeichnis. Das Verzeichnis kann beim Umschalten kurz fehlen. Externe Programme sollten es nach Befehlsabschluss lesen.
> - **Automatische Wiederherstellung.** Ein Nachbarverzeichnis der Ausgabe namens `<output-name>.latex-renderer-state` speichert den Wiederherstellungszustand und wird bei der Erfassung von Quellen ausgeschlossen. Bei normaler Beendigung werden Zwischendaten gelöscht. Nach erzwungener Beendigung stellt der nächste Download den alten Satz wieder her, wenn der Wechsel noch nicht bestätigt war. War er bestätigt, bleibt der neue Satz und der alte wird bereinigt. Entfernen Sie das Zustandsverzeichnis weder im Betrieb noch vor der Wiederherstellung.
> - **Sperren und Unregelmäßigkeiten.** Gleichzeitige Schreibvorgänge zum selben Ziel stoppen mit `OUTPUT_BUSY`. Zeitablauf allein verdrängt keinen aktiven Prozess. Bei wiederverwendeter PID stoppt der Vorgang vorsorglich. Beschädigte Metadaten, unbekannte Dateien und externe Links erfordern vor dem Löschen eine Prüfung.
> - **Benutzerdateien und Grenzen.** Normale Benutzerdateien werden in den neuen Satz kopiert. Wird beim Download eine Bearbeitung erkannt, wird die Veröffentlichung abgebrochen und die Bearbeitung bleibt erhalten. Ein eigenes Ausgabeziel wird empfohlen. Jeder Satz darf bis zu 1 GiB und 10.000 Einträge umfassen. Für beide Sätze und Zwischendaten muss Platz vorhanden sein. Unterstützt werden nur lokale Dateisysteme. Pfade mit symbolischen Links, Hardlinks oder eingehängten anderen Dateisystemen werden abgewiesen. Sperrverhalten von Netzwerkfreigaben und vollständige Atomarität bei Stromausfall sind nicht garantiert. Verhindert eine geöffnete Datei unter Windows den Wechsel, bleibt der vorige Satz erhalten.

## Authentifizierungsgrenzen im Web {#web認証の境界}

> [!DETAILS] Spezifikationen und Verfahren
>
> Serversitzungen schützen `/app/`, `/admin/` und ihre APIs. Sie stehen nicht im öffentlichen Suchindex. Normale Benutzer arbeiten mit `/app/`. Auf `/admin/` haben nur Administrierende und Eigentümer Zugriff. Die Identität ergibt sich aus `issuer + subject` des externen Anbieters oder dem `login name` der Passwortanmeldung. E-Mail und Anzeigename dienen nicht als Anmeldeschlüssel. ZIP-Uploads, Aufträge, Ausgaben und TeX-Kompilierung laufen über den serverseitigen Renderer.
>
> > [!NOTE]
> > Kurzlebige Tickets werden nicht dauerhaft im Browser gespeichert. Die Serversitzung stellt sie bei Bedarf neu aus. Geben Sie Sitzungscookies, CSRF-Token und Tickets nicht weiter.

## Registrierung und Diagnose von Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Spezifikationen und Verfahren
>
> - **Dynamische Clientregistrierung (DCR).** Unvollständige oder inaktive Registrierungen werden üblicherweise nach 30 Tagen bereinigt. Von gültigen Autorisierungscodes oder Tokenfamilien referenzierte Einträge bleiben geschützt. Die globale Obergrenze ist 10.000. Registrieren Sie den Client bei `invalid_client` nach einer Bereinigung neu. Standardkonforme DCR-Anfragen ohne Clientnamen werden akzeptiert. Die Prüfungen von Name und Weiterleitungs-URI bleiben bestehen.
> - **Temporäre Autorisierungsanfragen (Schema 20).** Ist eine Anmeldung zwischengeschaltet, wird die Anfrage unter einer kurzen zufälligen ID abgelegt. So lässt sie sich fortsetzen, ohne den langen OAuth-`state` in die Rückkehr-URL zu schreiben. Sie gilt 10 Minuten und kann bei passendem angemeldetem Browser und zugehörigem Cookie einmal verwendet werden. Gleichzeitige Tabs haben getrennte IDs. Global sind 1.000 Anfragen möglich, pro Browser 8 Fortsetzungscookies. Beim Erreichen der Grenze wird `503` zurückgegeben und bestehende Anfragen bleiben erhalten. Die Datenbank enthält nur Hashes von ID und Cookie. Neustart und Rücksicherung verlängern die Gültigkeit nicht.
> - **IP-Grenzen und Herkunftsheader.** DCR erlaubt pro vertrauenswürdiger Quell-IP 10 Registrierungen in 15 Minuten. Clients hinter demselben ausgehenden Proxy teilen das Kontingent. Ab dem 11. Versuch werden HTTP `429`, `temporarily_unavailable` und `Retry-After` zurückgegeben. Ungültige Metadaten verbrauchen kein Kontingent. Fehlende oder ungültige IPs führen zu `503`, damit der Betrieb den Proxy prüfen kann, ohne unbekannte Clients zusammenzufassen. Halten Sie das Backend auf Loopback und lassen Sie den Proxy `X-Latex-Renderer-Client-IP` durch die tatsächliche Adresse ersetzen. Beliebige `X-Forwarded-For`-Werte werden ignoriert. Bei Cloudflare-Routen wird auch `CF-Connecting-IP` innerhalb der Vertrauensgrenze verarbeitet.
> - **Administrative Verbindungsprüfung.** Der folgende Befehl prüft öffentliche Discovery und Bearer-Challenge `401`, ohne Zugangsdaten zu senden, Einstellungen zu ändern, Weiterleitungen zu folgen oder Antwortinhalte, Cookies oder Geheimnisse auszugeben.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Fehlerphase eingrenzen.** Eine erfolgreiche Discovery-Antwort `200` und eine korrekte Challenge `401` belegen nur diese Phasen. Gleichen Sie Phase, Zeitpunkt und `X-Request-ID` mit den Protokollen `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` und `remote_mcp.rpc_result` ab. Halten Sie OAuth-Codes, Token, Cookies, PKCE-Verifier, Quellen und Benutzerkennungen aus Protokollen und Issues heraus.
> - **Authentifizierung erfolgreich, Aktionserkennung fehlgeschlagen.** Prüfen Sie nach der Tokenausgabe separat `initialize`, die Initialisierungsbenachrichtigung und `tools/list`. HTTP `200` kann auch bei einem JSON-RPC-`error` auftreten. `remote_mcp.rpc_result` protokolliert HTTP-Status, Ergebnisklasse, Protokollversion, Werkzeuganzahl, Antwortgröße und Grundstruktur der Liste. Der Prüfpuffer ist auf 256 KiB begrenzt. Bei Überschreitung wird nur `inspection_limited` protokolliert, die Antwort bleibt unverändert. Eine SSE-Antwort oder eine `GET`-Anfrage mit Ergebnis `405` genügt nicht als Fehlernachweis. Prüfen Sie `Accept`, `Content-Type`, Protokollaushandlung und Weiterleitung vom Proxy. Externes OIDC, Cloudflare-Richtlinien und ein echtes ChatGPT-Konto sind separat in Produktion zu prüfen.

## MCP-Ergebnisse und Ressourcen {#mcpの結果とresource}

> [!DETAILS] Spezifikationen und Verfahren
>
> Antworten von Remote MCP bestehen aus drei Ebenen.
> 1. **Standardmäßiges `content`.** Enthält Quellen- und Auftrags-IDs, Status, Offset, Cursor, Verfügbarkeit und begrenzte Diagnosen für die nächste Entscheidung und den nächsten Werkzeugaufruf. Auch Clients ohne `structuredContent` oder eigene Ressourcen können Quellen erstellen, korrigieren und erneut rendern.
> 2. **`structuredContent`.** Enthält das vollständige geprüfte Objekt zur automatischen Verarbeitung.
> 3. **MCP-Ressourcen (`latex-renderer://jobs/...`).** Enthalten umfangreiche Daten wie PDF, vollständiges `compile.log`, rohes JSON, `svg/manifest.json` und `svg/objects/*.svg`. Nur derselbe OAuth-Eigentümer darf sie lesen. Es gelten dieselben Größen- und Aufbewahrungsgrenzen wie für reguläre Dateien. Alle Ebenen schließen API-Schlüssel, OAuth-Token, Tickets, Quelltext und rohe Base64-Daten aus.

## Warten und Wiederholungen in der CLI {#cliの待機と再試行}

> [!DETAILS] Spezifikationen und Verfahren
>
> Liefert die Statusabfrage einen vorübergehenden HTTP-Fehler `502`, `503`, `504` oder ungültiges JSON, wiederholt die CLI ausschließlich die Abfrage desselben Auftrags **bis zu 5-mal** nach 1, 2, 4, 8 und 8 Sekunden, ohne die Gesamtwartezeit zu verlängern. Auftragserstellung, Upload, Tokenerneuerung und Dateiprüfung werden nicht automatisch wiederholt. Fehler bei Authentifizierung und Berechtigungen werden sofort zurückgegeben. Beendet die CLI das Warten, kann der Server den Auftrag fortsetzen.

## JSON-Format der CLI {#cliのjson形式}

> [!DETAILS] Spezifikationen und Verfahren
>
> Mit `--json` gelten folgende Formate für die Standardausgabe. API-Schlüssel, `uploadTicket` und `jobTicket` sind ausgeschlossen.
>
> - **Erfolg (Exitcode `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI- oder API-Fehler (Exitcode `1`)**
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
> - **Auftrag mit Fehler beendet, etwa bei einem LaTeX-Fehler (Exitcode `2`).** `result` enthält Auftragsdaten und gespeicherte Pfade. Die Antwort enthält `success: false`.

## Migration und Wiederherstellung älterer Versionen {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Älteren Updater migrieren und Entpackfehler beheben
>
> ### Vom root-Updater v1.2.x zum Updater mit getrennten Berechtigungen wechseln {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Bis einschließlich v1.2.x lief Update Manager als root-Daemon. Seit v1.3.0 läuft der dauerhafte Controller als `latex-renderer-update` und ein kurzlebiger root-Hilfsprozess nimmt festgelegte Operationen an. Ein Webupdate aus dem alten Updater kann mit `Application Update Manager must use a separate non-root build tree` stoppen. Wiederholen Sie denselben Webvorgang nicht.
>
> Verwenden Sie für diese einmalige Migration die [Serverdistribution v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Folgen Sie als normaler Benutzer der Anleitung [Distribution herunterladen und prüfen](/de/docs/self-hosting/#v1-6-9をダウンロードして検証) und ändern Sie die erste Zeile `version=` in `version=1.3.6`. Behalten Sie dieselbe Terminalsitzung bei, damit die beim Prüfen und Entpacken gesetzte `bundle_root` erhalten bleibt.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> Das Skript lädt als root dieselbe unveränderliche Version erneut herunter und prüft Digest, Tag/Commit, Sigstore-Bundle, Archivgrenzen und Metadaten. Es akzeptiert nur `gh` unter `/usr/local/bin/gh` oder `/usr/bin/gh` mit root als Eigentümer und ohne Schreibzugriff für Gruppe oder andere. Es trennt `verified` von root, `bootstrap-build` ohne root (pnpm festgelegt durch einen eigenen Corepack-Shim) und `assembly` von root. Der bisherige Manager wird erst nach Erwerb der gemeinsamen Änderungssperre gestoppt und bei Fehler erneut gestartet. Prüfen Sie anschließend `User=latex-renderer-update` und den Zustand `active` jedes Dienstes mit den folgenden Befehlen. Verwenden Sie danach normale Updates über Web oder Admin-CLI.
> Web und API erhalten weder sudo-Rechte noch GitHub-Token.
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
> ### GNU tar bricht das Entpacken mit Function not implemented ab {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Verwendet GNU `tar` unter Ubuntu `openat2`, kann die Updater-Beschränkung `RestrictSUIDSGID=true` das Entpacken von Archiven mit Unterverzeichnissen mit `ENOSYS` (Function not implemented) stoppen. Der korrigierte Updater behält Archivprüfung mit GNU `tar` und Signaturprüfung bei. Nur die Extraktion erfolgt mit `/usr/bin/bsdtar` in einen leeren privaten temporären Ordner, ohne Übernahme von Eigentümern, ACLs oder erweiterten Attributen. `RestrictSUIDSGID` bleibt aktiv und das systemeigene `tar` erhalten.
>
> Der alte Updater kann bereits beim Entpacken seiner eigenen Korrektur scheitern. Prüfen Sie, dass keine Vorgänge laufen, Anwendung und Datenbank intakt sind und ein verschlüsseltes Backup verifiziert wurde. Verwenden Sie die installierte `bootstrap-v1`, um **zuerst nur den eigenständigen Updater** auf eine veröffentlichte Version mit der Korrektur zu aktualisieren.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Prüfen Sie die neue Updater-Version sowie `ready` und `pending=false`. Wenden Sie dieselbe Version anschließend über das Web oder den regulären Admin-CLI-Befehl `update apply` auf die Anwendung an.
>
> Im Updater `v1.4.0-rc.3` ist ein Problem bekannt. Beim Kopieren des Pakets als root bleibt der unprivilegierte Eigentümer erhalten und der Vorgang scheitert mit `Release extraction requires a private regular bundle`. Lassen Sie die Prüfungen aktiv, aktualisieren Sie zuerst den Updater auf eine veröffentlichte Version mit der Eigentümerkorrektur und dann die Anwendung. Die Extraktion unter root und systemd lässt sich separat mit `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs` testen.

> [!DETAILS] Sperren bei Updates und TeX-Änderungen untersuchen
>
> ### Änderungssperre ist belegt {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` verhindert gleichzeitige Anwendungsupdates und TeX-Änderungen. Warten Sie, bis der aktive Vorgang beendet ist. **Löschen Sie niemals die Datei `/run/latex-renderer/mutation.lock`.** Sonst können zwei unabhängige Sperren nebeneinander bestehen. Tritt der Fehler beim internen Wiederherstellen einer TeX-Umgebung während eines Updates auf, kann derselbe Vorgang mit sich selbst konkurrieren. Prüfen Sie Protokolle und angehaltene Dienste vor einer Wiederholung.
>
> Stoppen Sie beide Manager und untersuchen Sie den sperrenden Prozess erst, wenn kein Vorgang läuft und das Protokoll den Abschluss des früheren Vorgangs bestätigt.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Beenden Sie den Prozess und starten Sie die Manager nur dann neu, wenn Sie ihn als verwaisten Sperr-Hilfsprozess eines abgeschlossenen Vorgangs identifiziert haben.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Renderer-Identität in älteren Release Candidates {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Release Candidates von v1.3.4
>
> Das Update von `v1.3.4-rc.3` auf `v1.3.4-rc.4` scheiterte vor dem Dienstwechsel, als die Anzahl der Dateien im Identitätshash des Renderers von 5 auf 6 stieg. Verwenden Sie für diesen Wechsel `v1.3.4-rc.5` mit den bisherigen Kompatibilitätsdaten. Die Prüfsumme des Gesamtpakets und die Herkunftssignatur prüfen auch die hinzugefügte Datei.

## Ausführungsumgebungen des Updaters {#updaterの実行領域}

> [!DETAILS] Spezifikationen und Verfahren
>
> Update Manager trennt strikt den root-Baum `verified` mit der geprüften Distribution, `build` ohne root für Abhängigkeiten und Build sowie `assembly` von root mit den zugelassenen Ergebnissen. Als root ausgeführte Bereitstellungsskripte nutzen immer die geprüfte Kopie von `assembly`. Schritte als Bereitstellungsbenutzer, etwa die Veröffentlichung bei Cloudflare, nutzen nach den root-Prüfungen eine temporäre `deployment-build`-Kopie. Dasselbe gilt beim Rollback.

## Installationspfade und Schutz unter Windows {#windowsの配置と保護}

> [!DETAILS] Spezifikationen und Verfahren
>
> Wird der Installationsort unter Windows geändert, dient dessen Unterordner `bin` als Standardverzeichnis für Befehle. Bei gesetztem `LATEX_RENDER_BIN_DIRECTORY` werden verwaltete Startprogramme dort abgelegt. Benutzer-PATH und Local MCP verwenden denselben Pfad. Andere Startprogramme bleiben erhalten. `setup repair` kann den zuvor registrierten Pfad korrigieren. Der alte PATH-Eintrag bleibt für andere Anwendungen erhalten. Verwenden Sie absolute Pfade ohne Semikolon, Anführungs- oder Steuerzeichen. Kann `--open` oder die grafische Oberfläche Browser oder Betrachter nicht öffnen, bleibt das gespeicherte PDF erhalten.

## Gemeinsame Nutzung und Aufbewahrung von Projekten {#保存プロジェクトの共有-保持}

> [!DETAILS] Regeln für gemeinsame Nutzung und Aufbewahrung
>
> - Web (`/app/`), CLI, öffentliche API, Local MCP und Remote MCP teilen Projekte und den Verlauf unveränderlicher Revisionen eines Benutzers. Mehrere API-Schlüssel oder Dienstkonten desselben Benutzers können diese einsehen und aktualisieren. Temporäre Quellen und Aufträge sind auch ohne Speicherung in einem Projekt möglich.
> - Die Kombination aus Quellen, Hauptdokument, Satzmotor und Ausgabeformaten bestimmt die Revision. Revisionen mit unterschiedlichen Ausgaben können dieselben Quellen verwenden. Unter **Erneut umwandeln** gewählte Formate gelten nur für diesen Lauf. Wählen Sie die anfänglichen Einstellungen, um die gespeicherten Ausgabeformate der Revision zu nutzen.
> - Von einer aktiven Revision referenzierte Quellen bleiben auch nach Ablauf der Frist für verwaiste Quellen erhalten und zählen zum Benutzerkontingent. Das Entfernen eines Projekts blendet dessen Eintrag aus. Sobald das letzte referenzierende Projekt gelöscht ist und zugehörige Aufträge wegfallen, endet der Schutz. Nach Ablauf wird die Eingabe bei der regelmäßigen Bereinigung entfernt. Für sofortige vollständige Entfernung wenden Sie sich an die Administration.

## Sprache der Oberfläche {#表示言語}

Der Editor speichert **Anzeigesprache** im Konto. Fehlt eine Einstellung, prüft er die Browsersprachen in Reihenfolge und verwendet Englisch, wenn keine unterstützt wird. Satzmotor und Dokumentkodierung werden separat konfiguriert.

| Bereich | Übersetzungsumfang |
| --- | --- |
| Web und Einrichtung | Aktionen, Ausführungsstatus, Bestätigungen und Diagnosen. |
| CLI und MCP | CLI-Hilfe und Eingabeaufforderungen verwenden die Terminalsprache. Remote-MCP-Beschreibungen verwenden die Kontosprache. |
| Editor | Bearbeitung, Suchen und Ersetzen, Speichern und Konflikte, Kompilierungsstatus und Vorschau-Steuerelemente sind in 18 Sprachen verfügbar. |
| Öffentliche Anleitungen | Alle Anleitungen sind in den unten aufgeführten 18 Sprachen verfügbar. Die Sprache lässt sich oben auf der Seite wechseln. |

Der Editor unterstützt Englisch, Japanisch, vereinfachtes Chinesisch, Koreanisch, Spanisch, Portugiesisch, Französisch, Deutsch, Italienisch, Russisch, Türkisch, Polnisch, Tschechisch, Niederländisch, Schwedisch, Norwegisch (Bokmål), Dänisch und Finnisch. Protokolle von TeX und externen Paketen behalten zur Diagnose den Originalwortlaut bei.

## Audit-Protokolle wiederherstellen {#監査ログの復旧}

Nach einer Rücksicherung der Datenbank kann die Exportposition (`export_database_id`, Zeilensequenz `export_sequence` und `export_token`) vom Datenbankstand abweichen. Export und Bereinigung stoppen dann zum Schutz der Daten.

1. Stoppen Sie für Untersuchung und Wiederherstellung die Dienste und Timer für Export und Bereinigung.
2. Bewahren Sie wiederhergestellte Datenbank, bestehende verschlüsselte Exporte und sämtliche aktuellen und früheren Kontrollpunktdateien separat auf. Prüfen Sie Integrität, Fremdschlüssel und Migrationsstand der wiederhergestellten Datenbank.
3. Gibt es keinen passenden Kontrollpunkt und möchten Sie die vorhandenen Zeilen neu exportieren, verschieben Sie die Kontrollpunktdateien aus den aktiven Pfaden. Prüfen Sie auch den Pfad von `AUDIT_EXPORT_CHECKPOINT`, falls gesetzt. Behalten Sie Audit-Zeilen, SQLite-Sequenzen und `export.lock` bei.
4. Führen Sie einen manuellen Export mit den Zugangsdaten des Produktionsdienstes aus. Prüfen Sie, dass sich die Ausgabe entschlüsseln lässt und ein neuer Kontrollpunkt im Format 3 entstanden ist, bevor Sie die Timer neu starten.

Nur in der wiederhergestellten Datenbank vorhandene Zeilen werden erneut exportiert. Gleichen Sie Duplikate mithilfe der Kombination aus `export_database_id`, `export_sequence` und `export_token` ab. Der Zeitstempel allein identifiziert eine Zeile nicht.
