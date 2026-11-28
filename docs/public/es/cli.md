---
slug: cli
category: CLI
title: Convertir documentos y descargar resultados con la CLI
description: Compila TeX en una terminal y descarga PDF, registros y vistas previas.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

En la carpeta que contiene `main.tex`, ejecuta `n624-latex main.tex` para guardar el PDF en esa misma carpeta. Si es tu primera vez, [instala la CLI](/es/docs/client/) y configura la conexión.

## Autenticación {#認証}

Abre la pantalla de configuración en un navegador para guardar la clave de API.

```sh
n624-latex setup --gui
```

Si no puedes abrir un navegador, por ejemplo en una sesión SSH, registra la clave por la **entrada estándar** para evitar que aparezca en los argumentos del comando. En Bash o Zsh, ejecuta la primera línea, pega la clave, pulsa Enter y continúa con las siguientes líneas.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

En Windows también puedes usar la [entrada oculta del instalador](/es/docs/windows/#インストール).

Estos comandos comprueban si hay una clave guardada y la eliminan, respectivamente.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` muestra el origen efectivo de la conexión y de dónde se obtiene la credencial: del perfil guardado que indica por nombre, de la variable de entorno `LATEX_RENDER_API_KEY` o de ninguna fuente. Con `--json`, consulta `origin` y `credentialSource`.

- La variable de entorno `LATEX_RENDER_API_KEY`, si está definida, tiene prioridad sobre la clave local.
- `logout` elimina solo la clave guardada localmente. Desactiva la variable de entorno o revoca la clave en el servidor por separado cuando sea necesario.

### Elegir el servidor {#接続先サーバー}

La CLI se conecta por defecto al servicio alojado (`https://latex-render.n624.jp`). Para un servidor propio, configura su URL HTTPS en la sesión de terminal donde vas a ejecutar los comandos.

- Omite los sufijos `/app/` y `/api/v1/` en la URL.
- Usa una clave de API emitida por ese servidor.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Configuración y diagnóstico {#セットアップと診断}

Abre la configuración de conexión e integraciones con `n624-latex setup`. Si no puedes conectar, comprueba primero el estado con los comandos siguientes. Si no se encuentra `n624-latex`, consulta [Instalación y PATH](/es/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` inspecciona la instalación y las credenciales en modo de solo lectura y omite el valor de la clave de API. Si encuentra problemas, devuelve el código de salida `2`.

| Instalación | Actualización y reparación |
| --- | --- |
| APT | [Actualiza con APT](/es/docs/client/#apt-版の更新) o [reinstala](/es/docs/client/#状態確認と修復) los paquetes dañados. [Registra Local MCP manualmente](/es/docs/mcp/#local-mcpの登録). |
| Homebrew | [Actualiza con Homebrew](/es/docs/client/#homebrew-版の更新) o [reinstala](/es/docs/client/#状態確認と修復) los paquetes dañados. Configura las integraciones de IA con `n624-latex setup`. |
| Instalador descargable | [Actualiza desde la configuración](/es/docs/client/#配布インストーラー版の更新). Repara las integraciones y lanzadores administrados con `n624-latex setup repair`. |

Para desinstalar, sigue las [instrucciones de tu método](/es/docs/client/#アンインストール). La interfaz de configuración es local y se cierra al salir de la CLI.

## Renderizado {#レンダリング}

### Convertir directamente un archivo TeX {#tex-ファイルを直接変換する}

Indica el archivo `.tex` dentro de la carpeta del proyecto para generar el PDF. Puedes hacer referencia a imágenes, bibliografía y archivos `.sty` locales mediante rutas relativas.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Si omites `-o`, se guarda en la carpeta donde ejecutaste el comando un PDF con el mismo nombre base, por ejemplo `main.pdf`.
- Si falla LaTeX, se muestran el archivo, la línea y el ID del trabajo que se hayan podido identificar. Se conserva el último PDF guardado correctamente si falla la compilación o la descarga.

#### Elegir el motor LaTeX {#latex-のエンジンを選ぶ}

Para usar XeLaTeX, escribe el nombre del motor antes del archivo.

```sh
n624-latex xelatex main.tex
```

Si no especificas el motor, la CLI busca al principio del documento `% !TeX program = xelatex` o
`% !TEX TS-program = xelatex`. Si no hay ninguna directiva, consulta
`.n624-latex.json` en la raíz del proyecto. Puedes compartir este archivo
en Git para usar el mismo motor desde otros equipos.

```json
{"engine":"xelatex"}
```

Si no se especifica ninguno, se usa LuaLaTeX. pLaTeX y upLaTeX requieren
que el entorno de ejecución del servidor incluya la colección de japonés.

| Motor | Qué comprobar al migrar un documento |
| --- | --- |
| LuaLaTeX | Revisa la configuración de los documentos que usen `fontspec` o LuaTeX-ja. |
| pdfLaTeX | No admite `fontspec`. Usa la configuración de fuentes para pdfLaTeX. |
| XeLaTeX | Admite `fontspec`. Comprueba si hay paquetes exclusivos de LuaTeX. |
| pLaTeX / upLaTeX | Usa una clase de documento japonesa compatible con el motor. Para `jsarticle` en upLaTeX, especifica la opción de clase `uplatex`. |

El procesamiento bibliográfico depende de los paquetes y la configuración del documento. Incluye los `.bib` y los `.bst` propios. Los documentos BibTeX en pLaTeX y upLaTeX usan pBibTeX y upBibTeX, respectivamente. Consulta en el [entorno de renderizado](/app/environment/) la verificación de PDF, SVG y posición de los SVG.

### Convertir un ZIP o solicitar varias salidas {#zip-複数の出力を指定する}

Usa el subcomando `render` para convertir un ZIP o descargar el conjunto de salidas, incluidos registros, vistas previas y SVG.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Ejemplos**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- La ruta predeterminada es la carpeta actual y el valor predeterminado de `--entrypoint` es `main.tex`. La CLI prepara una entrada de hasta 500 archivos y espera al final. El punto de entrada puede ser una ruta relativa a un `.tex`. El servidor comprueba que sea segura y que el archivo exista.
- Con `--svg` también se extraen las expresiones matemáticas más externas y los diagramas TikZ de nivel superior como SVG independientes.

### Reutilizar la entrada para varios documentos {#同じ入力から複数の文書を作る-source-の再利用}

Si hay varios documentos principales en una carpeta o ZIP, sube la entrada una sola vez con `source upload` y reutiliza su ID. Usa una carpeta de salida (`--output`) distinta para cada trabajo.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Limpieza del destino, exclusiones y cargas duplicadas
>
> - **Limpieza de salidas anteriores.** Si reutilizas un destino, solo se retiran los PDF, vistas previas y SVG que figuraban en el `job.json` anterior y faltan en el nuevo resultado. Se conservan los archivos del usuario ajenos al trabajo.
> - **Comprobación del destino.** Se rechazan rutas que contengan enlaces simbólicos. En POSIX se comprueban también la propiedad y los permisos de escritura del grupo y otros usuarios. Windows omite la comprobación de bits de modo POSIX.
> - **Exclusión del directorio de salida.** Si `--output` apunta a una subcarpeta del proyecto, se excluye exactamente esa carpeta del siguiente ZIP. Las carpetas con nombres parecidos permanecen incluidas. La raíz del proyecto no puede ser el destino.
> - **Cargas duplicadas.** Si el servidor conserva un ZIP válido del mismo propietario con el mismo SHA-256, devuelve `uploadRequired: false` y omite la transferencia. Solo ese propietario puede usar el ID de entrada en trabajos posteriores.

## Proyectos y revisiones guardados {#保存projectと改訂}

Usa la CLI para administrar y volver a compilar proyectos y revisiones del servidor. La web, la API, MCP y otras claves del mismo usuario comparten los proyectos. Las operaciones temporales `render` y `source upload` no requieren guardar un proyecto.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** prepara la carpeta o ZIP como entrada y guarda una revisión inmutable en el proyecto. Con `--svg` la salida inicial de la revisión es PDF y SVG.
- **`render`** crea un trabajo a partir de una revisión guardada. Solo `--svg` sobrescribe la configuración de salida.
- **`list`, `get` y `jobs`** aceptan `--cursor` para recuperar la página siguiente.
- **`delete`** oculta el proyecto en la lista. Los trabajos existentes no se eliminan de inmediato.

## Operaciones con trabajos {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Descargar y esperar.** Estos comandos usan la clave de API para renovar un token de corta duración. `jobs download` espera a que termine el trabajo antes de reemplazar el conjunto guardado. Si la espera falla o se interrumpe, se conserva el conjunto previo. `delete` solo se aplica a trabajos finalizados.
- **Obtener más vistas previas PNG.** Al principio se genera solo la primera página. La descarga normal obtiene los PNG ya generados. Usa, por ejemplo, `--preview-page 2 5` para generar esas páginas, verificar su tamaño y SHA-256 y guardarlas. Esto no recompila el PDF ni amplía la conservación.
- **Descargar el PDF antes y reintentar SVG.** En trabajos PDF y SVG, usa `--pdf-only` para obtener el PDF sin esperar a los SVG. Si falla solo SVG, el PDF se conserva y el resultado es parcial. `retry-svg` reintenta únicamente la extracción. Se admiten 8 intentos incluido el primero, sin ampliar el plazo de conservación. Si ha cambiado el entorno de ejecución, crea un trabajo nuevo. Consulta [Disponibilidad anticipada del PDF y reintentos de SVG](/es/docs/api/#pdfの先行公開とsvgの再試行).
- **Reintentos por problemas de red.** Los fallos transitorios durante la consulta de estado se reintentan. Los errores de autenticación y permisos se devuelven enseguida. Si la CLI deja de esperar, el servidor puede seguir trabajando. Consulta el mismo `<jobId>` antes de crear otro. Véase [Espera y reintentos de la CLI](/es/docs/reference/#cliの待機と再試行).

## Archivos de salida {#成果物}

Para descargar el PDF antes, elegir páginas PNG o reintentar SVG, consulta [Obtener PDF, PNG y SVG](/es/docs/outputs/).

| Ruta | Contenido |
| --- | --- |
| `.render/result.pdf` | PDF generado correctamente |
| `.render/compile.log` | Registro de compilación de LaTeX |
| `.render/errors.json` | Detalles estructurados de los errores |
| `.render/job.json` | Estado final del trabajo |
| `.render/previews/page-N.png` | Vistas previas de hasta 100 páginas |
| `.render/svg/manifest.json` | Correspondencia entre SVG, posiciones en la fuente y coordenadas del PDF |
| `.render/svg/objects/*.svg` | SVG independiente por expresión matemática o diagrama TikZ |

## Salida JSON {#json出力}

Añade `--json` a cualquier comando para escribir un único objeto JSON en la salida estándar sin mensajes de progreso. Usa el mismo resultado de `client-core` que la presentación normal y excluye claves de API y tokens de corta duración.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Consulta el [formato JSON de la CLI](/es/docs/reference/#cliのjson形式) para los esquemas de éxito y error y los códigos de salida.
