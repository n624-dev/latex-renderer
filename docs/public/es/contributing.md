---
slug: contributing
category: Desarrollo y contribuciones
title: Contribuir a la documentación
description: Edita las guías en Markdown y verifica los cambios localmente.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Editar una guía {#本文を編集する}

- **Informar de un error.** Si una guía no coincide con la interfaz o los comandos, abre un informe en [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose) e indica la página y la corrección propuesta.
- **Enviar una solicitud de cambios.** Edita el archivo correspondiente en las [fuentes Markdown de las guías públicas (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) y abre una solicitud de cambios.

## Verificación local {#ローカル検証}

Tras editar, ejecuta estos comandos y comprueba que pasen la compilación y las comprobaciones de enlaces y cabeceras.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

La compilación de `public-web` realiza un ensayo con Wrangler y arranca un entorno local de Workers para comprobar páginas representativas, el índice de búsqueda, errores 404, redirecciones y cabeceras.

## Compatibilidad {#互換性}

- Conserva las rutas públicas y las anclas de los títulos (fragmentos `#...` generados a partir del texto). Si cambias un título, comprueba los enlaces desde otras páginas.
- Cuando cambies opciones de la CLI o ejemplos de peticiones HTTP, comprueba que coincidan con la implementación y con las definiciones OpenAPI.
