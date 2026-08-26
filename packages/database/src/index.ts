import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { JobStatus } from "@latex-renderer/contracts";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import { schemaSql } from "./schema.js";
import { applyDatabaseMigrations } from "./migrations.js";
import {
  ApiKeysRepository,
  ArtifactsRepository,
  AuditLogsRepository,
  JobsRepository,
  SecurityRepository,
  ServiceAccountsRepository,
  SettingsRepository,
  SourcesRepository,
  UsersRepository,
  WorkerRepository,
  RemoteMcpRepository,
  WebPrincipalsRepository,
  ProjectsRepository,
} from "./repositories/index.js";

export interface DatabaseOptions {
  readonly?: boolean;
}

export class RendererDatabase {
  /** Direct SQL is retained for local recovery and migrations only. Runtime code should use repositories. */
  public readonly raw: DatabaseSync;
  public readonly users: UsersRepository;
  public readonly serviceAccounts: ServiceAccountsRepository;
  public readonly apiKeys: ApiKeysRepository;
  public readonly jobs: JobsRepository;
  public readonly sources: SourcesRepository;
  public readonly settings: SettingsRepository;
  public readonly artifacts: ArtifactsRepository;
  public readonly auditLogs: AuditLogsRepository;
  public readonly security: SecurityRepository;
  public readonly worker: WorkerRepository;
  public readonly remoteMcp: RemoteMcpRepository;
  public readonly webPrincipals: WebPrincipalsRepository;
  public readonly projects: ProjectsRepository;

  constructor(path: string, options: DatabaseOptions = {}) {
    this.raw = new DatabaseSync(path, {
      readOnly: options.readonly ?? false,
      enableForeignKeyConstraints: true,
    });
    this.raw.exec("PRAGMA busy_timeout=5000");
    this.users = new UsersRepository(this.raw);
    this.serviceAccounts = new ServiceAccountsRepository(this.raw);
    this.apiKeys = new ApiKeysRepository(this.raw);
    this.jobs = new JobsRepository(this.raw);
    this.sources = new SourcesRepository(this.raw);
    this.settings = new SettingsRepository(this.raw);
    this.artifacts = new ArtifactsRepository(this.raw);
    this.auditLogs = new AuditLogsRepository(this.raw);
    this.security = new SecurityRepository(this.raw);
    this.worker = new WorkerRepository(this.raw);
    this.remoteMcp = new RemoteMcpRepository(this.raw);
    this.webPrincipals = new WebPrincipalsRepository(this.raw);
    this.projects = new ProjectsRepository(this.raw);
  }

  migrate(): void {
    this.raw.exec(schemaSql);
    applyDatabaseMigrations(this.raw);
  }
  close(): void {
    this.raw.close();
  }

  transaction<T>(operation: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  audit(input: {
    actorType: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    result: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    metadata?: Readonly<Record<string, unknown>> | undefined;
  }): void {
    this.raw
      .prepare(
        `INSERT INTO audit_logs
      (id,actor_type,actor_id,action,target_type,target_id,result,ip_address,user_agent,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId("audit"),
        input.actorType,
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.result,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.metadata ?? {}),
        nowIso(),
      );
  }

  transitionJob(
    jobId: string,
    from: readonly JobStatus[],
    to: JobStatus,
    updates: Readonly<Record<string, SQLInputValue>> = {},
  ): void {
    if (from.length === 0)
      throw new AppError(
        "INVALID_TRANSITION",
        "Source status set cannot be empty",
        500,
      );
    const set = [
      "status = ?",
      "updated_at = ?",
      ...Object.keys(updates).map((key) => `${key} = ?`),
    ];
    const values: SQLInputValue[] = [
      to,
      nowIso(),
      ...Object.values(updates),
      jobId,
      ...from,
    ];
    const placeholders = from.map(() => "?").join(",");
    const result = this.raw
      .prepare(
        `UPDATE jobs SET ${set.join(", ")} WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(...values);
    if (result.changes !== 1)
      throw new AppError(
        "JOB_STATE_CONFLICT",
        "Job state changed concurrently",
        409,
      );
  }

  claimNonce(
    nonce: string,
    jobId: string,
    owner: string,
    claimUntil: string,
  ): void {
    const result = this.raw
      .prepare(
        `UPDATE used_nonces SET state='claimed', claim_owner=?, claimed_at=?, expires_at=?
    WHERE nonce=? AND job_id=? AND state IN ('unused','released')`,
      )
      .run(owner, nowIso(), claimUntil, nonce, jobId);
    if (result.changes !== 1)
      throw new AppError(
        "UPLOAD_TICKET_REPLAYED",
        "Upload ticket is already in use",
        409,
      );
  }
  consumeNonce(nonce: string, owner: string): void {
    const result = this.raw
      .prepare(
        "UPDATE used_nonces SET state='consumed', used_at=? WHERE nonce=? AND state='claimed' AND claim_owner=?",
      )
      .run(nowIso(), nonce, owner);
    if (result.changes !== 1)
      throw new AppError("NONCE_STATE_CONFLICT", "Upload claim was lost", 409);
  }
  releaseNonce(nonce: string, owner: string): void {
    this.raw
      .prepare(
        "UPDATE used_nonces SET state='released', claim_owner=NULL, claimed_at=NULL WHERE nonce=? AND state='claimed' AND claim_owner=?",
      )
      .run(nonce, owner);
  }
  claimSourceNonce(
    nonce: string,
    sourceId: string,
    owner: string,
    claimUntil: string,
  ): void {
    const result = this.raw
      .prepare(
        `UPDATE source_upload_nonces SET state='claimed',claim_owner=?,claimed_at=?,expires_at=? WHERE nonce=? AND source_id=? AND state IN ('unused','released')`,
      )
      .run(owner, nowIso(), claimUntil, nonce, sourceId);
    if (result.changes !== 1)
      throw new AppError(
        "UPLOAD_TICKET_REPLAYED",
        "Upload ticket is already in use",
        409,
      );
  }
  consumeSourceNonce(nonce: string, owner: string): void {
    const result = this.raw
      .prepare(
        "UPDATE source_upload_nonces SET state='consumed',used_at=? WHERE nonce=? AND state='claimed' AND claim_owner=?",
      )
      .run(nowIso(), nonce, owner);
    if (result.changes !== 1)
      throw new AppError("NONCE_STATE_CONFLICT", "Upload claim was lost", 409);
  }
  releaseSourceNonce(nonce: string, owner: string): void {
    this.raw
      .prepare(
        "UPDATE source_upload_nonces SET state='released',claim_owner=NULL,claimed_at=NULL WHERE nonce=? AND state='claimed' AND claim_owner=?",
      )
      .run(nonce, owner);
  }
}

export * from "./repositories/index.js";
export { schemaSql } from "./schema.js";
