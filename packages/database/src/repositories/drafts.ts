import type { DatabaseSync } from "node:sqlite";
import type { JobStatus, RenderEngine } from "@latex-renderer/contracts";
import {
  ARTIFACT_AVAILABLE_SQL,
  artifactAvailabilityCutoff,
} from "../artifact-availability.js";

export interface DraftRow {
  project_id: string;
  base_revision_id?: string | null;
  version: number;
  entrypoint: string;
  engine: RenderEngine;
  outputs_json: string;
  created_at: string;
  updated_at: string;
}

export interface DraftFileRow {
  path: string;
  source_id: string;
  source_path: string;
}

export interface DraftRenderFile extends DraftFileRow {
  owner_user_id: string;
  storage_key: string;
  sha256: string;
  size: number;
  status: string;
}

export type DraftWorkCacheIdentity = {
  projectId: string;
  userId: string;
  key: string;
  version: number;
};

export type DraftWorkCacheLimits = {
  bytes: number;
  userBytes: number;
  projectBytes: number;
  entries: number;
  userEntries: number;
  projectEntries: number;
};

export class DraftsRepository {
  constructor(private readonly db: DatabaseSync) {}

  reserveWorkCache(
    input: DraftWorkCacheIdentity & {
      jobId: string;
      generation: number;
      bytes: number;
    },
    limits: DraftWorkCacheLimits,
  ): boolean {
    return (
      this.db
        .prepare(
          `
      INSERT INTO draft_work_cache(job_id,generation,project_id,user_id,cache_key,bytes)
      SELECT j.id,j.lease_generation,d.project_id,j.user_id,?,?
      FROM jobs j JOIN job_draft_inputs d ON d.job_id=j.id
      WHERE j.id=? AND j.lease_generation=? AND j.lease_owner IS NOT NULL
        AND j.status='running' AND j.cancel_requested_at IS NULL
        AND d.project_id=? AND j.user_id=? AND d.draft_version=?
        AND (SELECT COUNT(*) FROM draft_work_cache)<?
        AND (SELECT COUNT(*) FROM draft_work_cache WHERE user_id=j.user_id)<?
        AND (SELECT COUNT(*) FROM draft_work_cache WHERE user_id=j.user_id AND project_id=d.project_id)<?
        AND (SELECT COALESCE(SUM(bytes),0) FROM draft_work_cache)<=?
        AND (SELECT COALESCE(SUM(bytes),0) FROM draft_work_cache WHERE user_id=j.user_id)<=?
        AND (SELECT COALESCE(SUM(bytes),0) FROM draft_work_cache WHERE user_id=j.user_id AND project_id=d.project_id)<=?
      ON CONFLICT(job_id,generation) DO NOTHING
    `,
        )
        .run(
          input.key,
          input.bytes,
          input.jobId,
          input.generation,
          input.projectId,
          input.userId,
          input.version,
          limits.entries,
          limits.userEntries,
          limits.projectEntries,
          limits.bytes - input.bytes,
          limits.userBytes - input.bytes,
          limits.projectBytes - input.bytes,
        ).changes === 1
    );
  }

  availableWorkCache(input: DraftWorkCacheIdentity, retentionHours: number) {
    return this.db
      .prepare(
        `
      SELECT j.id AS jobId,a.id AS artifactId,w.generation,w.bytes
      FROM draft_work_cache w JOIN jobs j ON j.id=w.job_id
      JOIN job_draft_inputs d ON d.job_id=j.id
      JOIN artifacts a ON a.job_id=j.id AND a.storage_generation=w.generation
      WHERE w.user_id=? AND w.project_id=? AND w.cache_key=? AND d.draft_version<?
        AND j.status='succeeded' AND j.lease_owner IS NULL AND a.type='pdf'
        AND a.relative_path='result.pdf' AND ${ARTIFACT_AVAILABLE_SQL}
      ORDER BY d.draft_version DESC,j.completed_at DESC,j.rowid DESC LIMIT 1
    `,
      )
      .get(
        input.userId,
        input.projectId,
        input.key,
        input.version,
        artifactAvailabilityCutoff({ retentionHours }),
      ) as
      | { jobId: string; artifactId: string; generation: number; bytes: number }
      | undefined;
  }

  releaseWorkCache(jobId: string, generation: number): void {
    this.db
      .prepare("DELETE FROM draft_work_cache WHERE job_id=? AND generation=?")
      .run(jobId, generation);
  }

  getOwned(projectId: string, userId: string): DraftRow | undefined {
    return this.db
      .prepare(
        `SELECT d.* FROM project_drafts d JOIN projects p ON p.id=d.project_id
       WHERE d.project_id=? AND p.owner_user_id=? AND p.deleted_at IS NULL`,
      )
      .get(projectId, userId) as DraftRow | undefined;
  }

