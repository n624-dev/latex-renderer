---
slug: lan-https
category: Selbsthosting
title: HTTPS im LAN mit Akebi verwenden
description: Greifen Sie über eine aus der lokalen IP-Adresse abgeleitete HTTPS-URL auf den Server zu.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Über die IP-Adresse des LAN zugreifen {#lan-の-ip-アドレスからアクセスする}

Akebi bildet aus der privaten IP-Adresse des Servers einen per HTTPS erreichbaren Hostnamen.

Wählen Sie den gemeinsamen Zertifikatsdienst im Assistenten von LaTeX Renderer. Zum Bereitstellen eines eigenen Dienstes siehe [Einen Akebi-Zertifikatsdienst betreiben](/de/docs/lan-https-authority/).

- **IPv4-Beispiel.** Aus der IP `192.168.1.50` und der LAN-Domain `lan.example.org` ergibt sich die URL `https://192-168-1-50.lan.example.org`.
- **IPv6.** Der Name enthält die acht ausgeschriebenen Gruppen der unterstützten privaten Adresse. Verwenden Sie die genaue URL aus der Einrichtung.

**Netzwerk- und DNS-Anforderungen**
Der Client muss das LAN des Servers erreichen können. Wird der Name nicht aufgelöst, prüfen Sie, ob Router oder DNS-Resolver Antworten mit privaten IP-Adressen als **Schutz vor DNS-Rebinding** blockieren. Richten Sie bei Bedarf nur für die verwendete LAN-Domain eine Ausnahme ein.

## Zertifikatsart wählen {#証明書の方式を選ぶ}

| Verfahren | Voraussetzungen und Eigenschaften |
| --- | --- |
| **Gemeinsamer Dienst, öffentliche CA** | Gemeinsamen Dienst einrichten und Bedingungen der Zertifizierungsstelle (CA) akzeptieren. Der private Zertifikatsschlüssel bleibt auf dem Server. |
| **Eigener Dienst, öffentliche CA** | URL und LAN-Domain [Ihres Akebi-Dienstes](/de/docs/lan-https-authority/) sowie ggf. Einladungscode. |
| **Keyless** | Erfordert einen kompatiblen Dienst, an den die Signatur beim TLS-Handshake delegiert wird. |
| **Vorhandenes Zertifikat oder private CA** | Zum Servernamen passendes Zertifikat samt privatem Schlüssel. Bei privater CA müssen Server und alle Clients dem Stammzertifikat vertrauen. |

> [!NOTE]
> - Bei einer öffentlichen CA erscheinen die Hostnamen ausgestellter Zertifikate in **öffentlichen Certificate-Transparency-Protokollen (CT)**.
> - Zwei räumlich getrennte LANs mit derselben privaten IP und derselben LAN-Domain gelten im Browser als **derselbe Ursprung** und teilen Cookies und andere gespeicherte Daten.

## LAN-Zugriff konfigurieren {#lan-向けに設定する}

1. Bei einer Neuinstallation [bereiten Sie den Server vor](/de/docs/self-hosting/#準備するもの) und öffnen mit `sudo n624-latex server setup --web` den [Assistenten](/de/docs/server-setup/#ブラウザで開く). Für Änderungen an einem Server mit verwaltetem dediziertem HTTPS verwenden Sie `sudo n624-latex server setup --ingress --web`.
2. Wählen Sie **LAN** als Zugangsweg und geben Sie Netzwerkschnittstelle, private IP-Adresse, zugelassene Client-Subnetze und HTTPS-Port an.
3. Wählen Sie Zertifikatsdienst und -verfahren. Beim gemeinsamen Dienst werden die URL `https://akebi.n624.net` und die LAN-Domain `lan.n624.net` eingestellt und der Server beim Anwenden registriert. Eine Einladung ist nicht erforderlich. Lesen und akzeptieren Sie bei öffentlicher CA deren Bedingungen. Geben Sie bei einem eigenen Dienst mit Einladungen den Code der Administration ein.
4. Prüfen Sie die erzeugte HTTPS-URL und die zugelassenen Subnetze vor dem Anwenden. Die Anwendungsanmeldung per Passwort oder OIDC bleibt aktiv.
5. Öffnen Sie die URL von einem anderen Rechner in einem zugelassenen Subnetz. Prüfen Sie, dass keine Zertifikatswarnung erscheint, melden Sie sich an und wandeln Sie ein Testdokument um.

Zum Einrichten eines eigenen Dienstes siehe [Einen Akebi-Zertifikatsdienst betreiben](/de/docs/lan-https-authority/).

## Zertifikatsstatus prüfen {#証明書の状態を確認する}

Diese Befehle zeigen Dienst, Erneuerungstimer und Protokolle des zugehörigen Namensraums.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Schlägt die Ausstellung oder Erneuerung fehl, prüfen Sie Serveruhr, HTTPS-Verbindung zum Dienst, Domain, IP und den von der CA angegebenen Zeitpunkt für den nächsten Versuch. Ein vorübergehender Fehler lässt das gültige Zertifikat bestehen. Der Timer setzt die Ausstellung anhand des gespeicherten Zustands fort. Passen Schlüssel und Zustand nicht zusammen, prüfen Sie die erhaltenen Zustandsdateien derselben Generation.

Siehe [Aufbau von Akebi und Fehlerbehebung](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
