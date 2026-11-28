import { createHash } from "node:crypto";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import {
  assertRenderAdmission,
  type RenderStorageLimits,
} from "./render-admission.js";

export interface SvgRetryActor {
  userId: string;
  type: string;
  id: string;
  /** Present for API-key/OAuth callers to retain the existing Job boundary. */
  serviceAccountId?: string;
}
export interface SvgRetryLimits extends RenderStorageLimits {
  maxQueueLength?: number;
  maxUserStorageBytes?: number;
  maxOutputBytes?: number;
  artifactRetentionHours?: number;
  runtimeImage?: string | undefined;
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
      // UI visibility and an authenticated account's exact Job capability are
      // distinct. Internal smoke Jobs stay hidden from user listings, while
      // their creating account retains the same retry path as other Jobs.
      const row =
        actor.serviceAccountId === undefined
          ? this.db.jobs.getVisible(jobId)
          : this.db.jobs.getOwned(jobId, actor.userId, actor.serviceAccountId);
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
      const checkpoint = this.db.outputStages.checkpoint(jobId);
      const activeRuntime = this.limits.runtimeImage;
      if (
        activeRuntime !== undefined &&
        checkpoint?.pdf_status === "succeeded" &&
        checkpoint.renderer_image !== activeRuntime
      )
        throw new AppError(
          "SVG_RUNTIME_CHANGED",
          "The Runtime changed after PDF publication. Start a new Job to generate PDF and SVG together.",
          409,
        );
      assertRenderAdmission(
        this.db,
        { userId: actor.userId, serviceAccountId: row.service_account_id },
        {
          ...this.limits,
          maxQueueLength: this.limits.maxQueueLength ?? 100,
          maxUserStorageBytes: this.limits.maxUserStorageBytes ?? 1024 ** 3,
        },
        Math.max(0, maxOutput - (row.output_size ?? 0)),
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
