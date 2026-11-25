---
slug: outputs
category: Web y CLI
title: Obtener PDF, PNG y SVG
description: Guarda el PDF, descarga imágenes de páginas y exporta o vuelve a extraer las ecuaciones y los diagramas TikZ en SVG.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Abrir y guardar un PDF {#pdf-を開く-保存する}

- **Aplicación web.** Selecciona el documento en [Historial](/app/history/) y abre `result.pdf` en la lista de archivos de la página de resultados. Si solicitaste PDF y SVG, puedes descargar el PDF en cuanto esté listo.
- **CLI.** Descarga el resultado con el `<jobId>` que se muestra. Añade `--pdf-only` para descargar el PDF sin esperar a los SVG. Si necesitas conservar los archivos de otro documento, elige una carpeta `--output` distinta.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Obtener imágenes de páginas {#ページ画像を取得する}

Usa las vistas previas PNG cuando necesites imágenes de páginas completas. Inicialmente solo se genera la página 1. Las demás se generan al solicitarlas. Si están en preparación, espera un momento o vuelve a abrir la página. Puedes descargar el PDF terminado mientras esperas.

- **Aplicación web.** En los resultados, selecciona la vista previa de la página que quieras ver.
- **CLI.** El siguiente comando descarga los PNG de las páginas 2 y 5. Los archivos se guardan con nombres como `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Guardar ecuaciones y TikZ como SVG {#数式と-tikz-を-svg-で保存する}

Puedes extraer las expresiones matemáticas más externas y los diagramas TikZ de nivel superior como imágenes vectoriales independientes.

- **Aplicación web.** Antes de convertir, abre **Destino y opciones de salida** y selecciona **Exportar también ecuaciones y TikZ como SVG**. Una vez terminada la extracción, descarga los archivos SVG desde la página de resultados.
- **CLI.** Convierte el documento con `--svg`. Los SVG se guardan en `.render/svg/objects/`. Consulta las líneas del `.tex` original y las coordenadas correspondientes en el PDF en `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Si el PDF está listo pero falla la extracción de SVG {#pdf-はあるが-svg-が失敗した場合}

**Éxito parcial** indica que el PDF está listo y solo falló la extracción de SVG. Guarda el PDF y vuelve a intentar la extracción sin recompilarlo.

- **Aplicación web.** Pulsa **Reintentar solo SVG** en los resultados.
- **CLI.** Ejecuta este comando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Condiciones y límite de intentos**
- Se permiten **hasta 8 intentos**, incluido el inicial, mientras sigan disponibles la entrada original y el PDF definitivo y no haya cambiado el entorno TeX del servidor. Los reintentos no amplían la conservación de los archivos.
- Si el problema persiste, consulta el diagnóstico en la página de resultados o en `.render/svg/errors.json`.
- Si aparece `SVG_RUNTIME_CHANGED` o el botón de reintento no está disponible en un trabajo antiguo, [crea una nueva conversión desde el documento original o una revisión guardada](/es/docs/web/#以前の文書や結果を開く).

Consulta también [Descargar y reintentar mediante la API HTTP](/es/docs/api/#pdfの先行公開とsvgの再試行) y la [especificación del procesamiento de salidas](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
