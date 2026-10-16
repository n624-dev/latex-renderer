import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { newId, nowIso } from "@latex-renderer/shared";
import { validateAndExtract } from "@latex-renderer/zip-validation";
import {
  inspectOutputTree,
  publishArtifacts,
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

export async function processJob(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
): Promise<void> {
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
    staging = join(attempt, "staging"),
    candidateOutput = join(attempt, "output"),
    output = join(root, "outputs", String(job.lease_generation));
  let published = false,
    committed = false;
  const needsOutputCleanup = (): boolean => published && !committed;
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
      await rm(attempt, { recursive: true, force: true });
      await mkdir(work, { recursive: true, mode: 0o770 });
      await chmod(work, 0o770);
      // The host storage tree carries a default ACL for the rootless renderer
      // subordinate UID/GID.  Group-private modes keep the path inaccessible to
      // unrelated host users while still allowing the mapped container user to
      // write through the bind mount.
      await mkdir(staging, { recursive: true, mode: 0o770 });
      await chmod(staging, 0o770);
      await validateAndExtract(
        source,
        extracted,
        {
          maxExtractedBytes: config.maxExtractedBytes,
          maxFileBytes: config.maxUploadBytes,
          maxEntries: config.maxZipEntries,
          maxFiles: config.maxFileCount,
          maxDepth: 10,
          maxNameLength: 200,
        },
        job.entrypoint,
      );
      const startedAt = nowIso();
      if (
        leaseIsLost() ||
        database.worker.transitionOwned(
          job.id,
          config.workerId,
          job.lease_generation,
          ["validating"],
          "running",
          startedAt,
          { started_at: startedAt },
        ) !== 1
      )
        return;
      const spawned = spawnRenderer(
        config,
        job.id,
        job.lease_generation,
        extracted,
        staging,
        job.entrypoint,
        outputs,
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
      const monitor = setInterval(() => {
        if (monitoring) return;
        monitoring = true;
        monitorRun = monitorJob(
          database,
          config,
          job,
          staging,
          spawned.containerName,
        )
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
      await inspectOutputTree(config, staging);
      await generateMetadata(
        staging,
        result.status === "timeout" && exitCode === 0 ? 124 : exitCode,
        config.maxLogBytes,
        job.entrypoint,
        result.status === "timeout"
          ? (result.errorMessage ?? undefined)
          : undefined,
      );
      const artifacts = await validateArtifacts(
        config,
        staging,
        result.status === "succeeded",
        result.status === "succeeded" && outputs.includes("svg"),
      );
      await publishArtifacts(staging, candidateOutput, artifacts);
      renewLease();
      if (leaseIsLost()) return;
      await mkdir(join(root, "outputs"), { recursive: true, mode: 0o770 });
      await rename(candidateOutput, output);
      published = true;
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
        for (const artifact of artifacts)
          database.artifacts.insert({
            id: newId("artifact"),
            job_id: job.id,
            type: artifact.type,
            relative_path: artifact.path,
            storage_generation: job.lease_generation,
            size: artifact.size,
            sha256: artifact.sha256,
            created_at: timestamp,
          });
        const total = artifacts.reduce((sum, item) => sum + item.size, 0);
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
    })();
  } catch (error) {
    processingFailed = true;
    processingError = error;
  }
  clearInterval(leaseHeartbeat);
  const rendered = rendererState.spawned;
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
