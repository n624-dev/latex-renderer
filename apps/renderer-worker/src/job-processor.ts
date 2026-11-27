import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { newId, nowIso } from "@latex-renderer/shared";
import {
  syncArtifactTree,
  syncPublishedAncestors,
} from "../../../deploy/scripts/durable-storage.mjs";
import { prepareSourceInput } from "./source-tree-cache.js";
import {
  inspectOutputTree,
  publishArtifacts,
  readArtifactSinglePass,
  validateArtifacts,
} from "./artifact-validator.js";
import type { WorkerConfig } from "./config.js";
import {
  dockerStop,
  dockerStopVerified,
  RendererCleanupDeferred,
  spawnRenderer,
} from "./docker.js";
import { generateMetadata } from "./metadata.js";
import { classifyRenderResult } from "./render-result.js";
import { processStagedJob } from "./staged-job-processor.js";
import { previewPageCount } from "./preview-metadata.js";
import { rendererRuntimeDigest } from "./config.js";
import {
  identifyDraftWorkCache,
  loadDraftWorkCache,
  storeDraftWorkCache,
} from "./draft-work-cache.js";

export async function processJob(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
): Promise<void> {
  const profile = database.jobs.reproducibility(job.id);
  if (profile !== undefined)
    config = { ...config, reproducibilityEpoch: profile.epochSeconds };

  const subject = database.worker.subjectState(job.id);
  if (
    subject === undefined ||
    subject.user_status !== "active" ||
    subject.sa_status !== "active" ||
    subject.revoked_at !== null ||
    (subject.expires_at !== null && subject.expires_at <= nowIso())
  ) {
    database.transaction(() => {
      const timestamp = nowIso();
      if (
        database.worker.transitionOwned(
          job.id,
          config.workerId,
          job.lease_generation,
          ["validating"],
          "rejected",
          timestamp,
          {
            render_status: "rejected",
            completed_at: timestamp,
            error_code: "ACCOUNT_INACTIVE",
            error_message: "Job owner, service account, or API key is inactive",
            lease_owner: null,
            lease_expires_at: null,
          },
        ) !== 1
      )
        return;
      database.audit({
        actorType: "system",
        actorId: config.workerId,
        action: "render.failed",
        targetType: "job",
        targetId: job.id,
        result: "rejected",
        metadata: { code: "ACCOUNT_INACTIVE" },
      });
    });
    return;
  }
  if (renderOutputs(job.outputs_json).includes("svg"))
    return processStagedJob(database, config, job);
  const lease = { lost: false };
  const leaseIsLost = (): boolean => lease.lost;
  const renewLease = () => {
      if (
        database.worker.heartbeat(
          job.id,
          config.workerId,
          job.lease_generation,
          nowIso(),
          new Date(Date.now() + 30_000).toISOString(),
        ) !== 1
      )
        lease.lost = true;
    },
    leaseHeartbeat = setInterval(renewLease, 10_000);
  leaseHeartbeat.unref();
  const root = join(config.storageRoot, "jobs", job.id),
    source =
      job.source_storage_key === null
        ? join(root, "input", "source.zip")
        : join(config.storageRoot, job.source_storage_key),
    attempt = join(root, "attempts", String(job.lease_generation)),
    work = join(attempt, "work"),
    extracted = join(work, "input"),
    workSeed = join(attempt, "seed"),
    staging = join(attempt, "staging"),
    candidateOutput = join(attempt, "output"),
    output = join(root, "outputs", String(job.lease_generation));
  let published = false,
    committed = false,
    workCacheStored = false;
  let rendererInput = extracted,
    releaseInput = () => {};
  const needsOutputCleanup = (): boolean => published && !committed;
  const needsWorkCacheRelease = (): boolean =>
    workCacheStored && (!published || !committed);
  const rendererState: {
    spawned?: ReturnType<typeof spawnRenderer>;
    closed: boolean;
    uncertain: boolean;
  } = { closed: false, uncertain: false };
  const rendererClosed = () => rendererState.closed;
  let processingFailed = false,
    processingError: unknown;
  try {
    await (async () => {
      const outputs = renderOutputs(job.outputs_json);
      const prepareBegan = performance.now();
      await rm(attempt, { recursive: true, force: true });
      await mkdir(work, { recursive: true, mode: 0o770 });
      await chmod(work, 0o770);
      // The host storage tree carries a default ACL for the rootless renderer
      // subordinate UID/GID.  Group-private modes keep the path inaccessible to
      // unrelated host users while still allowing the mapped container user to
      // write through the bind mount.
      await mkdir(staging, { recursive: true, mode: 0o770 });
      await chmod(staging, 0o770);
      const prepared = await prepareSourceInput(
        database,
        config,
        job,
        source,
        extracted,
      );
      rendererInput = prepared.input;
      releaseInput = prepared.release;
      const startedAt = nowIso();
      const sourcePrepareMs = Math.round(performance.now() - prepareBegan);
      if (
        leaseIsLost() ||
        database.worker.transitionOwned(
          job.id,
          config.workerId,
          job.lease_generation,
          ["validating"],
          "running",
          startedAt,
          {
            started_at: startedAt,
            runtime_digest: rendererRuntimeDigest(config.image),
          },
        ) !== 1
      )
        return;
      const deferFirstPreview = database.drafts.isPreviewJob(job.id);
      const workCache = deferFirstPreview
        ? await identifyDraftWorkCache(database, config, job, rendererInput)
        : undefined;
      const warm =
        workCache &&
        (await loadDraftWorkCache(
          database,
          config,
          workCache,
          job.entrypoint,
          workSeed,
        ));
      const spawned = spawnRenderer(
        config,
        job.id,
        job.lease_generation,
        rendererInput,
        staging,
        job.entrypoint,
        outputs,
        deferFirstPreview
          ? {
              mode: "pdf",
              deferFirstPreview: true,
              ...(warm ? { workSeed } : {}),
            }
          : undefined,
        job.engine,
      );
      rendererState.spawned = spawned;
      spawned.process.stdout.resume();
      let stderr = "";
      spawned.process.stderr.setEncoding("utf8");
      spawned.process.stderr.on("data", (chunk: string) => {
        if (stderr.length < 16_384) stderr += chunk;
      });
      let monitoring = false,
        monitorFailure: unknown,
        monitorRun: Promise<void> | undefined;
      const renderBegan = performance.now();
      const supersedeAfter = config.draftPreviewSupersedeAfterMs ?? 0;
      const monitor = setInterval(() => {
        if (monitoring) return;
        monitoring = true;
        monitorRun = (async () => {
          if (
            deferFirstPreview &&
            supersedeAfter > 0 &&
            performance.now() - renderBegan >= supersedeAfter
          )
            database.drafts.requestOutdatedPreviewStop(
              job.id,
              config.workerId,
              job.lease_generation,
              nowIso(),
            );
          await monitorJob(
            database,
            config,
            job,
            staging,
            spawned.containerName,
          );
        })()
          .catch(async (error: unknown) => {
            monitorFailure ??= error;
            console.error(
              JSON.stringify({
                event: "renderer_worker.monitor_failed",
                jobId: job.id,
                message:
                  error instanceof Error
                    ? error.message
                    : "Unknown monitor error",
              }),
            );
            await dockerStop(spawned.containerName).catch(() => undefined);
          })
          .finally(() => {
            monitoring = false;
          });
      }, 1000);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        rendererState.uncertain = true;
        // Docker's daemon may be unavailable. Bound the stop commands and then
        // terminate the CLI too; never await a disconnected CLI indefinitely.
        void dockerStop(spawned.containerName)
          .catch(() => undefined)
          .finally(() => {
            if (!rendererClosed()) spawned.process.kill("SIGKILL");
          });
      }, config.jobTimeoutMs);
      timeout.unref();
      const exitCode = await new Promise<number>((resolve, reject) => {
        spawned.process.once("error", reject);
        spawned.process.once("close", (code, signal) => {
          rendererState.closed = true;
          if (signal !== null || code !== 0) rendererState.uncertain = true;
          resolve(code ?? 125);
        });
      }).finally(() => {
        clearInterval(monitor);
        clearTimeout(timeout);
      });
      await monitorRun;
      // A failed Docker CLI is not proof that its daemon container stopped.
      // Do this before cancel/finalization can release the durable Job lease.
      if (rendererState.uncertain) {
        try {
          await dockerStopVerified(spawned.containerName);
          rendererState.uncertain = false;
        } catch (error) {
          throw new RendererCleanupDeferred(
            "Renderer container cleanup could not be verified",
            { cause: error },
          );
        }
      }
      const runtime = database.worker.runtimeState(job.id);
      if (runtime === undefined)
        throw new Error("Renderer job disappeared during processing");
      if (
        leaseIsLost() ||
        runtime.lease_owner !== config.workerId ||
        runtime.lease_generation !== job.lease_generation
      )
        return;
      if (monitorFailure !== undefined)
        throw monitorFailure instanceof Error
          ? monitorFailure
          : new Error("Renderer output monitoring failed");
      if (
        runtime.cancel_requested_at !== null ||
        runtime.status === "canceled"
      ) {
        database.worker.markCanceled(
          job.id,
          config.workerId,
          job.lease_generation,
          nowIso(),
        );
        return;
      }
      const result = classifyRenderResult(exitCode, timedOut, stderr);
      const validationBegan = performance.now();
      const compileMs = Math.round(validationBegan - renderBegan);
      config.diagnostic?.({
        event: "renderer_worker.render_result",
        jobId: job.id,
        exitCode,
        result: result.status,
        code: result.errorCode,
        elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt)),
      });
      await inspectOutputTree(config, staging);
      await generateMetadata(
        staging,
        result.status === "timeout" && exitCode === 0 ? 124 : exitCode,
        config.maxLogBytes,
        job.entrypoint,
        result.status === "timeout" ||
          result.errorCode === "RENDERER_MEMORY_LIMIT"
          ? (result.errorMessage ?? undefined)
          : undefined,
      );
      const artifacts = await validateArtifacts(
        config,
        staging,
        result.status === "succeeded",
        result.status === "succeeded" && outputs.includes("svg"),
      );
      const pageCount =
        result.status === "succeeded"
          ? await previewPageCount(staging, artifacts, deferFirstPreview)
          : undefined;
      const publishBegan = performance.now();
      await publishArtifacts(staging, candidateOutput, artifacts);
      const publicBytes = artifacts.reduce((sum, item) => sum + item.size, 0);
      const mapName = basename(job.entrypoint).replace(
        /\.[tT][eE][xX]$/,
        ".synctex.gz",
      );
      const sourceMapPath = join(staging, mapName);
      const mapLimit = Math.min(
        8 * 1024 ** 2,
        config.maxOutputBytes - publicBytes,
      );
      const sourceMapInfo =
        result.status === "succeeded" && mapLimit > 0
          ? await lstat(sourceMapPath).catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
                return undefined;
              throw error;
            })
          : undefined;
      let sourceMap: { size: number; sha256: string } | undefined;
      if (
        sourceMapInfo?.isFile() &&
        sourceMapInfo.nlink === 1 &&
        sourceMapInfo.size > 0 &&
        sourceMapInfo.size <= mapLimit
      ) {
        const target = join(candidateOutput, "result.synctex.gz");
        const { sha256 } = await readArtifactSinglePass(
          sourceMapPath,
          "synctex",
          sourceMapInfo,
        );
        await copyFile(sourceMapPath, target, constants.COPYFILE_EXCL);
        const copied = await lstat(target);
        if (
          copied.size !== sourceMapInfo.size ||
          (await readArtifactSinglePass(target, "synctex", copied)).sha256 !==
            sha256
        )
          throw new Error("SyncTeX map changed during publication");
        sourceMap = { size: copied.size, sha256 };
      }
      if (workCache && result.status === "succeeded")
        workCacheStored = await storeDraftWorkCache(
          database,
          config,
          workCache,
          job,
          staging,
          candidateOutput,
        );
      await syncArtifactTree(candidateOutput, [
        ...artifacts.map(({ path }) => path),
        ...(sourceMap === undefined ? [] : ["result.synctex.gz"]),
      ]);
      renewLease();
      if (leaseIsLost()) return;
      await mkdir(join(root, "outputs"), { recursive: true, mode: 0o770 });
      await rename(candidateOutput, output);
      published = true;
      await syncPublishedAncestors(output, config.storageRoot);
      committed = database.transaction(() => {
        const finalRuntime = database.worker.runtimeState(job.id);
        if (finalRuntime === undefined)
          throw new Error("Renderer job disappeared during finalization");
        if (
          leaseIsLost() ||
          finalRuntime.lease_owner !== config.workerId ||
          finalRuntime.lease_generation !== job.lease_generation
        )
          return false;
        if (
          finalRuntime.cancel_requested_at !== null ||
          finalRuntime.status === "canceled"
        ) {
          return (
            database.worker.markCanceled(
              job.id,
              config.workerId,
              job.lease_generation,
              nowIso(),
              artifacts.reduce((sum, item) => sum + item.size, 0),
            ) === 1
          );
        }
        const timestamp = nowIso();
        for (const artifact of artifacts) {
          const artifactId = newId("artifact");
          database.artifacts.insert({
            id: artifactId,
            job_id: job.id,
            type: artifact.type,
            relative_path: artifact.path,
            storage_generation: job.lease_generation,
            size: artifact.size,
            sha256: artifact.sha256,
            created_at: timestamp,
          });
          if (artifact.type === "pdf" && sourceMap !== undefined)
            database.artifacts.recordSourceMap(
              artifactId,
              sourceMap.sha256,
              sourceMap.size,
              database.drafts.renderInput(job.id)?.files.map(({ path }) => path),
            );
          if (artifact.type === "pdf" && pageCount !== undefined)
            database.previews.register({
              job_id: job.id,
              pdf_artifact_id: artifactId,
              pdf_sha256: artifact.sha256,
              page_count: pageCount,
              runtime_image: config.image,
              created_at: timestamp,
            });
        }
        database.jobs.recordStageObservation({
          jobId: job.id,
          stage: "pdf",
          generation: job.lease_generation,
          rendererMs: compileMs,
          sourcePrepareMs,
          validationMs: Math.round(publishBegan - validationBegan),
          publicationMs: Math.round(performance.now() - publishBegan),
          workCacheUsed: warm === true,
          containerSample: spawned.observation?.(),
        });
        const total = publicBytes + (sourceMap?.size ?? 0);
        if (
          database.worker.transitionOwned(
            job.id,
            config.workerId,
            job.lease_generation,
            ["running"],
            result.status,
            timestamp,
            {
              render_status: result.status,
              completed_at: timestamp,
              output_size: total,
              exit_code: exitCode,
              error_code: result.errorCode,
              error_message: result.errorMessage,
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: timestamp,
            },
          ) !== 1
        )
          throw new Error("Worker lease was fenced during finalization");
        database.audit({
          actorType: "system",
          actorId: config.workerId,
          action: result.auditAction,
          targetType: "job",
          targetId: job.id,
          result: result.status === "succeeded" ? "success" : "failed",
          metadata: {
            outputSize: total,
            artifactCount: artifacts.length,
            exitCode,
          },
        });
        return true;
      });
      if (committed && deferFirstPreview && result.status === "succeeded") {
        const queuedAt = database.jobs.get(job.id)?.queued_at;
        config.diagnostic?.({
          event: "renderer_worker.draft_preview_completed",
          jobId: job.id,
          ...(queuedAt
            ? {
                queueAndPrepareMs: Math.max(
                  0,
                  Date.parse(startedAt) - Date.parse(queuedAt),
                ),
              }
            : {}),
          sourcePrepareMs,
          compileMs,
          validationMs: Math.round(publishBegan - validationBegan),
          publishMs: Math.round(performance.now() - publishBegan),
          workCacheHit: warm === true,
        });
      }
    })();
  } catch (error) {
    processingFailed = true;
    processingError = error;
  }
  clearInterval(leaseHeartbeat);
  const rendered = rendererState.spawned;
  if (processingError instanceof RendererCleanupDeferred) {
    if (rendered && !rendererClosed()) rendered.process.kill("SIGKILL");
    throw processingError;
  }
  if (rendered && (!rendererClosed() || rendererState.uncertain)) {
    try {
      await dockerStopVerified(rendered.containerName);
    } catch (error) {
      // Leave storage and the lease intact. Startup/periodic recovery must
      // prove the daemon container is gone before requeue or cleanup.
      throw new RendererCleanupDeferred(
        "Renderer container cleanup could not be verified",
        { cause: error },
      );
    } finally {
      if (!rendererClosed()) rendered.process.kill("SIGKILL");
    }
  }
  if (needsOutputCleanup()) await rm(output, { recursive: true, force: true });
  await rm(attempt, { recursive: true, force: true });
  if (needsWorkCacheRelease())
    database.drafts.releaseWorkCache(job.id, job.lease_generation);
  releaseInput();
  const finalState = database.worker.runtimeState(job.id);
  if (finalState?.cancel_requested_at != null)
    database.worker.markCanceled(
      job.id,
      config.workerId,
      job.lease_generation,
      nowIso(),
    );
  if (processingFailed) throw processingError;
}

function renderOutputs(value: string): string[] {
  const outputs: unknown = JSON.parse(value);
  if (!Array.isArray(outputs))
    throw new Error("Stored render outputs are invalid");
  const values: unknown[] = outputs;
  if (
    values.length < 1 ||
    values.length > 2 ||
    values.some((item) => item !== "pdf" && item !== "svg") ||
    !values.includes("pdf") ||
    new Set(values).size !== values.length
  )
    throw new Error("Stored render outputs are invalid");
  return values.map((item) => (item === "pdf" ? "pdf" : "svg"));
}

async function monitorJob(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
  staging: string,
  containerName: string,
): Promise<void> {
  const row = database.worker.runtimeState(job.id),
    output = await inspectOutputTree(config, staging),
    shouldStop =
      row === undefined ||
      row.lease_owner !== config.workerId ||
      row.lease_generation !== job.lease_generation ||
      row.cancel_requested_at !== null ||
      row.status !== "running" ||
      output.totalBytes > config.maxOutputBytes ||
      output.fileCount > config.maxOutputFileCount ||
      output.directoryCount > config.maxOutputDirectoryCount;
  if (shouldStop) await dockerStop(containerName);
}
