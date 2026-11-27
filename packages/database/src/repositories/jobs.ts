import type { DatabaseSync } from "node:sqlite";
import { userJobSql } from "../user-visible.js";
import { readySourceSql } from "../source-lifecycle.js";
import { jobCredentialId } from "../job-credentials.js";
import {
  defaultRenderEngine,
  type JobStatus,
  type RenderEngine,
  type RenderOutput,
} from "@latex-renderer/contracts";
import {
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

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
  lease_generation: number;
  deleted_at: string | null;
  source_id: string | null;
  entrypoint: string;
  engine: RenderEngine;
  runtime_digest: string | null;
  project_revision_id: string | null;
  outputs_json: string;
  reserved_output_bytes: number;
  render_status: JobStatus | null;
  deletion_status:
    "retained" | "pending" | "deleting" | "retry" | "failed" | "deleted";
  deletion_attempts: number;
  deletion_error: string | null;
  deletion_next_attempt_at: string | null;
}

export interface OwnedJobListRow extends Pick<
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
  | "engine"
  | "project_revision_id"
> {
  project_id: string | null;
  project_name: string | null;
  revision_display_name: string | null;
}

export type RevisionJobSummary = Pick<
  JobRow,
  | "id"
  | "status"
  | "created_at"
  | "updated_at"
  | "retry_of_job_id"
  | "error_code"
  | "outputs_json"
  | "engine"
  | "runtime_digest"
  | "service_account_id"
  | "user_id"
> & { credential_owner_id: string };

export type SourceJobSummary = Pick<
  JobRow,
  | "id"
  | "status"
  | "entrypoint"
  | "created_at"
  | "updated_at"
  | "retry_of_job_id"
  | "error_code"
>;

