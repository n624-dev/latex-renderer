import { createReadStream } from "node:fs";
import { basename, normalize, sep } from "node:path";
import {
  artifactStoragePath,
  artifactRetentionExpiresAt,
  bindArtifactDownloadLeases,
  ARTIFACT_DOWNLOAD_LEASE_MS,
  waitForPreview,
} from "@latex-renderer/database";
import { Readable } from "node:stream";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import yazl from "yazl";
import type { AdminDependencies, AppActor } from "../types.js";

const ARTIFACT_NAME =
  /^(?:result\.pdf|compile\.log|errors\.json|dependencies\.json|svg\/(?:compile\.log|errors\.json|dependencies\.json|manifest\.json)|svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg)$/;
const PREVIEW_NAME = /^page-[0-9]{1,3}\.png$/;

/** Caller must first apply admin scope or same-user Job authorization. */
export async function adminPreviewResponse(
  deps: AdminDependencies,
  actor: AppActor,
  jobId: string,
  name: string,
  signal: AbortSignal,
): Promise<Response> {
  if (
    !/^job_[a-f0-9]{32}$/.test(jobId) ||
    !deps.database.jobs.getVisible(jobId) ||
    !PREVIEW_NAME.test(name)
  )
    throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
  const row = await waitForPreview(
    deps.database,
    jobId,
    Number(name.slice(5, -4)),
    { retentionHours: deps.artifactRetentionHours ?? 24 },
    { signal },
  );
  return adminArtifactResponse(
    deps,
    actor,
    jobId,
    row.relative_path.slice("previews/".length),
    true,
    true,
  );
}

