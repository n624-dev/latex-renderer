import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  artifactStoragePath,
  protectArtifactDownloadLeases,
  ARTIFACT_DOWNLOAD_LEASE_MS,
  type RendererDatabase,
  type WorkerJobRow,
  type PreviewRequest,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";
import {
  inspectOutputTree,
  publishArtifacts,
  readArtifactSinglePass,
} from "./artifact-validator.js";
import {
  dockerStopVerified,
  rendererContainerName,
  RendererCleanupDeferred,
} from "./docker.js";
import { runRendererStage } from "./renderer-stage.js";

// Separate from the small generations used by PDF/SVG, but still an exact JS
// and SQLite integer. Sequence+attempt makes publication paths immutable.
function paths(config: WorkerConfig, request: PreviewRequest) {
  if (
    !/^job_[a-f0-9]{32}$/.test(request.job_id) ||
    !Number.isSafeInteger(request.sequence) ||
    request.sequence < 1 ||
    request.attempt < 1 ||
    request.attempt > 3
  )
    throw new Error("Invalid preview identity");
  const generation = 2 ** 40 + request.sequence * 4 + request.attempt;
  if (!Number.isSafeInteger(generation))
    throw new Error("Invalid preview generation");
  const root = resolve(config.storageRoot),
    job = join(root, "jobs", request.job_id);
  return {
    root,
    job,
    generation,
    work: join(job, "preview-attempts", String(generation)),
    output: join(job, "outputs", String(generation)),
  };
}

/** No symlink ancestor, nested mount, device crossing or unbounded traversal.
 * Only called after the daemon is proven stopped; never deletes a referenced
 * immutable generation. The application-owned parent cannot be written by TeX. */
async function cleanup(
  db: RendererDatabase,
  config: WorkerConfig,
  request: PreviewRequest,
  owns: () => boolean,
  onlyWork = false,
) {
  const p = paths(config, request);
  for (const target of onlyWork ? [p.work] : [p.work, p.output]) {
    if (
      target === p.output &&
      db.artifacts.referencedGenerations(request.job_id).includes(p.generation)
    )
      continue;
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (code(error) === "ENOENT") continue;
      throw error;
    }
    const device = (await lstat(p.root)).dev;
    if (
      !info.isDirectory() ||
      info.dev !== device ||
      (await realpath(p.root)) !== p.root ||
      (await realpath(target)) !== target
    )
      throw new Error("Unsafe preview cleanup path");
    if (process.platform === "linux") {
      const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
        .split("\n")
        .map((line) => line.split(" ")[4])
        .filter((v): v is string => v !== undefined)
        .map((v) =>
          v.replace(/\\([0-7]{3})/g, (_, n: string) =>
            String.fromCharCode(parseInt(n, 8)),
          ),
        );
      if (mounts.some((m) => m === target || m.startsWith(target + "/")))
        throw new Error("Unexpected preview mount");
    }
    const pending = [target];
    let count = 0;
    while (pending.length) {
      const directory = pending.pop();
      if (!directory) break;
      for (const entry of await readdir(directory)) {
        if (
          ++count >
          config.maxOutputFileCount + config.maxOutputDirectoryCount + 20
        )
          throw new Error("Preview cleanup exceeds entry budget");
        const child = join(directory, entry),
          childInfo = await lstat(child);
        if (childInfo.dev !== device)
          throw new Error("Unexpected preview device");
        if (childInfo.isDirectory()) pending.push(child);
      }
    }
    if (!owns()) throw new Error("Preview ownership lost during cleanup");
    await rm(target, { recursive: true, force: true });
  }
}

