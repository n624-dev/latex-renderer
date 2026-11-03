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
import { httpServiceStatus } from "./http-services.mjs";
import { workerHasDemand } from "./worker-demand.mjs";
import { request } from "node:http";

// Volatile, non-secret liveness only. The dedicated RuntimeDirectory is owned
// by the worker and readable, never writable, by the Web service's group.
export function writeWorkerHealth(path, { at, mode, stopping }) {
  if (!["running", "paused", "draining"].includes(mode))
    throw new Error("Invalid worker health mode");
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
export function readWorkerHealth({
  path = "/run/latex-renderer-worker-health/state.json",
  now = Date.now(),
  databasePath = process.env.DATABASE_PATH,
  run = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
} = {}) {
  let descriptor;
  try {
    const directory = dirname(path),
      dir = lstatSync(directory);
    if (
      !dir.isDirectory() ||
      dir.mode & 0o022 ||
      realpathSync(directory) !== directory
    )
      throw new Error("Unsafe health directory");
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (
      !info.isFile() ||
      info.uid !== dir.uid ||
      info.nlink !== 1 ||
      info.mode & 0o022 ||
      info.size > 4096
    )
      throw new Error("Unsafe health record");
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    const values = Object.fromEntries(
      run(
        "show",
        "--property=ActiveState,MainPID",
        "--no-pager",
        "latex-renderer-worker.service",
      )
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    const age = now - Date.parse(value.at);
    const fresh =
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 30_000 &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 1 &&
      String(value.pid) === values.MainPID &&
      values.ActiveState === "active";
    if (!fresh) throw new Error("Worker heartbeat is not active");
    return {
      operational:
        fresh && value.mode === "running" && value.stopping === false,
      state: fresh ? value.mode : "unavailable",
    };
  } catch {
    let database;
    try {
      if (
        httpServiceStatus("latex-renderer-worker.service", { run }).state !==
          "idle" ||
        !databasePath
      )
        return { operational: false, state: "unavailable" };
      database = new DatabaseSync(databasePath, { readOnly: true });
      database.exec("PRAGMA busy_timeout=100");
      const row = database
        .prepare(
          "SELECT value_json FROM system_settings WHERE key='worker_mode'",
        )
        .get();
      const mode = row ? JSON.parse(row.value_json) : "running";
      const demand = workerHasDemand(database);
      return {
        operational: mode === "running" && !demand,
        state: demand ? "unavailable" : mode === "running" ? "idle" : mode,
      };
    } catch {
      return { operational: false, state: "unavailable" };
    } finally {
      database?.close();
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
