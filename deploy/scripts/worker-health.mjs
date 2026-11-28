import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  renameSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { workerHasDemand } from "./worker-demand.mjs";
import { request } from "node:http";

const workerModes = new Set(["running", "paused", "draining"]);
const workerService = "latex-renderer-worker.service";
const workerSocket = "latex-renderer-worker.socket";

export function isWorkerHeartbeatFresh(at, now = Date.now()) {
  if (typeof at !== "string") return false;
  const age = now - Date.parse(at);
  // Keep the clock-skew and expiry bounds in sync with passive-health.py.
  return age >= -1_000 && age <= 30_000;
}

// Volatile, non-secret liveness only. The dedicated RuntimeDirectory is owned
// by the worker and readable, never writable, by the Web service's group.
export function writeWorkerHealth(path, { at, mode, stopping }) {
  if (!workerModes.has(mode)) throw new Error("Invalid worker health mode");
  const directory = dirname(path),
    info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid() ||
    info.mode & 0o022 ||
    realpathSync(directory) !== directory
  )
    throw new Error("Unsafe worker health directory");
  const temporary = `${path}.${randomUUID()}`;
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ pid: process.pid, at, mode, stopping }),
      { mode: 0o640, flag: "wx" },
    );
    chmodSync(temporary, 0o640);
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort removal must not replace the primary publication error.
    }
  }
}

export async function readPassiveWorkerHealth() {
  const current = readWorkerHealth();
  if (current.state !== "unavailable") return current;
  return new Promise((resolve) => {
    const fallback = () => resolve(current);
    const call = request(
      {
        socketPath: "/run/latex-renderer-status/status.sock",
        path: "/health/rendering",
        timeout: 4000,
      },
      (response) => {
        let text = "";
        response.on("data", (data) => {
          text += String(data);
          if (text.length > 4096) response.destroy();
        });
        response.once("error", fallback);
        response.once("end", () => {
          try {
            const value = JSON.parse(text);
            if (
              ![200, 503].includes(response.statusCode) ||
              typeof value.rendering !== "boolean" ||
              ![
                "running",
                "idle",
                "paused",
                "draining",
                "unavailable",
              ].includes(value.worker)
            )
              return fallback();
            resolve({ operational: value.rendering, state: value.worker });
          } catch {
            fallback();
          }
        });
      },
    );
    call.once("error", fallback);
    call.once("timeout", () => call.destroy());
    call.end();
  });
}
function readWorkerHeartbeat(path) {
  const directory = dirname(path),
    dir = lstatSync(directory);
  if (
    !dir.isDirectory() ||
    dir.mode & 0o022 ||
    realpathSync(directory) !== directory
  )
    throw new Error("Unsafe health directory");
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(descriptor);
    if (
      !info.isFile() ||
      info.uid !== dir.uid ||
      info.nlink !== 1 ||
      info.mode & 0o022 ||
      info.size > 4096
    )
      throw new Error("Unsafe health record");
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

export function readWorkerHealth({
  path = "/run/latex-renderer-worker-health/state.json",
  now = Date.now(),
  databasePath = process.env.DATABASE_PATH ??
    "/var/lib/latex-renderer/renderer.sqlite3",
  run = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 16_384,
      stdio: ["ignore", "pipe", "pipe"],
    }),
} = {}) {
  const unavailable = { operational: false, state: "unavailable" };
  try {
    const output = run(
      "show",
      "--no-pager",
      "--property=Id,LoadState,ActiveState,SubState,Result,MainPID",
      workerService,
      workerSocket,
    );
    const units = new Map(
      output
        .trim()
        .split(/\n\s*\n/)
        .map((block) => {
          const unit = Object.fromEntries(
            block.split("\n").map((line) => line.split("=")),
          );
          return [unit.Id, unit];
        }),
    );
    const service = units.get(workerService),
      socket = units.get(workerSocket);
    if (
      !databasePath ||
      units.size !== 2 ||
      service?.LoadState !== "loaded" ||
      service.Result !== "success" ||
      !socket ||
      socket.ActiveState === "failed"
    )
      return unavailable;

    const running = service.ActiveState === "active";
    const idle =
      service.ActiveState === "inactive" &&
      socket.ActiveState === "active" &&
      socket.SubState === "listening";
    if (!running && !idle) return unavailable;

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      database.exec("PRAGMA busy_timeout=100; PRAGMA cache_size=-256");
      const row = database
        .prepare(
          "SELECT value_json FROM system_settings WHERE key='worker_mode'",
        )
        .get();
      const mode = row ? JSON.parse(row.value_json) : "running";
      if (!workerModes.has(mode)) return unavailable;

      if (idle) {
        if (
          workerHasDemand(database, {
            includeMaintenance: false,
            now: new Date(now).toISOString(),
          })
        )
          return unavailable;
      } else {
        const heartbeat = readWorkerHeartbeat(path);
        if (
          !isWorkerHeartbeatFresh(heartbeat.at, now) ||
          !Number.isSafeInteger(heartbeat.pid) ||
          heartbeat.pid <= 1 ||
          String(heartbeat.pid) !== service.MainPID ||
          heartbeat.stopping !== false
        )
          return unavailable;
      }
      return {
        operational: mode === "running",
        state: idle && mode === "running" ? "idle" : mode,
      };
    } finally {
      database.close();
    }
  } catch {
    return unavailable;
  }
}
