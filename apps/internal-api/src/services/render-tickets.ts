import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import {
  defaultRenderEngine,
  type RenderEngine,
  type RenderOutput,
} from "@latex-renderer/contracts";
import { AppError, nowIso } from "@latex-renderer/shared";
import {
  registerReadyRender,
  registerReservedRender,
  requireReadyRenderSource,
  canRenderDraftPreview,
  ProjectDraftOperations,
  SvgRetryOperations,
} from "@latex-renderer/database";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import type { InternalApiDependencies } from "../types.js";

export class RenderTicketsService {
  constructor(private readonly deps: InternalApiDependencies) {}
  async createDraftPreview(
    actor: AuthenticatedServiceAccount,
    projectId: string,
    version: number,
  ) {
    const { database, sourceLimits, storageRoot } = this.deps;
    if (storageRoot === undefined)
      throw new AppError(
        "AUTHORING_UNAVAILABLE",
        "Authoring operations are unavailable",
        503,
      );
    const drafts = new ProjectDraftOperations(
      database,
      sourceLimits?.maxFileCount,
      sourceLimits?.maxZipEntries,
    );
    return Promise.resolve(
      drafts.queuePreview(
        {
          userId: actor.userId,
          type: "service_account",
          id: actor.serviceAccountId,
        },
        projectId,
        version,
        {
          apiKeyId: actor.apiKeyId,
          serviceAccountId: actor.serviceAccountId,
          runtime: process.env.RENDERER_IMAGE ?? null,
          retentionHours: this.deps.artifactRetentionHours,
          ...this.deps,
        },
      ),
    );
  }
  async create(
    actor: AuthenticatedServiceAccount,
    input:
      | { retrySvgJobId: string }
      | {
          size: number;
          sha256: string;
          outputs?: RenderOutput[];
          engine?: RenderEngine | undefined;
        }
      | {
          sourceId: string;
          entrypoint?: string | undefined;
          outputs?: RenderOutput[];
          engine?: RenderEngine | undefined;
          project?: { projectId: string; revisionId: string };
        },
    idempotencyKey: string,
  ) {
    if ("retrySvgJobId" in input) {
      // Reject before retry() can requeue stages or record idempotency.
      this.requireOwnedJob(actor, input.retrySvgJobId);
      const result = new SvgRetryOperations(this.deps.database, {
        ...this.deps,
        runtimeImage: process.env.RENDERER_IMAGE,
      }).retry(
        {
          userId: actor.userId,
          type: "service_account",
          id: actor.serviceAccountId,
          serviceAccountId: actor.serviceAccountId,
        },
        input.retrySvgJobId,
        idempotencyKey,
      );
      return {
        status: result.reused ? (200 as const) : (202 as const),
        value: await this.renew(actor, result.id),
      };
    }
    if ("sourceId" in input)
      return this.createFromSource(actor, input, idempotencyKey);
    return this.createLegacy(actor, input, idempotencyKey);
  }
  private async createLegacy(
    actor: AuthenticatedServiceAccount,
    input: {
      size: number;
      sha256: string;
      outputs?: RenderOutput[];
      engine?: RenderEngine | undefined;
    },
    idempotencyKey: string,
  ) {
    const engine = input.engine ?? defaultRenderEngine,
      outputs: RenderOutput[] = input.outputs ?? ["pdf"],
      normalized = outputs.includes("svg")
        ? { size: input.size, sha256: input.sha256, outputs }
        : { size: input.size, sha256: input.sha256 },
      requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            ...normalized,
            ...(engine === defaultRenderEngine ? {} : { engine }),
          }),
        )
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
        registerReservedRender(this.deps.database, this.deps, {
          ...subject,
          id: jobId,
          actor: { type: "service_account", id: actor.serviceAccountId },
          operation: "render.create",
          sourceId,
          sourceSize: input.size,
          sourceSha256: input.sha256,
          outputs,
          engine,
          nonce,
          keyHash,
          requestHash,
          timestamp,
          expiresAt,
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
      engine?: RenderEngine | undefined;
      project?: { projectId: string; revisionId: string };
    },
    idempotencyKey: string,
  ) {
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      engine = input.engine ?? defaultRenderEngine,
      outputs: RenderOutput[] = input.outputs ?? ["pdf"],
      normalized = outputs.includes("svg")
        ? {
            sourceId: input.sourceId,
            entrypoint,
            outputs,
            project: input.project,
          }
        : { sourceId: input.sourceId, entrypoint, project: input.project };
    const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            ...normalized,
            ...(engine === defaultRenderEngine ? {} : { engine }),
          }),
        )
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
    requireReadyRenderSource(this.deps.database, {
      ...actor,
      sourceId: input.sourceId,
      entrypoint,
      timestamp: nowIso(),
    });
    const jobId = `job_${randomBytes(16).toString("hex")}`,
      timestamp = nowIso(),
      jobTicket = await this.deps.tickets.issueJob(toSubject(actor, jobId));
    try {
      this.deps.database.transaction(() => {
        registerReadyRender(this.deps.database, this.deps, {
          ...toSubject(actor, jobId),
          id: jobId,
          actor: {
            type: "service_account",
            id: actor.serviceAccountId,
            userId: actor.userId,
          },
          action: "render.queued",
          sourceId: input.sourceId,
          entrypoint,
          outputs,
          engine,
          project: input.project,
          timestamp,
        });
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
    this.requireOwnedJob(actor, jobId);
    return {
      jobId,
      jobTicket: await this.deps.tickets.issueJob(toSubject(actor, jobId)),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
  }
  async renewForApiKey(actor: AuthenticatedServiceAccount, jobId: string) {
    if (
      canRenderDraftPreview(actor) &&
      this.deps.database.drafts.isOwnedProjectPreview(jobId, actor.userId)
    ) {
      return {
        jobId,
        jobTicket: await this.deps.tickets.issueDraftPreview(
          toSubject(actor, jobId),
        ),
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      };
    }
    if (
      !actor.scopes.includes("render:read:own") &&
      !actor.scopes.includes("admin:*")
    )
      throw new AppError(
        "INSUFFICIENT_SCOPE",
        "API key lacks the required scope",
        403,
      );
    return this.renew(actor, jobId);
  }
  requireOwnedJob(actor: AuthenticatedServiceAccount, jobId: string) {
    const row = this.deps.database.jobs.getOwned(
      jobId,
      actor.userId,
      actor.serviceAccountId,
    );
    if (
      row === undefined ||
      !this.deps.database.apiKeys.matchesJobOwner(
        row.api_key_id,
        actor.apiKeyId,
      )
    )
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return row;
  }
  private async issueExisting(
    actor: AuthenticatedServiceAccount,
    jobId: string,
  ) {
    const row = this.requireOwnedJob(actor, jobId);
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
    this.requireOwnedJob(actor, jobId);
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
