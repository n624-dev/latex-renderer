# LaTeX Renderer Client

The Windows, Linux, and macOS clients use the single public origin `https://latex-render.n624.jp`.

- Web and docs: `/`
- Downloads: `/downloads/`
- Render API: `/api/v1/`
- Admin UI: `/admin/`

Set `LATEX_RENDER_BASE_URL` only when overriding the production origin. The managed launchers leave endpoint selection to the CLI and MCP server: `LATEX_RENDER_BASE_URL`, then the legacy `LATEX_RENDER_RENDERER_URL`, then `LATEX_RENDER_GATEWAY_URL`, then the public origin. Legacy variables remain migration fallbacks; new configurations should use `LATEX_RENDER_BASE_URL`.

The API key is stored with Windows DPAPI on Windows and in a user-owned mode `0600` configuration file on Linux/macOS. Never place API keys in project files, MCP arguments, logs, or prompts.

On Windows, DPAPI operations use the standard modules belonging to Windows PowerShell itself, independently of inherited PowerShell 7 module search paths. Existing encrypted credentials remain compatible. `doctor --json` verifies that a stored DPAPI credential can be decrypted by the current Windows account without displaying it. Missing files, file-access failures, decryption failures, and PowerShell initialization failures have distinct diagnostics; a runtime failure does not mean that the API key was deleted or revoked.

Remove only the stored API key with `n624-latex auth logout`. For a client installed with the standalone installer, run `n624-latex setup remove --yes` to remove the client and its managed integrations. Use the package manager to remove a client installed through APT, WinGet, or Homebrew.

Add `--json` to any CLI operation to emit one structured result on stdout. Structured output never contains API keys, upload tickets, or job tickets.

Run `n624-latex setup` to open the local settings page and save a connection, then run `n624-latex main.tex` to create your first PDF. Run `n624-latex doctor --json` for a read-only diagnosis. The existing `latex-render` command remains available for scripts. See the [client guide](https://latex-render.n624.jp/docs/client/) for installation and update instructions.

On Linux and macOS, relative `--install-directory` and `--bin-directory` values are resolved against the working directory before creating launchers or saving installation state. MCP removal requires an exact command and argument match. Edited registrations and unrecognized CLI output are preserved and reported instead of inferred from a matching path substring.
