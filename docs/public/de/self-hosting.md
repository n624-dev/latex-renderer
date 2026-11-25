---
slug: self-hosting
category: Selbsthosting
title: LaTeX Renderer auf dem eigenen Server betreiben
description: Wählen Sie eine unterstützte Konfiguration, bereiten Sie den Host vor und richten Sie den Dienst mit Updates und Backups ein.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Installationsmöglichkeiten {#現在の提供状況}

Installieren Sie das [APT-Paket](/de/docs/client/#debian-ubuntu-の-apt-パッケージ) und starten Sie den Assistenten, um einen Server einzurichten. Der Assistent konfiguriert HTTPS, Anmeldeverfahren und ersten Eigentümer.

### Ablauf der Erstinstallation {#初回導入の順序}

1. **Server vorbereiten.** Prüfen Sie die [unterstützten Systeme und Zugangswege](#対応する構成) und [installieren Sie Docker Engine und Nginx](#準備するもの).
2. **APT-Paket installieren.** Folgen Sie zum Installieren von `n624-latex` der [Anleitung für Debian und Ubuntu](/de/docs/client/#debian-ubuntu-の-apt-パッケージ).
3. **Server einrichten.** Starten Sie `sudo n624-latex server setup --plan` von einem unprivilegierten Bereitstellungskonto. Erfüllen Sie die noch offenen Voraussetzungen und setzen Sie die [Einrichtung im Browser](/de/docs/server-setup/#ブラウザで開く) fort.
4. **Erstes PDF erzeugen.** Öffnen Sie die eingerichtete HTTPS-URL, [melden Sie sich an und wandeln Sie ein Testdokument um](#導入完了の確認). Der Assistent bereitet die erste TeX-Umgebung vor.

Für einen vorhandenen Server siehe [Über die Verwaltung aktualisieren](/de/docs/updates/), für die Installation aus einem Tar-Archiv die [manuelle Anleitung](#v1-6-9をダウンロードして検証).

## Automatisches HTTPS im LAN {#lan-内の自動-https}

Mit **Akebi** können Sie eine aus der privaten Server-IP abgeleitete HTTPS-URL einrichten. Dafür lässt sich zunächst der gemeinsame Zertifikatsdienst verwenden. Siehe [HTTPS im LAN mit Akebi verwenden](/de/docs/lan-https/).

## Unterstützte Konfigurationen {#対応する構成}

APT unterstützt Neuinstallationen auf einem einzelnen Host mit `systemd` unter Debian 12 oder 13 bzw. Ubuntu 24.04 oder 26.04 für amd64 oder arm64. Die LaTeX-Kompilierung läuft mit Rootless Docker unter einem eigenen Benutzer.

| Bereitstellungsmodus (`DEPLOYMENT_MODE`) | Eingang | Anmeldeverfahren |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache oder HTTPS im LAN (Akebi) | Lokale Passwörter, OIDC oder beides |
| `cloudflare` | Cloudflare Tunnel und ein Worker | Cloudflare Access oder native Authentifizierung (Passwörter, OIDC oder beides) |

- **OIDC.** Ermöglicht den Identitätsanbieter (IdP) Ihrer Organisation.
- **Cloudflare Access.** Richten Sie in Cloudflare eine Access-Anwendung für die Benutzer ein.
- **Lokale Passwörter.** Registrieren Sie Benutzer ohne externen IdP in der Serververwaltung.
- **Passwörter und OIDC.** Aktivieren Sie beide über die native Authentifizierung mit `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` und `AUTH_OIDC_ENABLED=true`. Für ältere Konfigurationen mit nur einem Verfahren verwenden Sie `AUTH_MODE`.

## Server vorbereiten {#準備するもの}

- **Arbeitskonto.** Melden Sie sich mit einem unprivilegierten Konto an und führen Sie die Einrichtungsbefehle mit `sudo` aus.
- **Datenträger.** Die Erstprüfung verlangt **mindestens 5 GiB freien Platz** in jedem Dateisystem, das `/opt` oder `/var/lib` enthält. Planen Sie weiteren Platz für TeX-Images, Versionen, Ergebnisse und verschlüsselte Backups ein.
- **Docker Engine.** Installieren Sie Docker Engine und `docker-ce-rootless-extras` aus dem offiziellen Repository. Der Assistent richtet Rootless Docker für die Kompilierung ein. Siehe die offiziellen Hinweise für [Debian](https://docs.docker.com/engine/install/debian/) oder [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Installieren Sie es mit `sudo apt install nginx`. Neue APT-Installationen prüfen die Installation von Nginx auch dann, wenn Caddy, Apache oder Cloudflare als Eingang dienen.
- **Zugang und TLS.** Bereiten Sie für eigenes HTTPS Hostname, Zertifikat und privaten Schlüssel vor und halten Sie Adresse und Port für das integrierte HTTPS frei. Für Cloudflare bereiten Sie Tunnel, DNS und Worker vor. Siehe [Voraussetzungen für HTTPS im LAN](#lan-内の自動-https).
- **Zugangsdaten**
  - OIDC benötigt Aussteller-URL, Client-ID, Clientgeheimnis und das stabile `subject` des ersten Eigentümers.
  - Cloudflare Access benötigt Angaben zur Access-Anwendung und das `subject` des Eigentümers.
  - Für Passwörter benötigen Sie den Anmeldenamen und das anfängliche Passwort des Eigentümers.
- **Ausgehende Verbindungen.** Der Server benötigt HTTPS-Zugriff auf GitHub Releases und Attestations, GHCR (`ghcr.io`), TeX-Live-Archive und Paket-Repositories für Debian bzw. Ubuntu.
- **APT-Paket.** Enthält Node.js. Siehe [APT-Anleitung](/de/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Installation prüfen {#導入完了の確認}

1. Öffnen Sie `/admin/` an der eingerichteten HTTPS-URL und melden Sie sich als der bei der Installation registrierte Eigentümer an.
2. Öffnen Sie `/app/` unter derselben URL, wählen Sie die [Beispieldatei `main.tex`](/de/docs/#最短でpdfを作る) und klicken Sie auf **In PDF umwandeln**.
3. Öffnen Sie das PDF auf der Ergebnisseite und prüfen Sie, ob es den Beispieltext anzeigt.

> [!DETAILS] Zusätzliche Prüfungen von Diensten und Ausgaben
>
> Administrierende können eine Testumwandlung über die öffentliche URL ausführen. Der dazu ausgegebene API-Schlüssel wird unmittelbar danach widerrufen.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Prüfen können Sie auch den Zugang für normale Benutzer, öffentliche Anleitungen, die angezeigte TeX-Umgebung mit Sprachen und Image sowie typische Ausgaben wie japanische Dokumente oder SVGs.

### Benutzer registrieren und Schlüssel ausgeben {#利用者と-api-キーの発行}

Sobald Sie sich unter `/admin/` als Eigentümer anmelden können, registrieren Sie die Benutzer.

- **Web und Remote MCP.** Legen Sie den Benutzer unter **Benutzer** an, hinterlegen Sie seine Identität für das gewählte Verfahren und teilen Sie ihm die URL der Webanwendung mit.
- **CLI, Local MCP und HTTP-API.** Erstellen Sie ein mit dem Benutzer verknüpftes Dienstkonto. Stellen Sie unter **API-Schlüssel → API-Schlüssel ausstellen** einen Render-Schlüssel mit `render:create` und `render:read:own` (Präfix `lrk_...`) aus und übermitteln Sie ihn über einen sicheren Kanal.

## Aktualisierungen und Rollback {#更新とロールバック}

### Anwendung aktualisieren {#アプリケーションを更新する}

- Öffnen Sie als Eigentümer **Verwaltung → Updates**. Siehe [Server aktualisieren oder zur vorherigen Version zurückkehren](/de/docs/updates/).
- Zum Ändern der TeX-Live-Version oder der Sprachen öffnen Sie **Verwaltung → TeX-Umgebung**. Siehe [TeX-Umgebung konfigurieren](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migration und besondere Wiederherstellungsverfahren
>
> ### Root-Updater v1.2.x auf getrennte Berechtigungen umstellen {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Siehe [Anleitung zur Updater-Migration](/de/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar bricht das Entpacken mit Function not implemented ab {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Siehe [Vorgehen bei Entpackfehlern](/de/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Änderungssperre ist belegt {#mutation-lockが使用中と表示される場合}
>
> Siehe [Prozess ermitteln, der die Sperre hält](/de/docs/reference/#mutation-lockが使用中と表示される場合).

## Backups {#バックアップ}

Regelmäßige Sicherungen, Wiederherstellungspunkte vor Updates, Rücksicherungstests und Wiederherstellung beschreibt [Backups erstellen, prüfen und wiederherstellen](/de/docs/backups/). Stimmt die Audit-Exportposition nach einer Rücksicherung nicht überein, folgen Sie der [Wiederherstellung der Audit-Protokolle](/de/docs/reference/#監査ログの復旧).

## Fehlerbehebung {#問題が起きた場合}

| Symptom | Zuerst prüfen |
| --- | --- |
| `/app/` ist nicht erreichbar | DNS, TLS-Zertifikat, Tunnel-/Proxy-Konfiguration und Startreihenfolge lokaler Dienste |
| Nur Administrierende können sich nicht anmelden | Explizite Eigentümeridentität bzw. Zugangsdaten, `AUTH_MODE`, Aussteller, Audience und Rollen |
| TeX-Image lässt sich nicht beziehen | HTTPS-Zugriff auf `ghcr.io`, Paketsichtbarkeit und Architektur des Tags |
| TeX-Änderung dauert lange | Vorgangs-ID und bereinigte Image-Manager-Protokolle |
| Update wird abgelehnt | Unveränderlichkeit der Version, Archiv-Digest, Updatepfad und freier Speicherplatz |
| Hostvorbereitung stoppt wegen eines unsicheren Pfads | Prüfen, ob `/var/lib/latex-renderer` dem Eigentümer `root:latex-renderer` gehört und Modus `2770` hat |
| Nur die Updateseite funktioniert nicht | `client-dist/manifest.json` in der Distribution und Zustand von Admin Web |
| Umwandlung startet nicht | Warteschlange, mindestens 5 GiB freier Platz, Worker-Dienst und Rootless-Docker-Socket |
| Direkt nach einem Update treten Probleme auf | Annahme neuer Aufträge stoppen und alte und neue Anwendungs- und Umgebungsversionen prüfen, bevor Sie über ein Rollback entscheiden |

Notieren Sie Vorgangs-ID, fehlgeschlagene Phase und einen weitergebbaren Fehlercode. Siehe [Fehlerbehebung](/de/docs/troubleshooting/), [Sicherheit von Konten und Dokumenten](/de/docs/security/) sowie [Bereitstellung und Konfigurationsdateien (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## TeX-Umgebung ändern {#tex環境の初期設定}

Die Ersteinrichtung bereitet die Kompilierungsumgebung vor. Zum Hinzufügen von Sprachen oder Ändern der TeX-Live-Version öffnen Sie **Verwaltung → TeX-Umgebung** (`/admin/tex-environment/`). Das folgende Beispiel unterstützt Englisch und Japanisch.

| Einstellung | Empfohlener Wert |
| --- | --- |
| Image | `latest` (bei Tags mit festem Datum eine zur Architektur passende Version wählen) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (standardmäßig deaktiviert) |

- Aus dem öffentlichen GHCR-Paket wird nur das sprachneutrale **Basisimage** geladen und per Digest festgelegt. Der Server baut mit den gewählten Sprachen und dem aktuellen Renderer-Code ein **Laufzeitimage**. Ein lokales Image mit derselben Konfiguration wird wiederverwendet. Laufzeitimages werden nicht extern veröffentlicht.
- Der Build läuft nach dem Schließen des Browsers weiter. Prüfen Sie danach die aktive Umgebung und die Sprachen in der Verwaltung. Scheitert der Download, prüfen Sie HTTPS-Zugriff auf `ghcr.io` und Architekturkompatibilität.

### Automatische Speicherbereinigung {#自動容量整理}

> [!DETAILS] Ungenutzte Images und Build-Cache bereinigen
>
> Standardmäßig bereinigt Image Manager ungenutzte verwaltete Images alle 24 Stunden. Geschützt sind die aktuelle Basis und Laufzeit sowie deren Rollback-Versionen und in der Konfiguration referenzierte Images. Andere können 24 Stunden nach Erstellung entfernt werden. Für den ungenutzten Build-Cache gilt ein Richtwert von 2 GiB, kein Gesamtlimit für Docker.
>
> Ändern Sie die Werte in `/etc/latex-renderer/renderer.env` und übernehmen Sie sie mit `sudo systemctl restart latex-renderer-image-manager.service`, während kein TeX-Update läuft.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` akzeptiert `0` zum Abschalten oder ein Intervall von `1` bis `720` Stunden. Ab 5 Minuten nach dem Start wird alle 5 Minuten geprüft, ob eine Bereinigung fällig ist. Eine gemeinsame Sperre verschiebt sie während Updates und Bereitstellungen. Eine manuelle Bereinigung über Web oder CLI entfernt ungeschützte Elemente ohne Abwarten der Aufbewahrungsfrist.
> - `RETENTION_HOURS` erlaubt `0` bis `8760` Stunden und `BUILD_CACHE_MAX_GIB` erlaubt `0` bis `1024` GiB.
> - Seit `1.3.4-rc.2` werden Buildx-Metadaten von Rootless Docker in `.docker/buildx-worker` im Home-Verzeichnis des Workers isoliert, um Rechtekonflikte mit root-Builds zu vermeiden. Die automatische Bereinigung überspringt Images alter Konfigurationen und manuelle Wiederherstellungsverzeichnisse. Löschen Sie einzelne Elemente erst, wenn feststeht, dass sie nicht mehr benötigt werden. Löschen Sie niemals direkt das Docker-Datenverzeichnis.

## Berechtigungen bei Installation und Betrieb {#sudoと通常運用の境界}

Die Ersteinrichtung legt Systembenutzer, Verzeichnisse, `systemd`-Units, Rootless Docker und Schlüsseldateien mit `sudo` an. **Im Normalbetrieb erhalten Web und Verwaltungs-API keine `sudo`-Rechte.**

- **TeX-Änderungen.** Sie werden beim root gehörenden Image Manager über einen Unix-Socket mit beschränkten Zugriffsrechten angefordert.
- **Updates.** Ein Unix-Socket führt zum unprivilegierten Controller des Update Managers, der fest definierte Operationen an einen kurzlebigen root-Hilfsprozess delegiert.
- **Gegenseitiger Ausschluss.** Eine gemeinsame Sperre serialisiert TeX-Änderungen und Updates. Web und API können keine beliebigen Befehle, Pfade oder URLs an root übergeben.

## Konfiguration und Geheimnisse {#設定と秘密情報}

Hostspezifische Einstellungen und Geheimnisse werden außerhalb der Anwendung und des Git-Arbeitsbaums gespeichert, beispielsweise unter `/etc/latex-renderer/`.

| Pfad | Inhalt | Empfohlener Modus |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Zugangsprofil, URL, Grenzen und nicht geheime IdP-Konfiguration | `0640` |
| `/etc/latex-renderer/deployment.env` | Kennungen und Token nur für das Cloudflare-Profil | `0600` |
| `/etc/latex-renderer/update-manager.env` | Unprivilegiertes Bereitstellungskonto | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Bindings und Routen des Produktions-Workers | `0600` |
| `/etc/cloudflared/config.yml` | Eingangsregeln von Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, Ticketschlüssel und Zugangsdaten der Manager | Je nach Datei |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Clientgeheimnis des OIDC-Profils | `0440` |

> [!WARNING]
> Übernehmen Sie `.env`, Cloudflare-Token, Tunnel-Zugangsdaten, API-Schlüssel, SQLite-Datenbanken, Dokumente, PDFs oder echte unbereinigte Protokolle nicht in Git, Issues oder Hilfeanfragen. Die `*.example` im Repository dienen als Vorlagen für die Felder.

## Manuelle Installation aus einem Tar-Archiv und ältere Versionen {#手動配置-旧版向けの構築手順-tarball-導入}

Bei APT und `sudo n624-latex server setup` erledigt oder begleitet der Assistent das Entpacken, die Hostvorbereitung und die Eigentümerregistrierung. Öffnen Sie den folgenden Abschnitt bei manueller Bereitstellung von `v1.7.1` oder zur Prüfung von Zugriffsgrenzen und Authentifizierungswechsel.

> [!DETAILS] Mit v1.7.1 herunterladen, prüfen, bereitstellen und Eigentümer registrieren
>
> Verwenden Sie für eine neue manuelle Installation die stabile Version [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) mit dem Archiv `latex-renderer-server-1.7.1.tar.gz`. Tag und Dateien sind nach Veröffentlichung unveränderlich. Direktbereitstellungen aus dem Entwicklungszweig `main` und lokale `docker build` für TeX sind für den Betrieb nicht unterstützt.
>
> ### v1.7.1 herunterladen und prüfen {#v1-6-9をダウンロードして検証}
>
> Stellen Sie `curl`, `jq`, `tar`, `sha256sum` und eine mit `gh attestation verify` kompatible GitHub CLI bereit. Node.js und Corepack werden später bei der Hostvorbereitung installiert.
>
> Führen Sie Folgendes als normaler Benutzer in derselben Bash-Sitzung aus. Geprüft werden der SHA-256-Wert von GitHub Releases und die Herkunftssignatur von GitHub Actions. Die Herkunftsdaten gehen ohne GitHub-Konto oder Token von der öffentlichen API an `gh`. Scheitert ein Schritt, bleibt `bundle_root` ungesetzt. Beheben Sie die Ursache und versuchen Sie es erneut.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### Host vorbereiten {#ホストを準備}
>
> Installieren Sie `setfacl` für Speicherberechtigungen, `bsdtar` zum Entpacken im eingeschränkten Updater und `unzip` für ZIP-Prüfungen. Installieren Sie nach den offiziellen Anleitungen Node.js 26 oder 24 (`/usr/local/bin/node` und `/usr/local/bin/corepack`) und die Werkzeuge für Rootless Docker. Installieren Sie für `cloudflare` zusätzlich `cloudflared`. Update Manager installiert und prüft das festgelegte pnpm mit Corepack für den Bereitstellungsbenutzer.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> Initialisieren Sie den Host vom üblichen Bereitstellungskonto und richten Sie Rootless Docker für `latex-render-worker` ein.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Hostspezifische Konfiguration anlegen {#ホスト固有設定を作成}
>
> Erstellen Sie in allen Profilen `renderer.env` und konfigurieren Sie `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` und `AUTH_MODE`. Es gibt keinen Alias wie `ADMIN_ALLOWED_ORIGINS`. Der für Browseroperationen erlaubte Ursprung muss exakt `PUBLIC_ORIGIN` entsprechen.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Profil `cloudflare`.** Ersetzen Sie `example.com`, `REPLACE_*`, alle UUIDs und die Access-Audience durch die Werte Ihrer Installation. Lassen Sie bei einem fernverwalteten Tunnel die lokale `config.yml` weg und bestätigen Sie zuerst, dass der Konnektor aktiv ist.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **Profil `standalone`.** Installieren Sie Nginx, Caddy oder Apache, kopieren Sie ein Beispiel aus `deploy/reverse-proxy/` und geben Sie FQDN und Zertifikatspfade an. Der Proxy entfernt eingehende `CF-Access-*`-Header und überschreibt die Client-IP. Binden Sie die lokalen Dienste auf Ports 3100 bis 3105 nicht direkt nach außen.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **Bei `AUTH_MODE=oidc`.** Registrieren Sie `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` beim IdP. Setzen Sie in `renderer.env` die Werte `OIDC_ISSUER` und `OIDC_CLIENT_ID` und speichern Sie das Geheimnis separat ohne abschließenden Zeilenumbruch.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Dienste bereitstellen {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - Die Erstbereitstellung lädt das unveränderliche veröffentlichte Archiv erneut und prüft es, trennt den root-Kontrollbaum vom unprivilegierten Build-Baum, baut `client-dist` und installiert es unter `/opt/latex-renderer/releases/$release_id`. Hosts mit bestehender Datenbank oder vorhandenem `current` werden abgewiesen. Verwenden Sie danach das normale Updateverfahren.
> - Prüfen Sie vor der Bereitstellung `renderer.env` (Eigentümer root, Modus `0640`, keine doppelten Schlüssel), `PUBLIC_ORIGIN`, die Authentifizierungseinstellungen sowie Eigentümer, Rechte und Länge des Peppers und der Geheimnisse, ohne deren Werte anzuzeigen.
> - Der Updater liegt getrennt unter `/opt/latex-renderer/updater`, wie in `docs/independent-updater.md` im Repository beschrieben. Nur die primäre Gruppe des Bereitstellungsbenutzers kann `/opt/latex-renderer/update-staging` durchqueren. Jeder Zwischenstand ist mit `0700` isoliert und wird nach Abschluss oder, bei Unterbrechung, bei einem späteren Start nach Ablauf von 24 Stunden bereinigt.
>
> ### Öffentliche Zugriffsgrenzen {#公開境界}
>
> - **`cloudflare-access`.** Schützen Sie `/auth/*`, `/app/`, `/admin/` und `/oauth/authorize` über dieselbe Access-Anwendung für menschliche Benutzer und prüfen Sie die Audience auch am Ursprung. Achten Sie bei Cloudflare mit OIDC oder Passwort darauf, dass Access `/auth/*` nicht blockiert. Dokumentation und Downloads sind öffentlich. Worker Routes bedienen nur den öffentlichen Teil der Render-API. Ordnen Sie die Eingangsregeln des Tunnels mit spezifischen API- und Verwaltungspfaden zuerst, danach dem Web als Standard und zuletzt `http_status:404`.
> - **`standalone`.** Ein TLS-Reverse-Proxy verteilt Anfragen nach Pfad an lokale Dienste. Nur kleine JSON-Ticketoperationen gehen an das Standalone Gateway auf Port 3105. Das Nginx-Beispiel begrenzt Verbindungen und Anfrageraten für Passwortanmeldung und Ticket-API. Caddy und Apache ohne Erweiterungen bieten keine entsprechende Begrenzung pro Client. Diese muss daher am Load Balancer oder beim Anbieter erfolgen. Halten Sie `/internal/*`, Datenbank und Verwaltungssockets privat.
>
> ### Erster Eigentümer {#最初のowner}
>
> Die externe Identität wird über `provider + issuer + subject`, die Passwortidentität über `login name` bestimmt. Die E-Mail-Adresse dient nur zur Anzeige. Konten werden weder anhand identischer E-Mail-Adressen verknüpft noch bei der Anmeldung automatisch erstellt. Führen Sie das Verfahren der gewählten Methode einmal aus.
>
> **Cloudflare Access oder OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **Lokales Passwort (Beispielname `owner`)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### AUTH_MODE später ändern {#後からauth-modeを変更する場合}
>
> Verwenden Sie dieses Verfahren, wenn der [Serverassistent](/de/docs/server-setup/) nicht verfügbar ist.
> Erstellen Sie ein verschlüsseltes Backup und stoppen Sie die Verwaltungs-API. Ergänzen Sie mit der unveränderlichen Benutzer-ID aus der Verwaltung oder aus `users list` (Format `user_...`) die neue Anmeldemethode. Das Überschreiben bestehender Zugangsdaten wird abgewiesen, bestehende Sitzungen werden widerrufen. Ändern Sie anschließend `renderer.env` und starten Sie API und Web neu. Behalten Sie die bisherigen Zugangsdaten, bis die Anmeldung im privaten Fenster geprüft ist.
>
> Führen Sie zunächst die folgende Vorbereitung und danach nur die Befehle für das Zielverfahren aus.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **Zum Wechseln auf OIDC oder Cloudflare Access** geben Sie `oidc` oder `cloudflare-access` ein.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **Zum Wechseln auf Passwort** verwenden Sie die verdeckte Eingabe.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
