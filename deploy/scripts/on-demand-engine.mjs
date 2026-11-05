import { spawn, execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runtimeMode } from "./runtime-mode.mjs";

export const ENGINE_LOCK_PATH = "/run/latex-renderer-engine/engine.lock";
export async function acquireEngineLock({
  path = ENGINE_LOCK_PATH,
  exclusive = false,
} = {}) {
  const parent = dirname(path),
    directory = await lstat(parent);
  if (
    !directory.isDirectory() ||
    directory.mode & 0o022 ||
    (await realpath(parent)) !== parent
  )
    throw new Error("Unsafe engine lock directory");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o002)
      throw new Error("Unsafe engine lock inode");
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/flock",
        [
          exclusive ? "--exclusive" : "--shared",
          "--nonblock",
          "--conflict-exit-code",
          "75",
          "3",
        ],
        { stdio: ["ignore", "ignore", "ignore", file.fd] },
      );
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) {
      const error = new Error(
        code === 75
          ? "Engine state is being changed"
          : "Cannot lock container engine",
      );
      if (code === 75) error.code = "ENGINE_BUSY";
      throw error;
    }
    return { release: () => file.close() };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export function workerEngineCommand(
  command,
  args,
  { run = execFileSync, timeout = 120000 } = {},
) {
  const uid = Number(
    run("/usr/bin/id", ["-u", "latex-render-worker"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim(),
  );
  if (!Number.isSafeInteger(uid) || uid < 1)
    throw new Error("Invalid dedicated engine user");
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/var/lib/latex-render-worker",
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
    XDG_CONFIG_HOME: "/var/lib/latex-render-worker/.config",
    XDG_DATA_HOME: "/var/lib/latex-render-worker/.local/share",
    XDG_CACHE_HOME: "/var/lib/latex-render-worker/.cache",
    DOCKER_CONFIG: "/var/lib/latex-render-worker/.docker",
    DOCKER_HOST: `unix:///run/user/${uid}/docker.sock`,
  };
  if (process.getuid() === 0)
    return run(
      "/usr/sbin/runuser",
      [
        "-u",
        "latex-render-worker",
        "--",
        "/usr/bin/env",
        "-i",
        ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
        command,
        ...args,
      ],
      { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] },
    );
  if (process.getuid() !== uid)
    throw new Error("Only the dedicated worker can control its engine");
  return run(command, args, {
    env,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let engineReady;
async function prepareEngineLease() {
  const deadline = Date.now() + 120000;
  let lock;
  while (!lock) {
    try {
      lock = await acquireEngineLock();
    } catch (error) {
      if (error.code !== "ENGINE_BUSY" || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
  try {
    workerEngineCommand("/usr/bin/systemctl", [
      "--user",
      "start",
      "docker.service",
    ]);
    return lock;
  } catch (error) {
    await lock.release();
    throw error;
  }
}
async function prepareEngine() {
  const lock = await prepareEngineLease();
  // Retain one shared FD for short-lived consumers such as memory sampling.
  process.once("beforeExit", () => {
    void lock.release();
  });
}

async function prepareScopedEngine() {
  const lock = await prepareEngineLease();
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      let output;
      try {
        output = workerEngineCommand(
          "/usr/bin/docker",
          ["info", "--format", "{{json .SecurityOptions}}"],
          { timeout: Math.max(1, deadline - Date.now()) },
        );
      } catch (error) {
        if (Date.now() >= deadline)
          throw new Error("Dedicated rootless Docker did not become ready", {
            cause: error,
          });
        await delay(500);
        continue;
      }
      const security = JSON.parse(output);
      if (!Array.isArray(security) || !security.includes("name=rootless"))
        throw new Error("Dedicated rootless Docker identity is invalid");
      return lock;
    }
  } catch (error) {
    await lock.release();
    throw error;
  }
}

// A setup Web session may live for hours. Hold protection only around the
// review/inspection, so idle collection can resume after that operation ends.
export async function withScopedContainerEngine(
  operation,
  environment = process.env,
  { prepare = prepareScopedEngine } = {},
) {
  if (runtimeMode(environment) !== "compact") return operation();
  const lock = await prepare();
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
export async function withContainerEngine(
  operation,
  environment = process.env,
) {
  if (runtimeMode(environment) !== "compact") return operation();
  engineReady ??= prepareEngine().catch((error) => {
    engineReady = undefined;
    throw error;
  });
  await engineReady;
  return operation();
}
