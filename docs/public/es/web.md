---
slug: web
category: Aplicación web
title: Convertir documentos en el navegador
description: Crea un PDF a partir de un archivo TeX o ZIP y consulta los resultados de conversiones anteriores.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Crear un PDF en el navegador {#ブラウザでpdfへ変換}

1. Abre la [aplicación web](/app/) e inicia sesión con el método que te indique el administrador.
2. Selecciona los archivos o arrástralos a la página.
   - Para un documento de un solo archivo, selecciona el `.tex` directamente.
   - Si incluye imágenes, bibliografías o varios archivos `.tex` (por ejemplo, mediante `\input`), reúne el documento y sus dependencias en un `.zip`. Consulta los [archivos admitidos y la estructura del ZIP](/es/docs/projects/).
   - Si seleccionas varios archivos `.tex` por separado, cada uno se convierte como documento independiente.
3. Si el ZIP contiene varios archivos `.tex` y se muestra un selector, elige el documento principal como punto de entrada.
4. Pulsa **Convertir a PDF**. Al finalizar, la página de resultados muestra el PDF y las vistas previas de las páginas.

Para usar otro motor en lugar de LuaLaTeX, selecciónalo en **Destino y opciones de salida → Motor**. El [entorno de renderizado](/app/environment/) indica qué motores están disponibles y si se han verificado las salidas PDF, SVG y la posición de los SVG. pLaTeX y upLaTeX requieren la colección de japonés en el servidor.

## Editar un documento en el navegador {#ブラウザーで文書を編集する}

1. Abre un documento en [Proyectos](/app/projects/) y selecciona **Editar TeX**. Un proyecto nuevo comienza con un `main.tex` vacío. También puedes elegir una plantilla.
2. Los cambios se guardan automáticamente en el borrador. Usa **Adjuntar archivo** para añadir imágenes o bibliografías.
3. Activa **Compilación automática** para actualizar el PDF cuando dejes de escribir. Para actualizarlo de inmediato, pulsa **Compilar**.
4. Pulsa **Guardar una versión** para conservar la entrada en el historial. Con **Editar desde esta revisión** puedes retomar una versión guardada. Si ya hay un borrador, se te pedirá confirmación antes de reemplazarlo.

Abre **Gestionar archivos** para añadir o adjuntar archivos. En **Ajustes** puedes cambiar el motor, la compilación automática y el idioma, o guardar una revisión. El botón **⋯** del panel PDF abre las opciones de zoom y PNG.

Si falla la compilación, se conservan el borrador y el último PDF correcto. Selecciona un error con nombre de archivo y número de línea para ir a esa línea. En el móvil, cambia entre **Código**, **PDF** y **Errores**. Si el PDF tarda en mostrarse, usa **PNG (vista previa ligera)**.

Las vistas previas temporales aparecen únicamente en el editor. Para conservar un PDF, descárgalo con **Guardar PDF**.

El editor utiliza UTF-8. Abre los archivos Shift_JIS o EUC-JP en un editor de texto con su codificación original, comprueba que se vean bien y guarda una copia en UTF-8. Adjunta la copia con el mismo nombre y confirma el reemplazo.

## Obtener ecuaciones y diagramas TikZ en SVG {#数式や-tikz-を-svg-で取得する}

1. Antes de convertir, abre **Destino y opciones de salida** y marca **Exportar también ecuaciones y TikZ como SVG**.
2. Puedes descargar el PDF en cuanto esté listo.
3. Si el resultado indica **Éxito parcial**, el PDF está listo, pero falló la extracción de SVG. Guarda primero el PDF y, si lo necesitas, pulsa **Reintentar solo SVG**.

Al principio solo se genera la vista previa PNG de la primera página. Las demás se generan cuando las abres. El PDF terminado se puede descargar mientras se preparan las vistas previas. Consulta [Obtener PDF, PNG y SVG](/es/docs/outputs/).

## Abrir documentos y resultados anteriores {#以前の文書や結果を開く}

- **[Historial](/app/history/)** muestra el progreso y los archivos resultantes. Puedes volver a la misma página de resultados después de cerrar el navegador.
- **[Proyectos](/app/projects/)** muestra los documentos y revisiones guardados. Para convertir una entrada anterior, abre la revisión y pulsa **Convertir de nuevo**.
- En **[Entorno de renderizado](/app/environment/)** puedes buscar los paquetes de LaTeX y las fuentes disponibles en el servidor.

## Información pública y privada {#公開される情報}

- **Páginas con inicio de sesión.** Inicia sesión en la aplicación web (`/app/`) para consultar tus documentos y conversiones en el historial o en los resultados. Solo los administradores y propietarios pueden usar el área de administración (`/admin/`). Consulta [Seguridad de cuentas y documentos](/es/docs/security/).
- **Páginas públicas.** Si no puedes iniciar sesión, consulta el [estado del servicio](/status/) o la [guía de solución de problemas](/es/docs/troubleshooting/). La CLI está en [Descargas](/downloads/) y las especificaciones de integración, en la [API pública](/es/docs/api/).
