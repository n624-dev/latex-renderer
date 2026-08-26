import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { isAbsolute, join } from "node:path";
import { mkdir, open, rename, rm, statfs } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError, DEFAULT_RESOURCE_LIMITS, newId, nowIso } from "@latex-renderer/shared";
import type { SourceTicketClaims, TicketClaims } from "@latex-renderer/ticket";
import { validateAndExtract } from "@latex-renderer/zip-validation";
import type { RendererApiDependencies } from "../types.js";

export async function uploadSource(
  deps: RendererApiDependencies,
  request: Request,
  jobId: string,
  claims: TicketClaims,
): Promise<void> {
  const job = deps.database.jobs.get(jobId);
  if (job === undefined)
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  if (job.source_id === null)
    return uploadLegacyJobSource(deps, request, jobId, claims);
  const source = deps.database.sources.get(job.source_id);
  if (source === undefined)
    throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
  await uploadSharedSource(deps, request, source.id, claims, {
    jobId,
    nonceKind: "job",
  });
}

export async function uploadSourceContent(
  deps: RendererApiDependencies,
  request: Request,
  sourceId: string,
  claims: SourceTicketClaims,
): Promise<void> {
  await uploadSharedSource(deps, request, sourceId, claims, {
    nonceKind: "source",
  });
}

async function uploadSharedSource(
  deps: RendererApiDependencies,
  request: Request,
  sourceId: string,
  claims: TicketClaims | SourceTicketClaims,
  context: { nonceKind: "job"; jobId: string } | { nonceKind: "source" },
): Promise<void> {
  assertUploadClaims(deps, request, claims);
  const source = deps.database.sources.get(sourceId);
  if (source === undefined)
    throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
  if (source.status === "ready" && source.sha256 === claims.sha256) return;
  if (source.status !== "reserved")
    throw new AppError(
      "SOURCE_NOT_UPLOADABLE",
      "Source is not awaiting upload",
      409,
    );
  if (
    isAbsolute(source.storage_key) ||
    source.storage_key.split("/").includes("..")
  )
    throw new AppError(
      "SOURCE_STORAGE_INVALID",
      "Source storage path is invalid",
      500,
    );
  const nonce = claims.nonce as string,
    claimOwner = newId("upload"),
    claimUntil = new Date(Date.now() + 120_000).toISOString();
  deps.database.transaction(() => {
    if (context.nonceKind === "source")
      deps.database.claimSourceNonce(nonce, sourceId, claimOwner, claimUntil);
    else {
      deps.database.claimNonce(nonce, context.jobId, claimOwner, claimUntil);
      deps.database.transitionJob(context.jobId, ["reserved"], "uploading");
    }
    deps.database.sources.transition(
      sourceId,
      ["reserved"],
      "uploading",
      nowIso(),
    );
  });
  const finalPath = join(deps.storageRoot, source.storage_key),
    directory = finalPath.slice(0, finalPath.lastIndexOf("/"));
  await mkdir(directory, { recursive: true, mode: 0o770 });
  const temporaryPath = `${finalPath}.${claimOwner}.tmp`,
    inspectionPath = join(directory, `.inspect-${claimOwner}`);
  try {
    await writeVerifiedBody(
      deps,
      request,
      temporaryPath,
      source.size,
      source.sha256,
    );
    const inspection = await validateAndExtract(
      temporaryPath,
      inspectionPath,
      {
        maxExtractedBytes:
          deps.maxExtractedBytes ?? DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
        maxFileBytes: deps.maxUploadBytes,
        maxEntries: deps.maxZipEntries ?? DEFAULT_RESOURCE_LIMITS.maxZipEntries,
        maxFiles: deps.maxFileCount ?? DEFAULT_RESOURCE_LIMITS.maxFileCount,
        maxDepth: 10,
        maxNameLength: 200,
      },
      "",
    );
    const handle = await open(temporaryPath, constants.O_RDONLY);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    const timestamp = nowIso(),
      orphanRetentionMinutes = deps.database.settings.value(
        "source_orphan_retention_minutes",
        60,
      ),
      expiresAt = new Date(
        Date.now() + orphanRetentionMinutes * 60_000,
      ).toISOString();
    deps.database.transaction(() => {
      if (context.nonceKind === "source")
        deps.database.consumeSourceNonce(nonce, claimOwner);
      else deps.database.consumeNonce(nonce, claimOwner);
      deps.database.sources.transition(
        sourceId,
        ["uploading"],
        "ready",
        timestamp,
        {
          uploaded_at: timestamp,
          expires_at: expiresAt,
          paths_json: JSON.stringify(inspection.paths),
        },
      );
      if (context.nonceKind === "job")
        deps.database.transitionJob(context.jobId, ["uploading"], "queued", {
          queued_at: timestamp,
        });
      deps.database.audit({
        actorType: "service_account",
        actorId: claims.service_account_id,
        action: "source.uploaded",
        targetType: "source",
        targetId: sourceId,
        result: "success",
        metadata: {
          size: source.size,
          sha256: source.sha256,
          files: inspection.files,
        },
      });
    });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    await rm(finalPath, { force: true });
    deps.database.transaction(() => {
      if (context.nonceKind === "source")
        deps.database.releaseSourceNonce(nonce, claimOwner);
      else deps.database.releaseNonce(nonce, claimOwner);
      deps.database.raw
        .prepare(
          "UPDATE sources SET status='reserved',updated_at=? WHERE id=? AND status='uploading'",
        )
        .run(nowIso(), sourceId);
      if (context.nonceKind === "job")
        deps.database.jobs.restoreReservedAfterUploadFailure(
          context.jobId,
          nowIso(),
        );
    });
    throw error;
  } finally {
    await rm(inspectionPath, { recursive: true, force: true });
  }
}

