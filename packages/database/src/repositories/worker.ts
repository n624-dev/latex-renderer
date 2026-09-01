import type { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { JobStatus } from "@latex-renderer/contracts";

export interface WorkerJobRow {
  id: string;
  source_size: number;
  source_sha256: string;
  status: string;
  source_id: string | null;
  source_storage_key: string | null;
  entrypoint: string;
  outputs_json: string;
  lease_generation: number;
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
  lease_owner: string | null;
  lease_generation: number;
}
export interface StaleLeaseRow {
  id: string;
  status: string;
  lease_owner: string;
  lease_expires_at: string;
  lease_generation: number;
}

const WORKER_UPDATE_COLUMNS = new Set([
  "started_at",
  "completed_at",
  "output_size",
  "exit_code",
  "error_code",
  "error_message",
  "lease_owner",
  "lease_expires_at",
  "heartbeat_at",
  "render_status",
]);

export class WorkerRepository {
  constructor(private readonly db: DatabaseSync) {}

  claimNext(
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ): WorkerJobRow | undefined {
    const job = this.db
      .prepare(
        `SELECT j.id,j.source_size,j.source_sha256,j.status,j.source_id,j.entrypoint,j.outputs_json,j.lease_generation,s.storage_key AS source_storage_key
      FROM jobs j LEFT JOIN sources s ON s.id=j.source_id WHERE j.status='queued' ORDER BY j.queued_at,j.id LIMIT 1`,
      )
      .get() as WorkerJobRow | undefined;
    if (job === undefined) return undefined;
    const changed = this.db
      .prepare(
        `UPDATE jobs SET status='validating',lease_owner=?,lease_expires_at=?,heartbeat_at=?,updated_at=?,lease_generation=lease_generation+1
      WHERE id=? AND status='queued'`,
      )
      .run(workerId, leaseExpiresAt, now, now, job.id);
    return changed.changes === 1
      ? { ...job, lease_generation: job.lease_generation + 1 }
      : undefined;
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
      .prepare(
        "SELECT cancel_requested_at,status,lease_owner,lease_generation FROM jobs WHERE id=?",
      )
      .get(jobId) as WorkerRuntimeState | undefined;
  }
  heartbeat(
    jobId: string,
    workerId: string,
    leaseGeneration: number,
    now: string,
    leaseExpiresAt: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET heartbeat_at=?,lease_expires_at=?
         WHERE id=? AND lease_owner=? AND lease_generation=?
         AND status IN ('validating','running')`,
        )
        .run(now, leaseExpiresAt, jobId, workerId, leaseGeneration).changes,
    );
  }
  markCanceled(
    jobId: string,
    workerId: string,
    leaseGeneration: number,
    now: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status='canceled',render_status='canceled',completed_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=? AND lease_generation=?
         AND status IN ('validating','running','canceled')`,
        )
        .run(now, now, jobId, workerId, leaseGeneration).changes,
    );
  }

  finishFailure(
    jobId: string,
    status: "rejected" | "failed",
    errorCode: string,
    message: string,
    now: string,
    outputSize: number,
    workerId: string,
    leaseGeneration: number,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status=?,render_status=?,error_code=?,error_message=?,completed_at=?,updated_at=?,output_size=?,
      lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=? AND lease_generation=?
      AND status IN ('validating','running')`,
        )
        .run(
          status,
          status,
          errorCode,
          message,
          now,
          now,
          outputSize,
          jobId,
          workerId,
          leaseGeneration,
        ).changes,
    );
  }

  transitionOwned(
    jobId: string,
    workerId: string,
    leaseGeneration: number,
    from: readonly JobStatus[],
    to: JobStatus,
    now: string,
    updates: Readonly<Record<string, SQLInputValue>> = {},
  ): number {
    if (
      from.length === 0 ||
      Object.keys(updates).some((key) => !WORKER_UPDATE_COLUMNS.has(key))
    )
      throw new Error("Worker Job transition is invalid");
    const set = [
        "status=?",
        "updated_at=?",
        ...Object.keys(updates).map((key) => `${key}=?`),
      ],
      values: SQLInputValue[] = [
        to,
        now,
        ...Object.values(updates),
        jobId,
        workerId,
        leaseGeneration,
        ...from,
      ];
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET ${set.join(",")} WHERE id=? AND lease_owner=?
           AND lease_generation=? AND status IN (${from.map(() => "?").join(",")})`,
        )
        .run(...values).changes,
    );
  }

  staleLeases(now: string): StaleLeaseRow[] {
    return this.db
      .prepare(
        `SELECT id,status,lease_owner,lease_expires_at,lease_generation FROM jobs
         WHERE status IN ('validating','running') AND lease_owner IS NOT NULL
         AND lease_expires_at<?`,
      )
      .all(now) as unknown as StaleLeaseRow[];
  }
  claimExpiredLease(
    job: StaleLeaseRow,
    recoveryOwner: string,
    now: string,
    leaseExpiresAt: string,
  ): number | undefined {
    const changed = this.db
      .prepare(
        `UPDATE jobs SET lease_owner=?,lease_expires_at=?,heartbeat_at=?,updated_at=?,lease_generation=lease_generation+1
         WHERE id=? AND status=? AND lease_owner=? AND lease_expires_at=?
         AND lease_generation=? AND lease_expires_at<=?`,
      )
      .run(
        recoveryOwner,
        leaseExpiresAt,
        now,
        now,
        job.id,
        job.status,
        job.lease_owner,
        job.lease_expires_at,
        job.lease_generation,
        now,
      );
    return changed.changes === 1 ? job.lease_generation + 1 : undefined;
  }

  expireRecoveryClaim(
    jobId: string,
    recoveryOwner: string,
    leaseGeneration: number,
    now: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET lease_expires_at=?,updated_at=?
           WHERE id=? AND lease_owner=? AND lease_generation=?
           AND status IN ('validating','running')`,
        )
        .run(now, now, jobId, recoveryOwner, leaseGeneration).changes,
    );
  }

  recoverFailed(
    jobId: string,
    recoveryOwner: string,
    leaseGeneration: number,
    now: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status='failed',render_status='failed',error_code='WORKER_CRASHED',error_message='Worker lease expired while container existed',
    completed_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL
    WHERE id=? AND lease_owner=? AND lease_generation=? AND status IN ('validating','running')`,
        )
        .run(now, now, jobId, recoveryOwner, leaseGeneration).changes,
    );
  }
  recoverQueued(
    jobId: string,
    recoveryOwner: string,
    leaseGeneration: number,
    now: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE jobs SET status='queued',updated_at=?,lease_owner=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_owner=? AND lease_generation=?
         AND status IN ('validating','running')`,
        )
        .run(now, jobId, recoveryOwner, leaseGeneration).changes,
    );
  }
}