export type AdminJobListRow = Pick<
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
>;

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
      FROM jobs WHERE ${userJobSql()} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as ReturnType<JobsRepository["list"]>;
  }

  /** Admin job search: filtering happens before keyset pagination in SQLite. */
  listAdminPage(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      status?: string | undefined;
      sourceId?: string | undefined;
      query?: string | undefined;
    } = {},
  ): Page<AdminJobListRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      conditions: string[] = [userJobSql()],
      params: Array<string | number> = [],
      query = options.query?.trim().toLowerCase();
    if (options.status !== undefined && options.status !== "") {
      conditions.push("status=?");
      params.push(options.status);
    }
    if (options.sourceId !== undefined && options.sourceId !== "") {
      conditions.push("source_id=?");
      params.push(options.sourceId);
    }
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(id),?)>0 OR instr(lower(COALESCE(source_id,'')),?)>0 OR instr(lower(user_id),?)>0 OR instr(lower(entrypoint),?)>0)",
      );
      params.push(query, query, query, query);
    }
    if (cursor !== undefined) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const rows = this.db
      .prepare(
        `SELECT id,user_id,service_account_id,status,source_size,created_at,updated_at,error_code,source_id,entrypoint,project_revision_id
         FROM jobs${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params) as unknown as AdminJobListRow[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
  }

  countAdmin(
    filters: {
      status?: string | undefined;
      sourceId?: string | undefined;
      query?: string | undefined;
    } = {},
  ): number {
    const conditions: string[] = [userJobSql()],
      params: string[] = [],
      query = filters.query?.trim().toLowerCase();
    if (filters.status !== undefined && filters.status !== "") {
      conditions.push("status=?");
      params.push(filters.status);
    }
    if (filters.sourceId !== undefined && filters.sourceId !== "") {
      conditions.push("source_id=?");
      params.push(filters.sourceId);
    }
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(id),?)>0 OR instr(lower(COALESCE(source_id,'')),?)>0 OR instr(lower(user_id),?)>0 OR instr(lower(entrypoint),?)>0)",
      );
      params.push(query, query, query, query);
    }
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`,
        )
        .get(...params) as { count: number }
    ).count;
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
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,lease_generation,deleted_at,source_id,entrypoint,project_revision_id,outputs_json,engine,runtime_digest,reserved_output_bytes,
      render_status,deletion_status,deletion_attempts,deletion_error,deletion_next_attempt_at FROM jobs WHERE id=?`,
      )
      .get(id) as unknown as JobRow | undefined;
  }

  getVisible(id: string): JobRow | undefined {
    return this.db
      .prepare(`SELECT * FROM jobs WHERE id=? AND ${userJobSql()}`)
      .get(id) as unknown as JobRow | undefined;
  }

  renderProvenance(
    row: Pick<
      JobRow,
      | "id"
      | "engine"
      | "runtime_digest"
      | "retry_of_job_id"
      | "project_revision_id"
      | "user_id"
    >,
  ) {
    let previous: { runtime_digest: string | null } | undefined;
    if (row.runtime_digest !== null && row.retry_of_job_id !== null) {
      previous = this.db
        .prepare("SELECT runtime_digest FROM jobs WHERE id=? AND user_id=?")
        .get(row.retry_of_job_id, row.user_id) as typeof previous;
    } else if (
      row.runtime_digest !== null &&
      row.project_revision_id !== null
    ) {
      previous = this.db
        .prepare(
          `SELECT previous.runtime_digest
          FROM jobs previous JOIN jobs current ON current.id=?
          WHERE previous.project_revision_id=? AND previous.user_id=?
            AND previous.runtime_digest IS NOT NULL
            AND (previous.created_at < current.created_at OR
              (previous.created_at = current.created_at AND previous.rowid < current.rowid))
          ORDER BY previous.created_at DESC,previous.rowid DESC LIMIT 1`,
        )
        .get(row.id, row.project_revision_id, row.user_id) as typeof previous;
    }
    return {
      engine: row.engine,
      runtimeDigest: row.runtime_digest,
      ...(previous?.runtime_digest &&
      previous.runtime_digest !== row.runtime_digest
        ? { previousRuntimeDigest: previous.runtime_digest }
        : {}),
    };
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
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,lease_generation,deleted_at,source_id,entrypoint,project_revision_id,outputs_json,engine,runtime_digest,reserved_output_bytes,
      render_status,deletion_status,deletion_attempts,deletion_error,deletion_next_attempt_at FROM jobs
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

  countActiveForUser(id: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs WHERE user_id=? AND status IN (${ACTIVE})`,
        )
        .get(id) as { count: number }
    ).count;
  }

  storageUsageForUser(id: string): number {
    return this.storageBreakdownForUser(id).totalBytes;
  }

  storageBreakdownForUser(id: string, visibleOnly = false) {
    const sourceBytes = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(size),0) AS bytes FROM sources WHERE owner_user_id=? AND status!='deleted' ${visibleOnly ? "AND purpose='user'" : ""}`,
        )
        .get(id) as { bytes: number }
    ).bytes;
    const jobBytes = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(
        CASE WHEN status IN (${ACTIVE})
          THEN MAX(COALESCE(output_size,0),reserved_output_bytes)
          ELSE COALESCE(output_size,0) END
        + CASE WHEN source_id IS NULL THEN source_size ELSE 0 END),0) AS bytes
      FROM jobs WHERE user_id=? AND status!='deleted' ${visibleOnly ? `AND ${userJobSql()}` : ""}`,
        )
        .get(id) as { bytes: number }
    ).bytes;
    const previews = this.db
      .prepare(
        `SELECT COALESCE(SUM(p.reserved_bytes),0) AS bytes
      FROM job_preview_requests p JOIN jobs j ON j.id=p.job_id WHERE j.user_id=? AND p.status='running' ${visibleOnly ? `AND ${userJobSql("j")}` : ""}`,
      )
      .get(id) as { bytes: number };
    const trees = visibleOnly
      ? { bytes: 0 }
      : (this.db
          .prepare(
            "SELECT COALESCE(SUM(reserved_bytes),0) AS bytes FROM source_trees WHERE owner_user_id=?",
          )
          .get(id) as { bytes: number });
    const draftWork = this.db
      .prepare(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM draft_work_cache WHERE user_id=?",
      )
      .get(id) as { bytes: number };
    return {
      sourceBytes,
      jobAndReservationBytes: jobBytes,
      previewReservationBytes: previews.bytes,
      sourceTreeBytes: trees.bytes,
      draftCacheBytes: draftWork.bytes,
      totalBytes:
        sourceBytes + jobBytes + previews.bytes + trees.bytes + draftWork.bytes,
    };
  }

  statusCounts(): Array<{ status: JobStatus; count: number }> {
    return this.db
      .prepare(
        `SELECT status,COUNT(*) AS count FROM jobs WHERE ${userJobSql()} GROUP BY status`,
      )
      .all() as unknown as Array<{ status: JobStatus; count: number }>;
  }

  cancel(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET cancel_requested_at=?,updated_at=?,
      render_status=CASE WHEN status IN ('reserved','uploading','queued','validating') THEN 'canceled' ELSE render_status END,
      status=CASE WHEN status IN ('reserved','uploading','queued','validating') THEN 'canceled' ELSE status END
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
          `UPDATE jobs SET render_status=status,status='deleting',deletion_status='pending',
           deletion_attempts=0,deletion_error=NULL,deletion_next_attempt_at=NULL,updated_at=?
           WHERE id=? AND status IN (${TERMINAL})`,
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
    engine?: RenderEngine;
    reservedOutputBytes: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,source_id,entrypoint,project_revision_id,outputs_json,engine,reserved_output_bytes)
      VALUES (?,?,?,?, 'reserved',?,?,?,?,?,?,?,?,?,?,?)`,
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
        input.engine ?? defaultRenderEngine,
        input.reservedOutputBytes,
      );
  }

  insertQueued(input: {
    id: string;
    userId: string;
    serviceAccountId: string;
    apiKeyId: string;
    rendererVersion: string;
    sourceId: string;
    entrypoint: string;
    timestamp: string;
    retryOfJobId?: string;
    projectRevisionId?: string;
    outputs?: readonly RenderOutput[];
    engine?: RenderEngine;
    reservedOutputBytes: number;
  }): number {
    return Number(
      this.db
        .prepare(
          `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,retry_of_job_id,source_id,entrypoint,project_revision_id,outputs_json,engine,reserved_output_bytes)
      SELECT ?,?,?,?,'queued',?,s.size,s.sha256,?,?,?,?,s.id,?,?,?,?,?
      FROM sources s WHERE s.id=? AND s.owner_user_id=? AND ${readySourceSql("s")}`,
        )
        .run(
          input.id,
          input.userId,
          input.serviceAccountId,
          input.apiKeyId,
          input.rendererVersion,
          input.timestamp,
          input.timestamp,
          input.timestamp,
          input.retryOfJobId ?? null,
          input.entrypoint,
          input.projectRevisionId ?? null,
          JSON.stringify(input.outputs ?? ["pdf"]),
          input.engine ?? defaultRenderEngine,
          input.reservedOutputBytes,
          input.sourceId,
          input.userId,
          input.timestamp,
        ).changes,
    );
  }

  insertDraftRender(input: {
    id: string;
    userId: string;
    serviceAccountId: string;
    apiKeyId: string;
    rendererVersion: string;
    manifestSha256: string;
    entrypoint: string;
    engine: RenderEngine;
    timestamp: string;
    reservedOutputBytes: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
       created_at,updated_at,queued_at,entrypoint,engine,reserved_output_bytes)
       VALUES (?,?,?,?,'queued',?,0,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.userId,
        input.serviceAccountId,
        input.apiKeyId,
        input.rendererVersion,
        input.manifestSha256,
        input.timestamp,
        input.timestamp,
        input.timestamp,
        input.entrypoint,
        input.engine,
        input.reservedOutputBytes,
      );
  }

  insertRetry(input: {
    id: string;
    source: JobRow;
    rendererVersion: string;
    timestamp: string;
    reservedOutputBytes: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,retry_of_job_id,source_id,entrypoint,project_revision_id,outputs_json,engine,reserved_output_bytes) VALUES (?,?,?,?, 'queued',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        input.source.engine,
        input.reservedOutputBytes,
      );
    const profile = this.reproducibility(input.source.id);
    if (profile)
      this.setReproducibility(
        input.id,
        profile.mode,
        profile.mode === "latest"
          ? Math.floor(Date.parse(input.timestamp) / 1000)
          : profile.epochSeconds,
      );
  }

  recordStageObservation(input: {
    jobId: string;
    stage: "pdf" | "svg";
    generation: number;
    rendererMs: number | null;
    validationMs?: number;
    publicationMs?: number;
    sourcePrepareMs?: number;
    workCacheUsed?: boolean;
    containerSample?: object | undefined;
  }) {
    this.db
      .prepare(
        `INSERT INTO job_stage_observations VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(job_id,stage) DO UPDATE SET generation=excluded.generation,
       renderer_wall_ms=excluded.renderer_wall_ms,validation_wall_ms=excluded.validation_wall_ms,
       publication_wall_ms=excluded.publication_wall_ms,source_prepare_wall_ms=excluded.source_prepare_wall_ms,
       work_cache_used=excluded.work_cache_used,container_sample_json=excluded.container_sample_json WHERE excluded.generation>job_stage_observations.generation`,
      )
      .run(
        input.jobId,
        input.stage,
        input.generation,
        input.rendererMs,
        input.validationMs ?? null,
        input.publicationMs ?? null,
        input.sourcePrepareMs ?? null,
        input.workCacheUsed === undefined ? null : Number(input.workCacheUsed),
      input.containerSample === undefined ? null : JSON.stringify(input.containerSample),
      );
  }

  stageObservations(jobId: string) {
    return this.db
      .prepare(
        `SELECT stage,generation,renderer_wall_ms AS rendererMs,validation_wall_ms AS validationMs,
       publication_wall_ms AS publicationMs,source_prepare_wall_ms AS sourcePrepareMs,
       work_cache_used AS cache,container_sample_json AS sample FROM job_stage_observations WHERE job_id=? ORDER BY stage`,
      )
      .all(jobId)
      .map((record) => {
        const { cache, sample, ...row } = record as {
          stage: "pdf" | "svg";
          generation: number;
          rendererMs: number | null;
          validationMs: number | null;
          publicationMs: number | null;
          sourcePrepareMs: number | null;
          cache: number | null;
        sample: string | null;
        };
        return { ...row, workCacheUsed: cache === null ? null : cache === 1,
        containerSample: sample === null ? null : JSON.parse(sample) as unknown,
      };
      });
  }

  setReproducibility(
    jobId: string,
    mode: "fixed" | "latest",
    epochSeconds: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO job_reproducibility(job_id,mode,epoch_seconds) VALUES (?,?,?)",
      )
      .run(jobId, mode, epochSeconds);
  }

  reproducibility(jobId: string) {
    return this.db
      .prepare(
        "SELECT mode,epoch_seconds AS epochSeconds FROM job_reproducibility WHERE job_id=?",
      )
      .get(jobId) as
      { mode: "fixed" | "latest"; epochSeconds: number } | undefined;
  }

  findRetrySource(id: string): JobRow | undefined {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
      created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
      cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,lease_generation,deleted_at,source_id,entrypoint,project_revision_id,outputs_json,engine,runtime_digest,reserved_output_bytes,
      render_status,deletion_status,deletion_attempts,deletion_error,deletion_next_attempt_at FROM jobs
      WHERE id=? AND ${userJobSql()} AND status IN ('succeeded','failed','timeout','canceled','rejected')`,
      )
      .get(id) as unknown as JobRow | undefined;
  }

  listOwned(userId: string, limit = 200): JobRow[] {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
        created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
        cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,lease_generation,deleted_at,source_id,entrypoint,project_revision_id,outputs_json,engine,runtime_digest,reserved_output_bytes,
        render_status,deletion_status,deletion_attempts,deletion_error,deletion_next_attempt_at
        FROM jobs WHERE user_id=? AND ${userJobSql()} AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM job_draft_inputs d WHERE d.job_id=jobs.id)
        ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as JobRow[];
  }

  /** User-facing job history with the Project/Revision resolved in one query. */
  listOwnedPage(
    userId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<OwnedJobListRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      condition = cursor
        ? " AND (j.created_at < ? OR (j.created_at = ? AND j.id < ?))"
        : "",
      params: Array<string | number> = cursor
        ? [userId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [userId, limit + 1],
      rows = this.db
        .prepare(
          `SELECT j.id,j.user_id,j.service_account_id,j.status,j.source_size,j.created_at,j.updated_at,
             j.error_code,j.source_id,j.entrypoint,j.engine,j.project_revision_id,
             p.id AS project_id,p.display_name AS project_name,
             r.display_name AS revision_display_name
           FROM jobs j
           LEFT JOIN project_revisions r ON r.id=j.project_revision_id
           LEFT JOIN projects p ON p.id=r.project_id AND p.deleted_at IS NULL
           WHERE j.user_id=? AND ${userJobSql("j")} AND j.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM job_draft_inputs d WHERE d.job_id=j.id)${condition}
           ORDER BY j.created_at DESC,j.id DESC LIMIT ?`,
        )
        .all(...params) as unknown as OwnedJobListRow[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
  }

  /** First page of each revision's history, fetched with one window query. */
  listSummariesForRevisions(
    revisionIds: readonly string[],
    limit = 50,
  ): Map<string, RevisionJobSummary[]> {
    const result = new Map<string, RevisionJobSummary[]>();
    if (revisionIds.length === 0) return result;
    const placeholders = revisionIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT j.id,j.project_revision_id,j.status,j.created_at,j.updated_at,j.retry_of_job_id,j.error_code,j.outputs_json,j.engine,j.runtime_digest,
             j.service_account_id,j.user_id,
             (SELECT ${jobCredentialId("k")} FROM api_keys k WHERE k.id=j.api_key_id) AS credential_owner_id,
             ROW_NUMBER() OVER (
               PARTITION BY j.project_revision_id
               ORDER BY j.created_at DESC,j.id DESC
             ) AS row_number
           FROM jobs j
           WHERE j.project_revision_id IN (${placeholders}) AND ${userJobSql("j")} AND j.deleted_at IS NULL
         )
         SELECT id,project_revision_id,status,created_at,updated_at,retry_of_job_id,error_code,outputs_json,engine,runtime_digest,
           service_account_id,user_id,credential_owner_id
         FROM ranked WHERE row_number<=?
         ORDER BY project_revision_id,created_at DESC,id DESC`,
      )
      .all(...revisionIds, limit) as unknown as Array<
      RevisionJobSummary & { project_revision_id: string }
    >;
    for (const row of rows) {
      const list = result.get(row.project_revision_id) ?? [];
      list.push({
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        retry_of_job_id: row.retry_of_job_id,
        error_code: row.error_code,
        outputs_json: row.outputs_json,
        engine: row.engine,
        runtime_digest: row.runtime_digest,
        service_account_id: row.service_account_id,
        user_id: row.user_id,
        credential_owner_id: row.credential_owner_id,
      });
      result.set(row.project_revision_id, list);
    }
    return result;
  }

  countForRevisions(revisionIds: readonly string[]): Map<string, number> {
    const result = new Map<string, number>();
    if (revisionIds.length === 0) return result;
    const placeholders = revisionIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT project_revision_id,COUNT(*) AS count FROM jobs
         WHERE project_revision_id IN (${placeholders}) AND ${userJobSql()} AND deleted_at IS NULL
         GROUP BY project_revision_id`,
      )
      .all(...revisionIds) as unknown as Array<{
      project_revision_id: string;
      count: number;
    }>;
    for (const row of rows) result.set(row.project_revision_id, row.count);
    return result;
  }

  listForRevisionPage(
    revisionId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<RevisionJobSummary> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      condition = cursor
        ? " AND (created_at < ? OR (created_at = ? AND id < ?))"
        : "",
      params: Array<string | number> = cursor
        ? [revisionId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [revisionId, limit + 1],
      rows = this.db
        .prepare(
          `SELECT id,status,created_at,updated_at,retry_of_job_id,error_code,outputs_json,engine,runtime_digest,service_account_id,user_id,
             (SELECT ${jobCredentialId("k")} FROM api_keys k WHERE k.id=jobs.api_key_id) AS credential_owner_id
           FROM jobs WHERE project_revision_id=? AND ${userJobSql()} AND deleted_at IS NULL${condition}
           ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(...params) as unknown as RevisionJobSummary[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
  }

  attachProjectRevision(jobId: string, revisionId: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET project_revision_id=? WHERE id=?
           AND (project_revision_id IS NULL OR project_revision_id=?)`,
        )
        .run(revisionId, jobId, revisionId).changes,
    );
  }

  forRevision(revisionId: string): JobRow[] {
    return this.db
      .prepare(
        `SELECT id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,
        created_at,updated_at,queued_at,started_at,completed_at,exit_code,error_code,error_message,output_size,
        cancel_requested_at,retry_of_job_id,lease_owner,lease_expires_at,heartbeat_at,lease_generation,deleted_at,source_id,entrypoint,project_revision_id,outputs_json,engine,runtime_digest,reserved_output_bytes,
        render_status,deletion_status,deletion_attempts,deletion_error,deletion_next_attempt_at
        FROM jobs WHERE project_revision_id=? AND ${userJobSql()} AND deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(revisionId) as unknown as JobRow[];
  }

  listBySourcePage(
    sourceId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<SourceJobSummary> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      condition = cursor
        ? " AND (created_at < ? OR (created_at = ? AND id < ?))"
        : "",
      params: Array<string | number> = cursor
        ? [sourceId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [sourceId, limit + 1],
      rows = this.db
        .prepare(
          `SELECT id,status,entrypoint,created_at,updated_at,retry_of_job_id,error_code
           FROM jobs WHERE source_id=? AND ${userJobSql()} AND deleted_at IS NULL${condition}
           ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(...params) as unknown as SourceJobSummary[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
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
