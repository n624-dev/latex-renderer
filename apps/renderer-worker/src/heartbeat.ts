import { writeWorkerHealth } from "../../../deploy/scripts/worker-health.mjs";
import type { RendererDatabase } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";

export function startWorkerHeartbeat(
  database: RendererDatabase,
  workerId: string,
  healthFile?: string,
): () => void {
  let healthWriteFailed = false;
  const heartbeat = (stopping = false) => {
    const at = nowIso();
    database.settings.upsert(
      "worker_heartbeat",
      { workerId, at, stopping },
      workerId,
      at,
    );
    if (healthFile) {
      try {
        writeWorkerHealth(healthFile, {
          at,
          stopping,
          mode: database.settings.value<string>("worker_mode", "running"),
        });
        healthWriteFailed = false;
      } catch {
        // A passive status record is not part of the job/lease heartbeat.
        // Keep processing, report once until recovery, and let stale health
        // become unavailable instead of presenting it as current.
        if (!healthWriteFailed)
          console.error(
            JSON.stringify({ event: "renderer_worker.passive_health_failed" }),
          );
        healthWriteFailed = true;
      }
    }
  };

  heartbeat();
  const timer = setInterval(() => {
    try {
      heartbeat();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "renderer_worker.heartbeat_failed",
          message:
            error instanceof Error ? error.message : "Unknown heartbeat error",
        }),
      );
    }
  }, 10_000);
  timer.unref();

  return () => {
    clearInterval(timer);
    heartbeat(true);
  };
}
