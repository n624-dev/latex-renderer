---
slug: client
category: Installation
title: CLI installieren
description: Installieren Sie die CLI unter Windows, macOS oder Linux und erstellen Sie Ihr erstes PDF im Terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Unterstützte Plattformen {#対応環境}

Verwenden Sie die Installationsmethode für Ihr System und hinterlegen Sie den API-Schlüssel (`lrk_...`) der Administration. Der Server kompiliert die LaTeX-Dokumente.

| Plattform | Methode | Node.js |
| --- | --- | --- |
| Debian 12 / 13 oder Ubuntu 24.04 / 26.04 (amd64 oder arm64) | **[APT-Paket](#debian-ubuntu-の-apt-パッケージ)** | Enthalten |
| Windows | **[Anleitung für Windows](/de/docs/windows/)** | Ab Version 24 |
| macOS (Apple Silicon oder Intel) | **[Homebrew](#homebrew-でインストール)** | Wird von Homebrew installiert |
| macOS oder andere Linux-Distributionen | **[Installationsprogramm zum Herunterladen](#linux-macos)** | Ab Version 24 |

## Mit APT unter Debian oder Ubuntu installieren {#debian-ubuntu-の-apt-パッケージ}

1. [Laden Sie `n624-latex.sources` herunter](https://apt.n624.jp/latex-renderer/n624-latex.sources). Die Datei enthält den öffentlichen Signaturschlüssel des APT-Repositories von LaTeX Renderer.
2. Führen Sie im Downloadordner diese Befehle zum Installieren des Pakets aus.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Fahren Sie mit [Das erste PDF erstellen](#最初の-pdf-を作る) fort. Möchten Sie einen Server installieren, folgen Sie der [Anleitung zum Selbsthosting](/de/docs/self-hosting/).

## Mit Homebrew installieren {#homebrew-でインストール}

Führen Sie diese Befehle auf einem Mac mit installiertem Homebrew aus.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Hinterlegen Sie den API-Schlüssel und fahren Sie mit [Das erste PDF erstellen](#最初の-pdf-を作る) fort.

### Vom heruntergeladenen Installationsprogramm zu Homebrew wechseln {#配布インストーラー版から-homebrew-へ移行する}

API-Schlüssel und MCP-Konfiguration können erhalten bleiben. Prüfen Sie mit `type -a n624-latex`, welchen Befehl die Shell zuerst findet. Kommt die ältere Installation zuerst, rufen Sie die Homebrew-Version direkt auf.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Damit `n624-latex` die Homebrew-Version nutzt, stellen Sie im `PATH` der Shell das `bin`-Verzeichnis von Homebrew vor den Pfad der älteren Installation.

Möchten Sie auch Local MCP umstellen, ändern Sie im KI-Werkzeug den Befehl des Eintrags `latex-renderer` auf den absoluten Pfad der Homebrew-Version von `bin/latex-renderer-mcp`. Den Installationsort finden Sie mit `brew --prefix`.

Starten Sie das KI-Werkzeug neu und testen Sie die Verbindung zu Local MCP von Homebrew, bevor Sie die ältere Version entfernen. Geben Sie zur Deinstallation den absoluten Pfad des alten Startprogramms an und behalten Sie Schlüssel und Skills. Für eine Installation am Standardort verwenden Sie diesen Befehl.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Installationsprogramm zum Herunterladen vorbereiten {#配布インストーラーの準備}

Installieren Sie **Node.js ab Version 24** für Ihr normales Benutzerkonto und prüfen Sie die Version mit `node --version`. Unter Windows folgen Sie der [Anleitung für Windows](/de/docs/windows/).

## Linux und macOS {#linux-macos}

Laden Sie das Installationsprogramm im Terminal in einen temporären Ordner und führen Sie es mit Node.js aus.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Wird `n624-latex` nicht gefunden, öffnen Sie ein neues Terminal. Besteht das Problem fort, führen Sie `export PATH="$HOME/.local/bin:$PATH"` aus und ergänzen Sie dieselbe Zeile in der Konfigurationsdatei der Shell, etwa `~/.bashrc` oder `~/.zshrc`.

## Das erste PDF erstellen {#最初の-pdf-を作る}

1. Öffnen Sie die Einstellungen als normaler Benutzer und speichern Sie den API-Schlüssel. Für eine eigene Installation [geben Sie zuerst den Server an](/de/docs/cli/#接続先サーバー). Können Sie keinen Browser öffnen, [hinterlegen Sie den Schlüssel über die Standardeingabe](/de/docs/cli/#認証).

```sh
n624-latex setup
```

2. Führen Sie diesen Befehl im Ordner mit `main.tex` aus. Sie können das [Beispieldokument](/de/docs/#最短でpdfを作る) verwenden.

```sh
n624-latex main.tex
```

Im selben Ordner wird `main.pdf` erstellt. Zur Wahl des Ausgabeorts und zur Arbeit mit ZIP, PDF und SVG siehe [Mit der CLI umwandeln und herunterladen](/de/docs/cli/#レンダリング).

## Windows {#windows}

Die [Anleitung für Windows](/de/docs/windows/) verwendet PowerShell. Windows DPAPI verschlüsselt den gespeicherten Schlüssel für das aktuelle Benutzerkonto. Siehe [Installationsort ändern und PATH reparieren](/de/docs/reference/#windowsの配置と保護).

## Updates {#更新}

### APT-Paket aktualisieren {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Gespeicherte Verbindung und API-Schlüssel bleiben erhalten. Möchten Sie den selbst betriebenen Server aktualisieren, verwenden Sie die [Update-Seite der Verwaltung](/de/docs/updates/).

### Homebrew-Paket aktualisieren {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Client aus dem heruntergeladenen Installationsprogramm aktualisieren {#配布インストーラー版の更新}

Führen Sie diesen Befehl oder erneut den ursprünglichen Installationsbefehl aus.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Clients bis einschließlich v1.6.9 aktualisieren
>
> Ist nur `latex-render` installiert, wiederholen Sie die Installation. [Unter Windows bleibt der gespeicherte Schlüssel bei der Aktualisierung erhalten](/de/docs/windows/#更新). Unter macOS und Linux können Sie die Version auch mit `latex-render setup` aktualisieren und den neuen Befehl mit `latex-render setup repair` hinzufügen. Vorhandene Skripte können `latex-render` weiterverwenden.

> [!DETAILS] Funktionsweise der Installation und Aktualisierung
>
> - Entspricht der SHA-256-Wert der heruntergeladenen ZIP-Datei der installierten Version, werden die verwalteten Einstellungen geprüft, ohne die Dateien neu zu installieren.
> - Beim Aktualisieren verschiebt das Installationsprogramm die frühere Version in eine Sicherung mit Zeitstempel. Andere Startprogramme, MCP-Einträge und vom Benutzer angepasste Skills bleiben erhalten.

## Installation prüfen und reparieren {#状態確認と修復}

Diese Befehle prüfen den Zustand bei allen Installationsarten.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Installieren Sie ein beschädigtes APT-Paket mit `sudo apt install --reinstall n624-latex` neu.
- Installieren Sie ein beschädigtes Homebrew-Paket mit `brew reinstall n624-dev/tap/n624-latex` neu.
- Beim heruntergeladenen Installationsprogramm repariert `n624-latex setup repair` die verwalteten Startprogramme und Integrationen.

## Ausgabedateien speichern und wiederherstellen {#成果物の保存と復旧}

`n624-latex main.tex` speichert das PDF im aktuellen Ordner. Zu PDF, Protokollen und Bildern, die `render` und `jobs download` speichern, siehe [Ausgabedateien der CLI](/de/docs/cli/#成果物). Ist das Ziel belegt, lesen Sie die [Fehlerbehebung](/de/docs/troubleshooting/#成果物の取得).

## Deinstallation {#アンインストール}

Entfernen Sie das APT-Paket mit `sudo apt remove n624-latex`. Möchten Sie auch den Schlüssel des Benutzers löschen, führen Sie zuvor `n624-latex auth logout` aus.

Entfernen Sie das Homebrew-Paket mit `brew uninstall n624-dev/tap/n624-latex`. Der gespeicherte Schlüssel und die MCP-Konfiguration Ihres KI-Werkzeugs bleiben erhalten. Benötigen Sie diese nicht mehr, melden Sie sich vor der Deinstallation ab und entfernen Sie die MCP-Konfiguration im KI-Werkzeug.

Für das heruntergeladene Installationsprogramm verwenden Sie diesen Befehl.

```sh
n624-latex setup remove --yes
```

Um Zugangsdaten bzw. Skills zu behalten, ergänzen Sie `--keep-credential` bzw. `--keep-skills`. Zur Deinstallation mit dem Windows-Skript siehe [Anleitung für Windows](/de/docs/windows/#アンインストール).
