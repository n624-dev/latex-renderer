---
slug: windows
category: Installasjon
title: Installer CLI i Windows
description: Installer CLI fra PowerShell, lagre API-nøkkelen og lag en PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Installasjon {#インストール}

1. Sørg for at du har **Node.js 24 eller nyere** og en API-nøkkel (`lrk_...`) fra administratoren.
2. Åpne PowerShell med din vanlige brukerkonto og kjør kommandoene nedenfor.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Lim nøkkelen inn i det skjulte inndatafeltet. Windows krypterer og lagrer den for den gjeldende brukeren.
4. Åpne **et nytt PowerShell-vindu** etter installasjonen. Hvis du [bruker en egen server](/no/docs/cli/#接続先サーバー), oppgi adressen før du konverterer.

Åpne innstillingene med `n624-latex setup` hvis du vil registrere en nøkkel på nytt.

## Første konvertering {#最初の変換}

1. Åpne mappen med `main.tex` i Filutforsker. Du kan bruke [eksempeldokumentet](/no/docs/#最短でpdfを作る).
2. Skriv `powershell` i adressefeltet i Filutforsker og trykk på Enter. Kjør følgende kommando i PowerShell-vinduet som åpnes.

```powershell
n624-latex main.tex
```

`main.pdf` opprettes i samme mappe. Se [Konverter med CLI](/no/docs/cli/#レンダリング) hvis du vil behandle ZIP-arkiver eller laste ned flere filer.

## Oppdatering {#更新}

Kjør `n624-latex setup` i PowerShell og oppdater klienten fra innstillingssiden.

> [!DETAILS] 履歴資料　Flytt fra v1.6.9 eller eldre
>
> Kjør det samme installasjonsprogrammet som i [installasjonsveiledningen](#インストール) med `-SkipCredential`. Den lagrede nøkkelen beholdes og `n624-latex` legges til. Hvis du endret installasjonsmappen, [oppgi samme plassering](/no/docs/reference/#windowsの配置と保護). Eksisterende skript kan fortsette å bruke `latex-render`.

## Fjern bare API-nøkkelen {#apiキーだけを削除}

Kjør følgende kommando for å beholde klienten og bare fjerne den lagrede nøkkelen.

```powershell
n624-latex auth logout
```

## Avinstallasjon {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Som standard fjernes klienten, den lagrede API-nøkkelen og administrerte ferdigheter for Codex og Claude. Legg til `-KeepCredential` for å beholde påloggingsopplysninger eller `-KeepSkills` for å beholde ferdigheter.
