import type { RendererDatabase } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";

export function startWorkerHeartbeat(
  database: RendererDatabase,
  workerId: string,
): () => void {
  const heartbeat = (stopping = false) =>
    database.settings.upsert(
      "worker_heartbeat",
      { workerId, at: nowIso(), stopping },
      workerId,
      nowIso(),
    );

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
