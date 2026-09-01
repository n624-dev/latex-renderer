import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import type { RenderOutput } from "@latex-renderer/contracts";
import { AppError, nowIso } from "@latex-renderer/shared";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import type { InternalApiDependencies } from "../types.js";

export class RenderTicketsService {
  constructor(private readonly deps: InternalApiDependencies) {}
  async create(
    actor: AuthenticatedServiceAccount,
    input:
      | { size: number; sha256: string; outputs?: RenderOutput[] }
      | {
          sourceId: string;
          entrypoint?: string | undefined;
          outputs?: RenderOutput[];
        },
    idempotencyKey: string,
  ) {
    if ("sourceId" in input)
      return this.createFromSource(actor, input, idempotencyKey);
    return this.createLegacy(actor, input, idempotencyKey);
  }
  private async createLegacy(
    actor: AuthenticatedServiceAccount,
    input: { size: number; sha256: string; outputs?: RenderOutput[] },
    idempotencyKey: string,
  ) {
    const outputs: RenderOutput[] = input.outputs ?? ["pdf"],
      normalized = outputs.includes("svg")
        ? { size: input.size, sha256: input.sha256, outputs }
        : { size: input.size, sha256: input.sha256 },
      requestHash = createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      existing = this.deps.database.security.idempotency(
        "service_account",
        actor.serviceAccountId,
        "render.create",
        keyHash,
        nowIso(),
      );
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was reused with a different request",
          409,
        );
      if (existing.resource_id === null)
        throw new AppError(
          "IDEMPOTENCY_INCOMPLETE",
          "Original request is still incomplete",
          409,
        );
      return {
        status: 200 as const,
        value: await this.issueExisting(actor, existing.resource_id),
      };
    }
    const jobId = `job_${randomBytes(16).toString("hex")}`,
      sourceId = `source_${randomBytes(16).toString("hex")}`,
      nonce = randomBytes(24).toString("base64url"),
      subject = toSubject(actor, jobId),
      [uploadTicket, jobTicket] = await Promise.all([
        this.deps.tickets.issueUpload({
          ...subject,
          size: input.size,
          sha256: input.sha256,
          nonce,
        }),
        this.deps.tickets.issueJob(subject),
      ]),
      timestamp = nowIso(),
      expiresAt = new Date(Date.now() + 600_000).toISOString();
    try {
      this.deps.database.transaction(() => {
        this.assertAccepting(actor, input.size);
        this.deps.database.sources.insertReserved({
          id: sourceId,
          ownerUserId: actor.userId,
          size: input.size,
          sha256: input.sha256,
          storageKey: `sources/${sourceId}/source.zip`,
          timestamp,
          expiresAt,
          dedupeEligible: false,
        });
        this.deps.database.jobs.insertReserved({
          id: jobId,
          userId: actor.userId,
          serviceAccountId: actor.serviceAccountId,
          apiKeyId: actor.apiKeyId,
          rendererVersion: this.deps.rendererVersion,
          sourceSize: input.size,
          sourceSha256: input.sha256,
          timestamp,
          sourceId,
          outputs,
          reservedOutputBytes: this.deps.maxOutputBytes,
        });
        this.deps.database.security.insertNonce(nonce, jobId, expiresAt);
        this.deps.database.security.insertIdempotency({
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          operation: "render.create",
          keyHash,
          requestHash,
          resourceId: jobId,
          responseCode: 201,
          expiresAt,
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          action: "render.reserved",
          targetType: "job",
          targetId: jobId,
          result: "success",
          metadata: { sourceSize: input.size, sourceSha256: input.sha256 },
        });
      });
    } catch (error) {
      const raced = this.deps.database.security.idempotency(
        "service_account",
        actor.serviceAccountId,
        "render.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExisting(actor, raced.resource_id),
        };
      throw error;
    }
    return {
      status: 201 as const,
      value: {
        jobId,
        uploadTicket,
        jobTicket,
        uploadUrl: this.uploadUrl(jobId),
        expiresAt,
      },
    };
  }
  private async createFromSource(
    actor: AuthenticatedServiceAccount,
    input: {
      sourceId: string;
      entrypoint?: string | undefined;
      outputs?: RenderOutput[];
    },
    idempotencyKey: string,
  ) {
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      outputs: RenderOutput[] = input.outputs ?? ["pdf"],
      normalized = outputs.includes("svg")
        ? { sourceId: input.sourceId, entrypoint, outputs }
        : { sourceId: input.sourceId, entrypoint };
    const requestHash = createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      existing = this.deps.database.security.idempotency(
        "service_account",
        actor.serviceAccountId,
        "render.create",
        keyHash,
        nowIso(),
      );
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was reused with a different request",
          409,
        );
      if (existing.resource_id === null)
        throw new AppError(
          "IDEMPOTENCY_INCOMPLETE",
          "Original request is still incomplete",
          409,
        );
      return {
        status: 200 as const,
        value: await this.issueExistingSourceJob(actor, existing.resource_id),
      };
    }
    const source = this.deps.database.sources.getOwnedReady(
      input.sourceId,
      actor.userId,
      nowIso(),
    );
    if (source === undefined)
      throw new AppError(
        "SOURCE_NOT_READY",
        "Source does not exist or is not ready",
        409,
      );
    if (!this.deps.database.sources.paths(source).includes(entrypoint))
      throw new AppError(
        "ENTRYPOINT_MISSING",
        "Source does not contain the requested entrypoint",
        422,
      );
    const jobId = `job_${randomBytes(16).toString("hex")}`,
      timestamp = nowIso(),
      jobTicket = await this.deps.tickets.issueJob(toSubject(actor, jobId));
    try {
      this.deps.database.transaction(() => {
        this.assertAccepting(actor, 0);
        const currentSource = this.deps.database.sources.getOwnedReady(
          input.sourceId,
          actor.userId,
          timestamp,
        );
        if (currentSource === undefined)
          throw new AppError(
            "SOURCE_NOT_READY",
            "Source does not exist or is not ready",
            409,
          );
        if (
          !this.deps.database.sources.paths(currentSource).includes(entrypoint)
        )
          throw new AppError(
            "ENTRYPOINT_MISSING",
            "Source does not contain the requested entrypoint",
            422,
          );
        if (
          this.deps.database.jobs.insertQueued({
            id: jobId,
            userId: actor.userId,
            serviceAccountId: actor.serviceAccountId,
            apiKeyId: actor.apiKeyId,
            rendererVersion: this.deps.rendererVersion,
            sourceId: currentSource.id,
            entrypoint,
            outputs,
            timestamp,
            reservedOutputBytes: this.deps.maxOutputBytes,
          }) !== 1
        )
          throw new AppError(
            "SOURCE_NOT_READY",
            "Source changed while the Render Job was being created",
            409,
          );
        this.deps.database.security.insertIdempotency({
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          operation: "render.create",
          keyHash,
          requestHash,
          resourceId: jobId,
          responseCode: 201,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          action: "render.queued",
          targetType: "job",
          targetId: jobId,
          result: "success",
          metadata: { sourceId: currentSource.id, entrypoint, outputs },
        });
      });
    } catch (caught) {
      const raced = this.deps.database.security.idempotency(
        "service_account",
        actor.serviceAccountId,
        "render.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExistingSourceJob(actor, raced.resource_id),
        };
      throw caught;
    }
    return {
      status: 201 as const,
      value: {
        jobId,
        jobTicket,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      },
    };
  }
  async renew(actor: AuthenticatedServiceAccount, jobId: string) {
    const row = this.deps.database.jobs.getOwned(
      jobId,
      actor.userId,
      actor.serviceAccountId,
    );
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return {
      jobId,
      jobTicket: await this.deps.tickets.issueJob(toSubject(actor, jobId)),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
  }
  private assertAccepting(
    actor: AuthenticatedServiceAccount,
    requestedBytes: number,
  ): void {
    if (
      this.deps.database.settings.value<
        "normal" | "reject-new-jobs" | "read-only" | "lockdown"
      >("maintenance_mode", "normal") !== "normal"
    )
      throw new AppError(
        "MAINTENANCE",
        "New jobs are temporarily unavailable",
        503,
      );
    const maxQueue = this.deps.database.settings.value(
      "max_queue_length",
      this.deps.maxQueueLength,
    );
    if (this.deps.database.jobs.countActive() >= maxQueue)
      throw new AppError("QUEUE_FULL", "Render queue is full", 503);
    if (
      this.deps.database.jobs.countActiveForServiceAccount(
        actor.serviceAccountId,
      ) >= 5
    )
      throw new AppError(
        "ACCOUNT_QUEUE_LIMIT",
        "Service account pending job limit reached",
        429,
      );
    const maxUserActiveJobs = this.deps.database.settings.value(
      "max_user_active_jobs",
      20,
    );
    if (
      this.deps.database.jobs.countActiveForUser(actor.userId) >=
      maxUserActiveJobs
    )
      throw new AppError(
        "USER_QUEUE_LIMIT",
        "User pending job limit reached",
        429,
      );
    const maxStorage = this.deps.database.settings.value(
        "max_user_storage_bytes",
        this.deps.maxUserStorageBytes,
      ),
      usedStorage = this.deps.database.jobs.storageUsageForUser(actor.userId);
    if (requestedBytes + this.deps.maxOutputBytes > maxStorage - usedStorage)
      throw new AppError(
        "USER_STORAGE_QUOTA",
        "User storage quota is exhausted",
        429,
      );
  }
  private async issueExisting(
    actor: AuthenticatedServiceAccount,
    jobId: string,
  ) {
    const row = this.deps.database.jobs.getOwned(
      jobId,
      actor.userId,
      actor.serviceAccountId,
    );
    if (row === undefined)
      throw new AppError(
        "JOB_NOT_FOUND",
        "Idempotent job no longer exists",
        404,
      );
    if (row.status !== "reserved")
      throw new AppError(
        "IDEMPOTENT_RESOURCE_STATE",
        "Original Render upload is no longer pending",
        409,
      );
    const timestamp = nowIso(),
      nonceRecord = this.deps.database.security.latestUsableNonceRecord(
        jobId,
        timestamp,
      );
    if (nonceRecord === undefined)
      throw new AppError(
        "IDEMPOTENT_RESOURCE_GONE",
        "Original Render upload reservation has expired",
        410,
      );
    const { nonce, expires_at: expiresAt } = nonceRecord;
    const subject = toSubject(actor, jobId);
    return {
      jobId,
      uploadTicket: await this.deps.tickets.issueUpload({
        ...subject,
        size: row.source_size,
        sha256: row.source_sha256,
        nonce,
      }),
      jobTicket: await this.deps.tickets.issueJob(subject),
      uploadUrl: this.uploadUrl(jobId),
      expiresAt,
    };
  }
  private async issueExistingSourceJob(
    actor: AuthenticatedServiceAccount,
    jobId: string,
  ) {
    const row = this.deps.database.jobs.getOwned(
      jobId,
      actor.userId,
      actor.serviceAccountId,
    );
    if (row === undefined)
      throw new AppError(
        "JOB_NOT_FOUND",
        "Idempotent job no longer exists",
        404,
      );
    return {
      jobId,
      jobTicket: await this.deps.tickets.issueJob(toSubject(actor, jobId)),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
  }
  private uploadUrl(jobId: string): string {
    return new URL(
      `/api/v1/jobs/${jobId}/source`,
      this.deps.rendererPublicUrl,
    ).toString();
  }
}
function toSubject(actor: AuthenticatedServiceAccount, jobId: string) {
  return {
    jobId,
    userId: actor.userId,
    serviceAccountId: actor.serviceAccountId,
    apiKeyId: actor.apiKeyId,
    userSecurityVersion: actor.userSecurityVersion,
    serviceAccountSecurityVersion: actor.serviceAccountSecurityVersion,
  };
}
