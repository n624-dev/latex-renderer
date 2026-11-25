---
slug: reference
category: Operaciones y desarrollo
title: Referencia de operaciones y desarrollo
description: Consulta el almacenamiento y la recuperación del cliente, la autenticación MCP y los procedimientos de migración.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## Almacenar y recuperar resultados {#成果物の保存-復旧の仕様}

> [!DETAILS] Especificaciones y procedimientos
>
> - **Sustitución atómica de directorios.** La CLI y Local MCP conservan rutas como `.render/result.pdf`, `job.json` y las vistas previas. Verifican el tamaño y el SHA-256 anunciados de todos los archivos y cambian el directorio cuando está completo. El directorio puede desaparecer un instante durante el cambio. Los programas externos deben leerlo después de que termine el comando.
> - **Recuperación automática.** Un directorio contiguo al de salida llamado `<output-name>.latex-renderer-state` guarda el estado de recuperación y se excluye de la recopilación de entradas. Al salir normalmente se borran los datos temporales. Tras una salida forzada, la siguiente descarga restaura el conjunto anterior si el cambio no se había confirmado o conserva el nuevo y limpia el anterior si ya lo estaba. No borres el directorio de estado durante la operación o antes de la recuperación.
> - **Exclusión y anomalías.** Las escrituras simultáneas al mismo destino se detienen con `OUTPUT_BUSY`. El tiempo transcurrido por sí solo no desplaza procesos activos. Si se reutiliza un PID, se detiene la operación por precaución. Los metadatos dañados, archivos desconocidos o enlaces externos requieren revisión antes de eliminar nada.
> - **Archivos del usuario y límites.** Los archivos ordinarios del usuario se copian al nuevo conjunto. Si se detecta una edición durante la descarga, se cancela la publicación y se conserva la edición. Es preferible usar un destino dedicado. Cada conjunto admite hasta 1 GiB y 10.000 entradas. Debe haber espacio para ambos y los datos temporales. Se admiten solo sistemas de archivos locales y se rechazan las rutas con enlaces simbólicos, enlaces duros o montajes de otro sistema de archivos. El bloqueo en recursos de red y la atomicidad total ante un corte eléctrico quedan fuera de las garantías. En Windows, si un archivo abierto impide el cambio, se mantiene el conjunto anterior.

## Límites de autenticación web {#web認証の境界}

> [!DETAILS] Especificaciones y procedimientos
>
> Las sesiones del servidor protegen `/app/`, `/admin/` y sus API. No se incluyen en el índice de búsqueda público. Los usuarios normales usan `/app/` y solo administradores y propietarios pueden acceder a `/admin/`. La identidad se establece con `issuer + subject` del proveedor externo o el `login name` de la autenticación por contraseña. El correo y el nombre visible no son claves de autenticación. Las cargas de ZIP, los trabajos, los archivos de salida y la compilación TeX pasan por el renderizador del servidor.
>
> > [!NOTE]
> > El navegador no guarda de forma persistente los tickets de corta duración. La sesión del servidor los reemite cuando hacen falta. No compartas cookies de sesión, tokens CSRF ni tickets.

## Registro y diagnóstico de Remote MCP {#remote-mcpの登録-診断}

