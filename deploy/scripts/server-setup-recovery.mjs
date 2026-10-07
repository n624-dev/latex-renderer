#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { URL } from "node:url";
import { createInitialServerSetupHost } from "./server-setup-initial-host.mjs";

// Recovery shares the SAME RemainAfterExit dependency as historical auth
// recovery. It must finish before consumers and never starts them recursively
// from inside their systemd Requires/After chain.
async function main() {
  if (process.geteuid?.() !== 0 || process.argv.length !== 2)
    throw new Error("Privileged boot recovery only");
  const journal = await lstat(
    "/etc/latex-renderer/installation-transaction/journal.json",
  ).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (journal) {
    const host = await createInitialServerSetupHost("auto");
    const result = await host.recover(true);
    // An unprovisioned database cannot start consumers. Keep Requires failed
    // until the operator resubmits credentials through the selected frontend.
    if (result.awaitingCredentials)
      throw new Error("Initial credentials required");
  } else
    execFileSync(
      process.execPath,
      [
        new URL("./configure-authentication.mjs", import.meta.url).pathname,
        "--recover-before-start",
      ],
      {
        timeout: 55_000,
        stdio: "ignore",
        env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
      },
    );
}
main().catch(() => {
  process.stderr.write(
    "Setup boot recovery failed; consumers must remain stopped. Inspect private recovery state.\n",
  );
  process.exitCode = 1;
});
