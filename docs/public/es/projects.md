---
slug: projects
category: Proyectos
title: Preparar archivos TeX y ZIP
description: Prepara la entrada, comprueba los límites y prueba un proyecto mínimo con LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Estructura del proyecto {#構成}

- **Documento de un solo archivo.** Sube el `.tex` directamente en la aplicación web o ejecuta `n624-latex main.tex` en la CLI.
- **Documento con imágenes, bibliografía o varios archivos fuente.** Reúne todo en **un ZIP** que conserve las rutas relativas. En la CLI también puedes indicar una carpeta.
- **Crear el ZIP.** Selecciona el contenido de la carpeta, como `main.tex` e `images/`, para comprimirlo. Si incluyes la carpeta superior, tendrás que indicar una ruta de entrada como `project/main.tex` al convertir.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Punto de entrada y rutas relativas**
El documento principal predeterminado es `main.tex` en la raíz del proyecto. Aunque elijas un `.tex` de una subcarpeta, por ejemplo `docs/main.tex`, **el directorio de trabajo de la compilación es siempre la raíz del proyecto**. Para incluir desde `docs/main.tex` el archivo `body.tex` de su misma carpeta, escribe `\input{docs/body.tex}`. Si escribes `\input{body.tex}`, el compilador buscará `body.tex` en la raíz.

## Ejemplo mínimo en japonés {#日本語の最小例}

El motor predeterminado es **LuaLaTeX**. Para probar un documento en japonés, guarda lo siguiente en `main.tex` con codificación UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Busca los paquetes y fuentes disponibles en el [entorno de renderizado](/app/environment/). La lista se genera a partir del contenedor del servidor durante el despliegue y también se usa para las búsquedas de Remote MCP. Si falta un paquete, envía al administrador el mensaje correspondiente de `compile.log`.

## Proyectos y revisiones guardados {#保存projectと改訂}

Los documentos convertidos en la aplicación web (`/app/`) se guardan en proyectos.

- **Registro automático de revisiones.** Cada combinación nueva de contenido, documento principal, motor y formatos de salida se guarda como una revisión del proyecto. Las anteriores siguen en el historial.
- **Convertir una revisión anterior.** Pulsa **Convertir de nuevo** para usar el documento y el motor guardados. Si cambias aquí el formato de salida, el resultado se añade al historial de conversiones de la misma revisión.
- **Uso compartido y eliminación.** La aplicación web, la CLI, la API HTTP y MCP comparten los proyectos y revisiones del usuario. Eliminar un proyecto oculta su registro. Las entradas y salidas existentes se limpian según su plazo de conservación. Contacta con el administrador si necesitas borrarlas por completo de inmediato. Las entradas referenciadas por revisiones activas cuentan para la cuota del usuario. Consulta [Uso compartido y conservación](/es/docs/reference/#保存プロジェクトの共有-保持).

### Editar en el navegador {#ブラウザーで編集する}

Abre un proyecto guardado y elige **Editar TeX**. Los cambios se guardan en el borrador. Cuando dejas de escribir se inicia la compilación y, si termina correctamente, se actualiza el PDF. Si falla la vista previa, puedes consultar el último PDF disponible y la versión del borrador a la que corresponde.

Los proyectos nuevos se abren con un `main.tex` vacío. Mientras el documento principal esté vacío puedes empezar con una plantilla. Para retomar una versión guardada, elige **Editar desde esta revisión**. Si ya tienes un borrador, confirma antes de reemplazarlo.

Para compilar solo cuando lo necesites, desactiva **Compilación automática** y pulsa **Compilar**. Elige **Salidas de la versión guardada** y pulsa **Guardar una versión** para conservar el borrador y sus ajustes. Si necesitas SVG, abre la revisión guardada y pulsa **Convertir de nuevo**.
El editor muestra el estado de compilación y la vista previa mientras trabajas.

## Archivos excluidos del envío {#送信から除外されるもの}

- **Exclusiones automáticas.** La CLI omite `.git`, `.render` y archivos auxiliares de LaTeX como `.aux`. Rechaza los enlaces simbólicos.
- **Archivos no admitidos.** Mueve fuera del proyecto las carpetas innecesarias, como `node_modules`. Si envías una carpeta con extensiones no admitidas, la CLI muestra la ruta y se detiene. Para conservar un archivo como `README.md` en el proyecto pero excluirlo del envío, añade a `.latexrenderignore` en la raíz una línea con `README.md`. El servidor verifica las mismas reglas de extensión en el ZIP.
- **Extensiones admitidas** (sin distinguir mayúsculas y minúsculas)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  Los archivos `.bst` son estilos de bibliografía de BibTeX y pueden estar en subcarpetas. Si un estilo propio usa una extensión que no aparece en la lista, consulta al administrador antes de cambiarla.

## Límites {#制限}

- **Número de archivos.** Hasta 500.
- **Tamaños predeterminados.** 20 MiB para el ZIP, 100 MiB en total tras la extracción y 20 MiB por archivo.
- **Punto de entrada.** Ruta relativa a un archivo `.tex` dentro de la entrada. Por defecto se usa `main.tex` en la raíz.
- **Seguridad.** Se desactivan el acceso al intérprete de comandos desde TeX (incluido `\write18`), la ejecución de órdenes externas y las conexiones de red externas.
- **Recursos.** El administrador fija los límites de tiempo, espacio de almacenamiento por usuario y conservación de los resultados.
