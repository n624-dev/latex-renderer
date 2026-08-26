import { createReadStream } from "node:fs";
import { basename, normalize, join, sep } from "node:path";
import { Readable } from "node:stream";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { AdminDependencies, AppActor } from "../types.js";

const ARTIFACT_NAME =
  /^(?:result\.pdf|compile\.log|errors\.json|dependencies\.json|svg\/manifest\.json|svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg)$/;
const PREVIEW_NAME = /^page-[1-9][0-9]{0,2}\.png$/;

export function adminArtifactResponse(
  deps: AdminDependencies,
  actor: AppActor,
  jobId: string,
  name: string,
  preview: boolean,
  inline: boolean,
): Response {
  if (!/^job_[a-f0-9]{32}$/.test(jobId))
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  if (!(preview ? PREVIEW_NAME : ARTIFACT_NAME).test(name))
    throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
  const relativePath = preview ? `previews/${name}` : name;
  const leased = deps.database.transaction(() => {
    const job = deps.database.jobs.get(jobId);
    if (
      job === undefined ||
      ["deleting", "deleted", "expired"].includes(job.status) ||
      isPastRetention(deps, job.completed_at ?? job.updated_at)
    )
      throw new AppError(
        "ARTIFACT_NOT_AVAILABLE",
        "Artifact is no longer available",
        410,
      );
    const row = deps.database.artifacts.getDownloadable(jobId, relativePath);
    if (row === undefined)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    const leaseId = newId("download");
    deps.database.artifacts.createLease({
      id: leaseId,
      jobId,
      artifactId: row.id,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
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
    return { row, leaseId };
  });
  const normalized = normalize(leased.row.relative_path);
  if (
    normalized.startsWith("..") ||
    normalized.includes(`${sep}..${sep}`) ||
    normalized !== relativePath
  ) {
    deps.database.artifacts.deleteLease(leased.leaseId);
    throw new AppError(
      "ARTIFACT_PATH_INVALID",
      "Stored artifact path is invalid",
    );
  }
  const input = createReadStream(
    join(deps.storageRoot, "jobs", jobId, "output", normalized),
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    deps.database.artifacts.deleteLease(leased.leaseId);
  };
  input.once("close", cleanup);
  input.once("error", cleanup);
  input.once("end", cleanup);
  const digest = Buffer.from(leased.row.sha256, "hex").toString("base64"),
    disposition =
      inline && ["pdf", "preview"].includes(leased.row.type)
        ? "inline"
        : "attachment";
  return new Response(Readable.toWeb(input) as ReadableStream, {
    headers: {
      "Content-Type": artifactContentType(leased.row.type),
      "Content-Length": String(leased.row.size),
      "Content-Digest": `sha-256=:${digest}:`,
      "X-Artifact-SHA256": leased.row.sha256,
      "Content-Disposition": `${disposition}; filename="${basename(name).replaceAll('"', "")}"`,
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
  return new Date(
    new Date(terminalAt).getTime() +
      (deps.artifactRetentionHours ?? 24) * 3_600_000,
  ).toISOString();
}

function isPastRetention(deps: AdminDependencies, terminalAt: string): boolean {
  return Date.parse(retentionExpiresAt(deps, terminalAt)) <= Date.now();
}
