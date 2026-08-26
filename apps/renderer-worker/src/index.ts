import { RendererDatabase } from "@latex-renderer/database";
import { AppError } from "@latex-renderer/shared";
import { loadWorkerConfig } from "./config.js";
import { assertDockerIsolation } from "./docker.js";
import { recordFailure } from "./failure.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { processJob } from "./job-processor.js";
import { claimNextJob } from "./queue.js";
import { recoverStaleLeases } from "./recovery.js";

const config = loadWorkerConfig();
const database = new RendererDatabase(config.databasePath);
database.migrate();
await assertDockerIsolation(config.apparmorProfile);
await recoverStaleLeases(database, config);

const shutdown = new AbortController();
process.on("SIGTERM", () => shutdown.abort());
process.on("SIGINT", () => shutdown.abort());
console.log(JSON.stringify({ event: "renderer_worker.started", workerId: config.workerId }));
const stopHeartbeat = startWorkerHeartbeat(database, config.workerId);

let nextLeaseRecoveryAt = Date.now() + 10_000;
while (!shutdown.signal.aborted) {
  // Startup recovery can miss a lease that remains valid for a few seconds
  // after an unclean worker stop. Re-check between jobs so such rows cannot
  // remain in running/validating forever after the lease subsequently expires.
  if (Date.now() >= nextLeaseRecoveryAt) {
    try {
      await recoverStaleLeases(database, config);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "renderer_worker.lease_recovery_failed",
          message: error instanceof Error ? error.message : "Unknown lease recovery error",
        }),
      );
    }
    nextLeaseRecoveryAt = Date.now() + 10_000;
  }

  const mode = database.settings.value<string>("worker_mode", "running");
  if (mode === "draining" || mode === "paused") {
    await delay(1000);
    continue;
  }
  const job = claimNextJob(database, config.workerId);
  if (job === undefined) {
    await delay(1000);
    continue;
  }
  try {
    await processJob(database, config, job);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown renderer error";
    const rejected = error instanceof AppError && error.status === 422;
    await recordFailure(
      database,
      config,
      job.id,
      message,
      rejected ? error.code : "RENDERER_FAILED",
      rejected ? "rejected" : "failed",
    );
    console.error(JSON.stringify({ event: "renderer_worker.job_failed", jobId: job.id, message }));
  }
}

stopHeartbeat();
database.close();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
