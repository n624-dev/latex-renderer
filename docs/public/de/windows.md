---
slug: windows
category: Installation
title: CLI unter Windows installieren
description: Installieren Sie die CLI mit PowerShell, hinterlegen Sie Ihren API-Schlüssel und erstellen Sie ein PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installation {#インストール}

1. Halten Sie **Node.js ab Version 24** und einen API-Schlüssel (`lrk_...`) der Administration bereit.
2. Öffnen Sie PowerShell mit Ihrem normalen Benutzerkonto und führen Sie diese Befehle aus.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Fügen Sie den Schlüssel in das verdeckte Eingabefeld ein. Windows verschlüsselt und speichert ihn für das aktuelle Benutzerkonto.
4. Öffnen Sie nach der Installation **ein neues PowerShell-Fenster**. Wenn Sie [einen eigenen Server verwenden](/de/docs/cli/#接続先サーバー), geben Sie dessen Adresse vor der Umwandlung an.

Um einen Schlüssel erneut zu hinterlegen, öffnen Sie die Einstellungen mit `n624-latex setup`.

## Erste Umwandlung {#最初の変換}

1. Öffnen Sie im Datei-Explorer den Ordner mit `main.tex`. Sie können das [Beispieldokument](/de/docs/#最短でpdfを作る) verwenden.
2. Geben Sie `powershell` in die Adressleiste des Explorers ein und drücken Sie die Eingabetaste. Führen Sie im geöffneten PowerShell-Fenster diesen Befehl aus.

```powershell
n624-latex main.tex
```

Im selben Ordner entsteht `main.pdf`. Zur Arbeit mit ZIP-Dateien und zum Herunterladen mehrerer Dateien siehe [Umwandeln mit der CLI](/de/docs/cli/#レンダリング).

## Aktualisierung {#更新}

Führen Sie `n624-latex setup` in PowerShell aus und aktualisieren Sie den Client in den Einstellungen.

> [!DETAILS] 履歴資料　Von Version 1.6.9 oder älter migrieren
>
> Starten Sie das Installationsprogramm aus der [Installationsanleitung](#インストール) mit `-SkipCredential`. Der gespeicherte Schlüssel bleibt erhalten und `n624-latex` wird hinzugefügt. Hatten Sie den Installationsordner geändert, [geben Sie denselben Pfad an](/de/docs/reference/#windowsの配置と保護). Vorhandene Skripte können `latex-render` weiterverwenden.

## Nur den API-Schlüssel entfernen {#apiキーだけを削除}

Mit diesem Befehl löschen Sie nur den gespeicherten Schlüssel und behalten den Client.

```powershell
n624-latex auth logout
```

## Deinstallation {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Standardmäßig werden der Client, der gespeicherte API-Schlüssel und die verwalteten Skills für Codex und Claude entfernt. Um Zugangsdaten bzw. Skills zu behalten, fügen Sie `-KeepCredential` bzw. `-KeepSkills` hinzu.
