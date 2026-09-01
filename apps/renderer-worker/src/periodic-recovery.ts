import type { RendererDatabase } from "@latex-renderer/database";
import type { WorkerConfig } from "./config.js";
import { recoverStaleLeases } from "./recovery.js";

export function createPeriodicLeaseRecovery(
  database: RendererDatabase,
  config: WorkerConfig,
  intervalMs = 10_000,
): () => Promise<void> {
  let nextRecoveryAt = Date.now() + intervalMs;
  return async () => {
    if (Date.now() < nextRecoveryAt) return;
    try {
      await recoverStaleLeases(database, config);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "renderer_worker.lease_recovery_failed",
          message:
            error instanceof Error
              ? error.message
              : "Unknown lease recovery error",
        }),
      );
    } finally {
      nextRecoveryAt = Date.now() + intervalMs;
    }
  };
}
