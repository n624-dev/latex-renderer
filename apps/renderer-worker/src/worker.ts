import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";
import { assertDockerIsolation, RendererCleanupDeferred } from "./docker.js";
import { recordFailure } from "./failure.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { processJob } from "./job-processor.js";
import { createPeriodicLeaseRecovery } from "./periodic-recovery.js";
import { claimNextJob } from "./queue.js";
import {
  assessHostResources,
  readHostResources,
  resourceWaitMessage,
} from "./admission.js";
import { planRenderMemory, rememberRenderMemory } from "./memory-plan.js";
import { diagnosticWriter } from "../../../deploy/scripts/service-diagnostics.mjs";
import { recoverStaleLeases } from "./recovery.js";
import { processPreview, recoverPreviewRequests } from "./preview-processor.js";
import {
  collectSourceTrees,
  recoverSourceTreeReaders,
} from "./source-tree-cache.js";

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
  await recoverPreviewRequests(database, config);
  console.log(
    JSON.stringify({
      event: "renderer_worker.started",
      workerId: config.workerId,
    }),
  );
  const stopHeartbeat = startWorkerHeartbeat(database, config.workerId),
    recoverExpiredLeases = createPeriodicLeaseRecovery(database, config);
  const isShuttingDown = () => signal.aborted;
  const diagnostic = diagnosticWriter(config.storageRoot, "renderer-worker");
  config.diagnostic = diagnostic;
  let nextResourceCheck = 0,
    admission: ReturnType<typeof assessHostResources> = "ready",
    previousAdmission = "";
  let resources = readHostResources();
  let admissionAfter: { queued_at: string; id: string } | undefined;
  let preferPreview = false,
    nextPreviewRecovery = 0;
  let nextSourceTreeCollection = 0;
  try {
    while (!isShuttingDown()) {
      await recoverExpiredLeases();
      if (Date.now() >= nextSourceTreeCollection) {
        try {
          await recoverSourceTreeReaders(database);
          await collectSourceTrees(
            database.raw,
            config.storageRoot,
            false,
            32,
            config.sourceTreeMaxBytes ?? 64 * 1024 ** 2,
            config.sourceTreeUserMaxBytes ?? 32 * 1024 ** 2,
          );
        } catch {
          diagnostic({ event: "renderer_worker.source_tree_gc_failed" });
        }
        nextSourceTreeCollection = Date.now() + 15 * 60_000;
      }
      if (Date.now() >= nextPreviewRecovery) {
        await recoverPreviewRequests(database, config);
        nextPreviewRecovery = Date.now() + 10_000;
      }
      if (isShuttingDown()) break;
      for (const id of awaitingRecovery) {
        const row = database.worker.runtimeState(id);
        if (
          !row ||
          (!["running", "validating"].includes(row.status) &&
            !(row.status === "canceled" && row.lease_owner !== null))
        )
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
      if (
        config.minimumAvailableMemoryBytes !== undefined &&
        Date.now() >= nextResourceCheck
      ) {
        resources = readHostResources();
        nextResourceCheck = Date.now() + 5000;
      }
      let candidates = database.worker.admissionCandidates(admissionAfter);
      if (!candidates.length && admissionAfter) {
        admissionAfter = undefined;
        candidates = database.worker.admissionCandidates();
      }
      const planned = candidates.map((candidate) => {
        const plan = planRenderMemory(
          database,
          candidate,
          config.image,
          config.minimumAvailableMemoryBytes,
        );
        const state: ReturnType<typeof assessHostResources> =
          plan.minimum === undefined
            ? "ready"
            : assessHostResources(resources, plan.minimum);
        database.worker.setAdmissionReason(
          state !== "ready",
          nowIso(),
          candidate.id,
          resourceWaitMessage(
            state,
            resources,
            plan.minimum ?? 0,
            Date.now() - Date.parse(candidate.queued_at) >=
              (config.admissionWaitTimeoutMs ?? 900000),
          ),
        );
        // Preserve literal states on the returned object; annotating the local
        // variable alone still allows map's mutable properties to widen.
        return { candidate, plan, state } as const;
      });
      const selected = planned.find((p) => p.state === "ready");
      admissionAfter = selected ? undefined : candidates.at(-1);
      const plan =
        selected?.plan ??
        planned[0]?.plan ??
        planRenderMemory(
          database,
          undefined,
          config.image,
          config.minimumAvailableMemoryBytes,
        );
      admission =
        selected?.state ??
        planned[0]?.state ??
        (plan.minimum === undefined
          ? "ready"
          : assessHostResources(resources, plan.minimum));
      if (admission !== previousAdmission) {
        diagnostic({ event: "renderer_worker.admission", state: admission });
        database.settings.upsert(
          "worker_admission",
          {
            state: admission,
            checkedAt: nowIso(),
            availableBytes: resources.availableBytes,
            requiredBytes: plan.minimum ?? null,
            containerMemoryBytes: plan.limit,
          },
          "system",
          nowIso(),
        );
        previousAdmission = admission;
      }
      // Alternate waiting preview work and ordinary Jobs. A small conversion
      // may proceed below the 1GiB renderer gate, never under memory/I/O pressure.
      if (
        (preferPreview ||
          admission !== "ready" ||
          !database.worker.nextQueued()) &&
        (config.minimumAvailableMemoryBytes === undefined ||
          assessHostResources(readHostResources(), 384 * 1024 * 1024) ===
            "ready")
      ) {
        const preview = database.transaction(() =>
          database.previews.claim(config.workerId, nowIso()),
        );
        if (preview) {
          preferPreview = false;
          try {
            await processPreview(database, config, preview);
          } catch (error) {
            if (!(error instanceof RendererCleanupDeferred)) throw error;
            diagnostic({
              event: "renderer_worker.preview_cleanup_deferred",
              jobId: preview.job_id,
              page: preview.page,
            });
          }
          continue;
        }
      }
      if (admission !== "ready") {
        // Resource waiting is not a failed rendering. The old configured
        // interval now controls the long-wait notice, never a fake failure.
        await idleDelay();
        continue;
      }
      const job = selected
        ? claimNextJob(
            database,
            config.workerId,
            undefined,
            selected.candidate.id,
          )
        : claimNextJob(database, config.workerId);
      if (job === undefined) {
        await idleDelay();
        continue;
      }
      const samples = new Map<string, number>();
      const completeRun = !database.artifacts.hasPublishedPdf(job.id);
      const executionConfig: WorkerConfig = {
        ...config,
        containerMemoryBytes: plan.limit,
      };
      if (config.minimumAvailableMemoryBytes !== undefined)
        executionConfig.observeContainerMemory = (container, peak) => {
          samples.set(container, Math.max(samples.get(container) ?? 0, peak));
        };
      try {
        await processJob(database, executionConfig, job);
        const terminal = database.jobs.get(job.id);
        const requiredSamples = job.outputs_json.includes('"svg"') ? 2 : 1;
        const peak =
          samples.size >= requiredSamples
            ? Math.max(...samples.values())
            : undefined;
        if (
          terminal?.status === "succeeded" &&
          terminal.lease_generation === job.lease_generation &&
          completeRun
        )
          rememberRenderMemory(database, selected?.plan.key, peak, true);
        else if (terminal?.error_code === "RENDERER_MEMORY_LIMIT")
          rememberRenderMemory(database, selected?.plan.key, undefined, false);
        diagnostic({
          event: "renderer_worker.memory_result",
          jobId: job.id,
          memoryPeakBytes: peak ?? null,
          memoryLimitBytes: plan.limit,
          result: terminal?.status ?? "unknown",
        });
        preferPreview = true;
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
        if (error instanceof AppError && error.code === "RENDERER_MEMORY_LIMIT")
          rememberRenderMemory(database, selected?.plan.key, undefined, false);
        await recordFailure(
          database,
          config,
          job,
          message,
          error instanceof AppError &&
            (rejected ||
              database.outputStages.checkpoint(job.id) !== undefined ||
              database.artifacts.hasPublishedPdf(job.id))
            ? error.code
            : "RENDERER_FAILED",
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
