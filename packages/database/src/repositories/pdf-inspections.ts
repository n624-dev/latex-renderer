import type { PdfInspectionInput } from "@latex-renderer/contracts";
import type { DatabaseSync } from "node:sqlite";
import { AppError, newId, sha256Hex } from "@latex-renderer/shared";
import { join } from "node:path";
import type { ArtifactRow } from "./artifacts.js";

export const PDF_INSPECTOR_VERSION = 2;
const maximumInspectionRetries = 3;
const retryableInspectionFailures = new Set([
  "INSUFFICIENT_STORAGE",
  "PDF_INSPECTION_INTERRUPTED",
]);
export const PDF_INSPECTION_UPLOAD_TTL_MS = 60 * 60 * 1000;
export function pdfInspectionUploadDirectory(
  storageRoot: string,
  id: string,
): string {
  if (!/^pdfupload_[a-f0-9]{32}$/.test(id))
    throw new Error("Invalid uploaded PDF ID");
  return join(storageRoot, "pdf-inspection-uploads", id);
}

export function pdfInspectionUploadResult(
  directory: string,
  id: string,
): string {
  if (!/^inspect_[a-f0-9]{32}$/.test(id))
    throw new Error("Invalid PDF inspection ID");
  return join(directory, `${id}.json`);
}
export type PdfInspectionUpload = {
  id: string;
  user_id: string;
  request_hash: string;
  file_hash: string;
  pdf_sha256: string | null;
  size: number | null;
  expires_at: string;
};
export type PdfInspectionRow = {
  id: string;
  job_id: string | null;
  artifact_id: string | null;
  upload_id: string | null;
  pdf_sha256: string;
  inspector_version: number;
  params_json: string | null;
  status: "queued" | "running" | "ready" | "failed";
  requested_at: string;
  expires_at: string;
  lease_owner: string | null;
  lease_until: string | null;
  result_json: string | null;
  error_code: string | null;
  retry_count: number;
  retry_at: string | null;
};

export class PdfInspectionsRepository {
  constructor(private readonly db: DatabaseSync) {}

  upload(id: string): PdfInspectionUpload | undefined {
    return this.db
      .prepare("SELECT * FROM pdf_inspection_uploads WHERE id=?")
      .get(id) as PdfInspectionUpload | undefined;
  }

