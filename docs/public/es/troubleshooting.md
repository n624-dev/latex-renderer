---
slug: troubleshooting
category: Solución de problemas y seguridad
title: Solución de problemas
description: Diagnostica fallos de inicio de sesión, instalación, conversión y descarga.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Por dónde empezar {#確認する順序}

1. **Consulta el [estado del servicio](/status/)** para comprobar si hay una incidencia general o un mantenimiento.
2. **Comprueba el trabajo existente.** Si ya iniciaste una conversión, abre el mismo trabajo en **Historial** o ejecuta `n624-latex jobs get <jobId>` en la CLI.
3. **Revisa los diagnósticos y el registro.** En la web, abre los diagnósticos de la página de resultados. En la CLI, consulta `.render/errors.json` y el registro detallado `.render/compile.log`.

## Problemas frecuentes {#代表的な問題}

### Instalación e inicio de sesión {#インストール-ログイン}

- **No se encuentra `n624-latex` o `latex-render`.**
  Abre una terminal o ventana de PowerShell nueva. Si persiste, revisa [PATH en Linux o macOS](/es/docs/client/#linux-macos) o las [instrucciones de instalación en Windows](/es/docs/windows/#インストール).
- **No puedes iniciar sesión en la aplicación web.**
  Usa la cuenta registrada y el método indicado por el administrador (contraseña, OIDC o Cloudflare Access). Para una conexión bloqueada desde ChatGPT o Claude, consulta [Comprobar la conexión de Remote MCP](/es/docs/mcp/#chatgptなどの接続を確認する).
- **La CLI devuelve `401` o `403`.**
  Ejecuta `n624-latex auth status` para comprobar la clave registrada. Pide al administrador que confirme que está activa y tiene los permisos `render:create` y `render:read:own`. Si hace falta, [vuelve a registrar la clave](/es/docs/cli/#認証). Para un servidor propio, comprueba también la [URL del servidor (`LATEX_RENDER_BASE_URL`)](/es/docs/cli/#接続先サーバー).

### Carga y conversión {#アップロード-変換}

- **No se encuentra el documento principal en el ZIP.**
  La entrada predeterminada es `main.tex` en la raíz. Comprueba si incluiste la carpeta superior o especifica la ruta relativa del documento. Consulta [Cómo preparar el ZIP](/es/docs/projects/#構成).
- **Se rechaza el tamaño o la extensión de un archivo.**
  Retira archivos generados innecesarios o no admitidos, o configura `.latexrenderignore`. Revisa los [archivos admitidos y límites](/es/docs/projects/#制限).
- **La conversión sigue en cola o se pierde la conexión.**
  Es posible que el servidor siga procesándola. Vuelve a abrir la misma página de resultados o consulta el mismo ID de trabajo antes de crear otro.
- **Faltan paquetes o fuentes, o se agota el tiempo.**
  Busca los nombres disponibles en el [entorno de renderizado](/app/environment/). Si se agota el tiempo, revisa macros complejas, imágenes grandes y diagramas TikZ cerca del punto en que se detuvo el registro.

### Descargar archivos {#成果物の取得}

- **Hay un PDF pero no SVG.**
  Si aparece **Éxito parcial**, guarda primero el PDF y selecciona **Reintentar solo SVG**. Consulta [Reintentar la extracción de SVG](/es/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **La vista previa PNG sigue en preparación.**
  Espera un poco o vuelve a abrir la misma página. El PDF definitivo se puede descargar sin esperar.
- **El destino está en uso o aparece `OUTPUT_BUSY`.**
  Cierra el visor que tenga abierto el PDF de salida o espera a que termine el proceso que escribe en esa carpeta y vuelve a descargar.
- **Resultado caducado o almacenamiento insuficiente.**
  Para un resultado caducado, vuelve a convertir la revisión guardada o los archivos locales. Si alcanzaste tu cuota, elimina trabajos terminados que ya no necesites. Si el disco del servidor está lleno, avisa al administrador.

## Solicitar ayuda {#問い合わせ}

- **Administrador del servidor.** Facilita la hora del problema, la operación que se detuvo, el código de error y, si lo tienes, el ID del trabajo (`job_...`).
- **Informe público en GitHub.** Aporta pasos mínimos para reproducir el problema sin secretos ni documentos personales. **Nunca publiques claves de API, cookies, el documento original, el PDF ni registros completos sin editar.**
