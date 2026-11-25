---
slug: windows
category: Instalación
title: Instalar la CLI en Windows
description: Instala la CLI desde PowerShell, registra tu clave de API y crea un PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalación {#インストール}

1. Prepara **Node.js 24 o posterior** y una clave de API (`lrk_...`) proporcionada por el administrador.
2. Abre PowerShell con tu cuenta habitual y ejecuta estos comandos.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Pega la clave en el campo de entrada oculto. Windows la cifra y la guarda para el usuario actual.
4. Tras la instalación, abre **una nueva ventana de PowerShell**. Si [usas un servidor propio](/es/docs/cli/#接続先サーバー), especifica su dirección antes de convertir.

Para volver a registrar una clave, abre la configuración con `n624-latex setup`.

## Primera conversión {#最初の変換}

1. Abre en el Explorador de archivos la carpeta que contiene `main.tex`. Puedes utilizar el [documento de ejemplo](/es/docs/#最短でpdfを作る).
2. Escribe `powershell` en la barra de direcciones del Explorador y pulsa Enter. En la ventana de PowerShell que se abre, ejecuta este comando.

```powershell
n624-latex main.tex
```

Se crea `main.pdf` en la misma carpeta. Para trabajar con ZIP o descargar varios archivos, consulta la [guía de conversión con la CLI](/es/docs/cli/#レンダリング).

## Actualización {#更新}

Ejecuta `n624-latex setup` en PowerShell y actualiza el cliente en la pantalla de configuración.

> [!DETAILS] 履歴資料　Migrar desde v1.6.9 o una versión anterior
>
> Ejecuta el mismo instalador de las [instrucciones de instalación](#インストール) con `-SkipCredential`. Se conserva tu clave guardada y se añade `n624-latex`. Si cambiaste la carpeta de instalación, [especifica la misma ubicación](/es/docs/reference/#windowsの配置と保護). Los scripts existentes pueden seguir usando `latex-render`.

## Eliminar solo la clave de API {#apiキーだけを削除}

Para conservar el cliente y eliminar únicamente la clave guardada, ejecuta este comando.

```powershell
n624-latex auth logout
```

## Desinstalación {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Por defecto se eliminan el cliente, la clave de API guardada y las habilidades administradas para Codex y Claude. Para conservar las credenciales o las habilidades, añade `-KeepCredential` o `-KeepSkills`, respectivamente.