  snapshotOwned(
    projectId: string,
    userId: string,
  ): (DraftRow & { files_json: string }) | undefined {
    return this.db
      .prepare(
        `SELECT d.*, (SELECT json_group_array(json_object('path',path,'source_id',source_id,'source_path',source_path))
         FROM (SELECT path,source_id,source_path FROM project_draft_files WHERE project_id=d.project_id ORDER BY path)) AS files_json
       FROM project_drafts d JOIN projects p ON p.id=d.project_id
       WHERE d.project_id=? AND p.owner_user_id=? AND p.deleted_at IS NULL`,
      )
      .get(projectId, userId) as
      (DraftRow & { files_json: string }) | undefined;
  }

  files(projectId: string): DraftFileRow[] {
    return this.db
      .prepare(
        "SELECT path,source_id,source_path FROM project_draft_files WHERE project_id=? ORDER BY path",
      )
      .all(projectId) as unknown as DraftFileRow[];
  }

  insert(row: DraftRow): void {
    this.db
      .prepare(
        `INSERT INTO project_drafts(project_id,version,entrypoint,engine,outputs_json,created_at,updated_at,base_revision_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.project_id,
        row.version,
        row.entrypoint,
        row.engine,
        row.outputs_json,
        row.created_at,
        row.updated_at,
        row.base_revision_id ?? null,
      );
  }

  update(row: DraftRow, expectedVersion: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE project_drafts SET version=?,entrypoint=?,engine=?,outputs_json=?,updated_at=?,base_revision_id=?
       WHERE project_id=? AND version=?`,
        )
        .run(
          row.version,
          row.entrypoint,
          row.engine,
          row.outputs_json,
          row.updated_at,
          row.base_revision_id ?? null,
          row.project_id,
          expectedVersion,
        ).changes === 1
    );
  }

  setBaseRevision(
    projectId: string,
    version: number,
    revisionId: string,
  ): void {
    this.db
      .prepare(
        "UPDATE project_drafts SET base_revision_id=? WHERE project_id=? AND version=?",
      )
      .run(revisionId, projectId, version);
  }

  putFile(projectId: string, file: DraftFileRow): void {
    this.db
      .prepare(
        `INSERT INTO project_draft_files(project_id,path,source_id,source_path) VALUES (?,?,?,?)
       ON CONFLICT(project_id,path) DO UPDATE SET source_id=excluded.source_id,source_path=excluded.source_path`,
      )
      .run(projectId, file.path, file.source_id, file.source_path);
  }

  removeFile(projectId: string, path: string): void {
    this.db
      .prepare("DELETE FROM project_draft_files WHERE project_id=? AND path=?")
      .run(projectId, path);
  }

  delete(projectId: string): void {
    this.db
      .prepare("DELETE FROM project_drafts WHERE project_id=?")
      .run(projectId);
  }

  isPreviewJob(jobId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM job_draft_inputs WHERE job_id=?")
        .get(jobId) !== undefined
    );
  }

  isOwnedProjectPreview(jobId: string, userId: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM job_draft_inputs d JOIN projects p ON p.id=d.project_id
       WHERE d.job_id=? AND p.owner_user_id=? AND p.deleted_at IS NULL`,
        )
        .get(jobId, userId) !== undefined
    );
  }

  pendingRender(
    projectId: string,
    version: number,
    runtime: string | null,
  ): string | undefined {
    const row = this.db
      .prepare(
        `SELECT j.id FROM job_draft_inputs d JOIN jobs j ON j.id=d.job_id
       WHERE d.project_id=? AND d.draft_version=? AND d.requested_runtime IS ?
        AND j.status IN ('queued','validating','running') AND j.cancel_requested_at IS NULL
       ORDER BY j.created_at,j.id LIMIT 1`,
      )
      .get(projectId, version, runtime) as { id: string } | undefined;
    return row?.id;
  }

  previewActivity(
    projectId: string,
    userId: string,
    runtime: string | null,
    retentionHours: number,
  ) {
    const cutoff = artifactAvailabilityCutoff({ retentionHours });
    const latest = this.db
      .prepare(
        `SELECT j.id AS jobId,d.draft_version AS version,j.status
      FROM job_draft_inputs d JOIN jobs j ON j.id=d.job_id
      WHERE d.project_id=? AND j.user_id=? AND d.requested_runtime IS ?
        AND j.deleted_at IS NULL AND j.error_code IS NOT 'DRAFT_SUPERSEDED'
        AND (j.status IN ('queued','validating','running')
          OR (j.status IN ('failed','timeout','canceled','rejected')
            AND COALESCE(j.completed_at,j.updated_at)>?)
          OR (j.status='succeeded' AND EXISTS (
            SELECT 1 FROM artifacts a WHERE a.job_id=j.id AND a.relative_path='result.pdf'
              AND a.type='pdf' AND ${ARTIFACT_AVAILABLE_SQL})))
      ORDER BY d.draft_version DESC,j.created_at DESC,j.rowid DESC LIMIT 1`,
      )
      .get(projectId, userId, runtime, cutoff, cutoff) as
      { jobId: string; version: number; status: JobStatus } | undefined;
    const successful = this.db
      .prepare(
        `SELECT j.id AS jobId,d.draft_version AS version,
          p.page_count AS pageCount
      FROM job_draft_inputs d JOIN jobs j ON j.id=d.job_id
      JOIN artifacts a ON a.job_id=j.id AND a.relative_path='result.pdf' AND a.type='pdf'
      LEFT JOIN job_preview_documents p ON p.job_id=j.id AND p.pdf_artifact_id=a.id AND p.pdf_sha256=a.sha256
      WHERE d.project_id=? AND j.user_id=? AND j.status='succeeded'
        AND j.deleted_at IS NULL AND ${ARTIFACT_AVAILABLE_SQL}
      ORDER BY d.draft_version DESC,j.completed_at DESC,j.rowid DESC LIMIT 1`,
      )
      .get(projectId, userId, cutoff) as
      { jobId: string; version: number; pageCount: number | null } | undefined;
    return { latest: latest ?? null, successful: successful ?? null };
  }

  completedRender(input: {
    projectId: string;
    userId: string;
    entrypoint: string;
    engine: RenderEngine;
    manifestSha256: string;
    runtimeDigest: string;
  }): string[] {
    const rows = this.db
      .prepare(
        `SELECT j.id FROM job_draft_inputs d JOIN jobs j ON j.id=d.job_id
        WHERE d.project_id=? AND j.user_id=? AND j.entrypoint=? AND j.engine=?
          AND j.source_sha256=? AND j.runtime_digest=? AND j.outputs_json='["pdf"]'
          AND j.status='succeeded'
        ORDER BY j.completed_at DESC, j.id LIMIT 3`,
      )
      .all(
        input.projectId,
        input.userId,
        input.entrypoint,
        input.engine,
        input.manifestSha256,
        input.runtimeDigest,
      ) as { id: string }[];
    return rows.map(({ id }) => id);
  }

  supersedeQueued(projectId: string, timestamp: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status='canceled',render_status='canceled',updated_at=?,completed_at=?,
        error_code='DRAFT_SUPERSEDED',error_message='A newer draft was queued'
       WHERE status='queued' AND id IN (SELECT job_id FROM job_draft_inputs WHERE project_id=?)`,
      )
      .run(timestamp, timestamp, projectId);
  }

  requestOutdatedPreviewStop(
    jobId: string,
    workerId: string,
    generation: number,
    timestamp: string,
  ): void {
    this.db
      .prepare(
        `
      UPDATE jobs AS active SET cancel_requested_at=?,updated_at=?,
        error_code='DRAFT_SUPERSEDED',error_message='A newer draft was queued'
      WHERE active.id=? AND active.lease_owner=? AND active.lease_generation=?
        AND active.status='running' AND active.cancel_requested_at IS NULL
        AND EXISTS (
          SELECT 1 FROM job_draft_inputs d JOIN job_draft_inputs n ON n.project_id=d.project_id
          JOIN jobs next ON next.id=n.job_id
          WHERE d.job_id=active.id AND n.draft_version>d.draft_version
            AND next.user_id=active.user_id AND next.status='queued' AND next.cancel_requested_at IS NULL
        )
    `,
      )
      .run(timestamp, timestamp, jobId, workerId, generation);
  }

  attachRender(
    jobId: string,
    projectId: string,
    version: number,
    runtime: string | null,
  ): void {
    this.db
      .prepare(
        "INSERT INTO job_draft_inputs(job_id,project_id,draft_version,requested_runtime) VALUES (?,?,?,?)",
      )
      .run(jobId, projectId, version, runtime);
    this.db
      .prepare(
        `INSERT INTO job_draft_input_files(job_id,path,source_id,source_path)
       SELECT ?,path,source_id,source_path FROM project_draft_files WHERE project_id=?`,
      )
      .run(jobId, projectId);
  }

  renderInput(jobId: string):
    | {
        version: number;
        projectId: string;
        runtime: string | null;
        files: DraftRenderFile[];
      }
    | undefined {
    const row = this.db
      .prepare(
        "SELECT draft_version AS version,project_id AS projectId,requested_runtime AS runtime FROM job_draft_inputs WHERE job_id=?",
      )
      .get(jobId) as
      | { version: number; projectId: string; runtime: string | null }
      | undefined;
    if (row === undefined) return undefined;
    const files = this.db
      .prepare(
        `SELECT f.path,f.source_id,f.source_path,s.owner_user_id,s.storage_key,s.sha256,s.size,s.status
       FROM job_draft_input_files f JOIN sources s ON s.id=f.source_id
       WHERE f.job_id=? ORDER BY f.path`,
      )
      .all(jobId) as unknown as DraftRenderFile[];
    return { ...row, files };
  }
}
