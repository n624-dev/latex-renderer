---
slug: security
category: Fehlerbehebung und Sicherheit
title: Sicherheit von Konten und Dokumenten
description: Schützen Sie Zugangsdaten und hochgeladene Dateien und lernen Sie die Zugriffsgrenzen für Renderer und Verwaltung kennen.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Wurde ein API-Schlüssel offengelegt, lassen Sie ihn unverzüglich von der Administration widerrufen und ersetzen.
- Melden Sie Sicherheitslücken über das [private GitHub-Formular](https://github.com/n624-dev/latex-renderer/security/advisories/new). Veröffentlichen Sie keine Einzelheiten in einem öffentlichen Issue.

## Zugangsdaten {#資格情報}

- Verwenden Sie API-Schlüssel nicht in Befehlsargumenten (etwa über `ps` sichtbar), URLs, Git-Repositories, Protokollen oder KI-Unterhaltungen.
- Zur lokalen Speicherung dient unter Windows DPAPI und unter Linux und macOS eine Datei im Modus `0600`, die nur das eigene Benutzerkonto lesen darf.
- Verwenden Sie Browserpasswörter, OIDC-Geheimnisse und Sitzungscookies ausschließlich für ihren vorgesehenen Zweck. Halten Sie CLI- und API-Schlüssel getrennt (`lrk_` und `lra_`).

## Projekte {#プロジェクト}

Alle LaTeX-Quellen und Anhänge gelten als nicht vertrauenswürdige Eingaben. Symbolische Links, Shell-Zugriff aus TeX, externe Befehle und Netzwerkverbindungen aus dem Container heraus sind deaktiviert. Beachten Sie Isolation, Zeitgrenzen und Dateibeschränkungen.

## Öffentliche Bereiche und Verwaltung {#公開領域と管理領域}

Öffentliche Dokumentation und Downloads, authentifizierte Seiten (`/app/` und `/admin/`) und die Render-API verwenden getrennte Routen unter demselben kanonischen HTTPS-Ursprung.

- **Netzwerkgrenze.** Einziger Eingang des Cloudflare-Profils ist Tunnel/Workers, beim Standalone-Profil ist es ein TLS-Reverse-Proxy. Alle Anwendungsdienste lauschen auf der Loopback-Schnittstelle. Interne API, SQLite und Verwaltungssockets bleiben privat. Authentifizierte Bereiche werden von Suchmaschinenindizes ausgeschlossen.
- **Authentifizierung und Browsersitzungen.** Für externe Identitätsanbieter muss `provider + issuer + subject` exakt übereinstimmen. E-Mail-Adresse und Anzeigename lösen keine automatische Kontoverknüpfung aus. Der Server kann eine Sitzung sofort widerrufen. Zustandsändernde Anfragen erfordern eine exakte Übereinstimmung von `Origin` und ein sitzungsspezifisches CSRF-Token. Passwörter werden mit `scrypt` und einem zusätzlichen Geheimnis (Pepper) im Besitz von root geschützt. Begrenzen Sie bei öffentlichen Installationen auch Verbindungen und Anfrageraten am Proxy und verwenden Sie den DDoS-Schutz des Anbieters.
- **Remote MCP.** `/mcp`, OAuth-Token-Endpunkt und Erkennungsmetadaten sind öffentlich erreichbar. Zum Ausführen von Werkzeugen ist ein kurzlebiges Bearer-Token mit beschränkter Audience und beschränktem Geltungsbereich erforderlich. Die Autorisierung verwendet die Browsersitzung von `/app/` und bindet den Zugriff ausdrücklich an einen vorhandenen aktiven Benutzer.
  - Die Standardantwort (`content`) enthält nur eigentümerbezogene Kennungen, Statuswerte, Cursor und begrenzte Diagnosen für die nächsten Schritte. Von Benutzern stammende Pfade und Diagnosen werden als nicht vertrauenswürdige Daten ohne Steuerzeichen und mit begrenzter Länge und Anzahl zurückgegeben.
  - Standardinhalt `content` und Diagnoseprotokolle schließen OAuth-Token, API-Schlüssel, Tickets, rohe Base64-Daten, vollständige Quellen und Protokolle, Stacktraces, Subject-Kennungen von Access und interne Serverpfade aus. Vollständige PDFs und Protokolle sind nur über Ressourcenabrufe mit erneuter Eigentümerprüfung verfügbar.

## Lokale Weboberfläche zur Konfiguration {#local-setup-web-ui}

`n624-latex setup --gui` (früher `latex-render setup --gui`) lauscht ausschließlich auf einem zufälligen Port von `127.0.0.1` auf dem lokalen Rechner.

- Im Fragment (`#...`) der von der CLI geöffneten URL steht ein einmaliges Starttoken. Der Browser entfernt es sofort aus dem Verlauf und tauscht es gegen eine kurzlebige Sitzung.
- Alle API-Operationen erfordern eine exakte Übereinstimmung von `Origin`, eine Bearer-Sitzung und ein separates CSRF-Token. CORS ist deaktiviert. Host und Loopback-Adresse des Clients werden geprüft. Eine strikte CSP sowie `frame-ancestors 'none'` und `no-store` gelten ebenfalls.
- Der eingegebene Schlüssel wird nur an den Speichervorgang übergeben und erscheint nicht in Status-, Diagnose- oder Testumwandlungsantworten. Die Oberfläche beendet sich nach 30 Minuten Inaktivität oder 2 Stunden seit dem Start.
