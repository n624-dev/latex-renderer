import type { DatabaseSync } from "node:sqlite";
import type { JobStages } from "@latex-renderer/contracts";

export interface OutputStageCheckpoint {
  job_id: string;
  source_sha256: string;
  source_id: string | null;
  entrypoint: string;
  project_revision_id: string | null;
  renderer_image: string;
  pdf_status: JobStages["pdf"]["status"];
  svg_status: JobStages["svg"]["status"];
  pdf_generation: number | null;
  svg_generation: number | null;
  pdf_sha256: string | null;
  synctex_sha256: string | null;
  synctex_bytes: number;
  pdf_completed_at: string | null;
  pdf_error_code: string | null;
  pdf_error_message: string | null;
  svg_completed_at: string | null;
  svg_error_code: string | null;
  svg_error_message: string | null;
  svg_attempt: number;
}

const owned = `EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_output_stages.job_id
  AND j.lease_owner=? AND j.lease_generation=? AND j.status='running' AND j.cancel_requested_at IS NULL
  AND j.source_sha256=job_output_stages.source_sha256 AND j.entrypoint=job_output_stages.entrypoint
  AND j.source_id IS job_output_stages.source_id AND j.project_revision_id IS job_output_stages.project_revision_id)`;

export class OutputStagesRepository {
  constructor(private readonly db: DatabaseSync) {}

  checkpoint(jobId: string): OutputStageCheckpoint | undefined {
    return this.db
      .prepare("SELECT * FROM job_output_stages WHERE job_id=?")
      .get(jobId) as OutputStageCheckpoint | undefined;
  }

  publicState(jobId: string): JobStages | undefined {
    const r = this.checkpoint(jobId);
    if (!r) return undefined;
    return this.publicCheckpoint(r);
  }

  publicStates(ids: readonly string[]): Map<string, JobStages> {
    if (ids.length > 10000)
      throw new Error("Stage metadata page exceeds limit");
    if (ids.length === 0) return new Map();
    const result = new Map<string, JobStages>();
    for (let offset = 0; offset < ids.length; offset += 200) {
      const page = ids.slice(offset, offset + 200);
      const rows = this.db
        .prepare(
          `SELECT * FROM job_output_stages WHERE job_id IN (${page.map(() => "?").join(",")})`,
        )
        .all(...page) as unknown as OutputStageCheckpoint[];
      for (const row of rows)
        result.set(row.job_id, this.publicCheckpoint(row));
    }
    return result;
  }

  private publicCheckpoint(r: OutputStageCheckpoint): JobStages {
    return {
      pdf: {
        status: r.pdf_status,
        completedAt: r.pdf_completed_at,
        errorCode: r.pdf_error_code,
        errorMessage: r.pdf_error_message,
        sha256: r.pdf_sha256,
      },
      svg: {
        status: r.svg_status,
        completedAt: r.svg_completed_at,
        errorCode: r.svg_error_code,
        errorMessage: r.svg_error_message,
        attempt: r.svg_attempt,
      },
    };
  }

  retentionStart(jobId: string, fallback: string): string {
    const r = this.checkpoint(jobId);
    return r?.pdf_status === "succeeded" && r.pdf_completed_at !== null
      ? r.pdf_completed_at
      : fallback;
  }

