---
slug: index
category: Primeros pasos
title: Guía de LaTeX Renderer
description: Convierte documentos LaTeX a PDF desde el navegador, la terminal o un asistente de IA.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Crea tu primer PDF {#最短でpdfを作る}

1. Abre la [aplicación web](/app/) e inicia sesión con el método que te indique el administrador.
2. Selecciona el archivo `.tex` y pulsa **Convertir a PDF**. Si utiliza imágenes o bibliografías, incluye los archivos junto con el documento en un ZIP y selecciona ese ZIP.
3. Abre el PDF que aparece en los resultados. Para consultarlo más tarde, abre **Historial** en la aplicación web.

Si no tienes un documento de prueba, guarda este ejemplo como `main.tex` con codificación UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Ejemplo en japonés y estructura del ZIP](/es/docs/projects/)
- [Guía de la aplicación web](/es/docs/web/)
- [Guardar PDF y PNG y reintentar la extracción de SVG](/es/docs/outputs/)

Para trabajar en la terminal, [instala la CLI para tu sistema](/es/docs/client/). Configura la conexión con `n624-latex setup`. En la carpeta donde guardaste `main.tex`, ejecuta `n624-latex main.tex` para crear `main.pdf`.

## Elige cómo trabajar {#利用方法を選ぶ}

| Qué quieres hacer | Herramienta | Guía |
| --- | --- | --- |
| **Convertir documentos en el navegador** | Aplicación web | [Convertir en el navegador](/es/docs/web/) |
| **Convertir desde la terminal y guardar los resultados localmente** | CLI para Windows, macOS o Linux | [Instalar la CLI](/es/docs/client/) |
| **Convertir desde ChatGPT o Claude** | Remote MCP con OAuth | [Conectar ChatGPT o Claude](/es/docs/mcp/) |
| **Trabajar con documentos locales en Codex o Claude Code** | CLI, Local MCP y habilidad | [Usar Codex o Claude Code](/es/docs/integrations/) |
| **Automatizar conversiones en tu aplicación** | API HTTP | [API pública](/es/docs/api/) |
| **Ejecutar el servicio en tu servidor Linux** | Alojamiento propio | [Administrar tu servidor](/es/docs/self-hosting/) |

## Requisitos {#必要なもの}

- **Aplicación web y Remote MCP.** Necesitas una cuenta de acceso indicada por el administrador del servidor.
- **CLI, Local MCP y API HTTP.** Solicita al administrador una clave de API de renderizado que empiece por `lrk_`.
- **Requisitos de la CLI según el tipo de instalación**
  - Debian y Ubuntu con APT: el paquete incluye su propia versión de Node.js.
  - macOS con Homebrew: Homebrew instala la versión necesaria de Node.js.
  - Instalador descargable para Windows, macOS o Linux: necesitas Node.js 24 o posterior.

El servidor se encarga de compilar los documentos. Puedes usar cualquiera de estos métodos sin instalar TeX Live en tu equipo.

> [!WARNING]
> No pegues claves de API en conversaciones con IA, código fuente, repositorios Git ni registros. Si sospechas que se ha filtrado una clave, pide al administrador que la revoque y emita otra de inmediato.

Si tienes problemas al iniciar sesión o convertir un documento, consulta la [guía de solución de problemas](/es/docs/troubleshooting/).