  reserveUpload(
    userId: string,
    requestHash: string,
    fileHash: string,
    timestamp: string,
  ) {
    const existing = this.db
      .prepare(
        "SELECT * FROM pdf_inspection_uploads WHERE user_id=? AND request_hash=?",
      )
      .get(userId, requestHash) as PdfInspectionUpload | undefined;
    if (existing) {
      if (existing.expires_at <= timestamp)
        throw new AppError(
          "PDF_INSPECTION_EXPIRED",
          "The uploaded PDF has expired",
          410,
        );
      if (existing.file_hash !== fileHash)
        throw new AppError(
          "PDF_UPLOAD_CONFLICT",
          "The request key belongs to a different attachment",
          409,
        );
      if (existing.pdf_sha256 === null)
        throw new AppError(
          "PDF_UPLOAD_PENDING",
          "The PDF is still being received",
          409,
          { retryAfterSeconds: 2 },
        );
      return { upload: existing, existing: true };
    }
    const active = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(user_id=?) AS owned
        FROM pdf_inspection_uploads`,
      )
      .get(userId) as { total: number; owned: number | null };
    if (active.total >= 8 || (active.owned ?? 0) >= 2)
      throw new AppError(
        "PDF_UPLOAD_BUSY",
        "The temporary PDF storage is full",
        503,
      );
    const id = newId("pdfupload");
    const expiresAt = new Date(
      Date.parse(timestamp) + PDF_INSPECTION_UPLOAD_TTL_MS,
    ).toISOString();
    const upload = this.db
      .prepare(
        `INSERT INTO pdf_inspection_uploads
        (id,user_id,request_hash,file_hash,expires_at) VALUES (?,?,?,?,?) RETURNING *`,
      )
      .get(id, userId, requestHash, fileHash, expiresAt) as
      PdfInspectionUpload | undefined;
    if (!upload) throw new Error("PDF upload reservation was not recorded");
    return { upload, existing: false };
  }

  completeUpload(id: string, sha256: string, size: number, timestamp: string) {
    const upload = this.db
      .prepare(
        `UPDATE pdf_inspection_uploads SET pdf_sha256=?,size=?
        WHERE id=? AND pdf_sha256 IS NULL AND expires_at>? RETURNING *`,
      )
      .get(sha256, size, id, timestamp) as PdfInspectionUpload | undefined;
    if (!upload)
      throw new AppError(
        "PDF_INSPECTION_EXPIRED",
        "The uploaded PDF has expired",
        410,
      );
    return upload;
  }

  discardUpload(id: string): void {
    this.db
      .prepare(
        "DELETE FROM pdf_inspection_uploads WHERE id=? AND pdf_sha256 IS NULL",
      )
      .run(id);
  }

  expiredUploads(timestamp: string): PdfInspectionUpload[] {
    return this.db
      .prepare(
        `SELECT * FROM pdf_inspection_uploads AS u
      WHERE u.expires_at<=? AND NOT EXISTS (
        SELECT 1 FROM pdf_inspections AS i WHERE i.upload_id=u.id AND i.status='running'
      )`,
      )
      .all(timestamp) as PdfInspectionUpload[];
  }

  deleteExpiredUpload(id: string, timestamp: string): void {
    this.db
      .prepare(
        "DELETE FROM pdf_inspection_uploads WHERE id=? AND expires_at<=?",
      )
      .run(id, timestamp);
  }

  get(id: string): PdfInspectionRow | undefined {
    return this.db
      .prepare("SELECT * FROM pdf_inspections WHERE id=?")
      .get(id) as PdfInspectionRow | undefined;
  }

  forArtifact(
    artifact: ArtifactRow,
    params?: PdfInspectionInput,
  ): PdfInspectionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM pdf_inspections WHERE job_id=?
      AND artifact_id=? AND pdf_sha256=? AND inspector_version=? AND request_key=?`,
      )
      .get(
        artifact.job_id,
        artifact.id,
        artifact.sha256,
        PDF_INSPECTOR_VERSION,
        inspectionKey(params),
      ) as PdfInspectionRow | undefined;
  }

  request(
    artifact: ArtifactRow,
    expiresAt: string,
    timestamp: string,
    params?: PdfInspectionInput,
  ) {
    const existing = this.forArtifact(artifact, params);
    if (existing) return existing;
    const job = this.db
      .prepare("SELECT user_id FROM jobs WHERE id=?")
      .get(artifact.job_id) as { user_id: string } | undefined;
    if (job === undefined) throw new Error("PDF inspection job is missing");
    this.assertCapacity(job.user_id);
    if (
      params &&
      this.db
        .prepare(
          `SELECT id FROM pdf_inspections WHERE job_id=? AND params_json IS NOT NULL
       AND expires_at>? LIMIT 1 OFFSET 31`,
        )
        .get(artifact.job_id, timestamp)
    )
      throw new AppError(
        "PDF_INSPECTION_LIMIT",
        "The PDF has reached its saved inspection limit",
        409,
      );
    const id = newId("inspect");
    this.db
      .prepare(
        `INSERT INTO pdf_inspections
      (id,job_id,artifact_id,pdf_sha256,inspector_version,request_key,params_json,status,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,'queued',?,?)`,
      )
      .run(
        id,
        artifact.job_id,
        artifact.id,
        artifact.sha256,
        PDF_INSPECTOR_VERSION,
        inspectionKey(params),
        params ? JSON.stringify(params) : null,
        timestamp,
        expiresAt,
      );
    const created = this.get(id);
    if (created === undefined)
      throw new Error("PDF inspection request was not recorded");
    return created;
  }

  forUpload(
    upload: PdfInspectionUpload,
    params?: PdfInspectionInput,
  ): PdfInspectionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM pdf_inspections
      WHERE upload_id=? AND pdf_sha256=? AND inspector_version=? AND request_key=?`,
      )
      .get(
        upload.id,
        upload.pdf_sha256,
        PDF_INSPECTOR_VERSION,
        inspectionKey(params),
      ) as PdfInspectionRow | undefined;
  }

  requestUpload(
    upload: PdfInspectionUpload,
    timestamp: string,
    params?: PdfInspectionInput,
  ): PdfInspectionRow {
    const existing = this.forUpload(upload, params);
    if (existing) return existing;
    if (upload.pdf_sha256 === null || upload.expires_at <= timestamp)
      throw new AppError(
        "PDF_INSPECTION_EXPIRED",
        "The uploaded PDF is not available",
        410,
      );
    this.assertCapacity(upload.user_id);
    if (
      params &&
      this.db
        .prepare(
          `SELECT 1 FROM pdf_inspections
      WHERE upload_id=? AND params_json IS NOT NULL LIMIT 1 OFFSET 31`,
        )
        .get(upload.id)
    )
      throw new AppError(
        "PDF_INSPECTION_LIMIT",
        "The PDF has reached its saved inspection limit",
        409,
      );
    const id = newId("inspect");
    const created = this.db
      .prepare(
        `INSERT INTO pdf_inspections
      (id,upload_id,pdf_sha256,inspector_version,request_key,params_json,status,requested_at,expires_at)
      VALUES (?,?,?,?,?,?,'queued',?,?) RETURNING *`,
      )
      .get(
        id,
        upload.id,
        upload.pdf_sha256,
        PDF_INSPECTOR_VERSION,
        inspectionKey(params),
        params ? JSON.stringify(params) : null,
        timestamp,
        upload.expires_at,
      ) as PdfInspectionRow | undefined;
    if (!created) throw new Error("Uploaded PDF inspection was not recorded");
    return created;
  }

  private assertCapacity(userId: string): void {
    const pending = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(COALESCE(j.user_id,u.user_id)=?) AS owned
        FROM pdf_inspections AS i LEFT JOIN jobs AS j ON i.job_id=j.id
        LEFT JOIN pdf_inspection_uploads AS u ON i.upload_id=u.id
        WHERE i.status IN ('queued','running')`,
      )
      .get(userId) as { total: number; owned: number | null };
    if (pending.total >= 32 || (pending.owned ?? 0) >= 8)
      throw new AppError(
        "PDF_INSPECTION_BUSY",
        "The PDF inspection queue is full",
        503,
      );
  }

  claim(owner: string, timestamp: string): PdfInspectionRow | undefined {
    if (this.hasRunning()) return undefined;
    const next = this.db
      .prepare(
        `SELECT id FROM pdf_inspections WHERE status='queued'
      AND expires_at>? AND (retry_at IS NULL OR retry_at<=?)
      ORDER BY COALESCE(retry_at, requested_at),id LIMIT 1`,
      )
      .get(timestamp, timestamp) as { id: string } | undefined;
    if (!next) return undefined;
    this.db
      .prepare(
        "UPDATE pdf_inspections SET status='running',lease_owner=?,lease_until=? WHERE id=?",
      )
      .run(
        owner,
        new Date(Date.parse(timestamp) + 120_000).toISOString(),
        next.id,
      );
    return this.get(next.id);
  }

  hasRunning(): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM pdf_inspections WHERE status='running' LIMIT 1")
        .get() !== undefined
    );
  }

  stale(timestamp: string): PdfInspectionRow[] {
    return this.db
      .prepare(
        "SELECT * FROM pdf_inspections WHERE status='running' AND lease_until<=?",
      )
      .all(timestamp) as PdfInspectionRow[];
  }

  takeRecovery(
    row: PdfInspectionRow,
    owner: string,
    timestamp: string,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE pdf_inspections SET lease_owner=?,lease_until=?
      WHERE id=? AND status='running' AND lease_owner=? AND lease_until<=?`,
        )
        .run(
          owner,
          new Date(Date.parse(timestamp) + 120_000).toISOString(),
          row.id,
          row.lease_owner,
          timestamp,
        ).changes === 1
    );
  }

  owns(id: string, owner: string, timestamp: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM pdf_inspections WHERE id=?
      AND status='running' AND lease_owner=? AND lease_until>?`,
        )
        .get(id, owner, timestamp) !== undefined
    );
  }

  finish(
    id: string,
    owner: string,
    outcome: { json: string } | { uploaded: true } | { error: string },
    timestamp = new Date().toISOString(),
  ): boolean {
    if ("error" in outcome && retryableInspectionFailures.has(outcome.error)) {
      const row = this.get(id);
      if (row && row.retry_count < maximumInspectionRetries) {
        const retryAt = new Date(Date.parse(timestamp) + 30_000 * 2 ** row.retry_count).toISOString();
        if (retryAt < row.expires_at) {
          return this.db.prepare(
            `UPDATE pdf_inspections SET status='queued', result_json=NULL, error_code=NULL,
             retry_count=retry_count+1, retry_at=?, lease_until=NULL, lease_owner=NULL
             WHERE id=? AND status='running' AND lease_owner=? AND retry_count=?`,
          ).run(retryAt, id, owner, row.retry_count).changes === 1;
        }
      }
    }
    return (
      this.db
        .prepare(
          `UPDATE pdf_inspections SET status=?,result_json=?,error_code=?,
      retry_at=NULL,lease_until=NULL,lease_owner=NULL WHERE id=? AND status='running' AND lease_owner=?`,
        )
        .run(
          "error" in outcome ? "failed" : "ready",
          "json" in outcome ? outcome.json : null,
          "error" in outcome ? outcome.error : null,
          id,
          owner,
        ).changes === 1
    );
  }

  prune(timestamp: string): void {
    this.db
      .prepare(
        "DELETE FROM pdf_inspections WHERE status!='running' AND expires_at<=?",
      )
      .run(timestamp);
  }
}

function inspectionKey(params?: PdfInspectionInput): string {
  if (params === undefined) return "quality";
  if ("direction" in params || "pages" in params)
    return sha256Hex(JSON.stringify(params));
  return sha256Hex(
    JSON.stringify([
      params.page,
      params.x,
      params.y,
      params.width,
      params.height,
    ]),
  );
}
