import type { RendererDatabase } from "@latex-renderer/database";
import { AppError } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";
import { assertDockerIsolation, RendererCleanupDeferred } from "./docker.js";
import { recordFailure } from "./failure.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { processJob } from "./job-processor.js";
import { createPeriodicLeaseRecovery } from "./periodic-recovery.js";
import { claimNextJob } from "./queue.js";
import { recoverStaleLeases } from "./recovery.js";

export async function runWorker(
  database: RendererDatabase,
  config: WorkerConfig,
  signal: AbortSignal,
  {
    idleDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  }: { idleDelay?: () => Promise<void> } = {},
): Promise<void> {
  const previousHeartbeat = database.settings.value<{
    workerId?: unknown;
  } | null>("worker_heartbeat", null);
  if (
    previousHeartbeat !== null &&
    typeof previousHeartbeat.workerId !== "string"
  )
    throw new Error("Worker heartbeat identity is invalid");
  // A killed worker can leave a still-valid lease. Wait for recovery, not just
  // for the next process to start, before creating another daemon container.
  const awaitingRecovery = new Set(
    previousHeartbeat?.workerId === undefined
      ? []
      : database.worker.ownedActiveJobIds(previousHeartbeat.workerId as string),
  );
  await assertDockerIsolation(config.apparmorProfile);
  await recoverStaleLeases(database, config);
  console.log(
    JSON.stringify({
      event: "renderer_worker.started",
      workerId: config.workerId,
    }),
  );
  const stopHeartbeat = startWorkerHeartbeat(database, config.workerId),
    recoverExpiredLeases = createPeriodicLeaseRecovery(database, config);
  const isShuttingDown = () => signal.aborted;
  try {
    while (!isShuttingDown()) {
      await recoverExpiredLeases();
      if (isShuttingDown()) break;
      for (const id of awaitingRecovery) {
        const row = database.worker.runtimeState(id);
        if (!row || !["running", "validating"].includes(row.status))
          awaitingRecovery.delete(id);
      }
      if (awaitingRecovery.size) {
        await idleDelay();
        continue;
      }
      const mode = database.settings.value<string>("worker_mode", "running");
      if (mode === "draining" || mode === "paused") {
        await idleDelay();
        continue;
      }
      const job = claimNextJob(database, config.workerId);
      if (job === undefined) {
        await idleDelay();
        continue;
      }
      try {
        await processJob(database, config, job);
      } catch (error) {
        if (error instanceof RendererCleanupDeferred) {
          awaitingRecovery.add(job.id);
          console.error(
            JSON.stringify({
              event: "renderer_worker.cleanup_deferred",
              jobId: job.id,
              reason: "container_state_unavailable",
            }),
          );
          continue;
        }
        const message =
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "Unknown renderer error",
          rejected = error instanceof AppError && error.status === 422;
        await recordFailure(
          database,
          config,
          job,
          message,
          rejected ? error.code : "RENDERER_FAILED",
          rejected ? "rejected" : "failed",
        );
        console.error(
          JSON.stringify({
            event: "renderer_worker.job_failed",
            jobId: job.id,
            message,
          }),
        );
      }
    }
  } finally {
    stopHeartbeat();
  }
}
