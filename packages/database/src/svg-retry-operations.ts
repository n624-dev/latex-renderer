import { createHash } from "node:crypto";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";

export interface SvgRetryActor {
  userId: string;
  type: string;
  id: string;
  /** Present for API-key/OAuth callers to retain the existing Job boundary. */
  serviceAccountId?: string;
}
export interface SvgRetryLimits {
  maxQueueLength?: number;
  maxUserStorageBytes?: number;
  maxOutputBytes?: number;
  artifactRetentionHours?: number;
}

export class SvgRetryOperations {
  constructor(
    private readonly db: RendererDatabase,
    private readonly limits: SvgRetryLimits = {},
  ) {}
  retry(
    actor: SvgRetryActor,
    jobId: string,
    idempotencyKey: string,
  ): { id: string; reused: boolean } {
    if (!/^job_[a-f0-9]{32}$/.test(jobId))
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256").update(jobId).digest("hex");
    const maxOutput = this.limits.maxOutputBytes ?? 200 * 1024 * 1024,
      retention = this.limits.artifactRetentionHours ?? 24;
    for (const value of [
      maxOutput,
      retention,
      this.limits.maxQueueLength ?? 100,
      this.limits.maxUserStorageBytes ?? 1024 ** 3,
    ])
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error("Invalid SVG retry limits");
    return this.db.transaction(() => {
      const row = this.db.jobs.getVisible(jobId);
      if (
        !row ||
        row.user_id !== actor.userId ||
        (actor.serviceAccountId !== undefined &&
          row.service_account_id !== actor.serviceAccountId)
      )
        throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
      const previous = this.db.security.idempotency(
        actor.type,
        actor.id,
        "render.retry_svg",
        keyHash,
        nowIso(),
      );
      if (previous) {
        if (
          previous.request_hash !== requestHash ||
          previous.resource_id !== jobId
        )
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was reused with another Job",
            409,
          );
        return { id: jobId, reused: true };
      }
      if (
        this.db.settings.value<string>("maintenance_mode", "normal") !==
        "normal"
      )
        throw new AppError(
          "MAINTENANCE",
          "New rendering is temporarily unavailable",
          503,
        );
      if (
        this.db.jobs.countActive() >=
        this.db.settings.value(
          "max_queue_length",
          this.limits.maxQueueLength ?? 100,
        )
      )
        throw new AppError("QUEUE_FULL", "Render queue is full", 503);
      if (
        this.db.jobs.countActiveForServiceAccount(row.service_account_id) >= 5
      )
        throw new AppError(
          "ACCOUNT_QUEUE_LIMIT",
          "Service account pending Job limit reached",
          429,
        );
      if (
        this.db.jobs.countActiveForUser(actor.userId) >=
        this.db.settings.value("max_user_active_jobs", 20)
      )
        throw new AppError(
          "USER_QUEUE_LIMIT",
          "User pending Job limit reached",
          429,
        );
      const storageLimit = this.db.settings.value(
        "max_user_storage_bytes",
        this.limits.maxUserStorageBytes ?? 1024 ** 3,
      );
      if (
        Math.max(0, maxOutput - (row.output_size ?? 0)) >
        storageLimit - this.db.jobs.storageUsageForUser(actor.userId)
      )
        throw new AppError(
          "USER_STORAGE_QUOTA",
          "User storage quota is exhausted",
          429,
        );
      const timestamp = nowIso(),
        cutoff = new Date(Date.now() - retention * 3600000).toISOString();
      if (
        !this.db.outputStages.requeueSvg(
          jobId,
          actor.userId,
          timestamp,
          cutoff,
          maxOutput,
        )
      )
        throw new AppError(
          "SVG_NOT_RETRYABLE",
          "SVG retry requires an unexpired PDF, its original ready Source, a failed SVG stage and fewer than 8 attempts",
          409,
        );
      this.db.security.insertIdempotency({
        actorType: actor.type,
        actorId: actor.id,
        operation: "render.retry_svg",
        keyHash,
        requestHash,
        resourceId: jobId,
        responseCode: 202,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: timestamp,
      });
      this.db.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "render.svg.retried",
        targetType: "job",
        targetId: jobId,
        result: "success",
      });
      return { id: jobId, reused: false };
    });
  }
}
