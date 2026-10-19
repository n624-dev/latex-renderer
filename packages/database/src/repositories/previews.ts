import type { DatabaseSync } from "node:sqlite";
import { AppError } from "@latex-renderer/shared";
import { ArtifactsRepository, type ArtifactRow } from "./artifacts.js";
import type { ArtifactAvailability } from "../artifact-availability.js";

export interface PreviewDocument {
  job_id: string;
  pdf_artifact_id: string;
  pdf_sha256: string;
  page_count: number;
  runtime_image: string;
  created_at: string;
}
export interface PreviewRequest {
  sequence: number;
  job_id: string;
  page: number;
  status: "queued" | "running" | "succeeded" | "failed";
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

/** All mutating methods run inside the caller's short management transaction.
 * No PDF conversion, filesystem work or waiting is allowed in that transaction. */
export class PreviewsRepository {
  constructor(private readonly db: DatabaseSync) {}

  document(jobId: string): PreviewDocument | undefined {
    return this.db
      .prepare("SELECT * FROM job_preview_documents WHERE job_id=?")
      .get(jobId) as PreviewDocument | undefined;
  }
  register(document: PreviewDocument): void {
    this.db
      .prepare(
        `INSERT INTO job_preview_documents(job_id,pdf_artifact_id,pdf_sha256,page_count,runtime_image,created_at)
      VALUES (?,?,?,?,?,?)`,
      )
      .run(
        document.job_id,
        document.pdf_artifact_id,
        document.pdf_sha256,
        document.page_count,
        document.runtime_image,
        document.created_at,
      );
  }
  get(jobId: string, page: number): PreviewRequest | undefined {
    return this.db
      .prepare("SELECT * FROM job_preview_requests WHERE job_id=? AND page=?")
      .get(jobId, page) as PreviewRequest | undefined;
  }
  verifiedPdf(
    jobId: string,
    policy: ArtifactAvailability = {},
  ): ArtifactRow | undefined {
    const document = this.document(jobId),
      pdf = new ArtifactsRepository(this.db).getDownloadable(
        jobId,
        "result.pdf",
        policy,
      );
    return document &&
      pdf?.id === document.pdf_artifact_id &&
      pdf.sha256 === document.pdf_sha256
      ? pdf
      : undefined;
  }
  request(
    jobId: string,
    page: number,
    timestamp: string,
    policy: ArtifactAvailability = {},
  ): void {
    const document = this.document(jobId),
      pdf = this.verifiedPdf(jobId, policy);
    if (!document || !pdf)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    if (!Number.isSafeInteger(page) || page < 1 || page > document.page_count)
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "Preview page is outside the PDF",
        404,
      );
    const prior = this.get(jobId, page);
    if (prior && prior.status !== "failed") return;
    if (
      prior &&
      (prior.attempt >= 3 ||
        Date.parse(timestamp) - Date.parse(prior.updated_at) < 60_000)
    )
      throw new AppError(
        "PREVIEW_UNAVAILABLE",
        "Preview generation is temporarily unavailable",
        503,
      );
    const queued = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN j.user_id=(SELECT user_id FROM jobs WHERE id=?) THEN 1 ELSE 0 END),0) AS owned
      FROM job_preview_requests p JOIN jobs j ON j.id=p.job_id WHERE p.status IN ('queued','running')`,
      )
      .get(jobId) as { total: number; owned: number };
    if (queued.total >= 32 || queued.owned >= 8)
      throw new AppError("PREVIEW_QUEUE_FULL", "Preview queue is full", 503);
    this.db
      .prepare(
        `INSERT INTO job_preview_requests(job_id,page,status,created_at,updated_at) VALUES (?,?,'queued',?,?)
      ON CONFLICT(job_id,page) DO UPDATE SET status='queued',error_code=NULL,updated_at=excluded.updated_at`,
      )
      .run(jobId, page, timestamp, timestamp);
  }
  claim(workerId: string, timestamp: string): PreviewRequest | undefined {
    const next = this.db
      .prepare(
        "SELECT * FROM job_preview_requests WHERE status='queued' ORDER BY created_at,sequence LIMIT 1",
      )
      .get() as PreviewRequest | undefined;
    if (!next) return undefined;
    const changed = this.db
      .prepare(
        `UPDATE job_preview_requests SET status='running',attempt=attempt+1,lease_owner=?,lease_expires_at=?,updated_at=?
      WHERE sequence=? AND status='queued' AND attempt<3`,
      )
      .run(
        workerId,
        new Date(Date.parse(timestamp) + 120_000).toISOString(),
        timestamp,
        next.sequence,
      );
    return changed.changes === 1 ? this.get(next.job_id, next.page) : undefined;
  }
  owns(request: PreviewRequest, workerId: string): boolean {
    const row = this.get(request.job_id, request.page);
    return (
      row?.status === "running" &&
      row.lease_owner === workerId &&
      row.attempt === request.attempt
    );
  }
  finish(
    request: PreviewRequest,
    workerId: string,
    timestamp: string,
    errorCode?: string,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE job_preview_requests SET status=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE sequence=? AND status='running' AND lease_owner=? AND attempt=?`,
        )
        .run(
          errorCode ? "failed" : "succeeded",
          errorCode ?? null,
          timestamp,
          request.sequence,
          workerId,
          request.attempt,
        ).changes === 1
    );
  }
  stale(timestamp: string): PreviewRequest[] {
    return this.db
      .prepare(
        "SELECT * FROM job_preview_requests WHERE status='running' AND lease_expires_at<?",
      )
      .all(timestamp) as unknown as PreviewRequest[];
  }
}
