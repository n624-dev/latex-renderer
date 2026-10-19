import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import { prepareSourceInput } from "./source-tree-cache.js";
import type { WorkerConfig } from "./config.js";
import {
  inspectOutputTree,
  publishArtifacts,
  validateArtifacts,
  type ValidatedArtifact,
} from "./artifact-validator.js";
import { RendererCleanupDeferred } from "./docker.js";
import { generateMetadata } from "./metadata.js";
import { classifyRenderResult } from "./render-result.js";
import { runRendererStage } from "./renderer-stage.js";
import { previewPageCount } from "./preview-metadata.js";

/** PDF and SVG use separate daemon containers and separate immutable storage
 * generations. Only a fenced database transaction makes a generation public. */
export async function processStagedJob(
  db: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
): Promise<void> {
  const root = join(config.storageRoot, "jobs", job.id),
    attempt = join(root, "attempts", String(job.lease_generation)),
    input = join(attempt, "input");
  const source =
    job.source_storage_key === null
      ? join(root, "input/source.zip")
      : join(config.storageRoot, job.source_storage_key);
  let preserveAttempt = false;
  let rendererInput = input,
    releaseInput = () => {};
  const owns = () => {
    const row = db.worker.runtimeState(job.id);
    return (
      row !== undefined &&
      row.lease_owner === config.workerId &&
      row.lease_generation === job.lease_generation
    );
  };
  const renew = () =>
    db.worker.heartbeat(
      job.id,
      config.workerId,
      job.lease_generation,
      nowIso(),
      new Date(Date.now() + 30000).toISOString(),
    ) === 1;
  const canceled = () => {
    if (!owns() || db.worker.runtimeState(job.id)?.cancel_requested_at === null)
      return false;
    db.worker.markCanceled(
      job.id,
      config.workerId,
      job.lease_generation,
      nowIso(),
    );
    return true;
  };
  const heartbeat = setInterval(() => {
    renew();
  }, 10000);
  heartbeat.unref();
  const published = new Set<string>();
  const stoppedOrFenced = () => {
    if (!owns() || canceled()) return;
    throw new AppError(
      "STAGE_STATE_CONFLICT",
      "Output stage no longer matches the owned Job",
    );
  };
  try {
    if (
      db.outputStages.checkpoint(job.id) === undefined &&
      db.artifacts.hasPublishedPdf(job.id)
    )
      throw new AppError(
        "STAGE_CHECKPOINT_MISSING",
        "Published PDF state cannot be safely reconstructed",
      );
    if (
      !owns() ||
      canceled() ||
      !db.outputStages.initialize(
        job.id,
        config.workerId,
        job.lease_generation,
        config.image,
      )
    )
      return;
    await rm(attempt, { recursive: true, force: true });
    await mkdir(attempt, { recursive: true, mode: 0o770 });
    await chmod(attempt, 0o770);
    // prepareSourceInput verifies archive size/SHA on misses and every cached
    // file on hits; do not hash the same archive again here.
    const prepared = await prepareSourceInput(db, config, job, source, input);
    rendererInput = prepared.input;
    releaseInput = prepared.release;
    if (
      db.worker.transitionOwned(
        job.id,
        config.workerId,
        job.lease_generation,
        ["validating"],
        "running",
        nowIso(),
        { started_at: nowIso() },
      ) !== 1
    )
      return;
    const deadline = Date.now() + config.jobTimeoutMs;
    let checkpoint = db.outputStages.checkpoint(job.id);
    if (checkpoint?.pdf_status !== "succeeded") {
      if (
        !db.outputStages.start(
          job.id,
          "pdf",
          config.workerId,
          job.lease_generation,
        )
      ) {
        stoppedOrFenced();
        return;
      }
      const staging = join(attempt, "pdf");
      await mkdir(staging, { mode: 0o770 });
      await chmod(staging, 0o770);
      const execution = await runRendererStage(
        db,
        config,
        job,
        rendererInput,
        staging,
        { mode: "pdf" },
        deadline - Date.now(),
      );
      if (!owns()) return;
      if (db.worker.runtimeState(job.id)?.cancel_requested_at !== null) {
        db.worker.markCanceled(
          job.id,
          config.workerId,
          job.lease_generation,
          nowIso(),
        );
        return;
      }
      const result = classifyRenderResult(
        execution.exitCode,
        execution.timedOut,
        execution.stderr,
      );
      await inspectOutputTree(config, staging);
      await generateMetadata(
        staging,
        result.status === "timeout" && execution.exitCode === 0
          ? 124
          : execution.exitCode,
        config.maxLogBytes,
        job.entrypoint,
        result.errorMessage ?? undefined,
      );
      if (result.status !== "succeeded") {
        const diagnostics = join(attempt, "pdf-diagnostics");
        await mkdir(diagnostics, { mode: 0o770 });
        for (const name of ["compile.log", "errors.json", "dependencies.json"])
          await copyFile(join(staging, name), join(diagnostics, name));
        const artifacts = await validateArtifacts(config, diagnostics, false);
        const generation = storageGeneration(job.lease_generation, false),
          output = join(root, "outputs", String(generation));
        await mkdir(join(root, "outputs"), { recursive: true, mode: 0o770 });
        await rename(diagnostics, output);
        published.add(output);
        const timestamp = nowIso(),
          committed = db.transaction(() => {
            if (!owns() || canceled()) return false;
            insertArtifacts(artifacts, generation, timestamp);
            if (
              db.worker.transitionOwned(
                job.id,
                config.workerId,
                job.lease_generation,
                ["running"],
                result.status,
                timestamp,
                {
                  render_status: result.status,
                  completed_at: timestamp,
                  output_size: artifacts.reduce((n, a) => n + a.size, 0),
                  exit_code: execution.exitCode,
                  error_code: result.errorCode,
                  error_message: result.errorMessage,
                  lease_owner: null,
                  lease_expires_at: null,
                },
              ) !== 1
            )
              throw new Error("PDF failure was fenced");
            db.audit({
              actorType: "system",
              actorId: config.workerId,
              action: result.auditAction,
              targetType: "job",
              targetId: job.id,
              result: result.status,
            });
            return true;
          });
        if (committed) published.delete(output);
        return;
      }
      const artifacts = (
        await validateArtifacts(config, staging, true, false)
      ).filter((a) => !a.path.startsWith("svg/"));
      if (!artifacts.some((a) => a.path === "previews/page-1.png"))
        throw new AppError("PREVIEW_MISSING", "PDF preview is missing");
      const pdf = artifacts.find((a) => a.path === "result.pdf");
      if (!pdf) throw new Error("Validated PDF is missing");
      const pageCount = await previewPageCount(staging, artifacts);
      const sync = await digestRegularFile(
        join(staging, "result.synctex.gz"),
        config.maxOutputBytes,
      );
      const total = artifacts.reduce((n, a) => n + a.size, 0) + sync.bytes;
      if (total > config.maxOutputBytes)
        throw new AppError(
          "OUTPUT_LIMIT",
          "PDF checkpoint exceeds output limit",
        );
      const generation = storageGeneration(job.lease_generation, false),
        candidate = join(attempt, "pdf-candidate"),
        output = join(root, "outputs", String(generation));
      await publishArtifacts(staging, candidate, artifacts);
      await copyFile(
        join(staging, "result.synctex.gz"),
        join(candidate, "result.synctex.gz"),
      );
      const copiedSync = await digestRegularFile(
        join(candidate, "result.synctex.gz"),
        config.maxOutputBytes,
      );
      if (copiedSync.sha256 !== sync.sha256 || copiedSync.bytes !== sync.bytes)
        throw new Error("SyncTeX checkpoint changed");
      if (!renew() || !owns()) return;
      await mkdir(join(root, "outputs"), { recursive: true, mode: 0o770 });
      await rename(candidate, output);
      published.add(output);
      const timestamp = nowIso();
      const committed = db.transaction(() => {
        if (
          !db.outputStages.completePdf(
            job.id,
            config.workerId,
            job.lease_generation,
            {
              storageGeneration: generation,
              sha256: pdf.sha256,
              synctexSha256: sync.sha256,
              synctexBytes: sync.bytes,
              completedAt: timestamp,
            },
          )
        )
          return false;
        insertArtifacts(artifacts, generation, timestamp, pageCount);
        if (
          db.worker.transitionOwned(
            job.id,
            config.workerId,
            job.lease_generation,
            ["running"],
            "running",
            timestamp,
            { output_size: total },
          ) !== 1
        )
          throw new Error("PDF publication was fenced");
        db.audit({
          actorType: "system",
          actorId: config.workerId,
          action: "render.pdf.succeeded",
          targetType: "job",
          targetId: job.id,
          result: "success",
          metadata: { sha256: pdf.sha256, outputSize: total },
        });
        return true;
      });
      if (!committed) {
        stoppedOrFenced();
        return;
      }
      published.delete(output);
      checkpoint = db.outputStages.checkpoint(job.id);
    }
    if (
      !checkpoint ||
      checkpoint.pdf_generation === null ||
      checkpoint.pdf_sha256 === null ||
      checkpoint.synctex_sha256 === null
    )
      throw new Error("PDF checkpoint is incomplete");
    const pdfCheckpoint = checkpoint;
    if (pdfCheckpoint.renderer_image !== config.image)
      throw new AppError(
        "SVG_RUNTIME_CHANGED",
        "The Runtime changed since PDF publication; retry the complete Job",
      );
    if (
      pdfCheckpoint.source_sha256 !== job.source_sha256 ||
      pdfCheckpoint.source_id !== job.source_id ||
      pdfCheckpoint.entrypoint !== job.entrypoint ||
      pdfCheckpoint.project_revision_id !==
        db.jobs.get(job.id)?.project_revision_id
    )
      throw new AppError(
        "PDF_CHECKPOINT_MISMATCH",
        "The Source, entrypoint or revision no longer matches the PDF checkpoint",
      );
    const pdfDirectory = join(
      root,
      "outputs",
      String(pdfCheckpoint.pdf_generation),
    );
    const verifyPdf = async () => {
      const pdf = await digestRegularFile(
          join(pdfDirectory, "result.pdf"),
          config.maxOutputBytes,
        ),
        sync = await digestRegularFile(
          join(pdfDirectory, "result.synctex.gz"),
          config.maxOutputBytes,
        );
      if (
        pdf.sha256 !== pdfCheckpoint.pdf_sha256 ||
        sync.sha256 !== pdfCheckpoint.synctex_sha256 ||
        sync.bytes !== pdfCheckpoint.synctex_bytes
      )
        throw new AppError(
          "PDF_CHECKPOINT_CHANGED",
          "The immutable PDF checkpoint has changed",
        );
    };
    await verifyPdf();
    if (
      !db.outputStages.start(
        job.id,
        "svg",
        config.workerId,
        job.lease_generation,
      )
    ) {
      stoppedOrFenced();
      return;
    }
    const staging = join(attempt, "svg");
    await mkdir(staging, { mode: 0o770 });
    await chmod(staging, 0o770);
    let result: ReturnType<typeof classifyRenderResult>, exitCode: number;
    try {
      const execution = await runRendererStage(
        db,
        config,
        job,
        rendererInput,
        staging,
        { mode: "svg", pdfDirectory },
        deadline - Date.now(),
      );
      exitCode = execution.exitCode;
      result = classifyRenderResult(
        exitCode,
        execution.timedOut,
        execution.stderr,
      );
      if (result.errorCode === "LATEX_COMPILE_FAILED")
        result = {
          ...result,
          errorCode: "SVG_GENERATION_FAILED",
          errorMessage: `SVG stage exited with ${exitCode}`,
        };
      if (result.errorCode === "RENDERER_MEMORY_LIMIT")
        result = {
          ...result,
          errorCode: "SVG_MEMORY_LIMIT",
          errorMessage: "The SVG stage exceeded its container memory limit",
        };
      await inspectOutputTree(config, staging);
      await generateMetadata(
        staging,
        result.status === "timeout" && exitCode === 0 ? 124 : exitCode,
        config.maxLogBytes,
        job.entrypoint,
        result.errorMessage ?? undefined,
      );
      if (result.status === "succeeded") {
        const manifestPath = join(staging, "svg/manifest.json");
        const handle = await open(
          manifestPath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let manifest: unknown;
        try {
          const stat = await handle.stat();
          if (
            !stat.isFile() ||
            stat.nlink !== 1 ||
            stat.size > Math.min(config.maxSvgBytes, 1024 * 1024)
          )
            throw new AppError(
              "SVG_MANIFEST_INVALID",
              "SVG manifest exceeds limit",
            );
          manifest = JSON.parse(await handle.readFile("utf8")) as unknown;
        } finally {
          await handle.close();
        }
        if (
          typeof manifest !== "object" ||
          manifest === null ||
          Array.isArray(manifest)
        )
          throw new AppError("SVG_MANIFEST_INVALID", "SVG manifest is invalid");
        await writeFile(
          manifestPath,
          JSON.stringify({
            ...manifest,
            document: {
              jobId: job.id,
              sourceSha256: job.source_sha256,
              pdfSha256: pdfCheckpoint.pdf_sha256,
              entrypoint: job.entrypoint,
              attempt: pdfCheckpoint.svg_attempt,
            },
          }) + "\n",
          { mode: 0o660 },
        );
      }
    } catch (error) {
      if (error instanceof RendererCleanupDeferred) throw error;
      const code =
        error instanceof AppError ? error.code : "SVG_GENERATION_FAILED";
      const message =
        error instanceof AppError ? error.message : "SVG generation failed";
      exitCode = 79;
      result = {
        ...classifyRenderResult(79, false, ""),
        errorCode: code,
        errorMessage: message,
      };
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { mode: 0o770 });
      await writeFile(
        join(staging, "compile.log"),
        message.slice(0, config.maxLogBytes) + "\n",
        { mode: 0o660 },
      );
      await generateMetadata(
        staging,
        79,
        config.maxLogBytes,
        job.entrypoint,
        message,
      );
    }
    if (!owns()) return;
    if (db.worker.runtimeState(job.id)?.cancel_requested_at !== null) {
      db.worker.markCanceled(
        job.id,
        config.workerId,
        job.lease_generation,
        nowIso(),
      );
      return;
    }
    // Failed SVG output is not public, even if a partial object is well-formed.
    const diagnostics = join(attempt, "svg-public");
    await mkdir(join(diagnostics, "svg"), { recursive: true, mode: 0o770 });
    for (const name of ["compile.log", "errors.json", "dependencies.json"])
      await copyFile(join(staging, name), join(diagnostics, "svg", name));
    if (result.status === "succeeded") {
      for (const name of ["compile.log", "errors.json", "dependencies.json"])
        await rename(join(staging, name), join(staging, "svg", name));
    }
    const artifacts = await validateArtifacts(
      config,
      result.status === "succeeded" ? staging : diagnostics,
      false,
      result.status === "succeeded",
      "svg/",
    );
    if (artifacts.some((a) => !a.path.startsWith("svg/")))
      throw new AppError(
        "SVG_OUTPUT_INVALID",
        "SVG stage attempted to replace PDF artifacts",
      );
    await verifyPdf();
    const generation = storageGeneration(job.lease_generation, true),
      candidate = join(attempt, "svg-candidate"),
      output = join(root, "outputs", String(generation));
    const previousBytes = db.jobs.get(job.id)?.output_size ?? 0,
      total = previousBytes + artifacts.reduce((n, a) => n + a.size, 0);
    if (total > config.maxOutputBytes)
      throw new AppError(
        "OUTPUT_LIMIT",
        "Combined output and retained attempts exceed limit",
      );
    await publishArtifacts(
      result.status === "succeeded" ? staging : diagnostics,
      candidate,
      artifacts,
    );
    if (!renew() || !owns()) return;
    await rename(candidate, output);
    published.add(output);
    const timestamp = nowIso();
    const committed = db.transaction(() => {
      if (
        !db.outputStages.completeSvg(
          job.id,
          config.workerId,
          job.lease_generation,
          {
            status: result.status,
            storageGeneration: generation,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            completedAt: timestamp,
          },
        )
      )
        return false;
      insertArtifacts(artifacts, generation, timestamp);
      if (
        db.worker.transitionOwned(
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
        throw new Error("SVG publication was fenced");
      db.audit({
        actorType: "system",
        actorId: config.workerId,
        action:
          result.status === "succeeded"
            ? "render.succeeded"
            : "render.svg.failed",
        targetType: "job",
        targetId: job.id,
        result: result.status,
        metadata: {
          pdfSha256: pdfCheckpoint.pdf_sha256,
          svgAttempt: pdfCheckpoint.svg_attempt,
          exitCode,
        },
      });
      return true;
    });
    if (committed) published.delete(output);
    else stoppedOrFenced();
  } catch (error) {
    if (error instanceof RendererCleanupDeferred) preserveAttempt = true;
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (!preserveAttempt) {
      for (const path of published)
        await rm(path, { recursive: true, force: true });
      await rm(attempt, { recursive: true, force: true });
      releaseInput();
      // Cancellation can win during ZIP validation, before a container exists.
      // Release only our fenced lease, after all daemon work/cleanup is proven.
      canceled();
    }
  }
  function insertArtifacts(
    artifacts: ValidatedArtifact[],
    generation: number,
    timestamp: string,
    pageCount?: number,
  ) {
    for (const a of artifacts) {
      const artifactId = newId("artifact");
      db.artifacts.publishStage({
        id: artifactId,
        job_id: job.id,
        type: a.type,
        relative_path: a.path,
        storage_generation: generation,
        size: a.size,
        sha256: a.sha256,
        created_at: timestamp,
      });
      if (a.type === "pdf" && pageCount !== undefined)
        db.previews.register({
          job_id: job.id,
          pdf_artifact_id: artifactId,
          pdf_sha256: a.sha256,
          page_count: pageCount,
          runtime_image: config.image,
          created_at: timestamp,
        });
    }
  }
}

function storageGeneration(lease: number, svg: boolean): number {
  const value = lease * 2 + (svg ? 1 : 0);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Stage generation is invalid");
  return value;
}

async function digestRegularFile(
  path: string,
  maxBytes: number,
): Promise<{ sha256: string; bytes: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
      throw new AppError(
        "CHECKPOINT_INVALID",
        "Checkpoint file is invalid or exceeds limit",
      );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path, {
      fd: handle.fd,
      autoClose: false,
    }))
      hash.update(chunk as Buffer);
    const after = await handle.stat();
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new AppError(
        "CHECKPOINT_CHANGED",
        "Checkpoint file changed during validation",
      );
    return { sha256: hash.digest("hex"), bytes: before.size };
  } finally {
    await handle.close();
  }
}
