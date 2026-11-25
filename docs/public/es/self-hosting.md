---
slug: self-hosting
category: Alojamiento propio
title: Administrar LaTeX Renderer en tu servidor
description: Elige una configuración compatible, prepara el host e instala el servicio con actualizaciones y copias de seguridad.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Opciones de instalación {#現在の提供状況}

Puedes montar un servidor instalando el [paquete APT](/es/docs/client/#debian-ubuntu-の-apt-パッケージ) y ejecutando el asistente. Este configura HTTPS, el método de acceso y el primer propietario.

### Orden de instalación inicial {#初回導入の順序}

1. **Prepara el servidor.** Comprueba los [sistemas y vías de acceso compatibles](#対応する構成) e [instala Docker Engine y Nginx](#準備するもの).
2. **Instala el paquete APT.** Sigue las [instrucciones para Debian y Ubuntu](/es/docs/client/#debian-ubuntu-の-apt-パッケージ) para instalar `n624-latex`.
3. **Configura el servidor.** Desde una cuenta de despliegue sin privilegios de root, ejecuta `sudo n624-latex server setup --plan`. Resuelve los requisitos pendientes y continúa con la [configuración en el navegador](/es/docs/server-setup/#ブラウザで開く).
4. **Crea tu primer PDF.** Abre la URL HTTPS establecida, [inicia sesión y convierte un documento de prueba](#導入完了の確認). El asistente prepara el primer entorno TeX.

Para un servidor existente, consulta [Actualizar desde administración](/es/docs/updates/). Para instalar desde un tarball, sigue las [instrucciones manuales](#v1-6-9をダウンロードして検証).

## HTTPS automático en la LAN {#lan-内の自動-https}

**Akebi** permite configurar una URL HTTPS derivada de la IP privada del servidor. Puedes empezar con el servicio compartido de certificados. Consulta [Usar HTTPS en la LAN con Akebi](/es/docs/lan-https/).

## Configuraciones compatibles {#対応する構成}

APT permite instalaciones nuevas en un único host con `systemd` que ejecute Debian 12 o 13, o Ubuntu 24.04 o 26.04, en amd64 o arm64. La compilación LaTeX usa Docker sin root con un usuario dedicado.

| Modo de despliegue (`DEPLOYMENT_MODE`) | Vía de entrada | Métodos de acceso |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache o HTTPS en la LAN (Akebi) | Contraseñas locales, OIDC o ambos |
| `cloudflare` | Cloudflare Tunnel y un Worker | Cloudflare Access o autenticación nativa (contraseñas, OIDC o ambos) |

- **OIDC.** Permite usar el proveedor de identidad (IdP) de tu organización.
- **Cloudflare Access.** Prepara una aplicación Access para los usuarios en Cloudflare.
- **Contraseñas locales.** Registra los usuarios desde la administración del servidor sin un IdP externo.
- **Contraseñas y OIDC.** Activa ambos mediante la autenticación nativa con `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` y `AUTH_OIDC_ENABLED=true`. Para configuraciones anteriores de un único método, usa `AUTH_MODE`.

## Preparar el servidor {#準備するもの}

- **Cuenta de trabajo.** Conéctate con una cuenta sin privilegios de root y ejecuta los comandos de configuración con `sudo`.
- **Disco.** La comprobación inicial exige **al menos 5 GiB libres** en cada sistema de archivos que contenga `/opt` o `/var/lib`. Reserva espacio adicional para imágenes TeX, versiones, resultados y copias cifradas.
- **Docker Engine.** Instala Docker Engine y `docker-ce-rootless-extras` desde el repositorio oficial. El asistente configura Docker sin root para la compilación. Consulta las instrucciones oficiales para [Debian](https://docs.docker.com/engine/install/debian/) o [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Instálalo con `sudo apt install nginx`. Las instalaciones APT nuevas comprueban que Nginx esté instalado incluso si expones el servicio mediante Caddy, Apache o Cloudflare.
- **Acceso y TLS.** Para HTTPS propio prepara nombre de host, certificado y clave privada, y deja libres la dirección y el puerto para el HTTPS integrado. Para Cloudflare prepara el Tunnel, el DNS y el Worker. Consulta los [requisitos de HTTPS en la LAN](#lan-内の自動-https).
- **Credenciales**
  - OIDC necesita la URL del emisor, ID y secreto de cliente y el `subject` estable del primer propietario.
  - Cloudflare Access necesita los datos de la aplicación Access y el `subject` del propietario.
  - Para contraseñas, prepara el nombre de acceso y la contraseña inicial del propietario.
- **Conectividad de salida.** El servidor debe poder acceder mediante HTTPS a GitHub Releases y Attestations, GHCR (`ghcr.io`), los archivos de TeX Live y los repositorios de paquetes de Debian o Ubuntu.
- **Paquete APT.** Incluye Node.js. Consulta las [instrucciones de APT](/es/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Verificar la instalación {#導入完了の確認}

1. Abre `/admin/` en la URL HTTPS configurada e inicia sesión como el propietario registrado durante la instalación.
2. Abre `/app/` en la misma URL, selecciona el [`main.tex` de ejemplo](/es/docs/#最短でpdfを作る) y pulsa **Convertir a PDF**.
3. Abre el PDF de la página de resultados y comprueba que muestre el texto del ejemplo.

> [!DETAILS] Verificaciones adicionales de servicios y salidas
>
> Los administradores pueden hacer una prueba de conversión a través de la URL pública. La clave de API emitida por la prueba se revoca inmediatamente después.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> También puedes verificar el acceso de un usuario normal, las guías públicas, los idiomas e imagen que figuran en el entorno TeX y salidas de uso habitual como documentos en japonés o SVG.

### Registrar usuarios y emitir claves {#利用者と-api-キーの発行}

Cuando puedas iniciar sesión como propietario en `/admin/`, registra los usuarios.

- **Web y Remote MCP.** Crea el usuario en **Usuarios**, registra su identidad para el método de acceso elegido y facilítale la URL de la aplicación web.
- **CLI, Local MCP y API HTTP.** Crea una cuenta de servicio vinculada al usuario. En **Claves de API → Emitir clave de API**, emite una clave de renderizado con `render:create` y `render:read:own` (prefijo `lrk_...`) y entrégala por un canal seguro.

## Actualizaciones y reversión {#更新とロールバック}

### Actualizar la aplicación {#アプリケーションを更新する}

- Como propietario, abre **Administración → Actualizaciones**. Consulta [Actualizar el servidor o volver a una versión anterior](/es/docs/updates/).
- Para cambiar la versión o idiomas de TeX Live, abre **Administración → Entorno TeX**. Consulta [Configurar el entorno TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Migración y recuperación especial
>
> ### Migrar el actualizador root v1.2.x a la separación de privilegios {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> Consulta las [instrucciones de migración del actualizador](/es/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar detiene la extracción con Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Consulta el [procedimiento para errores de extracción](/es/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### El bloqueo de cambios está en uso {#mutation-lockが使用中と表示される場合}
>
> Consulta cómo [identificar el proceso que conserva el bloqueo](/es/docs/reference/#mutation-lockが使用中と表示される場合).

## Copias de seguridad {#バックアップ}

Para las copias periódicas, los puntos previos a una actualización, las pruebas de restauración y la recuperación, consulta [Crear, verificar y restaurar copias](/es/docs/backups/). Si tras restaurar no coincide la posición de exportación de auditoría, consulta [Recuperar registros de auditoría](/es/docs/reference/#監査ログの復旧).

## Solución de problemas {#問題が起きた場合}

| Síntoma | Qué comprobar primero |
| --- | --- |
| No se puede acceder a `/app/` | DNS, certificado TLS, configuración del Tunnel o proxy y orden de inicio de servicios locales |
| Solo los administradores no pueden entrar | Identidad o credencial explícita del propietario, `AUTH_MODE`, emisor, audiencia y roles |
| No se puede obtener la imagen TeX | Acceso HTTPS a `ghcr.io`, visibilidad del paquete y arquitectura de la etiqueta |
| Un cambio de TeX tarda mucho | ID de operación y registros de Image Manager con datos sensibles ocultos |
| Se rechaza una actualización | Inmutabilidad de la versión, digest del archivo, ruta de actualización y espacio disponible |
| La preparación del host se detiene por una ruta insegura | Comprueba que `/var/lib/latex-renderer` pertenezca a `root:latex-renderer` y tenga modo `2770` |
| Solo falla la pantalla de actualizaciones | Presencia de `client-dist/manifest.json` en la distribución y estado de Admin Web |
| No empieza la conversión | Estado de la cola, 5 GiB de espacio libre como mínimo, servicio del trabajador y socket de Docker sin root |
| Aparecen problemas justo después de actualizar | Detén la admisión de trabajos nuevos y comprueba las versiones anterior y nueva de aplicación y entorno antes de decidir si revertir |

Anota el ID de la operación, la fase del fallo y un código de error que puedas compartir. Consulta [Solución de problemas](/es/docs/troubleshooting/), [Seguridad de cuentas y documentos](/es/docs/security/) y [Configuración del despliegue y archivos de configuración (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Cambiar el entorno TeX {#tex環境の初期設定}

La configuración inicial prepara el entorno de compilación. Para añadir idiomas o cambiar la versión de TeX Live, abre **Administración → Entorno TeX** (`/admin/tex-environment/`). El siguiente ejemplo admite inglés y japonés.

| Ajuste | Valor recomendado |
| --- | --- |
| Image | `latest` (para etiquetas con fecha fija, elige una compatible con tu arquitectura) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (desactivado por defecto) |

- Del paquete público de GHCR solo se descarga la **imagen base** sin idiomas, que se fija por digest. El servidor crea una **imagen de ejecución** con los idiomas seleccionados y el código actual del renderizador. Si hay una imagen local con la misma configuración, se reutiliza. Las imágenes de ejecución no se publican externamente.
- La compilación continúa aunque cierres el navegador. Después comprueba el entorno activo y los idiomas en administración. Si falla la descarga, verifica el acceso HTTPS a `ghcr.io` y la compatibilidad de arquitectura.

### Limpieza automática del disco {#自動容量整理}

> [!DETAILS] Limpieza de imágenes no utilizadas y caché de compilación
>
> Por defecto, Image Manager limpia las imágenes administradas sin usar cada 24 horas. Protege la base y el entorno actuales y los anteriores para reversión, además de las imágenes referenciadas en configuración. El resto puede eliminarse 24 horas después de crearse. La limpieza toma 2 GiB como referencia para la caché de compilación sin usar, sin imponer un límite a todo Docker.
>
> Ajusta los valores en `/etc/latex-renderer/renderer.env` y aplícalos con `sudo systemctl restart latex-renderer-image-manager.service` cuando no se esté actualizando TeX.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` acepta `0` para desactivar la limpieza o un intervalo de `1` a `720` horas. Desde 5 minutos después de iniciar, se comprueba cada 5 minutos si toca limpiar. Un bloqueo común aplaza la limpieza durante actualizaciones y despliegues. La limpieza manual desde web o CLI retira elementos no protegidos sin esperar al plazo de conservación.
> - `RETENTION_HOURS` admite de `0` a `8760` horas y `BUILD_CACHE_MAX_GIB`, de `0` a `1024` GiB.
> - Desde `1.3.4-rc.2`, los metadatos Buildx de Docker sin root se aíslan en `.docker/buildx-worker` dentro del directorio personal del trabajador para evitar problemas de permisos con compilaciones root. La limpieza automática omite imágenes de configuraciones antiguas y directorios de recuperación manual. Borra elementos individuales solo después de comprobar que sobran. Nunca elimines directamente el directorio de datos de Docker.

## Privilegios de instalación y operación {#sudoと通常運用の境界}

La instalación inicial prepara usuarios de sistema, directorios, unidades `systemd`, Docker sin root y archivos de claves con `sudo`. **Durante la operación normal, la web y la API de administración no reciben privilegios `sudo`.**

- **Cambios en TeX.** Se solicitan al Image Manager propiedad de root a través de un socket Unix de permisos restringidos.
- **Actualizaciones.** Un socket Unix comunica con el controlador de Update Manager sin root, que delega operaciones fijas a un auxiliar root de corta duración.
- **Exclusión mutua.** Un bloqueo compartido serializa cambios TeX y actualizaciones. Desde la web y la API no se pueden pasar comandos, rutas ni URL arbitrarios a root.

## Configuración y secretos {#設定と秘密情報}

Los ajustes propios del host y sus secretos se almacenan fuera de la aplicación y del árbol de trabajo de Git, por ejemplo en `/etc/latex-renderer/`.

| Ruta | Contenido | Modo recomendado |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Perfil de acceso, URL, límites y configuración no secreta del IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Identificadores y tokens exclusivos del perfil Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Cuenta de despliegue sin root | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Vinculaciones y rutas del Worker de producción | `0600` |
| `/etc/cloudflared/config.yml` | Ingreso de Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, clave de tickets y credenciales de gestores | Según el archivo |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Secreto de cliente del perfil OIDC | `0440` |

> [!WARNING]
> No subas a Git ni pegues en incidencias o peticiones de ayuda archivos `.env`, tokens Cloudflare, credenciales de Tunnel, claves de API, bases SQLite, documentos, PDF o registros reales sin editar. Los `*.example` del repositorio son plantillas para consultar los campos.

## Instalación manual desde tarball y versiones anteriores {#手動配置-旧版向けの構築手順-tarball-導入}

Con APT y `sudo n624-latex server setup`, el asistente lleva a cabo o guía la extracción, la preparación del host y el registro del propietario. Abre lo siguiente si despliegas manualmente `v1.7.1` o necesitas revisar los límites de acceso o el cambio de autenticación.

> [!DETAILS] Descargar, verificar, desplegar y registrar al propietario con v1.7.1
>
> Para una instalación manual nueva usa la versión estable [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1), archivo `latex-renderer-server-1.7.1.tar.gz`. Su etiqueta y archivos son inmutables tras publicarse. El despliegue directo desde la rama de desarrollo `main` y el `docker build` local de TeX quedan fuera de la operación admitida.
>
> ### Descargar y verificar v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Prepara `curl`, `jq`, `tar`, `sha256sum` y una CLI de GitHub compatible con `gh attestation verify`. Node.js y Corepack se instalan al preparar el host más adelante.
>
> Como usuario normal, ejecuta lo siguiente en la misma sesión Bash. Se verifican tanto el SHA-256 de GitHub Releases como la firma de procedencia de GitHub Actions. Los datos de procedencia se pasan desde la API pública a `gh`, sin cuenta ni token de GitHub. Si falla un paso, `bundle_root` queda sin definir. Corrige la causa y vuelve a intentarlo.
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
> ### Preparar el host {#ホストを準備}
>
> Instala `setfacl` para permisos de almacenamiento, `bsdtar` para extraer dentro del actualizador restringido y `unzip` para comprobar ZIP. Sigue las instrucciones oficiales para instalar Node.js 26 o 24 (`/usr/local/bin/node` y `/usr/local/bin/corepack`) y las herramientas de Docker sin root. Para `cloudflare` instala también `cloudflared`. Update Manager instala y verifica con Corepack el pnpm indicado para el usuario de despliegue.
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
> Desde la cuenta habitual de despliegue, inicializa el host y configura Docker sin root para `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Crear la configuración propia del host {#ホスト固有設定を作成}
>
> Crea `renderer.env` en todos los perfiles y configura `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` y `AUTH_MODE`. No existe un alias como `ADMIN_ALLOWED_ORIGINS`. El origen permitido para las operaciones del navegador debe coincidir exactamente con `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Perfil `cloudflare`.** Sustituye `example.com`, `REPLACE_*`, todos los UUID y la audiencia de Access por valores de tu instalación. Para un Tunnel administrado remotamente, omite el `config.yml` local y confirma antes que el conector esté activo.
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
> - **Perfil `standalone`.** Instala Nginx, Caddy o Apache, copia un ejemplo de `deploy/reverse-proxy/` e indica el FQDN y las rutas de certificados. El proxy elimina cabeceras `CF-Access-*` entrantes y sobrescribe la IP del cliente. No vincules directamente al exterior los servicios locales de los puertos 3100 a 3105.
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
> - **Con `AUTH_MODE=oidc`.** Registra `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` en el IdP. En `renderer.env` configura `OIDC_ISSUER` y `OIDC_CLIENT_ID` y guarda el secreto en un archivo separado sin salto de línea final.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Desplegar los servicios {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - El arranque inicial vuelve a descargar y verificar el archivo inmutable publicado, separa el árbol de control de root del árbol de compilación sin privilegios, construye `client-dist` y lo despliega en `/opt/latex-renderer/releases/$release_id`. Rechaza equipos con una base de datos o un `current` existente. Después de instalar, usa la actualización normal.
> - Antes del despliegue comprueba `renderer.env` (propiedad de root, modo `0640`, sin claves duplicadas), `PUBLIC_ORIGIN`, los ajustes de autenticación y la propiedad, permisos y longitud del pepper y los secretos, sin mostrar sus valores.
> - El actualizador se conserva por separado en `/opt/latex-renderer/updater`, como describe `docs/independent-updater.md` en el repositorio. Solo el grupo principal del usuario de despliegue puede atravesar `/opt/latex-renderer/update-staging`. Cada etapa está aislada con `0700` y se limpia al terminar o, si se interrumpe, en un arranque posterior transcurridas 24 horas.
>
> ### Límites del acceso público {#公開境界}
>
> - **`cloudflare-access`.** Protege `/auth/*`, `/app/`, `/admin/` y `/oauth/authorize` con la misma aplicación Access para usuarios humanos y verifica la audiencia también en el origen. Con Cloudflare y OIDC o contraseña, evita que Access bloquee `/auth/*`. La documentación y las descargas son públicas. Las Worker Routes atienden solo la parte pública de la API de renderizado. Ordena el ingreso del Tunnel con rutas concretas de API y administración, después la web por defecto y finalmente `http_status:404`.
> - **`standalone`.** Un proxy inverso TLS distribuye por ruta a los servicios locales. Solo las operaciones pequeñas de tickets JSON pasan al Standalone Gateway en el puerto 3105. El ejemplo Nginx limita conexiones y frecuencia de acceso por contraseña y de la API de tickets. Caddy y Apache sin extensiones carecen de un límite equivalente por cliente, por lo que es obligatorio aplicarlo en un balanceador o en el proveedor. Mantén privados `/internal/*`, la base de datos y los sockets de gestión.
>
> ### Primer propietario {#最初のowner}
>
> La identidad externa se determina por `provider + issuer + subject` y la de contraseña por `login name`. El correo solo se muestra. No se vinculan cuentas por coincidencia de correo ni se crean automáticamente al acceder. Ejecuta una sola vez el procedimiento del método elegido.
>
> **Cloudflare Access u OIDC**
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
> **Contraseña local (ejemplo con nombre `owner`)**
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
> ### Cambiar AUTH_MODE más adelante {#後からauth-modeを変更する場合}
>
> Usa este procedimiento cuando no esté disponible el [asistente del servidor](/es/docs/server-setup/).
> Crea una copia cifrada y detén la API de administración. Con el ID inmutable obtenido en administración o mediante `users list` (formato `user_...`), añade el nuevo método de autenticación. Se rechaza sobrescribir una credencial existente y se revocan las sesiones actuales. Modifica después `renderer.env` y reinicia la API y la web. Conserva las credenciales anteriores hasta verificar el nuevo inicio de sesión en una ventana privada.
>
> Ejecuta primero la preparación que sigue y después solo los comandos del método de destino.
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
> **Para pasar a OIDC o Cloudflare Access**, introduce `oidc` o `cloudflare-access`.
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
> **Para pasar a contraseña**, introdúcela en el campo oculto.
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
