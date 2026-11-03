import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { closeSync } from "node:fs";

// Preserve systemd's listener descriptor. The frozen bootstrap-v1 helper entry
// remains unchanged; its execve path intentionally discards non-stdio FDs.
if (process.argv.length !== 2 || process.getuid() === 0)
  throw new Error("Invalid Updater controller entry identity");
const { UpdaterSlots } =
  await import("/opt/latex-renderer/updater/bootstrap-v1/updater-slots.mjs");
const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
const state = await slots.state();
const { root } = await slots.verify(state.current);
const { updaterSocketCapable } =
  await import("/usr/local/libexec/latex-renderer-updater-transport.mjs");
if (!(await updaterSocketCapable(root))) {
  if (
    process.env.LISTEN_PID === String(process.pid) &&
    process.env.LISTEN_FDS === "1"
  )
    closeSync(3);
  for (const key of [
    "LISTEN_PID",
    "LISTEN_FDS",
    "LISTEN_FDNAMES",
    "LISTEN_PIDFDID",
  ])
    delete process.env[key];
}
process.chdir(root);
await import(pathToFileURL(join(root, "deploy/scripts/update-manager.mjs")));
