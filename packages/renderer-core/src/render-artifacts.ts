import { open } from "node:fs/promises";
import {
  ARTIFACT_DOWNLOAD_LEASE_MS,
  artifactStoragePath,
  protectArtifactDownloadLeases,
  type ArtifactRow,
  type JobRow,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import {
  assertLogRange,
  readLogWindow,
  renderDiagnostics,
  type RemoteRenderDiagnostics,
} from "./render-diagnostics.js";
import { artifactMimeType, resourceUri } from "./render-job-metadata.js";

const MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT = 64 * 1024 * 1024;
const ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;

export class RendererArtifactReads {
  private inlineArtifactBytesInFlight = 0;
  private readonly inlineArtifactWaiters: Array<{
    bytes: number;
    resolve: (release: () => void) => void;
  }> = [];

  constructor(
    private readonly database: RendererDatabase,
    private readonly storageRoot: string,
    private readonly artifactRetentionHours: number,
    private readonly maxInlineArtifactBytes: number,
    private readonly exposeMcpResources: boolean,
  ) {}

  async content(artifact: ArtifactRow) {
    if (
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 0 ||
      artifact.size > this.maxInlineArtifactBytes
    )
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        `Artifact exceeds the ${this.maxInlineArtifactBytes}-byte MCP inline resource limit; use the protected Web result instead`,
        413,
      );
    const release = await this.acquireInlineArtifactBytes(artifact.size);
    try {
      return {
        jobId: artifact.job_id,
        relativePath: artifact.relative_path,
        mimeType: artifactMimeType(artifact.type),
        size: artifact.size,
        sha256: artifact.sha256,
        bytes: await this.withArtifactLease(artifact, (path, signal) =>
          readBoundedArtifact(
            path,
            artifact.size,
            this.maxInlineArtifactBytes,
            signal,
          ),
        ),
      };
    } finally {
      release();
    }
  }

  async diagnostics(
    row: JobRow,
    stage?: "pdf" | "svg",
    offset?: number,
    limit?: number,
  ): Promise<RemoteRenderDiagnostics> {
    const jobId = row.id,
      stages = this.database.outputStages.publicState(jobId),
      selectedStage =
        stage ??
        (stages?.pdf.status === "succeeded" &&
        ["failed", "timeout", "canceled"].includes(stages.svg.status)
          ? "svg"
          : "pdf"),
      prefix = selectedStage === "svg" ? "svg/" : "",
      available = this.database.artifacts.listDownloadable(jobId, {
        retentionHours: this.artifactRetentionHours,
      }),
      errorsArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}errors.json`,
      ),
      logArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}compile.log`,
      ),
      errorsJson =
        errorsArtifact === undefined
          ? undefined
          : (await this.content(errorsArtifact)).bytes.toString("utf8");
    return renderDiagnostics({
      row,
      stages,
      selectedStage,
      stageWasRequested: stage !== undefined,
      offset,
      limit,
      errorsJson,
      ...(logArtifact === undefined
        ? {}
        : {
            readLog: () =>
              this.logWindow(logArtifact, undefined, undefined, 16_384),
            rawLogResourceUri:
              !this.exposeMcpResources ||
              logArtifact.size > this.maxInlineArtifactBytes
                ? null
                : resourceUri(jobId, logArtifact.relative_path),
          }),
    });
  }

  async readRenderLog(
    job: JobRow,
    stage: "pdf" | "svg",
    startByte?: number,
    startLine?: number,
    sha256?: string,
  ) {
    const jobId = job.id;
    const path = stage === "svg" ? "svg/compile.log" : "compile.log";
    const artifact = this.database.artifacts.getDownloadable(jobId, path, {
      retentionHours: this.artifactRetentionHours,
    });
    if (artifact === undefined) {
      const stored =
        job.status === "expired" ||
        job.status === "deleted" ||
        job.status === "deleting";
      throw new AppError(
        stored ? "LOG_EXPIRED" : "LOG_NOT_FOUND",
        stored
          ? "The compile log has expired"
          : "The compile log is not available",
        stored ? 410 : 404,
      );
    }
    if (sha256 !== undefined && artifact.sha256 !== sha256)
      throw new AppError(
        "LOG_CHANGED",
        "The stored log changed; start a new read",
        409,
      );
    return {
      jobId,
      stage,
      sha256: artifact.sha256,
      ...(await this.logWindow(artifact, startByte, startLine, 8192)),
    };
  }

  private async logWindow(
    artifact: ArtifactRow,
    startByte: number | undefined,
    startLine: number | undefined,
    maxBytes: number,
  ) {
    assertLogRange(artifact.size, startByte, startLine);
    const release = await this.acquireInlineArtifactBytes(maxBytes);
    try {
      return await this.withArtifactLease(artifact, (path, signal) =>
        readLogWindow(
          path,
          signal,
          artifact.size,
          startByte,
          startLine,
          maxBytes,
        ),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "LOG_UNAVAILABLE",
        "The stored compile log cannot be read",
        409,
      );
    } finally {
      release();
    }
  }

  async withArtifactLease<T>(
    artifact: ArtifactRow,
    read: (path: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let releaseLease: (() => void) | undefined;
    try {
      // Admission may wait behind other reads. Recheck retention and register
      // protection together only after the memory budget is actually acquired.
      const leaseId = this.database.transaction(() => {
        const current = this.database.artifacts.getDownloadable(
          artifact.job_id,
          artifact.relative_path,
          { retentionHours: this.artifactRetentionHours },
        );
        if (current === undefined || current.id !== artifact.id)
          throw new AppError(
            "ARTIFACT_NOT_FOUND",
            "Artifact is no longer available",
            404,
          );
        const id = newId("download");
        this.database.artifacts.createLease({
          id,
          jobId: artifact.job_id,
          artifactId: current.id,
          createdAt: nowIso(),
          expiresAt: new Date(
            Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
          ).toISOString(),
        });
        return id;
      });
      const controller = new AbortController();
      releaseLease = protectArtifactDownloadLeases(
        this.database.artifacts,
        [leaseId],
        () =>
          controller.abort(
            new AppError(
              "ARTIFACT_UNAVAILABLE",
              "Artifact download protection was lost",
              503,
            ),
          ),
      );
      return await read(
        artifactStoragePath(this.storageRoot, artifact),
        controller.signal,
      );
    } finally {
      releaseLease?.();
    }
  }

  private acquireInlineArtifactBytes(bytes: number): Promise<() => void> {
    if (
      this.inlineArtifactBytesInFlight + bytes <=
      MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT
    ) {
      this.inlineArtifactBytesInFlight += bytes;
      return Promise.resolve(() => this.releaseInlineArtifactBytes(bytes));
    }
    return new Promise((resolve) => {
      this.inlineArtifactWaiters.push({ bytes, resolve });
    });
  }

  private releaseInlineArtifactBytes(bytes: number): void {
    this.inlineArtifactBytesInFlight = Math.max(
      0,
      this.inlineArtifactBytesInFlight - bytes,
    );
    while (this.inlineArtifactWaiters.length > 0) {
      const index = this.inlineArtifactWaiters.findIndex(
        (waiter) =>
          this.inlineArtifactBytesInFlight + waiter.bytes <=
          MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT,
      );
      if (index < 0) return;
      const waiter = this.inlineArtifactWaiters.splice(index, 1)[0];
      if (waiter === undefined) return;
      this.inlineArtifactBytesInFlight += waiter.bytes;
      waiter.resolve(() => this.releaseInlineArtifactBytes(waiter.bytes));
    }
  }
}

