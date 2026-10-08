import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node normally resolves the entrypoint's symlinks for import.meta.url but
// leaves process.argv[1] as invoked. Compare file identity, not path spelling.
// This also works with --preserve-symlinks-main; imports never run the CLI.
export function isMainModule(moduleUrl, entrypoint = process.argv[1]) {
  if (entrypoint === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entrypoint);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}
