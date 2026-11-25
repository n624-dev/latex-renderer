---
slug: integrations
category: AI and MCP
title: Use LaTeX Renderer with Codex or Claude Code
description: Use the same locally stored credentials with the CLI and MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Install the skill {#skillの導入}

1. [Install the CLI and register an API key](/en/docs/client/).
2. With Codex or Claude Code installed, configure the integration for your installation method.

   - **Downloadable installer.** Open `n624-latex setup` and select your AI tool. You can register the skill and Local MCP together.
   - **Homebrew.** Configure AI integrations with `n624-latex setup`. If you are migrating an existing Local MCP registration, see the [Homebrew instructions](/en/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Register Local MCP manually](/en/docs/mcp/#local-mcpの登録).

3. Restart Codex or Claude Code. In your request, specify the folder or main document to compile.

- **Skill locations**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Setup preserves any skill you have modified and reports that it did so.

## Register MCP {#mcpの登録}

- **Working with local files in Codex or Claude Code.** Use Local MCP. See [manual registration](/en/docs/mcp/#local-mcpの登録) and [check installation status](/en/docs/client/#状態確認と修復).
- **Working in a cloud AI client such as ChatGPT or Claude on the web.** Follow the [Remote MCP connection instructions](/en/docs/mcp/#通常はremote-mcpを使う). You do not need an API key.

## Example requests {#依頼例}

- “Check and compile `main.tex` in this folder.”
- “Compile `reports/a.tex` from this ZIP.”
- “Upload this ZIP once, then compile `reports/a.tex` and `reports/b.tex` separately.”
- “Read the structured errors, fix only the affected TeX, and compile again.”
- “Check the generated PDF and page previews.”

## Safe use {#安全な使い方}

> [!WARNING]
> Keep API keys out of prompts, MCP tool arguments, and project files. Local MCP uses the credentials protected and stored by the CLI.

- **Untrusted data.** The integration treats LaTeX source, file paths, logs, errors, artifacts, and MCP responses as untrusted data. It is designed to ignore instructions embedded in those inputs, including prompt injections.
- **Destructive actions.** Run `cancel_render` and `delete_render` only at the user’s explicit request.
- **Entrypoint selection.** The default is `main.tex`. If it is missing and several `.tex` files are candidates, the integration asks which to use. It never automatically runs them all. The skill contains the safety rules and workflow. Detailed specifications are in its bundled `references/` directory and the public documentation.
