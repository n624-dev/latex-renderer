---
slug: cli
category: CLI
title: Compile and download results with the CLI
description: Compile TeX in a terminal and download PDFs, logs, and previews.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

Run `n624-latex main.tex` in the folder containing `main.tex` to save the PDF in that folder. If this is your first run, [install the CLI and configure the connection](/en/docs/client/).

## Authentication {#認証}

Open setup in a browser to save your API key.

```sh
n624-latex setup --gui
```

If you cannot open a browser, for example over SSH, enter the key through **standard input** to keep it out of command-line arguments. In Bash or Zsh, run the first line, paste the key, and press Enter before continuing.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

On Windows you can also enter the key at the [installer’s hidden prompt](/en/docs/windows/#インストール).

Use the following commands to check whether a key is saved or remove it.

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` shows the effective connection origin and the credential source: a saved profile name, the `LATEX_RENDER_API_KEY` environment variable, or none. With `--json`, look for `origin` and `credentialSource`.

- If you have not explicitly selected a connection, `LATEX_RENDER_API_KEY` takes precedence over the saved key.
- `logout` removes only the locally stored key. Unset the environment variable or revoke the key on the server separately as needed.

### Choose a server {#接続先サーバー}

Run **`n624-latex connection`** to manage connections from a terminal menu.

1. Add a connection by entering a name, your server’s HTTPS URL, and an API key issued by that server. The terminal hides the key as you enter it.
2. If you have several connections, set the one you use most often as the default.

Run `n624-latex main.tex` for the default connection, or `n624-latex --profile work main.tex` to select another connection for one command. To select a connection in Local MCP, set `LATEX_RENDER_PROFILE=work` in its launch environment.

To reuse a key saved by an older version, choose **Import saved key** and confirm the server it belongs to. For automation, run `n624-latex connection migrate work https://latex.example.com --confirm-origin`. A saved key is used only with its confirmed server.

To register a server noninteractively, pass the key on standard input.

```sh
n624-latex connection add work https://latex.example.com --api-key-stdin
n624-latex connection use work
```

In CI, you can set `LATEX_RENDER_BASE_URL` and `LATEX_RENDER_API_KEY` together. If you explicitly select a connection, the client uses that connection’s saved key.

## Setup and diagnostics {#セットアップと診断}

Run `n624-latex setup` to configure connections and integrations. If you cannot connect to the server, check the installation with the commands below. If your shell cannot find `n624-latex`, see [Installation and PATH](/en/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` checks your installation and credentials without changing them or printing the API key. It returns exit code `2` if it finds a problem.

| Installation method | Updates and repairs |
| --- | --- |
| APT | [Update with APT](/en/docs/client/#apt-版の更新) or [reinstall](/en/docs/client/#状態確認と修復) a damaged package. [Register Local MCP manually](/en/docs/mcp/#local-mcpの登録). |
| Homebrew | [Update with Homebrew](/en/docs/client/#homebrew-版の更新) or [reinstall](/en/docs/client/#状態確認と修復) a damaged package. Configure AI integrations with `n624-latex setup`. |
| Downloadable installer | [Update through setup](/en/docs/client/#配布インストーラー版の更新). Run `n624-latex setup repair` to repair managed integrations and launchers. |

To remove the CLI, follow the [instructions for your installation method](/en/docs/client/#アンインストール). The setup interface runs only on your computer and closes when the CLI exits.

## Rendering {#レンダリング}

### Compile a TeX file directly {#tex-ファイルを直接変換する}

Specify a `.tex` file in your project folder to generate a PDF. Use relative paths to reference images, bibliographies, and local `.sty` files in the project.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Without `-o`, the CLI writes a PDF with the input’s base name (for example, `main.pdf`) in the directory where you ran the command.
- For a LaTeX error, the CLI shows the file name, line number, and job ID it can identify. If compilation or download fails, it preserves the last successfully saved PDF.

#### Select a LaTeX engine {#latex-のエンジンを選ぶ}

To use XeLaTeX, place the engine name before the file name.

```sh
n624-latex xelatex main.tex
```

If you omit the engine, the CLI checks the beginning of the document for `% !TeX program = xelatex` or
`% !TEX TS-program = xelatex`. If neither directive is present, it checks
`.n624-latex.json` in the root of the project you are compiling.
Commit this file to Git to share the engine selection across computers.

```json
{"engine":"xelatex"}
```

The default is LuaLaTeX. pLaTeX and upLaTeX are available when the server’s
runtime includes the Japanese collection.

| Engine | What to check when moving a document |
| --- | --- |
| LuaLaTeX | Check the settings for documents that use `fontspec` or LuaTeX-ja. |
| pdfLaTeX | Use fonts configured for pdfLaTeX. This engine cannot use `fontspec`. |
| XeLaTeX | You can use `fontspec`. Check for packages specific to LuaTeX. |
| pLaTeX / upLaTeX | Choose a Japanese document class compatible with the engine. With upLaTeX and `jsarticle`, specify the `uplatex` class option. |

Bibliography processing follows the document’s packages and settings. Include `.bib` files and any custom `.bst` files. BibTeX documents compiled with pLaTeX or upLaTeX use pBibTeX or upBibTeX respectively. Check the server’s [rendering environment](/app/environment/) for PDF output, SVG output, and SVG placement verification.

### Render a ZIP or request multiple outputs {#zip-複数の出力を指定する}

Use the `render` subcommand to compile a ZIP or retrieve the full set of artifacts, including logs, previews, and SVGs.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Examples**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- The path defaults to the current directory and `--entrypoint` defaults to `main.tex`. The CLI prepares a source containing up to 500 files and waits for completion. You can specify any relative `.tex` path. The server verifies that the path is safe and the file exists.
- Add `--svg` to extract outermost math expressions and top-level TikZ diagrams as self-contained SVGs alongside the PDF.

### Reuse a source to compile multiple documents {#同じ入力から複数の文書を作る-source-の再利用}

To compile several entrypoints from one folder or ZIP, upload it once with `source upload` and reuse the source ID. Choose a different `--output` directory for each job.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] How the CLI handles output cleanup, exclusions, and duplicate uploads
>
> - **Old output files.** When you reuse a destination, the CLI removes previously generated PDFs, previews, and SVGs listed in the previous `job.json` if the new result no longer includes them. It preserves unrelated files.
> - **Destination checks.** The CLI rejects destinations containing symbolic links. On POSIX it also checks ownership and write permissions for group and other users. Windows skips POSIX mode-bit checks.
> - **Output exclusion.** If `--output` names a project subfolder, the CLI excludes that exact folder from the next input ZIP. Similarly named folders remain eligible. The project root itself cannot be the output directory.
> - **Duplicate uploads.** When a valid ZIP with the same owner and SHA-256 already exists, the server returns `uploadRequired: false` and skips the upload. Only that owner can use the returned source ID for later jobs.

## Saved projects and revisions {#保存projectと改訂}

Use the CLI to manage and recompile saved projects and revisions. The web app, API, MCP, and other API keys belonging to the same user share them. One-off `render` and `source upload` operations do not require a saved project.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** prepares a local directory or ZIP as a source and saves an immutable revision in the specified project. Add `--svg` to set the revision’s initial outputs to PDF and SVG.
- **`render`** creates a job from a saved revision. Only `--svg` overrides the saved output settings.
- **`list`, `get`, and `jobs`** accept `--cursor` to retrieve the next page.
- **`delete`** hides the project from the list. Existing jobs are not immediately erased.

## Work with jobs {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Download and wait.** Job commands use the API key to refresh a short-lived token. `jobs download` waits for completion before replacing the saved artifacts. If it fails or is interrupted while waiting, the existing files remain intact. `delete` applies only to finished jobs.
- **Operation deadline.** Rendering has a 30-minute deadline covering upload, rendering, and download. The server can keep processing an accepted job after this deadline. Use the same job ID with `jobs get` or `jobs download` to continue.
- **Get additional PNG previews.** Only page 1 is generated initially. A normal download retrieves existing PNGs. A request such as `--preview-page 2 5` generates those pages, verifies their sizes and SHA-256 hashes, and saves them. It does not recompile the PDF or extend retention.
- **Download the PDF early and retry SVG extraction.** For a PDF and SVG job, use `--pdf-only` to obtain the published PDF while SVG extraction continues. If only SVG extraction fails, the result is a partial success with a saved PDF. Use `retry-svg` to retry extraction while keeping the finalized PDF. The limit is 8 attempts including the first, and retries do not extend retention. Create a new job if the runtime has changed. See [Early PDF availability and SVG retries](/en/docs/api/#pdfの先行公開とsvgの再試行).
- **Retry after connection errors.** The CLI retries temporary network failures when checking status. Authentication and permission errors end the wait. The server may keep working after the CLI stops waiting. Check the same `<jobId>` before creating another job. See [CLI waiting and retries](/en/docs/reference/#cliの待機と再試行).

## Output files {#成果物}

See [Get PDF, PNG, and SVG output](/en/docs/outputs/) for early PDF downloads, specific PNG pages, and SVG retries.

| Path | Contents |
| --- | --- |
| `.render/result.pdf` | PDF from a successful compilation |
| `.render/compile.log` | LaTeX compilation log |
| `.render/errors.json` | Structured error details |
| `.render/job.json` | Final job status |
| `.render/previews/page-N.png` | Page previews (up to 100 pages) |
| `.render/svg/manifest.json` | Mapping from SVGs to source positions and PDF coordinates |
| `.render/svg/objects/*.svg` | Self-contained SVG for each math expression or TikZ diagram |

## JSON output {#json出力}

Add `--json` to any CLI command to write one JSON object to standard output without progress messages. This uses the same `client-core` result as the standard display and excludes API keys and short-lived tokens.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

See [CLI JSON format](/en/docs/reference/#cliのjson形式) for success and failure schemas and exit codes.
