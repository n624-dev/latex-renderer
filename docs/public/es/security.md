---
slug: security
category: Solución de problemas y seguridad
title: Seguridad de cuentas y documentos
description: Protege las credenciales y los archivos enviados y conoce los límites de acceso del renderizador y la administración.
navOrder: 71
updated: "2026-11-22"
since: "v1.0.0"
---

- Si se filtra una clave de API, pide de inmediato al administrador que la revoque y emita otra.
- Comunica las vulnerabilidades mediante el [formulario privado de GitHub](https://github.com/n624-dev/latex-renderer/security/advisories/new). Evita publicar los detalles en una incidencia pública.

## Credenciales {#資格情報}

- No incluyas claves de API en argumentos de línea de comandos (visibles con `ps`, entre otros), URL, repositorios Git, registros ni conversaciones con asistentes de IA.
- Para almacenarlas localmente, usa DPAPI en Windows o un archivo con modo `0600` que solo pueda leer su propietario en Linux y macOS.
- Usa las contraseñas del navegador, secretos OIDC y cookies de sesión únicamente para su finalidad. Mantén separadas las claves de CLI y API (`lrk_` y `lra_`).

## Proyectos {#プロジェクト}

El sistema trata todas las fuentes LaTeX y los adjuntos como entradas no fiables. Desactiva los enlaces simbólicos, el acceso al intérprete desde TeX, la ejecución de comandos externos y las conexiones de red fuera del contenedor. Respeta el aislamiento, los tiempos máximos y los límites de archivos.

## Áreas públicas y de administración {#公開領域と管理領域}

La documentación y las descargas públicas, las páginas autenticadas (`/app/` y `/admin/`) y la API de renderizado tienen rutas separadas en un único origen HTTPS canónico.

- **Límite de red.** El único punto de entrada del perfil Cloudflare es Tunnel/Workers. En el perfil standalone es un proxy inverso TLS. Todos los servicios de la aplicación escuchan en la interfaz de bucle local. La API interna, SQLite y los sockets de administración se mantienen privados. Las áreas autenticadas se excluyen de los índices de buscadores.
- **Autenticación y sesiones del navegador.** La identificación por IdP externo requiere que `provider + issuer + subject` coincida exactamente. El correo y el nombre visible no vinculan cuentas automáticamente. El servidor puede revocar una sesión de inmediato. Las solicitudes que cambian el estado exigen una coincidencia exacta de `Origin` y un token CSRF propio de la sesión. Las contraseñas se protegen con `scrypt` y un secreto adicional (pepper) propiedad de root. En instalaciones públicas, aplica además límites de conexiones y frecuencia en el proxy y protección DDoS del proveedor.
- **Remote MCP.** `/mcp`, el endpoint de tokens OAuth y los metadatos de descubrimiento son accesibles públicamente. La ejecución de herramientas requiere un token Bearer de corta duración con audiencia y alcance restringidos. La autorización usa la sesión del navegador de `/app/` y vincula el acceso explícitamente a un usuario existente y activo.
  - La respuesta estándar (`content`) incluye solo identificadores limitados al propietario, estados, cursores y diagnósticos acotados necesarios para continuar. Las rutas y diagnósticos de origen usuario se devuelven como datos no fiables, sin caracteres de control y con límites de longitud y cantidad.
  - El contenido estándar `content` y los registros de diagnóstico excluyen tokens OAuth, claves de API, tickets, base64 sin procesar, fuentes completas, registros íntegros, trazas de pila, identidades subject de Access y rutas internas del servidor. Los PDF y registros completos solo están disponibles mediante lecturas de recursos que vuelven a comprobar la propiedad.

## Interfaz web de configuración local {#local-setup-web-ui}

`n624-latex setup --gui` (antes `latex-render setup --gui`) escucha solo en un puerto aleatorio de `127.0.0.1` en el equipo local.

- El fragmento (`#...`) de la URL que abre la CLI contiene un token de inicio de un solo uso. El navegador lo borra inmediatamente del historial y lo cambia por una sesión de corta duración.
- Todas las operaciones de la API requieren coincidencia exacta de `Origin`, una sesión Bearer y un token CSRF independiente. Se desactiva CORS, se verifican Host y la dirección de bucle local del cliente y se aplican una CSP estricta, `frame-ancestors 'none'` y `no-store`.
- La clave introducida se entrega únicamente a la operación de guardado y se excluye de las respuestas de estado, diagnóstico y conversión de prueba. La interfaz se cierra tras 30 minutos de inactividad o 2 horas desde el inicio.
