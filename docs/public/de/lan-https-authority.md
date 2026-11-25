---
slug: lan-https-authority
category: Selbsthosting
title: Einen Akebi-Zertifikatsdienst betreiben
description: Richten Sie die DNS-Delegation für die LAN-Domain, die Zertifikatsausstellung und die offene Registrierung oder Registrierung per Einladung ein.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Diese Anleitung richtet sich an die Administration eines eigenen Zertifikatsdienstes. Zur Nutzung des gemeinsamen Dienstes mit LaTeX Renderer siehe [HTTPS im LAN mit Akebi verwenden](/de/docs/lan-https/).

Sie benötigen eine delegierbare DNS-Zone, einen Linux-Host (amd64 oder arm64) für öffentliches DNS und HTTPS, Node.js 24 oder 26 und ein Konto bei Ihrer Zertifizierungsstelle (CA). Verwenden Sie eine Serverdistribution, deren Signatur Sie nach der [manuellen Downloadanleitung](/de/docs/self-hosting/#v1-6-9をダウンロードして検証) geprüft haben.

## DNS delegieren {#dns-を委任する}

Richten Sie diese Einträge in der übergeordneten Zone ein. Das Akebi-DNS muss aus dem Internet **über UDP und TCP auf Port 53** erreichbar sein.

| Typ | Name | Wert |
| --- | --- | --- |
| `A` | `ns1.example.org` | Öffentliche IPv4-Adresse des Akebi-DNS-Servers |
| `A` | `akebi.example.org` | Öffentliche IPv4-Adresse des HTTPS-Reverse-Proxys der Akebi-API |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Reservieren Sie `ns1.example.org` für DNS und legen Sie den API-Host (`akebi.example.org`) außerhalb der LAN-Zertifikatszone (`lan.example.org`) an.
- Nach der Delegation beantwortet Akebi dynamisch Anfragen zu den aus LAN-IP-Adressen abgeleiteten `A`- und `AAAA`-Einträgen sowie zu `TXT` für ACME-Prüfungen. Die übergeordnete Zone benötigt keinen Eintrag pro IP.

## Dienst bereitstellen {#サービスを配置する}

1. **Benutzer und Zustandsverzeichnisse anlegen.** Trennen Sie die Anwendungsrechte über einen eigenen Benutzer und eine eigene Gruppe namens `latex-renderer-lan-authority`. Erstellen Sie `/var/lib/latex-renderer-lan-authority` und darunter `keyless` mit diesem Eigentümer und jeweils Modus `0700`.
2. **Konfigurationsverzeichnis vorbereiten.** Erstellen Sie `/etc/latex-renderer-lan-authority` mit Eigentümer und Gruppe `root:latex-renderer-lan-authority` und Modus `0750`. Kopieren Sie `deploy/lan-https/examples/authority.json` aus der geprüften Distribution dorthin und setzen Sie `root:latex-renderer-lan-authority` sowie Modus `0640`.
3. **`authority.json` bearbeiten.**
   - `policy.serverOrigin` legt die HTTPS-URL der API fest, beispielsweise `https://akebi.example.org`.
   - `policy.lanDomain` legt die delegierte LAN-Domain fest, beispielsweise `lan.example.org`.
   - `dns.nameserver` und `dns.listeners` bestimmen den öffentlichen DNS-Host und seine Lauschadressen. Nutzt ein anderer DNS-Dienst Port 53, wählen Sie eine konfliktfreie öffentliche IP.
   - Binden Sie `http` an die Loopback-Schnittstelle.
   - Konfigurieren Sie die öffentliche CA in `issuers`. Verlangt sie External Account Binding (EAB), speichern Sie in der angegebenen `eabFile`, die dem Dienstkonto gehört und Modus `0600` besitzt, die Werte `kid` und `hmacKey`. Werden CAA-Einträge verwendet, autorisieren Sie die gewählte CA.
4. **Code und systemd-Unit installieren.** Im Beispiel liegen die geprüften Quellen im Besitz von root unter `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Zustand initialisieren und Dienst starten.** Führen Sie `init` nur beim ersten Mal aus.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS-Zertifikat beziehen {#https-証明書を用意する}

Das Nginx-Beispiel zum Veröffentlichen der API steht in `deploy/lan-https/examples/authority.nginx.conf` und leitet an die API auf der lokalen Schnittstelle weiter. Beziehen Sie das Zertifikat der API, bevor Sie TLS in Nginx aktivieren.

Für automatische Erneuerung mit Certbot geben Sie CA, Kontakt, Zustimmung zu den Bedingungen und benötigte EAB-Daten in `/etc/latex-renderer-lan-authority/certbot.ini` an, auf die nur root zugreifen darf. Verwenden Sie einen ECDSA-P-256-Schlüssel. Warten Sie die Verbreitung der DNS-Delegation ab und führen Sie Folgendes aus.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Passen Sie nach der Ausstellung Servername und Zertifikatspfade in Nginx an, prüfen Sie mit `nginx -t` die Syntax, übernehmen Sie die Änderungen und kontrollieren Sie den Erneuerungstimer von Certbot.

- **Wenn Sie Keyless anbieten**, beziehen Sie ein separates ECDSA-P-256-Wildcard-Zertifikat, das ausschließlich `*.lan.example.org` umfasst. Ändern Sie im obigen Befehl `--cert-name` in `akebi-keyless`, `-d` in `'*.lan.example.org'` und `--deploy-hook` in `"$hooks/operator-certificate-hook.sh"`. Für den reinen Betrieb mit öffentlicher CA ist dieses Zertifikat entbehrlich.

## Registrierung konfigurieren {#登録方法を設定する}

Wählen Sie in `authority.json` mit `policy.registration` das Registrierungsverfahren für Clientserver.

- `"open"` erlaubt die automatische Registrierung.
- `"invite"` erfordert einen von der Administration ausgegebenen Code.

Erstellen Sie bei Einladungen mit dem folgenden Befehl einen zeitlich und in der Anzahl der Nutzungen begrenzten Code und übermitteln Sie ihn nur der vorgesehenen Person über einen sicheren Kanal.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

Für beide Modi gelten Grenzen für Registrierungen, Ausstellungshäufigkeit und gespeicherte Einträge sowie die Ausstellungsrichtlinien der CA.

## Von außen prüfen {#外部から確認する}

Prüfen Sie von einem externen Rechner die DNS-Delegation, SOA-Antworten über UDP und TCP, die Auflösung IP-basierter Namen und die HTTPS-Discovery-Antwort.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Funktionieren alle Antworten, verbinden Sie einen LaTeX-Renderer-Testserver nach der Anleitung [LAN-Zugriff konfigurieren](/de/docs/lan-https/#lan-向けに設定する) und prüfen Sie Zertifikatsausstellung und Anmeldung. Gibt die CA einen Zeitpunkt für den nächsten Versuch an, warten Sie bis dahin.

**Backups.** Nehmen Sie `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA-Konten und die Certbot-Erneuerungskonfiguration in verschlüsselte Backups auf. Verwenden Sie für eine laufende SQLite-Datenbank die Online-Sicherung.

Siehe [Konfigurationsbeispiele und Akebi-Spezifikation](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
