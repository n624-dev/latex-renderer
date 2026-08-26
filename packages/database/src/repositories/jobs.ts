import type { DatabaseSync } from "node:sqlite";
import type { JobStatus, RenderOutput } from "@latex-renderer/contracts";

export interface JobRow {
  id: string;
  user_id: string;
  service_account_id: string;
  api_key_id: string;
  status: JobStatus;
  renderer_version: string;
  source_size: number;
  source_sha256: string;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  error_code: string | null;
  error_message: string | null;
  output_size: number | null;
  cancel_requested_at: string | null;
  retry_of_job_id: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  deleted_at: string | null;
  source_id: string | null;
  entrypoint: string;
  project_revision_id: string | null;
  outputs_json: string;
}

const ACTIVE = "'reserved','uploading','queued','validating','running'";
const TERMINAL =
  "'succeeded','failed','timeout','canceled','rejected','expired'";

export class JobsRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(
    limit = 500,
  ): Array<
    Pick<
      JobRow,
      | "id"
      | "user_id"
      | "service_account_id"
      | "status"
      | "source_size"
      | "created_at"
      | "updated_at"
      | "error_code"
      | "source_id"
      | "entrypoint"
      | "project_revision_id"
    >
  > {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,status,source_size,created_at,updated_at,error_code,source_id,entrypoint,project_revision_id
      FROM jobs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as ReturnType<JobsRepository["list"]>;
  }

  retries(id: string): Array<Pick<JobRow, "id" | "status" | "created_at">> {
    return this.db
      .prepare(
        "SELECT id,status,created_at FROM jobs WHERE retry_of_job_id=? ORDER BY created_at DESC",
      )
      .all(id) as unknown as Array<
      Pick<JobRow, "id" | "status" | "created_at">
    >;
  }

  get(id: string): JobRow | undefined {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,deleted_at,source_id,entrypoint,project_revision_id,outputs_json FROM jobs WHERE id=?`,
      )
      .get(id) as unknown as JobRow | undefined;
  }

  getOwned(
    id: string,
    userId: string,
    serviceAccountId: string,
  ): JobRow | undefined {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,deleted_at,source_id,entrypoint,project_revision_id,outputs_json FROM jobs
      WHERE id=? AND user_id=? AND service_account_id=? AND deleted_at IS NULL`,
      )
      .get(id, userId, serviceAccountId) as unknown as JobRow | undefined;
  }

  getUploadState(
    id: string,
  ): Pick<JobRow, "status" | "source_sha256"> | undefined {
    return this.db
      .prepare("SELECT status,source_sha256 FROM jobs WHERE id=?")
      .get(id) as unknown as
      Pick<JobRow, "status" | "source_sha256"> | undefined;
  }

  countActive(): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs WHERE status IN (${ACTIVE})`,
        )
        .get() as { count: number }
    ).count;
  }

  countActiveForServiceAccount(id: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs WHERE service_account_id=? AND status IN (${ACTIVE})`,
        )
        .get(id) as { count: number }
    ).count;
  }

  storageUsageForUser(id: string): number {
    const sourceBytes = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(size),0) AS bytes FROM sources WHERE owner_user_id=? AND status NOT IN ('deleted','expired')`,
        )
        .get(id) as { bytes: number }
    ).bytes;
    const jobBytes = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(output_size,0)+CASE WHEN source_id IS NULL THEN source_size ELSE 0 END),0) AS bytes
      FROM jobs WHERE user_id=? AND status!='deleted'`,
        )
        .get(id) as { bytes: number }
    ).bytes;
    return sourceBytes + jobBytes;
  }

  statusCounts(): Array<{ status: JobStatus; count: number }> {
    return this.db
      .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
      .all() as unknown as Array<{ status: JobStatus; count: number }>;
  }

  cancel(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET cancel_requested_at=?,updated_at=?,status=CASE
      WHEN status IN ('reserved','uploading','queued','validating') THEN 'canceled' ELSE status END
      WHERE id=? AND status IN (${ACTIVE})`,
        )
        .run(timestamp, timestamp, id).changes,
    );
  }

  restoreReservedAfterUploadFailure(id: string, timestamp: string): void {
    this.db
      .prepare(
        "UPDATE jobs SET status='reserved',updated_at=? WHERE id=? AND status='uploading'",
      )
      .run(timestamp, id);
  }

  markDeleting(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status='deleting',updated_at=? WHERE id=? AND status IN (${TERMINAL})`,
        )
        .run(timestamp, id).changes,
    );
  }

  insertReserved(input: {
    id: string;
    userId: string;
    serviceAccountId: string;
    apiKeyId: string;
    rendererVersion: string;
    sourceSize: number;
    sourceSha256: string;
    timestamp: string;
    sourceId?: string;
    entrypoint?: string;
    projectRevisionId?: string;
    outputs?: readonly RenderOutput[];
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,source_id,entrypoint,project_revision_id,outputs_json)
      VALUES (?,?,?,?, 'reserved',?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.userId,
        input.serviceAccountId,
        input.apiKeyId,
        input.rendererVersion,
        input.sourceSize,
        input.sourceSha256,
        input.timestamp,
        input.timestamp,
        input.sourceId ?? null,
        input.entrypoint ?? "main.tex",
        input.projectRevisionId ?? null,
        JSON.stringify(input.outputs ?? ["pdf"]),
      );
  }

  insertQueued(input: {
    id: string;
    userId: string;
    serviceAccountId: string;
    apiKeyId: string;
    rendererVersion: string;
    sourceId: string;
    sourceSize: number;
    sourceSha256: string;
    entrypoint: string;
    timestamp: string;
    retryOfJobId?: string;
    projectRevisionId?: string;
    outputs?: readonly RenderOutput[];
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,retry_of_job_id,source_id,entrypoint,project_revision_id,outputs_json) VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.userId,
        input.serviceAccountId,
        input.apiKeyId,
        input.rendererVersion,
        input.sourceSize,
        input.sourceSha256,
        input.timestamp,
        input.timestamp,
        input.timestamp,
        input.retryOfJobId ?? null,
        input.sourceId,
        input.entrypoint,
        input.projectRevisionId ?? null,
        JSON.stringify(input.outputs ?? ["pdf"]),
      );
  }

  insertRetry(input: {
    id: string;
    source: JobRow;
    rendererVersion: string;
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,retry_of_job_id,source_id,entrypoint,project_revision_id,outputs_json) VALUES (?,?,?,?, 'queued',?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.source.user_id,
        input.source.service_account_id,
        input.source.api_key_id,
        input.rendererVersion,
        input.source.source_size,
        input.source.source_sha256,
        input.timestamp,
        input.timestamp,
        input.timestamp,
        input.source.id,
        input.source.source_id,
        input.source.entrypoint,
        input.source.project_revision_id,
        input.source.outputs_json,
      );
  }

  findRetrySource(id: string): JobRow | undefined {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,deleted_at,source_id,entrypoint,project_revision_id,outputs_json FROM jobs
      WHERE id=? AND status IN ('succeeded','failed','timeout','canceled','rejected')`,
      )
      .get(id) as unknown as JobRow | undefined;
  }

  listOwned(userId: string, limit = 200): JobRow[] {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
        created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
        cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,deleted_at,source_id,entrypoint,project_revision_id,outputs_json
        FROM jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as JobRow[];
  }

  attachProjectRevision(jobId: string, revisionId: string): void {
    this.db
      .prepare("UPDATE jobs SET project_revision_id=? WHERE id=?")
      .run(revisionId, jobId);
  }

  forRevision(revisionId: string): JobRow[] {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
        created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
        cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,deleted_at,source_id,entrypoint,project_revision_id,outputs_json
        FROM jobs WHERE project_revision_id=? AND deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(revisionId) as unknown as JobRow[];
  }

  outputs(row: Pick<JobRow, "outputs_json">): RenderOutput[] {
    const value: unknown = JSON.parse(row.outputs_json);
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 2 ||
      value.some((item) => item !== "pdf" && item !== "svg") ||
      !value.includes("pdf") ||
      new Set(value).size !== value.length
    )
      throw new Error("Stored render outputs are invalid");
    return value as RenderOutput[];
  }
}