> [!DETAILS] Especificaciones y procedimientos
>
> - **Registro dinámico de clientes (DCR).** Los registros incompletos o inactivos suelen limpiarse a los 30 días. Se protegen los que tengan referencias desde códigos de autorización válidos o familias de tokens. El máximo global es 10.000. Ante `invalid_client` tras una limpieza, registra el cliente de nuevo. Se admiten solicitudes DCR estándar sin nombre de cliente y se mantiene la validación del nombre y de la URI de redirección.
> - **Solicitudes temporales de autorización (esquema 20).** Si se intercala un inicio de sesión, la solicitud se guarda mediante un ID aleatorio corto que permite recuperarla sin insertar el `state` largo de OAuth en la URL de retorno. Dura 10 minutos y solo se puede usar una vez si coinciden el navegador autenticado y la cookie dedicada. Las pestañas concurrentes tienen IDs distintos. El límite global es de 1.000 solicitudes y cada navegador admite hasta 8 cookies de continuación. Al alcanzar el límite se devuelve `503` conservando las solicitudes existentes. En la base de datos se guardan únicamente hashes de ID y cookie. Ni reiniciar ni restaurar copias amplía su vigencia.
> - **Límites por IP y cabeceras de origen.** DCR permite 10 registros por IP de origen fiable cada 15 minutos. Los clientes de un mismo proxy de salida comparten el cupo. Desde el intento 11 se devuelve HTTP `429`, `temporarily_unavailable` y `Retry-After`. Los metadatos no válidos no consumen cupo. Si falta la IP o es inválida, se devuelve `503` para que el operador revise el proxy, sin agrupar clientes no identificados. Mantén el backend en la interfaz local y configura el proxy para reemplazar `X-Latex-Renderer-Client-IP` por la dirección real. Se ignoran valores arbitrarios de `X-Forwarded-For`. En rutas Cloudflare también se procesa `CF-Connecting-IP` dentro del límite de confianza.
> - **Comprobación administrativa de conectividad.** El siguiente comando verifica el descubrimiento público y el desafío Bearer `401` sin enviar credenciales, cambiar ajustes, seguir redirecciones ni mostrar cuerpos, cookies o secretos.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **Aislar el fallo por fases.** Un `200` de descubrimiento y un desafío `401` correctos solo verifican esas fases. Contrasta etapa, hora y `X-Request-ID` con los registros `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error` y `remote_mcp.rpc_result`. Mantén códigos OAuth, tokens, cookies, verificadores PKCE, fuentes e IDs de usuario fuera de registros e incidencias.
> - **La autenticación funciona pero falla el descubrimiento de acciones.** Revisa por separado `initialize`, la notificación de inicialización y `tools/list` después de emitir el token. HTTP `200` también puede acompañar un `error` de JSON-RPC. `remote_mcp.rpc_result` registra estado HTTP, clasificación del resultado, versión del protocolo, número de herramientas, bytes de respuesta y forma básica de la lista. El búfer de inspección se limita a 256 KiB. Al superarlo, solo se registra `inspection_limited` y la respuesta se conserva intacta. Una respuesta SSE o una solicitud `GET` que devuelve `405` no bastan para diagnosticar un fallo. Revisa `Accept`, `Content-Type`, la negociación del protocolo y la llegada de peticiones desde el proxy. Comprueba por separado en producción el OIDC externo, las políticas de Cloudflare y una cuenta real de ChatGPT.

## Resultados y recursos MCP {#mcpの結果とresource}

> [!DETAILS] Especificaciones y procedimientos
>
> Las respuestas de Remote MCP tienen tres capas.
> 1. **`content` estándar.** Incluye IDs de entrada y trabajo, estado, desplazamiento, cursor, disponibilidad y diagnósticos acotados para tomar decisiones y llamar a la siguiente herramienta. Incluso los clientes sin `structuredContent` ni recursos personalizados pueden crear, corregir y volver a renderizar.
> 2. **`structuredContent`.** Contiene el objeto validado completo para procesamiento automático.
> 3. **Recursos MCP (`latex-renderer://jobs/...`).** Contienen datos voluminosos como el PDF, `compile.log` completo, JSON sin procesar, `svg/manifest.json` y `svg/objects/*.svg`. Solo el mismo propietario OAuth puede leerlos. Se aplican los mismos límites de tamaño y conservación que a los archivos normales. Todas las capas excluyen claves de API, tokens OAuth, tickets, texto fuente y base64 sin procesar.

## Espera y reintentos de la CLI {#cliの待機と再試行}

> [!DETAILS] Especificaciones y procedimientos
>
> Si al consultar el estado se recibe un HTTP transitorio `502`, `503`, `504` o JSON no válido, la CLI repite solo la consulta del mismo trabajo, **hasta 5 veces**, con esperas de 1, 2, 4, 8 y 8 segundos sin ampliar el tiempo total. No se repiten automáticamente la creación de trabajos, la carga, la renovación de tokens ni la verificación de archivos. Los errores de autenticación y permisos se devuelven de inmediato. Que la CLI deje de esperar no implica que el servidor haya detenido el trabajo.

## Formato JSON de la CLI {#cliのjson形式}

