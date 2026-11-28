import { createHash, randomBytes } from "node:crypto";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import {
  ProjectDraftOperations,
  SvgRetryOperations,
  sourceRequestExpiresAt,
  registerReadyRender,
  registerReservedRender,
  registerWholeRenderRetry,
  requireReadyRenderSource,
  assertSourceWritable,
  createSourceReference,
  assertUserStorageQuota,
  type JobRow,
} from "@latex-renderer/database";
import {
  defaultRenderEngine,
  type RenderEngine,
  type RenderOutput,
} from "@latex-renderer/contracts";
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
  async createDraftPreview(
    actor: AppActor,
    projectId: string,
    version: number,
    principal: { api_key_id: string; service_account_id: string },
  ) {
    const drafts = new ProjectDraftOperations(
      this.deps.database,
      this.deps.maxFileCount,
      this.deps.maxZipEntries,
    );
    return Promise.resolve(
      drafts.queuePreview(actor, projectId, version, {
        ...this.deps,
        apiKeyId: principal.api_key_id,
        serviceAccountId: principal.service_account_id,
        runtime: process.env.RENDERER_IMAGE ?? null,
        retentionHours: this.deps.artifactRetentionHours,
      }),
    );
  }
  list(
    filters: {
      status?: string;
      query?: string;
      sourceId?: string;
      cursor?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const page = this.deps.database.jobs.listAdminPage(filters);
    const stages = this.deps.database.outputStages.publicStates(
      page.items.map((job) => job.id),
    );
    return {
      ...page,
      items: page.items.map((job) => ({
        ...job,
        ...(stages.has(job.id) ? { stages: stages.get(job.id) } : {}),
      })),
      total: this.deps.database.jobs.countAdmin(filters),
    };
  }
  get(id: string) {
    const row = this.deps.database.jobs.getVisible(id);
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    const stages = this.deps.database.outputStages.publicState(id);
    const terminalAt = this.deps.database.outputStages.retentionStart(
        id,
        row.completed_at ?? row.updated_at,
      ),
      retention =
        RETAINED.has(row.status) || stages?.pdf.status === "succeeded"
          ? retentionExpiresAt(this.deps, terminalAt)
          : null,
      available =
        retention !== null &&
        Date.parse(retention) > Date.now() &&
        !["expired", "deleting", "deleted"].includes(row.status),
      artifacts = available
        ? this.deps.database.artifacts.listDownloadable(id, {
            retentionHours: this.deps.artifactRetentionHours ?? 24,
          })
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
    const previewDocument = this.deps.database.previews.verifiedPdf(id, {
      retentionHours: this.deps.artifactRetentionHours ?? 24,
    })
      ? this.deps.database.previews.document(id)
      : undefined;
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
      ...this.deps.database.jobs.renderProvenance(row),
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
      ...(stages === undefined ? {} : { stages }),
      artifacts: artifacts
        .filter((artifact) => artifact.type !== "preview")
        .map(item),
      previews: artifacts
        .filter((artifact) => artifact.type === "preview")
        .map(item),
      ...(previewDocument
        ? { preview_page_count: previewDocument.page_count }
        : {}),
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
    const result = createSourceReference(
      this.deps.database,
      identity.user_id,
      input.sourceId,
    );
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
          engine?: RenderEngine | undefined;
          outputs: RenderOutput[];
        }
      | {
          apiKeyId: string;
          sourceId: string;
          entrypoint?: string | undefined;
          engine?: RenderEngine | undefined;
          outputs: RenderOutput[];
          project?:
            | {
                projectId: string;
                displayName: string;
                originalFilename: string;
                outputs: RenderOutput[];
              }
            | {
                projectId: string;
                revisionId: string;
              }
            | undefined;
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
    const { engine: selectedEngine, ...legacy } = input;
    const engine = selectedEngine ?? defaultRenderEngine,
      normalized = input.outputs.includes("svg")
        ? legacy
        : {
            apiKeyId: input.apiKeyId,
            size: input.size,
            sha256: input.sha256,
          },
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            ...normalized,
            ...(engine === defaultRenderEngine ? {} : { engine }),
          }),
        )
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
        registerReservedRender(this.deps.database, this.deps, {
          ...subject,
          id: jobId,
          actor,
          operation: "admin.render.create",
          sourceId,
          sourceSize: input.size,
          sourceSha256: input.sha256,
          outputs: input.outputs,
          engine,
          nonce,
          keyHash,
          requestHash,
          timestamp,
          expiresAt,
          auditMetadata: {
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
    assertSourceWritable(this.deps.database);
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
      try {
        this.deps.database.transaction(() => {
          const timestamp = nowIso();
          assertSourceWritable(this.deps.database);
          if (
            this.deps.database.sources.getOwnedReady(
              ready.id,
              identity.user_id,
              timestamp,
            ) === undefined
          )
            throw new AppError(
              "SOURCE_NOT_READY",
              "Source is no longer available",
              409,
            );
          this.deps.database.security.insertIdempotency({
            actorType: actor.type,
            actorId: actor.id,
            operation: "admin.source.create",
            keyHash,
            requestHash,
            resourceId: ready.id,
            responseCode: 200,
            expiresAt: sourceRequestExpiresAt(timestamp),
            createdAt: timestamp,
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
        assertUserStorageQuota(
          this.deps.database,
          identity.user_id,
          this.deps.maxUserStorageBytes,
          input.size,
        );
        assertSourceWritable(this.deps.database);
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
          expiresAt,
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
      engine?: RenderEngine | undefined;
      outputs: RenderOutput[];
      project?:
        | {
            projectId: string;
            displayName: string;
            originalFilename: string;
            outputs: RenderOutput[];
          }
        | {
            projectId: string;
            revisionId: string;
          }
        | undefined;
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
    const engine = input.engine ?? defaultRenderEngine,
      normalized = input.outputs.includes("svg")
        ? {
            apiKeyId: input.apiKeyId,
            sourceId: input.sourceId,
            entrypoint,
            outputs: input.outputs,
            ...(input.project === undefined ? {} : { project: input.project }),
          }
        : {
            apiKeyId: input.apiKeyId,
            sourceId: input.sourceId,
            entrypoint,
            ...(input.project === undefined ? {} : { project: input.project }),
          },
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            ...normalized,
            ...(engine === defaultRenderEngine ? {} : { engine }),
          }),
        )
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
    requireReadyRenderSource(this.deps.database, {
      sourceId: input.sourceId,
      userId: identity.user_id,
      serviceAccountId: identity.service_account_id,
      entrypoint,
      timestamp: nowIso(),
    });
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
    let createdProjectRevisionId: string | undefined;
    try {
      this.deps.database.transaction(() => {
        createdProjectRevisionId = registerReadyRender(
          this.deps.database,
          this.deps,
          {
            id: jobId,
            userId: identity.user_id,
            serviceAccountId: identity.service_account_id,
            apiKeyId: identity.api_key_id,
            actor,
            action: "render.queued",
            sourceId: input.sourceId,
            entrypoint,
            outputs: input.outputs,
            engine,
            project:
              input.project && "revisionId" in input.project
                ? { ...input.project, touch: true }
                : input.project,
            timestamp,
          },
        );
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
        if (input.project !== undefined && "revisionId" in input.project)
          this.deps.database.audit({
            actorType: actor.type,
            actorId: actor.id,
            action: "project.revision_rendered",
            targetType: "job",
            targetId: jobId,
            result: "success",
            metadata: {
              projectId: input.project.projectId,
              revisionId: input.project.revisionId,
            },
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
        ...(input.project === undefined
          ? {}
          : { projectRevisionId: createdProjectRevisionId }),
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
      this.get(id);
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
      this.get(id);
      if (this.deps.database.jobs.markDeleting(id, nowIso()) !== 1)
        throw new AppError(
          "JOB_STATE_CONFLICT",
          "Job state changed concurrently",
          409,
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
        if (this.deps.database.jobs.getVisible(id) === undefined) continue;
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

  async retrySvg(
    actor: AppActor,
    id: string,
    key: string,
  ): Promise<{ id: string; reused: boolean }> {
    const row = this.deps.database.jobs.getVisible(id);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return Promise.resolve(
      new SvgRetryOperations(this.deps.database, {
        ...this.deps,
        runtimeImage: process.env.RENDERER_IMAGE,
      }).retry(
        { userId: row.user_id, type: actor.type, id: actor.id },
        id,
        key,
      ),
    );
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
      if (
        this.deps.database.jobs.getVisible(existing.resource_id) === undefined
      )
        throw new AppError(
          "IDEMPOTENT_RESOURCE_GONE",
          "The idempotent Retry Job no longer exists",
          410,
        );
      return {
        id: existing.resource_id,
        retryOfJobId: sourceJobId,
        reused: true,
      };
    }
    let id: string;
    try {
      const timestamp = nowIso();
      id = this.deps.database.transaction(() => {
        if (this.deps.database.jobs.getVisible(sourceJobId) === undefined)
          throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
        const id = registerWholeRenderRetry(this.deps.database, this.deps, {
          originalId: sourceJobId,
          timestamp,
          notRetryable: "Job does not exist or is not retryable",
          checkSourceBeforeAdmission: true,
          sourceUnavailable: () =>
            new AppError(
              "SOURCE_EXPIRED",
              "The original source is unavailable",
              410,
            ),
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
        return id;
      });
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
    return Promise.resolve({ id, retryOfJobId: sourceJobId, reused: false });
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
    if (
      source.expires_at <= nowIso() &&
      this.deps.database.sources.getOwnedReady(
        sourceId,
        identity.user_id,
        nowIso(),
      ) === undefined
    )
      throw new AppError(
        "IDEMPOTENT_RESOURCE_GONE",
        "Idempotent Source reservation has expired",
        410,
      );
    if (source.status === "ready")
      return { sourceId, uploadRequired: false, expiresAt: source.expires_at };
    if (source.status !== "reserved")
      throw new AppError(
        "IDEMPOTENCY_IN_PROGRESS",
        "Original Source upload is already in progress",
        409,
      );
    const expiresAt = source.expires_at;
    const nonce = this.deps.database.security.latestUsableSourceNonce(
      sourceId,
      nowIso(),
    );
    if (nonce === undefined)
      throw new AppError(
        "IDEMPOTENT_RESOURCE_GONE",
        "Original Source upload reservation is no longer usable",
        410,
      );
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
    const row = this.deps.database.jobs.getVisible(jobId);
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
    const identity = this.deps.database.apiKeys.renderJobIdentity(
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
    const nonceRecord = this.deps.database.security.latestUsableNonceRecord(
      jobId,
      nowIso(),
    );
    if (nonceRecord === undefined)
      throw new AppError(
        "IDEMPOTENT_RESOURCE_GONE",
        "Original Render upload reservation has expired",
        410,
      );
    const { nonce, expires_at: expiresAt } = nonceRecord;
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
    const row = this.deps.database.jobs.getVisible(jobId);
    if (row === undefined)
      throw new AppError(
        "JOB_NOT_FOUND",
        "Idempotent job no longer exists",
        404,
      );
    const identity = this.deps.database.apiKeys.renderJobIdentity(
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
      ...(row.project_revision_id === null
        ? {}
        : { projectRevisionId: row.project_revision_id }),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
  }

  async issueAccessTicket(
    actor: AppActor,
    jobId: string,
  ): Promise<{ jobId: string; jobTicket: string; expiresAt: string }> {
    const row = this.deps.database.jobs.getVisible(jobId);
    if (row === undefined || row.user_id !== actor.userId)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return this.issueAccessTicketForRow(actor, row);
  }

  async issueAdminAccessTicket(actor: AppActor, jobId: string) {
    const row = this.deps.database.jobs.getVisible(jobId);
    if (row === undefined)
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
    const identity = this.deps.database.apiKeys.activeJobIdentity(
      row.api_key_id,
      nowIso(),
    );
    if (
      identity === undefined ||
      identity.user_id !== row.user_id ||
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
