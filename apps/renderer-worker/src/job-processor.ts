import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { newId, nowIso } from "@latex-renderer/shared";
import { validateAndExtract } from "@latex-renderer/zip-validation";
import { directorySize, publishArtifacts, validateArtifacts } from "./artifact-validator.js";
import type { WorkerConfig } from "./config.js";
import { dockerStop, spawnRenderer } from "./docker.js";
import { generateMetadata } from "./metadata.js";

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
      database.transitionJob(job.id, ["validating"], "rejected", {
        completed_at: nowIso(),
        error_code: "ACCOUNT_INACTIVE",
        error_message: "Job owner, service account, or API key is inactive",
        lease_owner: null,
        lease_expires_at: null,
      });
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
  const root = join(config.storageRoot, "jobs", job.id),
    source =
      job.source_storage_key === null
        ? join(root, "input", "source.zip")
        : join(config.storageRoot, job.source_storage_key),
    work = join(root, "work"),
    extracted = join(work, "input"),
    staging = join(root, "staging"),
    output = join(root, "output");
  try {
    const outputs = renderOutputs(job.outputs_json);
    await rm(extracted, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
    await mkdir(work, { recursive: true, mode: 0o770 });
    await chmod(work, 0o770);
    await mkdir(staging, { recursive: true, mode: 0o777 });
    await chmod(staging, 0o777);
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
    database.transitionJob(job.id, ["validating"], "running", {
      started_at: nowIso(),
    });
    const spawned = spawnRenderer(
      config,
      job.id,
      extracted,
      staging,
      job.entrypoint,
      outputs,
    );
    spawned.process.stdout.resume();
    let stderr = "";
    spawned.process.stderr.setEncoding("utf8");
    spawned.process.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    let monitoring = false;
    const monitor = setInterval(() => {
      if (monitoring) return;
      monitoring = true;
      void monitorJob(database, config, job.id, staging, spawned.containerName)
        .catch((error: unknown) =>
          console.error(
            JSON.stringify({
              event: "renderer_worker.monitor_failed",
              jobId: job.id,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown monitor error",
            }),
          ),
        )
        .finally(() => {
          monitoring = false;
        });
    }, 1000);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void dockerStop(spawned.containerName);
    }, config.jobTimeoutMs);
    timeout.unref();
    const exitCode = await new Promise<number>((resolve, reject) => {
      spawned.process.once("error", reject);
      spawned.process.once("close", (code) => resolve(code ?? 125));
    }).finally(() => {
      clearInterval(monitor);
      clearTimeout(timeout);
    });
    const runtime = database.worker.runtimeState(job.id);
    if (runtime === undefined)
      throw new Error("Renderer job disappeared during processing");
    if (runtime.cancel_requested_at !== null || runtime.status === "canceled") {
      database.worker.markCanceled(job.id, nowIso());
      return;
    }
    await generateMetadata(staging, exitCode);
    const artifacts = await validateArtifacts(
      config,
      staging,
      exitCode === 0,
      exitCode === 0 && outputs.includes("svg"),
    );
    await rm(output, { recursive: true, force: true });
    await publishArtifacts(staging, output, artifacts);
    const finalized = database.transaction(() => {
      const finalRuntime = database.worker.runtimeState(job.id);
      if (finalRuntime === undefined)
        throw new Error("Renderer job disappeared during finalization");
      if (
        finalRuntime.cancel_requested_at !== null ||
        finalRuntime.status === "canceled"
      ) {
        database.worker.markCanceled(job.id, nowIso());
        return false;
      }
      const timestamp = nowIso();
      for (const artifact of artifacts)
        database.artifacts.insert({
          id: newId("artifact"),
          job_id: job.id,
          type: artifact.type,
          relative_path: artifact.path,
          size: artifact.size,
          sha256: artifact.sha256,
          created_at: timestamp,
        });
      const total = artifacts.reduce((sum, item) => sum + item.size, 0),
        finalStatus = timedOut
          ? "timeout"
          : exitCode === 0
            ? "succeeded"
            : "failed";
      database.transitionJob(job.id, ["running"], finalStatus, {
        completed_at: timestamp,
        output_size: total,
        exit_code: exitCode,
        error_code: timedOut
          ? "JOB_TIMEOUT"
          : exitCode === 0
            ? null
            : "LATEX_COMPILE_FAILED",
        error_message: timedOut
          ? "The renderer exceeded the overall job timeout"
          : exitCode === 0
            ? null
            : `Renderer exited with ${exitCode}: ${stderr.slice(0, 500)}`,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: timestamp,
      });
      database.audit({
        actorType: "system",
        actorId: config.workerId,
        action: timedOut
          ? "render.timeout"
          : exitCode === 0
            ? "render.completed"
            : "render.failed",
        targetType: "job",
        targetId: job.id,
        result: exitCode === 0 ? "success" : "failed",
        metadata: {
          outputSize: total,
          artifactCount: artifacts.length,
          exitCode,
        },
      });
      return true;
    });
    if (!finalized) await rm(output, { recursive: true, force: true });
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
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
  jobId: string,
  staging: string,
  containerName: string,
): Promise<void> {
  const row = database.worker.runtimeState(jobId),
    size = await directorySize(staging),
    logSize = await lstat(join(staging, "compile.log"))
      .then((info) => info.size)
      .catch(() => 0),
    shouldStop =
      row === undefined ||
      row.cancel_requested_at !== null ||
      row.status !== "running" ||
      size > config.maxOutputBytes ||
      logSize > config.maxLogBytes;
  database.worker.heartbeat(
    jobId,
    config.workerId,
    nowIso(),
    new Date(Date.now() + 30_000).toISOString(),
  );
  if (shouldStop) await dockerStop(containerName);
}
