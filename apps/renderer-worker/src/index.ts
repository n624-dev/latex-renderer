import { RendererDatabase } from "@latex-renderer/database";
import { loadWorkerConfig } from "./config.js";
import { runWorker } from "./worker.js";
import {
  workerIdleConfiguration,
  workerWakeListener,
  workerHasDemand,
  notifyWorker,
} from "../../../deploy/scripts/worker-demand.mjs";

const config = loadWorkerConfig();
const database = new RendererDatabase(config.databasePath);
database.migrate();
const shutdown = new AbortController();
const idle = workerIdleConfiguration();
const listener = await workerWakeListener();
const stop = () => shutdown.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
try {
  await runWorker(
    database,
    config,
    shutdown.signal,
    listener && idle.enabled
      ? {
          idle: {
            timeoutMs: idle.timeoutMs,
            initialMaintenance: !workerHasDemand(database.raw),
          },
        }
      : {},
  );
} finally {
  const closed = listener?.close();
  // A commit racing the last loop check must be queued on systemd's retained
  // listener for the next process. Do not await an ACK from this closing one.
  if (!shutdown.signal.aborted && listener && workerHasDemand(database.raw))
    void notifyWorker();
  await closed;
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  database.close();
}
