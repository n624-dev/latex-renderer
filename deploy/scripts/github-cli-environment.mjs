import { mkdir, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// All probes and verifier calls use private disposable state outside source.
export async function githubCliEnvironment(root) {
  if (!isAbsolute(root))
    throw new Error("GitHub CLI state root must be absolute");
  const info = await lstat(root);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o022)
    throw new Error(
      "GitHub CLI state root must be private and owned by the caller",
    );
  for (const name of [
    "gh-home",
    "gh-config",
    "gh-cache",
    "gh-state",
    "gh-data",
  ]) {
    const path = join(root, name);
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const entry = await lstat(path);
    if (
      !entry.isDirectory() ||
      entry.uid !== process.getuid() ||
      entry.mode & 0o077
    )
      throw new Error("GitHub CLI state directory is unsafe");
  }
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: join(root, "gh-home"),
    GH_CONFIG_DIR: join(root, "gh-config"),
    GH_PROMPT_DISABLED: "1",
    GH_TELEMETRY: "disabled",
    XDG_CONFIG_HOME: join(root, "gh-config"),
    XDG_CACHE_HOME: join(root, "gh-cache"),
    XDG_STATE_HOME: join(root, "gh-state"),
    XDG_DATA_HOME: join(root, "gh-data"),
  };
}
