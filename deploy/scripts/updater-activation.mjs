import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

// The helper releases the mutation lock before its controller commits success.
// A free lock alone is therefore NOT permission to restart that controller.
export function controllerIdle(state) {
  if (
    !state ||
    !(
      state.activeOperationId === null ||
      typeof state.activeOperationId === "string"
    ) ||
    !(state.lastError === null || typeof state.lastError === "string")
  )
    throw new Error("Invalid controller activation state");
  if (state.activeOperationId !== null) return false;
  if (state.lastError !== null)
    throw new Error(
      "Resolve the failed application operation before Updater activation",
    );
  return true;
}

export async function stopUpdaterForActivation(run) {
  await run("stop", "latex-renderer-update-manager.socket");
  await run("stop", "latex-renderer-update-manager.service");
}

export async function activateAfterOperation({
  acquireLock,
  hasCandidate,
  verifyCandidate = async () => {},
  readController,
  stopController,
  recover,
  startController,
  activate,
  wait = () => setTimeout(3000),
  now = () => performance.now(),
  timeoutMs = 2 * 60 * 60_000,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let lock;
    try {
      lock = await acquireLock();
    } catch (error) {
      if (error.code !== "MUTATION_LOCK_BUSY") throw error;
      await wait();
      continue;
    }
    let stopped = false,
      ready = false;
    try {
      try {
        if (!(await hasCandidate())) return false;
        let state,
          reachable = true;
        try {
          state = await readController();
        } catch (error) {
          // A slow or restarting listener does not authorize a cutover and
          // must not turn a transient read into a service-stop cleanup path.
          if (error.code !== "UPDATER_CONTROLLER_UNAVAILABLE") throw error;
          reachable = false;
        }
        if (reachable && controllerIdle(state) && now() < deadline) {
          await verifyCandidate();
          // Exclude a new operation until the idle controller has stopped. The
          // frozen bootstrap takes the same lock itself, after we release it.
          stopped = true;
          await stopController();
          ready = true;
        }
      } finally {
        await lock.release();
      }
      if (!ready) {
        await wait();
        continue;
      }
      await activate();
      return true;
    } finally {
      if (stopped) {
        // A failed bootstrap may leave a pending journal when recovery itself
        // failed (for example ENOSPC). Never start that uncommitted candidate.
        await recover();
        await startController();
      }
    }
  }
  throw new Error("Timed out waiting for the application operation to commit");
}

const bootstrapRoot = "/opt/latex-renderer/updater/bootstrap-v1";
const execute = promisify(execFile);
export async function readControllerState({
  tokenFile = "/etc/latex-renderer/secrets/update-manager-token",
  socketPath = "/run/latex-renderer/update-manager.sock",
  timeoutMs = 10_000,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("Invalid controller state request timeout");
  const token = (await readFile(tokenFile, "utf8")).trim();
  const unavailable = () =>
    Object.assign(new Error("Controller activation check unavailable"), {
      code: "UPDATER_CONTROLLER_UNAVAILABLE",
    });
  const transportError = (error) =>
    ["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(
      error.code,
    )
      ? unavailable()
      : error;
  const read = (path) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path,
          headers: { Authorization: `Bearer ${token}` },
        },
        (response) => {
          let size = 0;
          const chunks = [];
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024)
              req.destroy(
                new Error("Unbounded controller activation response"),
              );
            else chunks.push(chunk);
          });
          response.on("error", (error) => reject(transportError(error)));
          response.on("end", () => {
            try {
              if (response.statusCode !== 200)
                throw Object.assign(
                  [502, 503, 504].includes(response.statusCode)
                    ? unavailable()
                    : new Error("Controller activation check failed"),
                  { statusCode: response.statusCode },
                );
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      // Absolute deadline also bounds a peer that keeps sending small chunks.
      const timer = globalThis.setTimeout(
        () => req.destroy(unavailable()),
        timeoutMs,
      );
      req.once("close", () => globalThis.clearTimeout(timer));
      req.on("error", (error) => {
        reject(transportError(error));
      });
      req.end();
    });
  try {
    return await read("/v1/activation-state");
  } catch (error) {
    // Historical, independently rolled-back controllers expose only /state.
    // An authentication failure or corrupt response is never a fallback.
    if (error.statusCode !== 404) throw error;
    return read("/v1/state");
  }
}

async function main() {
  if (process.getuid() !== 0 || process.argv.length !== 2)
    throw new Error("Updater activation requires root and no arguments");
  // Installed separately from current and from the selected controller slot.
  // Only the immutable bootstrap supplies privileged slot/lock operations.
  const { UpdaterSlots } = await import(
    pathToFileURL(join(bootstrapRoot, "updater-slots.mjs"))
  );
  const { acquireMutationLock } = await import(
    pathToFileURL(join(bootstrapRoot, "mutation-lock.mjs"))
  );
  const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
  const systemctl = (...args) =>
    execute("/usr/bin/systemctl", args, { timeout: 120_000 });
  await activateAfterOperation({
    acquireLock: acquireMutationLock,
    hasCandidate: async () => {
      const state = await slots.state();
      if (state.pending)
        throw new Error("Recover interrupted Updater activation first");
      return Boolean(state.candidate);
    },
    verifyCandidate: async () => {
      const state = await slots.state();
      await slots.verify(state.current);
      const { envelope } = await slots.verify(state.candidate);
      const root = await realpath("/opt/latex-renderer/current");
      if (!/^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+$/.test(root))
        throw new Error("Invalid application release for activation");
      const path = join(root, ".latex-renderer-updater.json"),
        info = await lstat(path);
      if (
        !info.isFile() ||
        info.uid !== 0 ||
        info.mode & 0o022 ||
        info.size > 1024 * 1024
      )
        throw new Error("Unsealed application Updater identity");
      if (
        !(await readFile(path)).equals(
          Buffer.from(JSON.stringify(envelope) + "\n"),
        )
      )
        throw new Error(
          "Updater candidate does not match the installed application",
        );
    },
    readController: readControllerState,
    stopController: () => stopUpdaterForActivation(systemctl),
    recover: () =>
      execute(
        "/usr/local/bin/node",
        [
          "--max-old-space-size=64",
          join(bootstrapRoot, "updater-bootstrap.mjs"),
          "recover",
        ],
        { timeout: 120_000 },
      ),
    startController: () =>
      systemctl("start", "latex-renderer-update-manager.service"),
    activate: () =>
      execute(
        "/usr/local/bin/node",
        [
          "--max-old-space-size=64",
          join(bootstrapRoot, "updater-bootstrap.mjs"),
          "activate",
        ],
        { timeout: 240_000 },
      ),
  });
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === (await realpath(process.argv[1]))
)
  await main();
