---
slug: web
category: Web app
title: Edit and compile in the browser
description: Compile a TeX file or ZIP, edit project drafts, and download PDF and SVG output.
navOrder: 12
updated: "2026-11-24"
since: "v1.0.0"
---

## Convert files to a PDF {#ブラウザでpdfへ変換}

1. Open the [web app](/app/) and sign in using the method your administrator provides.
2. Choose files or drop them onto the page.
   - For a self-contained document, choose its `.tex` file.
   - For images, bibliographies, or files referenced with commands such as `\input`, place the document and its dependencies in one `.zip`. See [supported files and ZIP layout](/en/docs/projects/).
   - If you select several `.tex` files individually, each is compiled as its own document.
3. If the ZIP contains several `.tex` files and the app asks which to compile, select the main document (the entrypoint).
4. Choose **Convert to PDF**. The results page displays the completed PDF and page previews.

To use an engine other than LuaLaTeX, open **Destination and output options** and select **Engine**. The [rendering environment](/app/environment/) lists available engines and shows which support verified PDF output, SVG output, and SVG placement. pLaTeX and upLaTeX require the Japanese collection on the server.

## Edit a project {#ブラウザーで文書を編集する}

1. Open a document in [Projects](/app/projects/) and choose **Edit TeX**. A new project opens with an empty `main.tex`. You can also choose a template.
2. Edit the selected file. The editor saves your draft automatically. Choose **Attach a file** to add an image or bibliography and **Set as main document** to choose which `.tex` file to compile.
3. Leave **Auto compile** on to update the PDF when you pause typing. Choose **Compile** to update it immediately.
4. Choose **Save a revision** to keep the input in the project history. Choose **Edit from this revision** to start editing a saved version. If you have a working draft, the editor asks before replacing it.

Use **Manage files** to add or attach files. Open **Settings** to change the engine, auto compile, or display language, or to save a revision. The **⋯** button in the PDF pane opens the zoom and PNG options.

### Find and fix an error

If compilation fails, the editor keeps your draft and the last successful PDF. The preview identifies the draft that produced it. Select an error with a file name and line number to jump to that location. On a phone, switch between **Code**, **PDF**, and **Errors**. If the PDF is slow to display, choose **PNG (lightweight preview)**.

Temporary previews appear only in the editor. Choose **Save PDF** to keep a copy for later.

The editor uses UTF-8 text. For a Shift_JIS or EUC-JP file, open it in a text editor using the original encoding, check the text, and save a UTF-8 copy. Attach the copy with the same file name and confirm the replacement. **Display language** changes the editor language. Your account saves this setting independently of the document’s engine, fonts, and text.

## Get equations and TikZ diagrams as SVGs {#数式や-tikz-を-svg-で取得する}

1. Before converting, open **Destination and output options** and select **Also export math and TikZ as SVG**.
2. Download the PDF as soon as it is ready.
3. If the result shows **Partial success**, the PDF is ready but SVG extraction failed. Save the PDF first, then choose **Retry SVG only** if you still need the SVGs.

The server initially generates a PNG preview for the first page. Opening another page generates its preview. You can download the finished PDF while previews are being prepared. See [Get PDF, PNG, and SVG output](/en/docs/outputs/).

## Open previous documents and results {#以前の文書や結果を開く}

- **[History](/app/history/)** shows conversion progress and output files. You can reopen a results page after closing your browser.
- **[Projects](/app/projects/)** lists saved documents and revisions. To compile a previous version, open the revision and choose **Convert again**.
- **[Rendering environment](/app/environment/)** lets you search for LaTeX packages and fonts installed on the server.

## What you can access {#公開される情報}

- **Signed-in pages.** Sign in to the web app (`/app/`) to view your documents and results in History or on their results pages. Only administrators and owners can use the administration area (`/admin/`). See [Account and document security](/en/docs/security/).
- **Public pages.** If you cannot sign in, check [service status](/status/) or [Troubleshooting](/en/docs/troubleshooting/). Get the CLI from [Downloads](/downloads/) or see the [public API](/en/docs/api/) for integration details.