> [!DETAILS] Especificaciones y procedimientos
>
> Con `--json` se usan los siguientes formatos de salida estándar. Se excluyen la clave de API, `uploadTicket` y `jobTicket`.
>
> - **Éxito (código de salida `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **Error de CLI o API (código de salida `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **Trabajo finalizado con error, como un fallo de LaTeX (código de salida `2`).** `result` contiene los datos del trabajo y las rutas guardadas. La respuesta incluye `success: false`.

## Migración y recuperación de versiones anteriores {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　Migrar un actualizador antiguo y solucionar errores de extracción
>
> ### Migrar del actualizador root v1.2.x al actualizador con separación de privilegios {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Hasta v1.2.x, Update Manager se ejecutaba como demonio root. Desde v1.3.0, el controlador permanente se ejecuta como `latex-renderer-update` y un proceso auxiliar root de corta duración acepta operaciones fijas. Una actualización web desde el actualizador antiguo puede detenerse con `Application Update Manager must use a separate non-root build tree`. No repitas la misma operación web.
>
> Para esta migración única, usa la [distribución de servidor v1.3.6](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6). Como usuario normal, sigue [Descargar y verificar la distribución](/es/docs/self-hosting/#v1-6-9をダウンロードして検証) cambiando la primera línea `version=` por `version=1.3.6`. Usa la misma terminal para conservar el `bundle_root` obtenido durante la verificación y extracción.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> El script vuelve a descargar como root la misma versión inmutable y verifica digest, etiqueta/commit, paquete Sigstore, límites del archivo y metadatos. Solo acepta `gh` en `/usr/local/bin/gh` o `/usr/bin/gh`, propiedad de root y sin escritura para grupo u otros. Separa los árboles `verified` de root, `bootstrap-build` sin root (pnpm fijado mediante un intermediario Corepack dedicado) y `assembly` de root. Solo detiene el gestor anterior después de obtener el bloqueo compartido de cambios y lo reinicia si falla. Al finalizar, verifica `User=latex-renderer-update` y el estado `active` de cada servicio con los comandos siguientes. Después usa los mecanismos normales de actualización web o Admin CLI.
> La web y la API no reciben privilegios sudo ni tokens de GitHub.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar detiene la extracción con Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> En Ubuntu, si GNU `tar` usa `openat2`, la restricción `RestrictSUIDSGID=true` del actualizador puede detener la extracción de archivos con subdirectorios con `ENOSYS` (Function not implemented). El actualizador corregido conserva la inspección con GNU `tar` y la verificación de firmas. Solo la extracción pasa a `/usr/bin/bsdtar`, en una carpeta temporal privada vacía, sin importar propietarios, ACL ni atributos extendidos. Se mantiene `RestrictSUIDSGID` y se conserva el `tar` del sistema.
>
> El actualizador antiguo también puede fallar al extraer su propia corrección. Comprueba que no haya operaciones activas, que la aplicación y la base de datos estén sanas y que se haya verificado una copia cifrada. Usa el `bootstrap-v1` instalado para **actualizar primero únicamente el actualizador independiente** a una versión publicada que incluya la corrección.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> Comprueba la nueva versión del actualizador y los valores `ready` y `pending=false`. Aplica después esa misma versión a la aplicación mediante la web o el comando normal `update apply` de Admin CLI.
>
> El actualizador `v1.4.0-rc.3` tiene un problema conocido: la copia del paquete realizada por root conserva el propietario sin privilegios y falla con `Release extraction requires a private regular bundle`. Mantén las comprobaciones, actualiza primero el actualizador a una versión publicada con la corrección de propiedad y después aplica la aplicación. Puedes probar la extracción bajo root y systemd de manera independiente con `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`.

> [!DETAILS] Investigar bloqueos de actualizaciones o cambios TeX
>
> ### El bloqueo de cambios está en uso {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY` impide que se solapen una actualización de la aplicación y un cambio de TeX. Espera a que termine la operación activa. **Nunca elimines el archivo `/run/latex-renderer/mutation.lock`.** Si lo haces, pueden coexistir dos bloqueos independientes. Si ocurre al restaurar internamente un entorno TeX durante una actualización, puede tratarse de contención con la propia operación. Revisa registros y servicios detenidos antes de repetir.
>
> Solo si no hay operaciones en curso y el registro confirma que la anterior terminó, detén ambos gestores e inspecciona el proceso que conserva el bloqueo.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> Termina ese proceso y reinicia los gestores únicamente si has confirmado que es un auxiliar de bloqueo huérfano de una operación finalizada.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## Identidad del renderizador en versiones candidatas anteriores {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　Candidatas de v1.3.4
>
> La actualización de `v1.3.4-rc.3` a `v1.3.4-rc.4` falló antes del cambio de servicios al pasar de 5 a 6 los archivos incluidos en el hash de identidad del renderizador. Para esa migración, usa `v1.3.4-rc.5`, que incluye también los datos de compatibilidad anteriores. La suma de comprobación del paquete completo y la firma de procedencia verifican también el archivo añadido.

## Entornos de ejecución del actualizador {#updaterの実行領域}

> [!DETAILS] Especificaciones y procedimientos
>
> Update Manager separa estrictamente el árbol `verified` de root con la distribución verificada, `build` sin root para instalar dependencias y compilar y `assembly` de root con los resultados permitidos. Los scripts de despliegue ejecutados por root siempre usan la copia verificada de `assembly`. Para pasos como la publicación en Cloudflare con el usuario de despliegue, se usa una copia temporal `deployment-build` tras las comprobaciones de root. Lo mismo se aplica al revertir.

## Rutas de instalación y protección en Windows {#windowsの配置と保護}

> [!DETAILS] Especificaciones y procedimientos
>
> Al cambiar la ubicación de instalación en Windows, el directorio predeterminado de comandos pasa a su subcarpeta `bin`. Si defines `LATEX_RENDER_BIN_DIRECTORY`, los lanzadores administrados se colocan allí y comparten la ruta entre PATH del usuario y Local MCP. Se conservan lanzadores alternativos. `setup repair` puede corregir la ruta registrada anteriormente. La entrada antigua de PATH se conserva para otras aplicaciones. Usa rutas absolutas sin puntos y coma, comillas ni caracteres de control. Si `--open` o la interfaz gráfica no consiguen abrir el navegador o visor, se conserva el PDF guardado.

## Proyectos compartidos y conservación {#保存プロジェクトの共有-保持}

> [!DETAILS] Reglas para compartir y conservar
>
> - La web (`/app/`), la CLI, la API pública, Local MCP y Remote MCP comparten los proyectos y el historial de revisiones inmutables de cada usuario. Varias claves de API o cuentas de servicio del mismo usuario pueden verlos y actualizarlos. También puedes usar entradas y trabajos temporales sin guardarlos en un proyecto.
> - La combinación de entrada, documento principal, motor y formatos de salida identifica la revisión. Revisiones con salidas distintas pueden compartir la entrada. Los formatos elegidos en **Convertir de nuevo** solo se aplican a esa ejecución. Selecciona la configuración inicial para usar las salidas guardadas en la revisión.
> - Una entrada referenciada por una revisión activa se conserva aunque venza su plazo como huérfana y cuenta para la cuota del usuario. Eliminar un proyecto oculta su registro. Al eliminarse el último proyecto que la referencia y desaparecer los trabajos asociados, la entrada pierde la protección y se eliminará en la limpieza periódica una vez caducada. Para un borrado completo inmediato, contacta con el administrador.

## Idioma de la interfaz {#表示言語}

El editor guarda **Idioma de la interfaz** en la cuenta. Si no está definido, recorre los idiomas del navegador y usa el inglés cuando ninguno sea compatible. El motor y la codificación del documento se configuran por separado.

| Área | Cobertura de traducción |
| --- | --- |
| Web y configuración | Acciones, estado, confirmaciones y diagnósticos. |
| CLI y MCP | La ayuda y los avisos de la CLI usan el idioma del terminal. Las descripciones de MCP remoto usan el idioma de la cuenta. |
| Editor | La edición, búsqueda y reemplazo, guardado y conflictos, estados de compilación y controles de vista previa están disponibles en 18 idiomas. |
| Guías públicas | Todas las guías están disponibles en los 18 idiomas indicados abajo. Cambia de idioma en el menú de la parte superior. |

El editor admite inglés, japonés, chino simplificado, coreano, español, portugués, francés, alemán, italiano, ruso, turco, polaco, checo, neerlandés, sueco, noruego bokmål, danés y finés. Los registros de TeX y de paquetes externos mantienen el texto original para facilitar el diagnóstico.

## Recuperar los registros de auditoría {#監査ログの復旧}

Tras restaurar la base de datos, la posición de exportación (`export_database_id`, secuencia de fila `export_sequence` y `export_token`) puede dejar de coincidir con su estado. En ese caso se detienen la exportación y la limpieza para proteger los datos.

1. Detén los servicios y temporizadores de exportación y limpieza durante la investigación y la recuperación.
2. Conserva por separado la base de datos restaurada, las exportaciones cifradas existentes y todos los archivos de puntos de control actuales y antiguos. Verifica integridad, claves externas y estado de migración de la base restaurada.
3. Si no hay un punto de control compatible y decides volver a exportar los registros presentes, mueve los archivos de control fuera de las rutas activas. Comprueba también la ruta de `AUDIT_EXPORT_CHECKPOINT` si está definida. Conserva las filas de auditoría, las secuencias SQLite y `export.lock`.
4. Ejecuta una exportación manual con las credenciales del servicio de producción. Comprueba que se puede descifrar la salida y que se ha generado un punto de control nuevo de formato 3 antes de reiniciar los temporizadores.

Solo se volverán a exportar las filas presentes en la base de datos restaurada. Para cotejar duplicados utiliza conjuntamente `export_database_id`, `export_sequence` y `export_token`. La fecha y hora por sí solas no identifican una fila.
