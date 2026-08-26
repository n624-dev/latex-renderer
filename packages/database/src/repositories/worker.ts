import type { DatabaseSync } from "node:sqlite";

export interface WorkerJobRow {
  id: string;
  source_size: number;
  source_sha256: string;
  status: string;
  source_id: string | null;
  source_storage_key: string | null;
  entrypoint: string;
  outputs_json: string;
}
export interface WorkerSubjectState {
  user_status: string;
  sa_status: string;
  revoked_at: string | null;
  expires_at: string | null;
}
export interface WorkerRuntimeState {
  cancel_requested_at: string | null;
  status: string;
}
export interface StaleLeaseRow {
  id: string;
  status: string;
}

export class WorkerRepository {
  constructor(private readonly db: DatabaseSync) {}

  claimNext(
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ): WorkerJobRow | undefined {
    const job = this.db
      .prepare(
        `SELECT j.id,j.source_size,j.source_sha256,j.status,j.source_id,j.entrypoint,j.outputs_json,s.storage_key AS source_storage_key
      FROM jobs j LEFT JOIN sources s ON s.id=j.source_id WHERE j.status='queued' ORDER BY j.queued_at,j.id LIMIT 1`,
      )
      .get() as WorkerJobRow | undefined;
    if (job === undefined) return undefined;
    const changed = this.db
      .prepare(
        `UPDATE jobs SET status='validating',lease_owner=?,lease_expires_at=?,heartbeat_at=?,updated_at=?
      WHERE id=? AND status='queued'`,
      )
      .run(workerId, leaseExpiresAt, now, now, job.id);
    return changed.changes === 1 ? job : undefined;
  }

  subjectState(jobId: string): WorkerSubjectState | undefined {
    return this.db
      .prepare(
        `SELECT u.status AS user_status,s.status AS sa_status,k.revoked_at,k.expires_at FROM jobs j
      JOIN users u ON u.id=j.user_id JOIN service_accounts s ON s.id=j.service_account_id JOIN api_keys k ON k.id=j.api_key_id WHERE j.id=?`,
      )
      .get(jobId) as WorkerSubjectState | undefined;
  }

  runtimeState(jobId: string): WorkerRuntimeState | undefined {
    return this.db
      .prepare("SELECT cancel_requested_at,status FROM jobs WHERE id=?")
      .get(jobId) as WorkerRuntimeState | undefined;
  }
  heartbeat(
    jobId: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ): void {
    this.db
      .prepare(
        "UPDATE jobs SET heartbeat_at=?,lease_expires_at=? WHERE id=? AND lease_owner=?",
      )
      .run(now, leaseExpiresAt, jobId, workerId);
  }
  markCanceled(jobId: string, now: string): void {
    this.db
      .prepare(
        "UPDATE jobs SET status='canceled',completed_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
      )
      .run(now, now, jobId);
  }

  finishFailure(
    jobId: string,
    status: "rejected" | "failed",
    errorCode: string,
    message: string,
    now: string,
    outputSize: number,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status=?,error_code=?,error_message=?,completed_at=?,updated_at=?,output_size=?,
      lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND status IN ('validating','running')`,
        )
        .run(status, errorCode, message, now, now, outputSize, jobId).changes,
    );
  }

  staleLeases(now: string): StaleLeaseRow[] {
    return this.db
      .prepare(
        "SELECT id,status FROM jobs WHERE status IN ('validating','running') AND lease_expires_at<?",
      )
      .all(now) as unknown as StaleLeaseRow[];
  }
  recoverFailed(jobId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status='failed',error_code='WORKER_CRASHED',error_message='Worker lease expired while container existed',
    completed_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND status IN ('validating','running')`,
      )
      .run(now, now, jobId);
  }
  recoverQueued(jobId: string, now: string): void {
    this.db
      .prepare(
        "UPDATE jobs SET status='queued',updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND status IN ('validating','running')",
      )
      .run(now, jobId);
  }
}
