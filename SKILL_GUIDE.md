# Skill guide

The canonical Skill is [`integrations/latex-renderer`](integrations/latex-renderer/SKILL.md). User-facing installation and integration guidance lives in [`docs/public/integrations.md`](docs/public/integrations.md).

The Windows client installer copies the Skill to Codex, Claude, or both and refuses to overwrite an existing destination. The standalone source installer remains available as `scripts/install-skill.ps1 codex` or `claude`.

The Skill deliberately contains no credential lookup and no management workflow. It directs agents to structured errors before raw logs, prohibits security-boundary weakening, and fixes the rendering engine to LuaLaTeX.

The document entrypoint is **not** fixed to `main.tex`:

- use an explicitly requested relative `.tex` entrypoint when supplied;
- use `main.tex` only when the user did not specify an entrypoint;
- if `main.tex` is absent and multiple `.tex` candidates exist, present likely entrypoints and ask the user to choose rather than rendering every file automatically;
- when multiple entrypoints are selected, upload one Source and reuse it for one Job per entrypoint.

Keep detailed agent workflow and safety rules in the canonical [`SKILL.md`](integrations/latex-renderer/SKILL.md) rather than duplicating them here.
