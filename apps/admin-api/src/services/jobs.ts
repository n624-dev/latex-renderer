import { createHash, randomBytes } from "node:crypto";
import { statfs } from "node:fs/promises";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { JobRow } from "@latex-renderer/database";
import type { RenderOutput } from "@latex-renderer/contracts";
import { RemoteRenderService } from "@latex-renderer/remote-mcp-core";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import type { AdminDependencies, AppActor } from "../types.js";
import { artifactContentType, retentionExpiresAt } from "./artifacts.js";

const RETAINED = new Set([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "expired",
]);

export class AdminJobsService {
  constructor(private readonly deps: AdminDependencies) {}
  list(filters: { status?: string; query?: string; sourceId?: string } = {}) {
    const query = filters.query?.trim().toLowerCase();
    return this.deps.database.jobs.list().filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (filters.sourceId && row.source_id !== filters.sourceId) return false;
      return (
        !query ||
        [row.id, row.source_id, row.entrypoint, row.user_id].some((value) =>
          value?.toLowerCase().includes(query),
        )
      );
    });
  }
  get(id: string) {
    const row = this.deps.database.jobs.get(id);
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    const terminalAt = row.completed_at ?? row.updated_at,
      retention = RETAINED.has(row.status)
        ? retentionExpiresAt(this.deps, terminalAt)
        : null,
      available =
        retention !== null &&
        Date.parse(retention) > Date.now() &&
        !["expired", "deleting", "deleted"].includes(row.status),
      artifacts = available
        ? this.deps.database.artifacts.listDownloadable(id)
        : [];
    const item = (artifact: (typeof artifacts)[number]) => {
      const leaf =
        artifact.type === "preview"
          ? artifact.relative_path.replace(/^previews\//, "")
          : artifact.relative_path;
      const prefix = artifact.type === "preview" ? "previews" : "artifacts";
      const downloadUrl = `/admin/api/v1/jobs/${encodeURIComponent(id)}/${prefix}/${leaf.split("/").map(encodeURIComponent).join("/")}`;
      return {
        type: artifact.type,
        relative_path: artifact.relative_path,
        size: artifact.size,
        sha256: artifact.sha256,
        created_at: artifact.created_at,
        content_type: artifactContentType(artifact.type),
        download_url: downloadUrl,
        open_url:
          artifact.type === "pdf" || artifact.type === "preview"
            ? `${downloadUrl}?disposition=inline`
            : null,
      };
    };
    return {
      id: row.id,
      user_id: row.user_id,
      service_account_id: row.service_account_id,
      status: row.status,
      renderer_version: row.renderer_version,
      source_size: row.source_size,
      source_sha256: row.source_sha256,
      source_id: row.source_id,
      entrypoint: row.entrypoint,
      outputs: this.deps.database.jobs.outputs(row),
      created_at: row.created_at,
      updated_at: row.updated_at,
      queued_at: row.queued_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_ms:
        row.started_at && row.completed_at
          ? Math.max(
              0,
              Date.parse(row.completed_at) - Date.parse(row.started_at),
            )
          : null,
      retention_expires_at: retention,
      artifacts_available: available,
      exit_code: row.exit_code,
      error_code: row.error_code,
      error_message: row.error_message,
      output_size: row.output_size,
      retry_of_job_id: row.retry_of_job_id,
      retries: this.deps.database.jobs.retries(id),
      artifacts: artifacts
        .filter((artifact) => artifact.type !== "preview")
        .map(item),
      previews: artifacts
        .filter((artifact) => artifact.type === "preview")
        .map(item),
    };
  }

  renderTargets() {
    return this.deps.database.apiKeys
      .listRenderIdentities(nowIso())
      .map((row) => ({
        apiKeyId: row.api_key_id,
        apiKeyName: row.api_key_name,
        serviceAccountId: row.service_account_id,
        serviceAccountName: row.service_account_name,
        userId: row.user_id,
        userLabel: row.user_email ?? row.user_display_name,
      }));
  }

  createSourceRef(
    actor: AppActor,
    input: { apiKeyId: string; sourceId: string },
  ) {
    const identity = this.deps.database.apiKeys.renderIdentity(
      input.apiKeyId,
      nowIso(),
    );
    if (identity === undefined)
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "Selected render target is unavailable",
        409,
      );
    const result = new RemoteRenderService(
      this.deps.database,
      this.deps.storageRoot,
      this.deps.rendererVersion,
      this.deps.renderTickets?.rendererPublicUrl ?? this.deps.publicOrigin,
      this.deps.maxQueueLength,
      this.deps.maxUserStorageBytes,
    ).createSourceRef(identity.user_id, input.sourceId);
    this.deps.database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action: "admin.source_ref.created",
      targetType: "source",
      targetId: input.sourceId,
      result: "success",
      metadata: { ownerUserId: identity.user_id, expiresAt: result.expiresAt },
    });
    return result;
  }

  async createRender(
    actor: AppActor,
    input:
      | {
          apiKeyId: string;
          size: number;
          sha256: string;
          outputs: RenderOutput[];
        }
      | {
          apiKeyId: string;
          sourceId: string;
          entrypoint?: string | undefined;
          outputs: RenderOutput[];
        },
    idempotencyKey: string,
  ) {
    if ("sourceId" in input)
      return this.createRenderFromSource(actor, input, idempotencyKey);
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const normalized = input.outputs.includes("svg")
        ? input
        : {
            apiKeyId: input.apiKeyId,
            size: input.size,
            sha256: input.sha256,
          },
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      timestamp = nowIso();
    const existing = this.deps.database.security.idempotency(
      actor.type,
      actor.id,
      "admin.render.create",
      keyHash,
      timestamp,
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
        value: await this.issueExisting(existing.resource_id),
      };
    }
    const identity = this.deps.database.apiKeys.renderIdentity(
      input.apiKeyId,
      timestamp,
    );
    if (identity === undefined)
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "Selected render target is unavailable",
        409,
      );
    const config = this.renderTicketConfig(),
      jobId = newId("job"),
      sourceId = newId("source"),
      nonce = randomBytes(24).toString("base64url"),
      subject = {
        jobId,
        userId: identity.user_id,
        serviceAccountId: identity.service_account_id,
        apiKeyId: identity.api_key_id,
        userSecurityVersion: identity.user_security_version,
        serviceAccountSecurityVersion:
          identity.service_account_security_version,
      },
      expiresAt = new Date(Date.now() + 600_000).toISOString();
    const [uploadTicket, jobTicket] = await Promise.all([
      config.tickets.issueUpload({
        ...subject,
        size: input.size,
        sha256: input.sha256,
        nonce,
      }),
      config.tickets.issueJob(subject),
    ]);
    try {
      this.deps.database.transaction(() => {
        this.assertAccepting(
          identity.user_id,
          identity.service_account_id,
          input.size,
        );
        this.deps.database.sources.insertReserved({
          id: sourceId,
          ownerUserId: identity.user_id,
          size: input.size,
          sha256: input.sha256,
          storageKey: `sources/${sourceId}/source.zip`,
          timestamp,
          expiresAt,
          dedupeEligible: false,
        });
        this.deps.database.jobs.insertReserved({
          id: jobId,
          userId: identity.user_id,
          serviceAccountId: identity.service_account_id,
          apiKeyId: identity.api_key_id,
          rendererVersion: this.deps.rendererVersion,
          sourceSize: input.size,
          sourceSha256: input.sha256,
          timestamp,
          sourceId,
          outputs: input.outputs,
        });
        this.deps.database.security.insertNonce(nonce, jobId, expiresAt);
        this.deps.database.security.insertIdempotency({
          actorType: actor.type,
          actorId: actor.id,
          operation: "admin.render.create",
          keyHash,
          requestHash,
          resourceId: jobId,
          responseCode: 201,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: actor.type,
          actorId: actor.id,
          action: "render.reserved",
          targetType: "job",
          targetId: jobId,
          result: "success",
          metadata: {
            sourceSize: input.size,
            sourceSha256: input.sha256,
            apiKeyId: identity.api_key_id,
            serviceAccountId: identity.service_account_id,
          },
        });
      });
    } catch (error) {
      const raced = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "admin.render.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExisting(raced.resource_id),
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

  async createSource(
    actor: AppActor,
    input: { apiKeyId: string; size: number; sha256: string },
    idempotencyKey: string,
  ) {
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const identity = this.deps.database.apiKeys.renderIdentity(
      input.apiKeyId,
      nowIso(),
    );
    if (identity === undefined)
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "Selected render target is unavailable",
        409,
      );
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      existing = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "admin.source.create",
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
          "Original request is incomplete",
          409,
        );
      return {
        status: 200 as const,
        value: await this.issueExistingSource(identity, existing.resource_id),
      };
    }
    const ready = this.deps.database.sources.findReady(
      identity.user_id,
      input.sha256,
      input.size,
      nowIso(),
    );
    if (ready !== undefined) {
      this.deps.database.transaction(() =>
        this.deps.database.security.insertIdempotency({
          actorType: actor.type,
          actorId: actor.id,
          operation: "admin.source.create",
          keyHash,
          requestHash,
          resourceId: ready.id,
          responseCode: 200,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: nowIso(),
        }),
      );
      return {
        status: 200 as const,
        value: {
          sourceId: ready.id,
          uploadRequired: false,
          expiresAt: ready.expires_at,
        },
      };
    }
    const sourceId = newId("source"),
      nonce = randomBytes(24).toString("base64url"),
      expiresAt = new Date(Date.now() + 600_000).toISOString(),
      timestamp = nowIso(),
      config = this.renderTicketConfig();
    const uploadTicket = await config.tickets.issueSourceUpload({
      sourceId,
      userId: identity.user_id,
      serviceAccountId: identity.service_account_id,
      apiKeyId: identity.api_key_id,
      userSecurityVersion: identity.user_security_version,
      serviceAccountSecurityVersion: identity.service_account_security_version,
      size: input.size,
      sha256: input.sha256,
      nonce,
    });
    try {
      this.deps.database.transaction(() => {
        this.assertStorage(identity.user_id, input.size);
        this.deps.database.sources.insertReserved({
          id: sourceId,
          ownerUserId: identity.user_id,
          size: input.size,
          sha256: input.sha256,
          storageKey: `sources/${sourceId}/source.zip`,
          timestamp,
          expiresAt,
        });
        this.deps.database.security.insertSourceNonce(
          nonce,
          sourceId,
          expiresAt,
        );
        this.deps.database.security.insertIdempotency({
          actorType: actor.type,
          actorId: actor.id,
          operation: "admin.source.create",
          keyHash,
          requestHash,
          resourceId: sourceId,
          responseCode: 201,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: actor.type,
          actorId: actor.id,
          action: "source.reserved",
          targetType: "source",
          targetId: sourceId,
          result: "success",
          metadata: { size: input.size, sha256: input.sha256 },
        });
      });
    } catch (caught) {
      const raced = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "admin.source.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExistingSource(identity, raced.resource_id),
        };
      throw caught;
    }
    return {
      status: 201 as const,
      value: {
        sourceId,
        uploadRequired: true,
        uploadTicket,
        uploadUrl: this.sourceUploadUrl(sourceId),
        expiresAt,
      },
    };
  }

  private async createRenderFromSource(
    actor: AppActor,
    input: {
      apiKeyId: string;
      sourceId: string;
      entrypoint?: string | undefined;
      outputs: RenderOutput[];
    },
    idempotencyKey: string,
  ) {
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      identity = this.deps.database.apiKeys.renderIdentity(
        input.apiKeyId,
        nowIso(),
      );
    if (identity === undefined)
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "Selected render target is unavailable",
        409,
      );
    const normalized = input.outputs.includes("svg")
        ? {
            apiKeyId: input.apiKeyId,
            sourceId: input.sourceId,
            entrypoint,
            outputs: input.outputs,
          }
        : {
            apiKeyId: input.apiKeyId,
            sourceId: input.sourceId,
            entrypoint,
          },
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      existing = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "admin.render.create",
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
          "Original request is incomplete",
          409,
        );
      return {
        status: 200 as const,
        value: await this.issueExistingSourceJob(existing.resource_id),
      };
    }
    const source = this.deps.database.sources.getOwned(
      input.sourceId,
      identity.user_id,
    );
    if (source === undefined || source.status !== "ready")
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
    const jobId = newId("job"),
      timestamp = nowIso(),
      jobTicket = await this.renderTicketConfig().tickets.issueJob({
        jobId,
        userId: identity.user_id,
        serviceAccountId: identity.service_account_id,
        apiKeyId: identity.api_key_id,
        userSecurityVersion: identity.user_security_version,
        serviceAccountSecurityVersion:
          identity.service_account_security_version,
      });
    try {
      this.deps.database.transaction(() => {
        this.assertAccepting(identity.user_id, identity.service_account_id, 0);
        this.deps.database.jobs.insertQueued({
          id: jobId,
          userId: identity.user_id,
          serviceAccountId: identity.service_account_id,
          apiKeyId: identity.api_key_id,
          rendererVersion: this.deps.rendererVersion,
          sourceId: source.id,
          sourceSize: source.size,
          sourceSha256: source.sha256,
          entrypoint,
          outputs: input.outputs,
          timestamp,
        });
        this.deps.database.security.insertIdempotency({
          actorType: actor.type,
          actorId: actor.id,
          operation: "admin.render.create",
          keyHash,
          requestHash,
          resourceId: jobId,
          responseCode: 201,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: actor.type,
          actorId: actor.id,
          action: "render.queued",
          targetType: "job",
          targetId: jobId,
          result: "success",
          metadata: { sourceId: source.id, entrypoint },
        });
      });
    } catch (caught) {
      const raced = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "admin.render.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExistingSourceJob(raced.resource_id),
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

  cancel(
    actor: AppActor,
    id: string,
  ): { id: string; cancelRequestedAt: string } {
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      if (this.deps.database.jobs.cancel(id, timestamp) !== 1)
        throw new AppError("JOB_NOT_CANCELABLE", "Job cannot be canceled", 409);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "render.canceled",
        targetType: "job",
        targetId: id,
        result: "requested",
      });
    });
    return { id, cancelRequestedAt: timestamp };
  }

  delete(actor: AppActor, id: string): void {
    this.deps.database.transaction(() => {
      this.deps.database.transitionJob(
        id,
        ["succeeded", "failed", "timeout", "canceled", "rejected", "expired"],
        "deleting",
      );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "render.deleted",
        targetType: "job",
        targetId: id,
        result: "requested",
      });
    });
  }

  bulkDelete(actor: AppActor, ids: string[]): string[] {
    const accepted: string[] = [];
    this.deps.database.transaction(() => {
      for (const id of ids) {
        if (this.deps.database.jobs.markDeleting(id, nowIso()) === 1) {
          accepted.push(id);
          this.deps.database.audit({
            actorType: actor.type,
            actorId: actor.id,
            action: "render.deleted",
            targetType: "job",
            targetId: id,
            result: "requested",
          });
        }
      }
    });
    return accepted;
  }

  async retry(
    actor: AppActor,
    sourceJobId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; retryOfJobId: string; reused: boolean }> {
    if (idempotencyKey.length < 16 || idempotencyKey.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256").update(sourceJobId).digest("hex");
    const existing = this.deps.database.security.idempotency(
      actor.type,
      actor.id,
      "render.retry",
      keyHash,
      nowIso(),
    );
    if (existing?.resource_id) {
      if (existing.request_hash !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was reused with another job",
          409,
        );
      return {
        id: existing.resource_id,
        retryOfJobId: sourceJobId,
        reused: true,
      };
    }
    const source = this.deps.database.jobs.findRetrySource(sourceJobId);
    if (source === undefined)
      throw new AppError(
        "JOB_NOT_RETRYABLE",
        "Job does not exist or is not retryable",
        409,
      );
    const fs = await statfs(this.deps.storageRoot);
    if (fs.bavail * fs.bsize < this.deps.minFreeStorageBytes)
      throw new AppError("STORAGE_PRESSURE", "Insufficient free storage", 503);
    if (source.source_id === null)
      throw new AppError(
        "SOURCE_EXPIRED",
        "The original source is unavailable",
        410,
      );
    const shared = this.deps.database.sources.get(source.source_id);
    if (shared === undefined || shared.status !== "ready")
      throw new AppError(
        "SOURCE_EXPIRED",
        "The original source is unavailable",
        410,
      );
    const id = newId("job");
    try {
      const timestamp = nowIso();
      this.deps.database.transaction(() => {
        this.assertAccepting(source.user_id, source.service_account_id, 0);
        this.deps.database.jobs.insertRetry({
          id,
          source,
          rendererVersion: this.deps.rendererVersion,
          timestamp,
        });
        this.deps.database.security.insertIdempotency({
          actorType: actor.type,
          actorId: actor.id,
          operation: "render.retry",
          keyHash,
          requestHash,
          resourceId: id,
          responseCode: 202,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: actor.type,
          actorId: actor.id,
          action: "render.retried",
          targetType: "job",
          targetId: id,
          result: "success",
          metadata: { retryOfJobId: sourceJobId },
        });
      });
      return { id, retryOfJobId: sourceJobId, reused: false };
    } catch (error) {
      const raced = this.deps.database.security.idempotency(
        actor.type,
        actor.id,
        "render.retry",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          id: raced.resource_id,
          retryOfJobId: sourceJobId,
          reused: true,
        };
      throw error;
    }
  }

  private assertAccepting(
    userId: string,
    serviceAccountId: string,
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
      this.deps.database.jobs.countActiveForServiceAccount(serviceAccountId) >=
      5
    )
      throw new AppError(
        "ACCOUNT_QUEUE_LIMIT",
        "Service account pending job limit reached",
        429,
      );
    const maxStorage = this.deps.database.settings.value(
        "max_user_storage_bytes",
        this.deps.maxUserStorageBytes,
      ),
      usedStorage = this.deps.database.jobs.storageUsageForUser(userId);
    if (requestedBytes > maxStorage - usedStorage)
      throw new AppError(
        "USER_STORAGE_QUOTA",
        "User storage quota is exhausted",
        429,
      );
  }

  private assertStorage(userId: string, requestedBytes: number): void {
    const maxStorage = this.deps.database.settings.value(
        "max_user_storage_bytes",
        this.deps.maxUserStorageBytes,
      ),
      usedStorage = this.deps.database.jobs.storageUsageForUser(userId);
    if (requestedBytes > maxStorage - usedStorage)
      throw new AppError(
        "USER_STORAGE_QUOTA",
        "User storage quota is exhausted",
        429,
      );
  }

  private renderTicketConfig() {
    const config = this.deps.renderTickets;
    if (config === undefined)
      throw new AppError(
        "RENDER_TICKETS_UNAVAILABLE",
        "Web render ticket service is unavailable",
        503,
      );
    return config;
  }
  private uploadUrl(jobId: string): string {
    return new URL(
      `/api/v1/jobs/${jobId}/source`,
      this.renderTicketConfig().rendererPublicUrl,
    ).toString();
  }
  private sourceUploadUrl(sourceId: string): string {
    return new URL(
      `/api/v1/sources/${sourceId}/content`,
      this.renderTicketConfig().rendererPublicUrl,
    ).toString();
  }
  private async issueExistingSource(
    identity: {
      user_id: string;
      service_account_id: string;
      api_key_id: string;
      user_security_version: number;
      service_account_security_version: number;
    },
    sourceId: string,
  ) {
    const source = this.deps.database.sources.getOwned(
      sourceId,
      identity.user_id,
    );
    if (source === undefined)
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    if (source.status === "ready")
      return { sourceId, uploadRequired: false, expiresAt: source.expires_at };
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    let nonce = this.deps.database.security.latestUsableSourceNonce(
      sourceId,
      nowIso(),
    );
    if (nonce === undefined) {
      nonce = randomBytes(24).toString("base64url");
      this.deps.database.transaction(() =>
        this.deps.database.security.insertSourceNonce(
          nonce as string,
          sourceId,
          expiresAt,
        ),
      );
    }
    const uploadTicket =
      await this.renderTicketConfig().tickets.issueSourceUpload({
        sourceId,
        userId: identity.user_id,
        serviceAccountId: identity.service_account_id,
        apiKeyId: identity.api_key_id,
        userSecurityVersion: identity.user_security_version,
        serviceAccountSecurityVersion:
          identity.service_account_security_version,
        size: source.size,
        sha256: source.sha256,
        nonce,
      });
    return {
      sourceId,
      uploadRequired: true,
      uploadTicket,
      uploadUrl: this.sourceUploadUrl(sourceId),
      expiresAt,
    };
  }
  private async issueExisting(jobId: string) {
    const row = this.deps.database.jobs.get(jobId);
    if (row === undefined)
      throw new AppError(
        "JOB_NOT_FOUND",
        "Idempotent job no longer exists",
        404,
      );
    const identity = this.deps.database.apiKeys.renderIdentity(
      row.api_key_id,
      nowIso(),
    );
    if (
      identity === undefined ||
      identity.service_account_id !== row.service_account_id ||
      identity.user_id !== row.user_id
    )
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "The render target is no longer available",
        409,
      );
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    let nonce = this.deps.database.security.latestUsableNonce(jobId, nowIso());
    if (nonce === undefined) {
      nonce = randomBytes(24).toString("base64url");
      this.deps.database.transaction(() =>
        this.deps.database.security.insertNonce(
          nonce as string,
          jobId,
          expiresAt,
        ),
      );
    }
    const subject = {
        jobId,
        userId: identity.user_id,
        serviceAccountId: identity.service_account_id,
        apiKeyId: identity.api_key_id,
        userSecurityVersion: identity.user_security_version,
        serviceAccountSecurityVersion:
          identity.service_account_security_version,
      },
      config = this.renderTicketConfig(),
      [uploadTicket, jobTicket] = await Promise.all([
        config.tickets.issueUpload({
          ...subject,
          size: row.source_size,
          sha256: row.source_sha256,
          nonce,
        }),
        config.tickets.issueJob(subject),
      ]);
    return {
      jobId,
      uploadTicket,
      jobTicket,
      uploadUrl: this.uploadUrl(jobId),
      expiresAt,
    };
  }
  private async issueExistingSourceJob(jobId: string) {
    const row = this.deps.database.jobs.get(jobId);
    if (row === undefined)
      throw new AppError(
        "JOB_NOT_FOUND",
        "Idempotent job no longer exists",
        404,
      );
    const identity = this.deps.database.apiKeys.renderIdentity(
      row.api_key_id,
      nowIso(),
    );
    if (
      identity === undefined ||
      identity.user_id !== row.user_id ||
      identity.service_account_id !== row.service_account_id
    )
      throw new AppError(
        "RENDER_TARGET_UNAVAILABLE",
        "The render target is no longer available",
        409,
      );
    return {
      jobId,
      jobTicket: await this.renderTicketConfig().tickets.issueJob({
        jobId,
        userId: identity.user_id,
        serviceAccountId: identity.service_account_id,
        apiKeyId: identity.api_key_id,
        userSecurityVersion: identity.user_security_version,
        serviceAccountSecurityVersion:
          identity.service_account_security_version,
      }),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
  }

  async issueAccessTicket(
    actor: AppActor,
    jobId: string,
  ): Promise<{ jobId: string; jobTicket: string; expiresAt: string }> {
    const row = this.deps.database.jobs.get(jobId);
    if (row === undefined || row.user_id !== actor.userId)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return this.issueAccessTicketForRow(actor, row);
  }

  private async issueAccessTicketForRow(
    actor: AppActor,
    row: JobRow,
  ): Promise<{ jobId: string; jobTicket: string; expiresAt: string }> {
    if (["deleted", "deleting", "expired"].includes(row.status))
      throw new AppError("JOB_UNAVAILABLE", "Job is no longer available", 410);
    if (
      RETAINED.has(row.status) &&
      Date.parse(
        retentionExpiresAt(this.deps, row.completed_at ?? row.updated_at),
      ) <= Date.now()
    )
      throw new AppError(
        "JOB_UNAVAILABLE",
        "Job artifact retention has expired",
        410,
      );
    const identity = this.deps.database.apiKeys.activeIdentity(
      row.api_key_id,
      nowIso(),
    );
    if (
      identity === undefined ||
      identity.user_id !== actor.userId ||
      identity.service_account_id !== row.service_account_id
    )
      throw new AppError(
        "JOB_IDENTITY_REVOKED",
        "Job access is no longer authorized",
        403,
      );
    const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
    const jobTicket = await this.renderTicketConfig().tickets.issueJob({
      jobId: row.id,
      userId: identity.user_id,
      serviceAccountId: identity.service_account_id,
      apiKeyId: identity.api_key_id,
      userSecurityVersion: identity.user_security_version,
      serviceAccountSecurityVersion: identity.service_account_security_version,
    });
    this.deps.database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action: "web.job_ticket.issued",
      targetType: "job",
      targetId: row.id,
      result: "success",
      metadata: { expiresAt },
    });
    return { jobId: row.id, jobTicket, expiresAt };
  }
}
