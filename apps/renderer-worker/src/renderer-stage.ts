import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import type { WorkerConfig } from "./config.js";
import { inspectOutputTree } from "./artifact-validator.js";
import {
  dockerStopVerified,
  RendererCleanupDeferred,
  spawnRenderer,
  type RendererStageOptions,
} from "./docker.js";

/** A single isolated stage. Never start the next stage until monitors, stop
 * requests, the Docker CLI and (on uncertain exit) the daemon are settled. */
export async function runRendererStage(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
  input: string,
  staging: string,
  options: RendererStageOptions,
  timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean; stderr: string }> {
  const renderer = spawnRenderer(
    config,
    job.id,
    job.lease_generation,
    input,
    staging,
    job.entrypoint,
    ["pdf", "svg"],
    options,
  );
  let closed = false,
    uncertain = false,
    timedOut = false,
    stderr = "",
    monitorFailure: unknown;
  let monitoring: Promise<void> | undefined,
    stopping: Promise<void> | undefined;
  const requestStop = () =>
    (stopping ??= dockerStopVerified(renderer.containerName).finally(() => {
      if (!closed) renderer.process.kill("SIGKILL");
    }));
  renderer.process.stdout.resume();
  renderer.process.stderr.setEncoding("utf8");
  renderer.process.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16384);
  });
  const exited = new Promise<number>((resolve, reject) => {
    renderer.process.once("error", reject);
    renderer.process.once("close", (code, signal) => {
      closed = true;
      uncertain = signal !== null || code !== 0;
      resolve(code ?? 125);
    });
  });
  const monitor = setInterval(() => {
    if (monitoring) return;
    monitoring = (async () => {
      const row = database.worker.runtimeState(job.id);
      if (
        !row ||
        row.lease_owner !== config.workerId ||
        row.lease_generation !== job.lease_generation ||
        row.status !== "running" ||
        row.cancel_requested_at !== null
      ) {
        await requestStop();
        return;
      }
      await inspectOutputTree(config, staging);
    })()
      .catch(async (error: unknown) => {
        monitorFailure ??= error;
        await requestStop().catch(() => {});
      })
      .finally(() => {
        monitoring = undefined;
      });
  }, 1000);
  const timer = setTimeout(
    () => {
      timedOut = true;
      uncertain = true;
      void requestStop().catch(() => {});
    },
    Math.max(1, timeoutMs),
  );
  timer.unref();
  try {
    const exitCode = await exited;
    clearInterval(monitor);
    await monitoring;
    if (monitorFailure !== undefined) throw monitorFailure;
    return { exitCode, timedOut, stderr };
  } finally {
    clearInterval(monitor);
    clearTimeout(timer);
    await monitoring;
    try {
      if (!closed || uncertain || stopping) await requestStop();
    } catch (error) {
      throw new RendererCleanupDeferred(
        "Renderer stage cleanup could not be verified",
        { cause: error },
      );
    } finally {
      if (!closed) renderer.process.kill("SIGKILL");
    }
  }
}