export async function recoverPreviewRequests(
  db: RendererDatabase,
  config: WorkerConfig,
): Promise<void> {
  for (const stale of db.previews.stale(nowIso())) {
    const recoveryOwner = config.workerId + ":preview-recovery",
      request = db.transaction(() =>
        db.previews.claimRecovery(stale, recoveryOwner, nowIso()),
      );
    if (!request) continue;
    const owns = () => db.previews.owns(request, recoveryOwner);
    try {
      await dockerStopVerified(
        rendererContainerName(request.job_id, request.attempt, request.page),
      );
      await cleanup(db, config, request, owns);
      db.transaction(() =>
        db.previews.finish(
          request,
          recoveryOwner,
          nowIso(),
          "PREVIEW_INTERRUPTED",
        ),
      );
    } catch {
      // Retain the reservation and running state. Another attempt may not run
      // merely because the old lease expired or Docker cannot be contacted.
      config.diagnostic?.({
        event: "renderer_worker.preview_recovery_deferred",
        jobId: request.job_id,
        page: request.page,
      });
    }
  }
}

export async function processPreview(
  db: RendererDatabase,
  config: WorkerConfig,
  request: PreviewRequest,
): Promise<void> {
  const p = paths(config, request),
    limit = Math.min(
      config.maxOutputBytes - (db.jobs.get(request.job_id)?.output_size ?? 0),
      10 * 1024 * 1024,
    ),
    policy = { retentionHours: config.artifactRetentionHours ?? 24 },
    owns = () => db.previews.owns(request, config.workerId);
  let transfer: ReturnType<typeof protectArtifactDownloadLeases> | undefined,
    lost = false,
    deferred = false;
  let failure: string | undefined;
  try {
    const document = db.previews.document(request.job_id);
    const pdf = db.transaction(() => {
      const row = db.previews.verifiedPdf(request.job_id, policy);
      if (!row || !document || !owns())
        throw new AppError(
          "ARTIFACT_NOT_FOUND",
          "PDF no longer available",
          404,
        );
      const maximum = db.settings.value<number>(
        "max_user_storage_bytes",
        config.maxUserStorageBytes ?? 1024 * 1024 * 1024,
      );
      const job = db.jobs.get(request.job_id);
      if (
        !job ||
        limit < 1 ||
        (job.output_size ?? 0) + limit > config.maxOutputBytes ||
        !db.previews.reserve(request, config.workerId, limit, maximum)
      )
        throw new AppError(
          "USER_STORAGE_QUOTA_EXCEEDED",
          "No preview storage budget",
          503,
        );
      const lease = newId("preview_download");
      db.artifacts.createLease({
        id: lease,
        jobId: request.job_id,
        artifactId: row.id,
        createdAt: nowIso(),
        expiresAt: new Date(
          Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
        ).toISOString(),
      });
      return { row, lease };
    });
    transfer = protectArtifactDownloadLeases(db.artifacts, [pdf.lease], () => {
      lost = true;
    });
    const filesystem = await statfs(config.storageRoot);
    if (
      filesystem.bavail * filesystem.bsize <
      (config.minFreeStorageBytes ?? 5 * 1024 * 1024 * 1024) +
        3 * limit +
        1024 * 1024
    )
      throw new AppError(
        "INSUFFICIENT_STORAGE",
        "No preview working space",
        503,
      );
    const source = artifactStoragePath(config.storageRoot, pdf.row),
      info = await lstat(source);
    if (
      (await realpath(source)) !== source ||
      (await readArtifactSinglePass(source, "pdf", info)).sha256 !==
        pdf.row.sha256
    )
      throw new AppError("PDF_CHECKSUM_MISMATCH", "Stored PDF changed", 409);
    const input = join(p.work, "input"),
      staging = join(p.work, "staging"),
      candidate = join(p.work, "candidate");
    await mkdir(input, { recursive: true, mode: 0o770 });
    await mkdir(staging, { recursive: true, mode: 0o770 });
    const lifecycle = {
      owns: () =>
        owns() &&
        !lost &&
        Boolean(db.previews.verifiedPdf(request.job_id, policy)) &&
        Date.parse(
          db.previews.get(request.job_id, request.page)?.lease_expires_at ?? "",
        ) > Date.now(),
    };
    if (!lifecycle.owns()) throw new Error("Preview ownership lost");
    const job: WorkerJobRow = {
      id: request.job_id,
      lease_generation: request.attempt,
      status: "running",
      source_id: null,
      source_storage_key: null,
      source_size: 0,
      source_sha256: "",
      entrypoint: "main.tex",
      outputs_json: '["pdf"]',
    };
    const result = await runRendererStage(
      db,
      { ...config, image: document!.runtime_image, maxOutputBytes: limit },
      job,
      input,
      staging,
      { mode: "preview", page: request.page, pdfDirectory: dirname(source) },
      65_000,
      lifecycle,
    );
    if (!lifecycle.owns() || result.exitCode !== 0 || result.timedOut)
      throw new AppError(
        "PREVIEW_CONVERSION_FAILED",
        "Preview conversion failed",
        503,
      );
    await inspectOutputTree({ ...config, maxOutputBytes: limit }, staging);
    const path = `previews/page-${request.page}.png`,
      file = join(staging, path),
      pngInfo = await lstat(file),
      validated = await readArtifactSinglePass(file, "preview", pngInfo);
    if (pngInfo.size > limit)
      throw new AppError("OUTPUT_LIMIT", "Preview exceeds limit");
    const artifact = {
      path,
      type: "preview",
      size: pngInfo.size,
      sha256: validated.sha256,
    };
    await publishArtifacts(staging, candidate, [artifact]);
    await mkdir(dirname(p.output), { recursive: true, mode: 0o770 });
    if (!lifecycle.owns()) throw new Error("Preview ownership lost");
    await rename(candidate, p.output);
    // Leave no unaccounted duplicate after the final transaction, even if the
    // process is killed immediately after committing its published pointer.
    await cleanup(db, config, request, lifecycle.owns, true);
    db.transaction(() => {
      if (
        !lifecycle.owns() ||
        !db.previews.finish(request, config.workerId, nowIso())
      )
        throw new Error("Preview publication fence lost");
      db.artifacts.insert({
        id: newId("artifact"),
        job_id: request.job_id,
        type: "preview",
        relative_path: path,
        size: artifact.size,
        sha256: artifact.sha256,
        created_at: nowIso(),
        storage_generation: p.generation,
      });
      db.previews.charge(request.job_id, artifact.size);
      db.audit({
        actorType: "system",
        actorId: config.workerId,
        action: "render.preview_generated",
        targetType: "job",
        targetId: request.job_id,
        result: "success",
        metadata: { page: request.page, size: artifact.size },
      });
    });
  } catch (error) {
    if (error instanceof RendererCleanupDeferred) {
      deferred = true;
      throw error;
    }
    failure =
      error instanceof AppError
        ? error.code
        : ["ENOSPC", "EDQUOT"].includes(String(code(error)))
          ? "INSUFFICIENT_STORAGE"
          : "PREVIEW_FAILED";
  } finally {
    if (!deferred) {
      // Success has released ownership, but only its work directory remains;
      // published files are protected by DB references. Failures retain their
      // fence until cleanup has actually completed.
      try {
        await cleanup(
          db,
          config,
          request,
          () =>
            owns() ||
            db.previews.get(request.job_id, request.page)?.status ===
              "succeeded",
        );
      } catch {
        deferred = true;
      }
      if (failure && !deferred)
        db.transaction(() => {
          if (db.previews.finish(request, config.workerId, nowIso(), failure))
            db.audit({
              actorType: "system",
              actorId: config.workerId,
              action: "render.preview_failed",
              targetType: "job",
              targetId: request.job_id,
              result: "failed",
              metadata: { page: request.page, errorCode: failure },
            });
        });
    }
    transfer?.();
  }
  if (deferred)
    throw new RendererCleanupDeferred("Preview cleanup could not be verified");
}

function code(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}