async function uploadLegacyJobSource(
  deps: RendererApiDependencies,
  request: Request,
  jobId: string,
  claims: TicketClaims,
): Promise<void> {
  assertUploadClaims(deps, request, claims);
  const current = deps.database.jobs.getUploadState(jobId),
    finalPath = join(deps.storageRoot, "jobs", jobId, "input", "source.zip");
  if (current?.status === "queued" && current.source_sha256 === claims.sha256)
    return;
  if (current?.status !== "reserved")
    throw new AppError("JOB_NOT_UPLOADABLE", "Job is not awaiting upload", 409);
  const claimOwner = newId("upload");
  deps.database.transaction(() => {
    deps.database.claimNonce(
      claims.nonce as string,
      jobId,
      claimOwner,
      new Date(Date.now() + 120_000).toISOString(),
    );
    deps.database.transitionJob(jobId, ["reserved"], "uploading");
  });
  await mkdir(join(deps.storageRoot, "jobs", jobId, "input"), {
    recursive: true,
    mode: 0o770,
  });
  const temporaryPath = `${finalPath}.${claimOwner}.tmp`;
  try {
    await writeVerifiedBody(
      deps,
      request,
      temporaryPath,
      claims.size as number,
      claims.sha256 as string,
    );
    const handle = await open(temporaryPath, constants.O_RDONLY);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    deps.database.transaction(() => {
      deps.database.consumeNonce(claims.nonce as string, claimOwner);
      deps.database.transitionJob(jobId, ["uploading"], "queued", {
        queued_at: nowIso(),
      });
    });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    deps.database.transaction(() => {
      deps.database.releaseNonce(claims.nonce as string, claimOwner);
      deps.database.jobs.restoreReservedAfterUploadFailure(jobId, nowIso());
    });
    throw error;
  }
}

function assertUploadClaims(
  deps: RendererApiDependencies,
  request: Request,
  claims: TicketClaims | SourceTicketClaims,
): void {
  if (
    typeof claims.size !== "number" ||
    typeof claims.sha256 !== "string" ||
    typeof claims.nonce !== "string"
  )
    throw new AppError(
      "UPLOAD_CLAIMS_INVALID",
      "Upload ticket claims are incomplete",
      401,
    );
  if (claims.size > deps.maxUploadBytes)
    throw new AppError(
      "UPLOAD_TOO_LARGE",
      "Upload exceeds configured limit",
      413,
    );
  const contentLength = Number(request.headers.get("Content-Length"));
  if (!Number.isInteger(contentLength) || contentLength !== claims.size)
    throw new AppError(
      "CONTENT_LENGTH_MISMATCH",
      "Content-Length does not match ticket",
      400,
    );
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/zip"
  )
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/zip",
      415,
    );
}

async function writeVerifiedBody(
  deps: RendererApiDependencies,
  request: Request,
  path: string,
  claimedSize: number,
  claimedHash: string,
): Promise<void> {
  const filesystem = await statfs(deps.storageRoot);
  if (filesystem.bavail * filesystem.bsize < deps.minFreeStorageBytes)
    throw new AppError("STORAGE_PRESSURE", "Insufficient free storage", 503);
  if (request.body === null)
    throw new AppError("UPLOAD_BODY_REQUIRED", "ZIP body is required", 400);
  let received = 0;
  const digest = createHash("sha256"),
    meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > claimedSize || received > deps.maxUploadBytes)
          callback(
            new AppError("UPLOAD_TOO_LARGE", "Upload exceeds ticket size", 413),
          );
        else {
          digest.update(chunk);
          callback(null, chunk);
        }
      },
    });
  await pipeline(
    Readable.from(readWebBody(request.body)),
    meter,
    createWriteStream(path, { flags: "wx", mode: 0o660 }),
  );
  if (received !== claimedSize || digest.digest("hex") !== claimedHash)
    throw new AppError(
      "UPLOAD_INTEGRITY_FAILED",
      "Upload size or SHA-256 mismatch",
      422,
    );
}

async function* readWebBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}
