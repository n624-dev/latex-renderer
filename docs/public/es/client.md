---
slug: client
category: Instalación
title: Instalar la CLI
description: Instala la CLI en Windows, macOS o Linux y crea tu primer PDF desde la terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Plataformas compatibles {#対応環境}

Instala la CLI con el método correspondiente a tu sistema y registra la clave de API (`lrk_...`) que te entregue el administrador. El servidor compila los documentos LaTeX.

| Plataforma | Método | Node.js |
| --- | --- | --- |
| Debian 12 / 13 o Ubuntu 24.04 / 26.04 (amd64 o arm64) | **[Paquete APT](#debian-ubuntu-の-apt-パッケージ)** | Incluido |
| Windows | **[Instrucciones para Windows](/es/docs/windows/)** | 24 o posterior |
| macOS (Apple Silicon o Intel) | **[Homebrew](#homebrew-でインストール)** | Lo instala Homebrew |
| macOS u otras distribuciones de Linux | **[Instalador descargable](#linux-macos)** | 24 o posterior |

## Instalar con APT en Debian o Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Descarga `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). El archivo incluye la clave pública de firma del repositorio APT de LaTeX Renderer.
2. En la carpeta donde lo guardaste, ejecuta estos comandos para instalar el paquete.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Continúa con [Crear tu primer PDF](#最初の-pdf-を作る). Si quieres instalar un servidor, sigue las [instrucciones de alojamiento propio](/es/docs/self-hosting/).

## Instalar con Homebrew {#homebrew-でインストール}

Ejecuta estos comandos en un Mac con Homebrew instalado.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Tras registrar la clave de API, continúa con [Crear tu primer PDF](#最初の-pdf-を作る).

### Migrar del instalador descargable a Homebrew {#配布インストーラー版から-homebrew-へ移行する}

Puedes conservar la clave de API y la configuración de MCP. Ejecuta `type -a n624-latex` para comprobar qué comando encuentra primero el intérprete. Si aparece primero la instalación anterior, ejecuta la versión de Homebrew directamente.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Para que `n624-latex` use la versión de Homebrew, coloca en el `PATH` del intérprete el directorio `bin` de Homebrew antes que la instalación anterior.

Si también quieres cambiar Local MCP, modifica el comando de la entrada `latex-renderer` de tu herramienta de IA para que apunte a la ruta absoluta de `bin/latex-renderer-mcp` de Homebrew. Usa `brew --prefix` para localizar la instalación.

Antes de eliminar la versión anterior, reinicia la herramienta de IA y comprueba que se conecta al Local MCP de Homebrew. Especifica la ruta absoluta del lanzador anterior al desinstalarlo y conserva la clave y las habilidades. Para una instalación en la ubicación predeterminada, ejecuta este comando.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Preparar el instalador descargable {#配布インストーラーの準備}

Instala **Node.js 24 o posterior** para tu usuario habitual y comprueba la versión con `node --version`. En Windows, sigue las [instrucciones para Windows](/es/docs/windows/).

## Linux y macOS {#linux-macos}

En una terminal, descarga el instalador en una carpeta temporal y ejecútalo con Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Si no se encuentra `n624-latex`, abre una terminal nueva. Si persiste el problema, ejecuta `export PATH="$HOME/.local/bin:$PATH"` y añade la misma línea al archivo de configuración del intérprete, por ejemplo `~/.bashrc` o `~/.zshrc`.

## Crear tu primer PDF {#最初の-pdf-を作る}

1. Abre la configuración con tu usuario habitual y guarda la clave de API. Si usas alojamiento propio, [especifica primero el servidor](/es/docs/cli/#接続先サーバー). Si no puedes abrir un navegador, [registra la clave por la entrada estándar](/es/docs/cli/#認証).

```sh
n624-latex setup
```

2. Ejecuta este comando en la carpeta que contiene `main.tex`. Puedes usar el [documento de ejemplo](/es/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

Se crea `main.pdf` en la misma carpeta. Para elegir un destino o trabajar con ZIP, PDF y SVG, consulta [Convertir y descargar desde la CLI](/es/docs/cli/#レンダリング).

## Windows {#windows}

Las [instrucciones para Windows](/es/docs/windows/) usan PowerShell. Windows DPAPI cifra la clave guardada para el usuario actual. Consulta [Cambiar la ubicación y reparar PATH](/es/docs/reference/#windowsの配置と保護).

## Actualizaciones {#更新}

### Actualizar el paquete APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

Se mantienen la conexión y la clave de API guardadas. Si quieres actualizar el servidor que alojas, usa la [pantalla de actualizaciones de administración](/es/docs/updates/).

### Actualizar el paquete Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Actualizar el cliente del instalador descargable {#配布インストーラー版の更新}

Ejecuta este comando o repite el comando de instalación inicial.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Actualizar clientes v1.6.9 o anteriores
>
> Si solo está instalado `latex-render`, repite la instalación. [En Windows puedes actualizar sin volver a introducir la clave guardada](/es/docs/windows/#更新). En macOS y Linux también puedes actualizar con `latex-render setup` y añadir el nuevo comando con `latex-render setup repair`. Los scripts existentes pueden seguir usando `latex-render`.

> [!DETAILS] Cómo funcionan la instalación y las actualizaciones
>
> - Si el SHA-256 del ZIP descargable coincide con la versión instalada, se comprueban los ajustes administrados sin volver a instalar los archivos.
> - Al actualizar, el instalador mueve la versión anterior a una copia de seguridad con fecha y hora. Conserva otros lanzadores, registros de MCP y habilidades modificadas por el usuario.

## Comprobar y reparar la instalación {#状態確認と修復}

Estos comandos comprueban el estado con cualquier método de instalación.

```sh
n624-latex setup status
n624-latex doctor --json
```

- Para APT, reinstala el paquete con `sudo apt install --reinstall n624-latex`.
- Para Homebrew, reinstala el paquete con `brew reinstall n624-dev/tap/n624-latex`.
- Para el instalador descargable, repara los lanzadores y las integraciones administradas con `n624-latex setup repair`.

## Guardar y recuperar archivos de salida {#成果物の保存と復旧}

`n624-latex main.tex` guarda el PDF en la carpeta actual. Para los PDF, registros e imágenes que guardan `render` y `jobs download`, consulta [Archivos de salida de la CLI](/es/docs/cli/#成果物). Si el destino está en uso, consulta [Solución de problemas](/es/docs/troubleshooting/#成果物の取得).

## Desinstalación {#アンインストール}

Desinstala el paquete APT con `sudo apt remove n624-latex`. Para eliminar también la clave del usuario, ejecuta `n624-latex auth logout` antes de desinstalar.

Desinstala el paquete de Homebrew con `brew uninstall n624-dev/tap/n624-latex`. Se conservan la clave guardada y la configuración MCP de tu herramienta de IA. Si ya no las necesitas, cierra sesión antes de desinstalar y elimina la configuración MCP en la herramienta de IA.

Para el instalador descargable, ejecuta este comando.

```sh
n624-latex setup remove --yes
```

Si quieres conservar las credenciales o las habilidades, añade `--keep-credential` o `--keep-skills`, respectivamente. Para desinstalar con el script de Windows, consulta las [instrucciones para Windows](/es/docs/windows/#アンインストール).
