import { RendererDatabase } from "@latex-renderer/database";
import { loadWorkerConfig } from "./config.js";
import { runWorker } from "./worker.js";

const config = loadWorkerConfig();
const database = new RendererDatabase(config.databasePath);
database.migrate();
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
try {
  await runWorker(database, config, shutdown.signal);
} finally {
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  database.close();
}
