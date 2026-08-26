# LaTeX Renderer Client

The Windows, Linux, and macOS clients use the single public origin `https://latex-render.n624.jp`.

- Web and docs: `/`
- Downloads: `/downloads/`
- Render API: `/api/v1/`
- Admin UI: `/admin/`

Set `LATEX_RENDER_BASE_URL` only when overriding the production origin. The legacy `LATEX_RENDER_GATEWAY_URL` and `LATEX_RENDER_RENDERER_URL` variables remain migration fallbacks in the CLI but are no longer written by the Windows wrappers.

The API key is stored with Windows DPAPI on Windows and in a user-owned mode `0600` configuration file on Linux/macOS. Never place API keys in project files, MCP arguments, logs, or prompts.

Remove only the stored API key with `latex-render auth logout`. Run `uninstall.mjs` on any supported OS or the Windows `uninstall.ps1` wrapper to remove the client, credential, and managed unmodified Codex/Claude skills. Modified skills are preserved.

Add `--json` to any CLI operation to emit one structured result on stdout. Structured output never contains API keys, upload tickets, or job tickets.

Run `latex-render setup` to install or idempotently update the cross-platform client, Skill, launchers, and available Codex/Claude MCP registrations. Run `latex-render setup --gui` for the authenticated loopback-only setup UI. Run `latex-render doctor --json` for a read-only, secret-free diagnosis, `latex-render setup repair` to repair owned settings, and `latex-render setup remove --yes` to remove only managed settings. Conflicting or modified settings are preserved.
