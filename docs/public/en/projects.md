---
slug: projects
category: Projects
title: Prepare TeX files and ZIP archives
description: Choose files to upload, check limits, and try a minimal LuaLaTeX project.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Project layout {#構成}

- **Single-file document.** Upload the `.tex` file directly in the web app or run `n624-latex main.tex` in the CLI.
- **Images, bibliographies, or multiple source files.** Put everything in **one ZIP**, preserving relative paths. The CLI can also take a directory directly.
- **Creating the ZIP.** Select the contents of the project folder, such as `main.tex` and `images/`, when creating the archive. If you include the parent folder, specify an entrypoint such as `project/main.tex` when compiling.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Entrypoints and relative paths**
By default, the main document (the entrypoint) is `main.tex` in the project root. Even when you select an entrypoint in a subfolder, such as `docs/main.tex`, **the working directory during compilation is always the project root**. To include `docs/body.tex` from `docs/main.tex`, write `\input{docs/body.tex}`. Writing `\input{body.tex}` looks for `body.tex` in the root.

## Minimal Japanese document {#日本語の最小例}

The default engine is **LuaLaTeX**. Try this Japanese document by saving it as `main.tex` in UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Search [Rendering environment](/app/environment/) for available packages and fonts. Deployment generates this list from the actual renderer container. Remote MCP searches the same list. If a package is missing, send your server administrator the relevant message from `compile.log`.

## Saved projects and revisions {#保存projectと改訂}

The web app (`/app/`) saves converted documents in projects.

- **Automatic revisions.** A new combination of content, main document, engine, and output formats creates a new revision in the project. Existing revisions remain in its history.
- **Compile a previous revision.** Choose **Convert again** to use the saved document and engine. Changing the output formats at this point adds a result to the same revision’s conversion history.
- **Sharing and deletion.** The web app, CLI, HTTP API, and MCP share saved projects and revisions for the same user. Deleting a project removes its listing. Existing input and output files are cleaned up according to their retention periods. Ask an administrator if you need immediate complete deletion. Inputs referenced by active revisions count toward your storage quota. See [Project sharing and retention](/en/docs/reference/#保存プロジェクトの共有-保持).

### Edit in the browser {#ブラウザーで編集する}

Open a saved project and choose **Edit TeX**. The editor saves changes as a draft. When you pause typing, it compiles the document and updates the PDF on success. If a preview fails, you can still see the last available PDF and the draft version that produced it.

A new project opens with an empty `main.tex`. While the main document is empty, you can start from a template. To work from a saved version, choose **Edit from this revision**. If you have a working draft, confirm before replacing it.

To compile on demand, turn off **Auto compile** and choose **Compile**. Select **Outputs for the saved revision**, then **Save a revision** to save the current draft and settings. If you need SVGs, open the saved revision and choose **Convert again**.
The editor displays compilation progress and previews while you work.

## Files excluded from uploads {#送信から除外されるもの}

- **Automatic exclusions.** The CLI excludes `.git`, `.render`, and LaTeX auxiliary files such as `.aux`. It rejects symbolic links.
- **Unsupported files.** Move unneeded folders such as `node_modules` outside the project. If a directory upload contains an unsupported extension, the CLI shows the path and stops. To keep a file such as `README.md` in the project while excluding it from uploads, add `README.md` to `.latexrenderignore` in the project root. The server checks ZIP uploads against the same extension rules.
- **Supported extensions** (case-insensitive)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  A `.bst` file is a BibTeX bibliography style and may reside in a subfolder. If a custom style or other file has an unlisted extension, ask your administrator before changing the extension.

## Limits {#制限}

- **File count.** Up to 500 files.
- **Default size limits.** 20 MiB for the uploaded ZIP, 100 MiB total after extraction, and 20 MiB per file.
- **Entrypoint.** A relative `.tex` path within the source. The default is `main.tex` in the root.
- **Security.** Shell escape (including `\write18`), external command execution, and external network access are disabled.
- **Resource limits.** Your administrator sets limits on processing time, storage per user, and artifact retention.