export function adminArtifactsArchiveResponse(
  deps: AdminDependencies,
  actor: AppActor,
  jobId: string,
): Response {
  if (!/^job_[a-f0-9]{32}$/.test(jobId))
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  const leased = deps.database.transaction(() => {
    const job = deps.database.jobs.getVisible(jobId);
    if (
      job === undefined ||
      ["deleting", "deleted", "expired"].includes(job.status) ||
      isPastRetention(
        deps,
        deps.database.outputStages.retentionStart(
          jobId,
          job.completed_at ?? job.updated_at,
        ),
      )
    )
      throw new AppError(
        "ARTIFACT_NOT_AVAILABLE",
        "Artifacts are no longer available",
        410,
      );
    const rows = deps.database.artifacts.listDownloadable(jobId, {
      retentionHours: deps.artifactRetentionHours ?? 24,
    });
    if (rows.length === 0)
      throw new AppError(
        "ARTIFACT_NOT_FOUND",
        "No downloadable artifacts exist",
        404,
      );
    for (const row of rows) {
      assertStoredArtifactPath(row.relative_path);
      artifactStoragePath(deps.storageRoot, row);
    }
    const leases = rows.map((row) => {
      const leaseId = newId("download");
      deps.database.artifacts.createLease({
        id: leaseId,
        jobId,
        artifactId: row.id,
        expiresAt: new Date(
          Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
        ).toISOString(),
        createdAt: nowIso(),
      });
      return leaseId;
    });
    deps.database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action: "admin.artifacts.archive_downloaded",
      targetType: "job",
      targetId: jobId,
      result: "success",
      metadata: {
        count: rows.length,
        size: rows.reduce((total, row) => total + row.size, 0),
      },
    });
    return { rows, leases };
  });

  const archive = new yazl.ZipFile();
  const output = archive.outputStream as unknown as Readable;
  const cleanup = bindArtifactDownloadLeases(
    deps.database.artifacts,
    leased.leases,
    output,
  );
  // yazl emits file stat/read failures on ZipFile, not just outputStream.
  // Install handlers before addFile/end and propagate failure to the response.
  archive.on("error", (error: Error) => {
    output.destroy(error);
    cleanup();
  });
  try {
    for (const row of leased.rows) {
      archive.addFile(
        artifactStoragePath(deps.storageRoot, row),
        row.relative_path,
        { compress: false },
      );
    }
    archive.end();
  } catch (error) {
    output.destroy();
    cleanup();
    throw error;
  }
  // Bridge Node and DOM stream definitions for the Response body.
  const responseBody = Readable.toWeb(output) as ReadableStream<Uint8Array>;
  return new Response(responseBody, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${jobId}-artifacts.zip"`,
      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function adminArtifactResponse(
  deps: AdminDependencies,
  actor: AppActor,
  jobId: string,
  name: string,
  preview: boolean,
  inline: boolean,
  pdfRequest?: { range?: string | undefined; ifRange?: string | undefined },
): Response {
  if (!/^job_[a-f0-9]{32}$/.test(jobId))
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  if (
    !(preview ? PREVIEW_NAME : ARTIFACT_NAME).test(name) ||
    (preview &&
      (Number(name.slice(5, -4)) < 1 || Number(name.slice(5, -4)) > 100))
  )
    throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
  const relativePath = preview ? `previews/${name}` : name;
  const leased = deps.database.transaction(() => {
    const job = deps.database.jobs.getVisible(jobId);
    if (
      job === undefined ||
      ["deleting", "deleted", "expired"].includes(job.status) ||
      isPastRetention(
        deps,
        deps.database.outputStages.retentionStart(
          jobId,
          job.completed_at ?? job.updated_at,
        ),
      )
    )
      throw new AppError(
        "ARTIFACT_NOT_AVAILABLE",
        "Artifact is no longer available",
        410,
      );
    const row = deps.database.artifacts.getDownloadable(jobId, relativePath, {
      retentionHours: deps.artifactRetentionHours ?? 24,
    });
    if (row === undefined)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    assertStoredArtifactPath(row.relative_path, relativePath);
    const path = artifactStoragePath(deps.storageRoot, row);
    const etag =
      pdfRequest && row.type === "pdf" ? `"sha256:${row.sha256}"` : undefined;
    const range =
      etag && (pdfRequest?.ifRange === undefined || pdfRequest.ifRange === etag)
        ? pdfByteRange(pdfRequest?.range, row.size)
        : undefined;
    if (range === "unsatisfied") return { row, etag, range } as const;
    const leaseId = newId("download");
    deps.database.artifacts.createLease({
      id: leaseId,
      jobId,
      artifactId: row.id,
      expiresAt: new Date(
        Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
      ).toISOString(),
      createdAt: nowIso(),
    });
    deps.database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action: inline ? "admin.artifact.viewed" : "admin.artifact.downloaded",
      targetType: "job",
      targetId: jobId,
      result: "success",
      metadata: { relativePath, size: row.size, sha256: row.sha256 },
    });
    return { row, path, leaseId, etag, range } as const;
  });
  const cache = {
    "Cache-Control":
      "private, no-store, no-cache, max-age=0, must-revalidate, no-transform",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    ...(leased.etag ? { ETag: leased.etag, "Accept-Ranges": "bytes" } : {}),
  };
  if (leased.range === "unsatisfied")
    return new Response(null, {
      status: 416,
      headers: {
        ...cache,
        "Content-Range": `bytes */${leased.row.size}`,
        "Content-Length": "0",
      },
    });
  const { range } = leased;
  const input = createReadStream(leased.path, range);
  bindArtifactDownloadLeases(deps.database.artifacts, [leased.leaseId], input);
  const digest = Buffer.from(leased.row.sha256, "hex").toString("base64"),
    disposition =
      inline && ["pdf", "preview"].includes(leased.row.type)
        ? "inline"
        : "attachment";
  return new Response(Readable.toWeb(input) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      ...cache,
      "Content-Type": artifactContentType(leased.row.type),
      "Content-Length": String(
        range ? range.end - range.start + 1 : leased.row.size,
      ),
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${leased.row.size}`,
            "Repr-Digest": `sha-256=:${digest}:`,
          }
        : { "Content-Digest": `sha-256=:${digest}:` }),
      "X-Artifact-SHA256": leased.row.sha256,
      "Content-Disposition": `${disposition}; filename="${basename(name).replaceAll('"', "")}"`,
    },
  });
}

function pdfByteRange(header: string | undefined, size: number) {
  // Ignore unsupported units, malformed fields and multiple ranges. The
  // browser viewer uses one contiguous range in each request.
  if (!header || header.length > 1024) return;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (size === 0 || suffix === 0) return "unsatisfied" as const;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]),
    end = match[2] ? Number(match[2]) : size - 1;
  if (match[2] && end < start) return;
  if (start >= size) return "unsatisfied" as const;
  return { start, end: Math.min(end, size - 1) };
}

function assertStoredArtifactPath(path: string, expected = path): void {
  const normalized = normalize(path);
  if (
    normalized.startsWith("..") ||
    normalized.includes(`${sep}..${sep}`) ||
    normalized.startsWith(sep) ||
    normalized !== path ||
    normalized !== expected
  )
    throw new AppError(
      "ARTIFACT_PATH_INVALID",
      "Stored artifact path is invalid",
    );
}

export function artifactContentType(type: string): string {
  if (type === "pdf") return "application/pdf";
  if (type === "preview") return "image/png";
  if (type === "svg") return "image/svg+xml";
  if (type === "errors" || type === "dependencies" || type === "svg_manifest")
    return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function retentionExpiresAt(
  deps: AdminDependencies,
  terminalAt: string,
): string {
  return artifactRetentionExpiresAt(
    terminalAt,
    deps.artifactRetentionHours ?? 24,
  );
}

function isPastRetention(deps: AdminDependencies, terminalAt: string): boolean {
  return Date.parse(retentionExpiresAt(deps, terminalAt)) <= Date.now();
}
