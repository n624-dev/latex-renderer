import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function updaterSocketCapable(root) {
  try {
    const marker = (
      await readFile(join(root, "deploy/scripts/updater-socket-v1.mjs"), "utf8")
    ).trim();
    if (marker !== "export const updaterSocketProtocol = 1;")
      throw new Error("Invalid Updater socket protocol");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function prepareUpdaterTransport({
  slots,
  action = "prepare",
  compact = false,
  acquireLock,
  isControllerActive,
  canStopController,
  run = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      timeout: 30000,
      stdio: "ignore",
    }),
}) {
  let lock;
  if (action === "resume") {
    if (!acquireLock || !isControllerActive || !canStopController)
      throw new Error(
        "Transport resume requires the controller commit barrier",
      );
    lock = await acquireLock();
  }
  try {
    const state = await slots.state();
    const { root } = await slots.verify(state.current);
    const capable = await updaterSocketCapable(root);
    if (action === "check") {
      if (!capable)
        throw new Error(
          "Install the socket-capable independent Updater before selecting compact mode",
        );
      return { activated: true };
    }
    if (action === "resume") {
      // ExecStopPost also runs when activation fails BEFORE stopping anything.
      // Preserve a busy/unknown controller; hold the shared lock from this check
      // through transport restoration so a new mutation cannot race the stop.
      if ((await isControllerActive()) && !(await canStopController()))
        return { activated: capable, deferred: true };
      run("stop", "latex-renderer-update-manager.service");
      if (capable && compact) {
        run("disable", "latex-renderer-update-manager.service");
        run("enable", "latex-renderer-update-manager.socket");
        // Queue the listener without waiting inside ExecStopPost. The activation
        // gate, rather than a Conflicts edge, owns its post-commit stop boundary.
        run("start", "--no-block", "latex-renderer-update-manager.socket");
        return { activated: true };
      }
    } else if (action !== "prepare")
      throw new Error("Invalid Updater transport action");
    if (capable && action === "prepare") return { activated: true };
    // Independent rollback may select a controller predating socket activation.
    // Remove the retained listener before that controller binds its own socket.
    // This pre-start guard has fixed root-owned arguments and no HTTP entry.
    run("disable", "--now", "latex-renderer-update-manager.socket");
    run("enable", "latex-renderer-update-manager.service");
    if (action === "resume")
      run("start", "latex-renderer-update-manager.service");
    return { activated: false };
  } finally {
    await lock?.release();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const action = process.argv[2] ?? "prepare";
  if (
    process.argv.length > 3 ||
    !["prepare", "check", "resume"].includes(action) ||
    process.getuid() !== 0
  )
    throw new Error("Invalid Updater transport guard identity");
  const { UpdaterSlots } =
    await import("/opt/latex-renderer/updater/bootstrap-v1/updater-slots.mjs");
  let compact = false;
  let barrier = {};
  if (action === "resume") {
    const { acquireMutationLock } =
      await import("/opt/latex-renderer/updater/bootstrap-v1/mutation-lock.mjs");
    const { controllerIdle, readControllerState } =
      await import("/usr/local/libexec/latex-renderer-updater-activation.mjs");
    barrier = {
      acquireLock: acquireMutationLock,
      isControllerActive: () => {
        const pid = execFileSync(
          "/usr/bin/systemctl",
          [
            "show",
            "latex-renderer-update-manager.service",
            "--property=MainPID",
            "--value",
          ],
          { encoding: "utf8", timeout: 30_000 },
        ).trim();
        if (!/^(?:0|[1-9]\d*)$/.test(pid))
          throw new Error("Invalid controller process state");
        return pid !== "0";
      },
      canStopController: async () =>
        controllerIdle(await readControllerState()),
    };
    const modes = (await readFile("/etc/latex-renderer/renderer.env", "utf8"))
      .split("\n")
      .filter((line) => line.startsWith("RENDERER_RUNTIME_MODE="));
    if (modes.length > 1) throw new Error("Duplicate runtime mode");
    const match = /^RENDERER_RUNTIME_MODE=(["']?)(classic|compact)\1$/.exec(
      modes[0] ?? "RENDERER_RUNTIME_MODE=classic",
    );
    if (!match) throw new Error("Invalid runtime mode");
    compact = match[2] === "compact";
  }
  console.log(
    JSON.stringify(
      await prepareUpdaterTransport({
        slots: new UpdaterSlots("/opt/latex-renderer/updater", 0),
        action,
        compact,
        ...barrier,
      }),
    ),
  );
}
