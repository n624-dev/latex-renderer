import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";

// CI commands must not leave runuser/CLI/pipe descendants alive when a smoke
// deadline or runner cancellation interrupts their parent shell.
export function runCiProcessGroup(
  command,
  args,
  { timeoutMs = 180000, graceMs = 15000 } = {},
) {
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000 ||
    !Number.isSafeInteger(graceMs) ||
    graceMs < 1 ||
    graceMs > 30000
  )
    throw new Error("Invalid CI process-group deadline");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "inherit" });
    let settled = false,
      stopping = false,
      deadline,
      grace;
    const kill = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const onExit = () => {
      try {
        kill("SIGKILL");
      } catch {
        /* exiting */
      }
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      process.removeListener("SIGTERM", onCancel);
      process.removeListener("SIGINT", onCancel);
      process.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const stop = (reason, wait = graceMs) => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(deadline);
      try {
        kill("SIGTERM");
      } catch (error) {
        finish(error);
        return;
      }
      grace = setTimeout(() => {
        try {
          kill("SIGKILL");
          finish(new Error(reason));
        } catch (error) {
          finish(error);
        }
      }, wait);
    };
    // Runner cancellation escalates quickly. Reclaim the detached group before
    // the runner force-kills this supervising process.
    const onCancel = () =>
      stop("CI process group cancelled", Math.min(graceMs, 1000));
    process.once("SIGTERM", onCancel);
    process.once("SIGINT", onCancel);
    process.once("exit", onExit);
    child.once("error", finish);
    child.once("exit", (code) => {
      if (stopping) return;
      try {
        kill("SIGKILL");
      } catch (error) {
        finish(error);
        return;
      }
      finish(code === 0 ? null : new Error("CI child exited unsuccessfully"));
    });
    deadline = setTimeout(() => stop("CI process group timed out"), timeoutMs);
  });
}
