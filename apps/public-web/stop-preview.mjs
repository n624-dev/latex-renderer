import { setTimeout as delay } from "node:timers/promises";

export async function stopPreview(worker, exited, timeout = 5_000) {
  const timer = new globalThis.AbortController();
  try {
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill("SIGTERM");
    if (
      (await Promise.race([
        exited,
        delay(timeout, "timeout", { signal: timer.signal }),
      ])) === "timeout"
    ) {
      worker.kill("SIGKILL");
      await exited;
    }
  } finally {
    // A losing promise still keeps its timer alive unless explicitly cancelled.
    timer.abort();
  }
}
