import { createConnection, createServer } from "node:net";
import { fstatSync } from "node:fs";
import { assertUnixListener } from "./activation-socket.mjs";
import { boundedIntegerEnvironment } from "./environment.mjs";

export const WORKER_WAKE_PATH = "/run/latex-renderer-worker/wake.sock";

export function workerIdleConfiguration(environment = process.env) {
  const enabled = environment.WORKER_IDLE_ENABLED ?? "false";
  if (!["true", "false"].includes(enabled))
    throw new Error("WORKER_IDLE_ENABLED must be true or false");
  return {
    enabled: enabled === "true",
    timeoutMs:
      1000 *
      boundedIntegerEnvironment(
        environment,
        "WORKER_IDLE_TIMEOUT_SECONDS",
        900,
        30,
        86400,
      ),
  };
}

// The database, including cleanup leases, is authoritative. Notifications only
// reduce latency; neither a lost hint nor an old heartbeat can erase work.
export function workerHasDemand(database) {
  return (
    database
      .prepare(
        `SELECT
    EXISTS(SELECT 1 FROM jobs WHERE status IN ('queued','validating','running') OR lease_owner IS NOT NULL)
    OR EXISTS(SELECT 1 FROM job_preview_requests WHERE status IN ('queued','running') OR lease_owner IS NOT NULL)
    OR EXISTS(SELECT 1 FROM source_tree_readers)
    OR EXISTS(SELECT 1 FROM source_trees WHERE status IN ('building','deleting')) AS pending`,
      )
      .get().pending === 1
  );
}

export function notifyWorker({
  path = WORKER_WAKE_PATH,
  timeoutMs = 1000,
} = {}) {
  return new Promise((resolve) => {
    const socket = createConnection({ path });
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(success);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write("w"));
    socket.on("data", (data) => finish(data.toString() === "ok"));
    socket.on("end", () => finish(false));
  });
}

let notification;
let lastNotice = 0;
export function notifyWorkerAfterCommit(database, environment = process.env) {
  try {
    if (!workerIdleConfiguration(environment).enabled || notification) return;
    if (!workerHasDemand(database)) return;
    notification = notifyWorker()
      .then((success) => {
        if (!success && Date.now() - lastNotice >= 60_000) {
          lastNotice = Date.now();
          console.error(
            JSON.stringify({ event: "renderer_worker.wake_deferred" }),
          );
        }
      })
      .finally(() => {
        notification = undefined;
      });
  } catch {
    // The transaction is already committed: never report it as rolled back.
    // The independent reconciler reports corrupt/unreadable state as failure.
    console.error(
      JSON.stringify({ event: "renderer_worker.wake_state_error" }),
    );
  }
}

export async function workerWakeListener(
  environment = process.env,
  { path = WORKER_WAKE_PATH } = {},
) {
  const supplied = ["LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"].some(
    (key) => environment[key] !== undefined,
  );
  if (!supplied) return undefined;
  try {
    if (
      environment.LISTEN_PID !== String(process.pid) ||
      environment.LISTEN_FDS !== "1" ||
      environment.LISTEN_FDNAMES !== "worker" ||
      !fstatSync(3).isSocket()
    )
      throw new Error("Invalid Worker activation descriptor");
    // Node reports null for address() on inherited Unix listeners. Validate
    // the kernel inode, listening stream type and fixed local path instead.
    assertUnixListener(3, path);
  } finally {
    for (const key of [
      "LISTEN_PID",
      "LISTEN_FDS",
      "LISTEN_FDNAMES",
      "LISTEN_PIDFDID",
    ])
      delete environment[key];
  }
  const server = createServer((socket) => {
    socket.setTimeout(1000, () => socket.destroy());
    socket.once("error", () => socket.destroy());
    socket.once("data", (data) =>
      data.toString() === "w" ? socket.end("ok") : socket.destroy(),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ fd: 3 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close() {
      // Initiate closure synchronously: no accepted notification can race an
      // await between the final database check and releasing our listener FD.
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
