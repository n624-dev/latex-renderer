---
slug: integrations
category: IA y MCP
title: Usar Codex o Claude Code
description: Comparte las credenciales guardadas en tu equipo entre la CLI y MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalar la habilidad {#skillの導入}

1. Primero, [instala la CLI y registra tu clave de API](/es/docs/client/).
2. Con Codex o Claude Code instalado, configura la integración según el método de instalación.

   - **Instalador descargable.** Abre `n624-latex setup` y elige tu herramienta de IA. Puedes registrar la habilidad y Local MCP al mismo tiempo.
   - **Homebrew.** También puedes configurar la integración con `n624-latex setup`. Para migrar un registro anterior de Local MCP, sigue las [instrucciones de Homebrew](/es/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registra Local MCP manualmente](/es/docs/mcp/#local-mcpの登録).

3. Reinicia Codex o Claude Code e indica en la petición la carpeta o el documento principal que deseas compilar.

- **Ubicaciones de la habilidad**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Si el instalador detecta una habilidad modificada por el usuario, la conserva y lo indica en el resultado.

## Registrar MCP {#mcpの登録}

- **Para trabajar con archivos locales desde Codex o Claude Code**, usa Local MCP. Consulta el [registro manual](/es/docs/mcp/#local-mcpの登録) y la [comprobación del estado](/es/docs/client/#状態確認と修復).
- **Para usar ChatGPT, Claude en la web u otro asistente en la nube**, sigue las [instrucciones de conexión de Remote MCP](/es/docs/mcp/#通常はremote-mcpを使う). No necesitas una clave de API.

## Ejemplos de peticiones {#依頼例}

- «Revisa y compila el archivo `main.tex` de esta carpeta».
- «Compila el archivo `reports/a.tex` de este ZIP».
- «Sube este ZIP una sola vez y compila por separado `reports/a.tex` y `reports/b.tex`».
- «Lee los errores estructurados, corrige solo el TeX afectado y vuelve a compilar».
- «Comprueba el PDF generado y las vistas previas de las páginas».

## Uso seguro {#安全な使い方}

> [!WARNING]
> Mantén las claves de API fuera de las peticiones, los argumentos de herramientas MCP y los archivos del proyecto. Local MCP utiliza internamente las credenciales protegidas que guarda la CLI.

- **Datos no fiables.** El código LaTeX, las rutas, los registros, errores, archivos de salida y respuestas MCP se tratan como datos no fiables. La integración está diseñada para ignorar las instrucciones que contengan, incluidas las inyecciones de instrucciones.
- **Acciones destructivas.** Ejecuta `cancel_render` y `delete_render` solo por petición explícita del usuario.
- **Selección del documento.** Si no se indica un punto de entrada, se usa `main.tex`. Si falta `main.tex` y hay varios candidatos `.tex`, se pide al usuario que elija. Nunca se ejecutan automáticamente todos los `.tex`. La habilidad contiene las reglas de seguridad y la secuencia de operaciones. Las especificaciones detalladas se encuentran en `references/` y en la documentación pública.