async function readBoundedArtifact(
  path: string,
  expectedSize: number,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    throw error;
  }
  try {
    signal.throwIfAborted();
    const initial = await handle.stat();
    if (
      !initial.isFile() ||
      !Number.isSafeInteger(initial.size) ||
      initial.size !== expectedSize
    )
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact metadata does not match the stored file",
        503,
      );
    if (initial.size > maximumBytes)
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        "Artifact exceeds the MCP inline resource limit",
        413,
      );

    const bytes = Buffer.allocUnsafe(initial.size);
    let offset = 0;
    while (offset < initial.size) {
      signal.throwIfAborted();
      const length = Math.min(ARTIFACT_READ_CHUNK_BYTES, initial.size - offset);
      const result = await handle.read(bytes, offset, length, offset);
      if (result.bytesRead <= 0)
        throw new AppError(
          "ARTIFACT_UNAVAILABLE",
          "Artifact ended before its recorded size",
          503,
        );
      offset += result.bytesRead;
      if (offset > maximumBytes)
        throw new AppError(
          "ARTIFACT_TOO_LARGE",
          "Artifact exceeds the MCP inline resource limit",
          413,
        );
    }
    const final = await handle.stat();
    signal.throwIfAborted();
    if (final.size !== expectedSize)
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact changed while it was being read",
        503,
      );
    return bytes;
  } finally {
    await handle.close();
  }
}