  initialize(
    jobId: string,
    workerId: string,
    generation: number,
    rendererImage: string,
  ): boolean {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO job_output_stages(job_id,source_sha256,source_id,entrypoint,project_revision_id,renderer_image)
      SELECT id,source_sha256,source_id,entrypoint,project_revision_id,? FROM jobs WHERE id=? AND lease_owner=? AND lease_generation=?
      AND status IN ('validating','running') AND cancel_requested_at IS NULL
      AND EXISTS(SELECT 1 FROM json_each(outputs_json) WHERE value='svg')`,
      )
      .run(rendererImage, jobId, workerId, generation);
    return this.checkpoint(jobId) !== undefined;
  }

  start(
    jobId: string,
    stage: "pdf" | "svg",
    workerId: string,
    generation: number,
  ): boolean {
    const phase = stage === "pdf" ? "pdf_status" : "svg_status";
    return (
      this.db
        .prepare(
          `UPDATE job_output_stages SET ${phase}='running'
      WHERE job_id=? AND ${phase}='queued' AND ${owned}
      ${stage === "svg" ? "AND pdf_status='succeeded'" : ""}`,
        )
        .run(jobId, workerId, generation).changes === 1
    );
  }

  completePdf(
    jobId: string,
    workerId: string,
    generation: number,
    input: {
      storageGeneration: number;
      sha256: string;
      synctexSha256: string;
      synctexBytes: number;
      completedAt: string;
    },
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE job_output_stages SET pdf_status='succeeded',pdf_generation=?,pdf_sha256=?,
      synctex_sha256=?,synctex_bytes=?,pdf_completed_at=?
      WHERE job_id=? AND pdf_status='running' AND ${owned}`,
        )
        .run(
          input.storageGeneration,
          input.sha256,
          input.synctexSha256,
          input.synctexBytes,
          input.completedAt,
          jobId,
          workerId,
          generation,
        ).changes === 1
    );
  }

  completeSvg(
    jobId: string,
    workerId: string,
    generation: number,
    input: {
      storageGeneration: number;
      status: "succeeded" | "failed" | "timeout" | "canceled";
      errorCode: string | null;
      errorMessage: string | null;
      completedAt: string;
    },
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE job_output_stages SET svg_status=?,svg_error_code=?,svg_error_message=?,svg_completed_at=?,svg_generation=?
      WHERE job_id=? AND svg_status='running' AND ${owned}`,
        )
        .run(
          input.status,
          input.errorCode,
          input.errorMessage,
          input.completedAt,
          input.storageGeneration,
          jobId,
          workerId,
          generation,
        ).changes === 1
    );
  }

  /** Caller holds the database transaction, including ownership/admission and idempotency checks. */
  requeueSvg(
    jobId: string,
    userId: string,
    now: string,
    cutoff: string,
    reservedBytes: number,
  ): boolean {
    const changed = this.db
      .prepare(
        `UPDATE jobs SET status='queued',render_status=NULL,queued_at=?,updated_at=?,
      completed_at=NULL,error_code=NULL,error_message=NULL,exit_code=NULL,cancel_requested_at=NULL,reserved_output_bytes=?
      WHERE id=? AND user_id=? AND status IN ('failed','timeout','canceled') AND lease_owner IS NULL
      AND EXISTS(SELECT 1 FROM job_output_stages p WHERE p.job_id=jobs.id AND p.pdf_status='succeeded'
        AND p.source_sha256=jobs.source_sha256 AND p.entrypoint=jobs.entrypoint
        AND p.source_id IS jobs.source_id AND p.project_revision_id IS jobs.project_revision_id
        AND EXISTS(SELECT 1 FROM artifacts a WHERE a.job_id=jobs.id AND a.relative_path='result.pdf'
          AND a.type='pdf' AND a.storage_generation=p.pdf_generation AND a.sha256=p.pdf_sha256)
        AND p.pdf_completed_at>? AND p.svg_status IN ('failed','timeout','canceled') AND p.svg_attempt<8)
      AND EXISTS(SELECT 1 FROM sources s WHERE s.id=jobs.source_id AND s.owner_user_id=jobs.user_id
        AND s.status='ready' AND s.sha256=jobs.source_sha256 AND s.size=jobs.source_size
        AND (s.expires_at>? OR EXISTS(SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
          WHERE r.source_id=s.id AND p.deleted_at IS NULL)))`,
      )
      .run(now, now, reservedBytes, jobId, userId, cutoff, now).changes;
    if (changed !== 1) return false;
    this.db
      .prepare(
        `UPDATE job_output_stages SET svg_status='queued',svg_completed_at=NULL,svg_generation=NULL,
      svg_error_code=NULL,svg_error_message=NULL,svg_attempt=svg_attempt+1 WHERE job_id=?`,
      )
      .run(jobId);
    return true;
  }
}
