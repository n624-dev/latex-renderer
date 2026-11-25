import type { PdfInspectionInput } from "@latex-renderer/contracts";
import type { DatabaseSync } from "node:sqlite";
import { AppError, newId, sha256Hex } from "@latex-renderer/shared";
import type { ArtifactRow } from "./artifacts.js";

export const PDF_INSPECTOR_VERSION = 2;
export type PdfInspectionRow = {
  id: string;
  job_id: string;
  artifact_id: string;
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
};

export class PdfInspectionsRepository {
  constructor(private readonly db: DatabaseSync) {}

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
    const pending = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
      SUM(CASE WHEN j.user_id=(SELECT user_id FROM jobs WHERE id=?) THEN 1 ELSE 0 END) AS owned
      FROM pdf_inspections i JOIN jobs j ON j.id=i.job_id
      WHERE i.status IN ('queued','running')`,
      )
      .get(artifact.job_id) as { total: number; owned: number | null };
    if (pending.total >= 32 || (pending.owned ?? 0) >= 8)
      throw new AppError(
        "PDF_INSPECTION_BUSY",
        "The PDF inspection queue is full",
        503,
      );
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

  claim(owner: string, timestamp: string): PdfInspectionRow | undefined {
    if (this.hasRunning()) return undefined;
    const next = this.db
      .prepare(
        `SELECT id FROM pdf_inspections WHERE status='queued'
      AND expires_at>? ORDER BY requested_at,id LIMIT 1`,
      )
      .get(timestamp) as { id: string } | undefined;
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
    outcome: { json: string } | { error: string },
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE pdf_inspections SET status=?,result_json=?,error_code=?,
      lease_until=NULL,lease_owner=NULL WHERE id=? AND status='running' AND lease_owner=?`,
        )
        .run(
          "json" in outcome ? "ready" : "failed",
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
