# Homebrew package release

The formula installs the renderer CLI, its compatibility commands, and Local
MCP. Homebrew provides the runtime through `node@24` and manages the package
files. The client keeps API keys in the user's existing configuration
directory. The supported installation target is macOS.

1. Validate the candidate on native Apple Silicon and Intel macOS runners with
   the **homebrew** workflow.
2. Publish the Stable client release. Run the **homebrew** workflow with its tag
   in `published_stable` to test the same verified ZIP that users will get.
3. Generate the formula with an authenticated GitHub CLI.

   ```sh
   node deploy/homebrew/published-formula.mjs vX.Y.Z > n624-latex.rb
   ```

   The generator checks the immutable release, expected asset URL, size,
   SHA-256, and build attestation. Copy the formula to
   `Formula/n624-latex.rb` in `n624-dev/homebrew-tap`.

4. Verify a fresh installation from the public tap before advertising it in
   the download and installation guides.

   ```sh
   brew install n624-dev/tap/n624-latex
   n624-latex setup
   ```

   The setup screen can configure Codex and Claude Code integrations. For a
   legacy migration, use `type -a n624-latex` to identify any old launcher
   ahead of Homebrew on PATH. Open the Homebrew client directly with
   `"$(brew --prefix)/bin/n624-latex" setup` if an older copy takes priority.
   Put the Homebrew bin directory first on PATH for subsequent commands.

   Integration setup adds Local MCP where it has yet to be configured. Existing
   registrations keep their current settings and launcher. To switch an
   existing registration to Homebrew, run `brew --prefix` and use the resulting
   absolute `bin/latex-renderer-mcp` path for the `latex-renderer` server's
   `command` field in Codex or Claude Code. Leave the other MCP settings as
   they are, restart the AI tool, and confirm the connection before uninstalling
   an older copy of the client.

Users update and uninstall with `brew upgrade n624-dev/tap/n624-latex` and
`brew uninstall n624-dev/tap/n624-latex`. Uninstall removes the package
binaries. Users can run `n624-latex auth logout` before uninstalling to remove
the saved key. Users who configured Local MCP can remove its registration from
the corresponding AI tool when they stop using it. Reinstalling the package
restores the launcher at the same path.
