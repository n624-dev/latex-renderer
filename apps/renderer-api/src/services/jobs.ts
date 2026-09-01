import { AppError, nowIso } from "@latex-renderer/shared";
import type { ArtifactRow } from "@latex-renderer/database";
import type {
  JobArtifact,
  JobResponse,
  JobStatus,
} from "@latex-renderer/contracts";
import type { TicketClaims } from "@latex-renderer/ticket";
import type { RendererApiDependencies } from "../types.js";

export class RendererJobsService {
  constructor(private readonly deps: RendererApiDependencies) {}
  status(id: string): JobResponse {
    const row = this.deps.database.jobs.get(id);
    if (row === undefined || row.status === "deleted")
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    const listed = this.deps.database.artifacts.listDownloadable(id),
      artifacts: JobArtifact[] = [],
      previews: JobArtifact[] = [];
    for (const artifact of listed) {
      const item = artifactItem(id, artifact);
      (artifact.type === "preview" ? previews : artifacts).push(item);
    }
    return {
      id: row.id,
      status: row.status,
      sourceSize: row.source_size,
      sourceSha256: row.source_sha256,
      sourceId: row.source_id,
      entrypoint: row.entrypoint,
      outputs: this.deps.database.jobs.outputs(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      retentionExpiresAt: retentionExpiresAt(
        row.status,
        row.completed_at ?? row.updated_at,
        this.deps.artifactRetentionHours,
      ),
      artifacts,
      previews,
    };
  }
  cancel(
    id: string,
    claims: TicketClaims,
  ): { id: string; cancelRequestedAt: string } {
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      if (this.deps.database.jobs.cancel(id, timestamp) !== 1)
        throw new AppError("JOB_NOT_CANCELABLE", "Job cannot be canceled", 409);
      this.deps.database.audit({
        actorType: "service_account",
        actorId: claims.service_account_id,
        action: "render.canceled",
        targetType: "job",
        targetId: id,
        result: "requested",
      });
    });
    return { id, cancelRequestedAt: timestamp };
  }
  delete(id: string, claims: TicketClaims): void {
    this.deps.database.transaction(() => {
      if (this.deps.database.jobs.markDeleting(id, nowIso()) !== 1)
        throw new AppError(
          "JOB_STATE_CONFLICT",
          "Job state changed concurrently",
          409,
        );
      this.deps.database.audit({
        actorType: "service_account",
        actorId: claims.service_account_id,
        action: "render.deleted",
        targetType: "job",
        targetId: id,
        result: "requested",
      });
    });
  }
}

const RETAINED_STATUSES: ReadonlySet<JobStatus> = new Set([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "expired",
]);
function retentionExpiresAt(
  status: JobStatus,
  terminalAt: string,
  hours: number,
): string | null {
  return RETAINED_STATUSES.has(status)
    ? new Date(new Date(terminalAt).getTime() + hours * 3_600_000).toISOString()
    : null;
}
function artifactItem(jobId: string, row: ArtifactRow): JobArtifact {
  const leaf =
      row.type === "preview"
        ? row.relative_path.replace(/^previews\//, "")
        : row.relative_path,
    prefix = row.type === "preview" ? "previews" : "artifacts";
  return {
    type: row.type,
    relativePath: row.relative_path,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.created_at,
    downloadUrl: `/api/v1/jobs/${encodeURIComponent(jobId)}/${prefix}/${leaf.split("/").map(encodeURIComponent).join("/")}`,
  };
}
