import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { InternalApiDependencies } from "../types.js";

export class SourceTicketsService {
  constructor(private readonly deps: InternalApiDependencies) {}

  async create(
    actor: AuthenticatedServiceAccount,
    input: { size: number; sha256: string },
    idempotencyKey: string,
  ) {
    const requestHash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      keyHash = createHash("sha256").update(idempotencyKey).digest("hex"),
      now = nowIso();
    const existing = this.deps.database.security.idempotency(
      "service_account",
      actor.serviceAccountId,
      "source.create",
      keyHash,
      now,
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
        value: await this.issueExisting(actor, existing.resource_id),
      };
    }
    const ready = this.deps.database.sources.findReady(
      actor.userId,
      input.sha256,
      input.size,
      now,
    );
    if (ready !== undefined) {
      try {
        this.deps.database.transaction(() =>
          this.deps.database.security.insertIdempotency({
            actorType: "service_account",
            actorId: actor.serviceAccountId,
            operation: "source.create",
            keyHash,
            requestHash,
            resourceId: ready.id,
            responseCode: 200,
            expiresAt: new Date(
              Math.min(Date.now() + 86_400_000, Date.parse(ready.expires_at)),
            ).toISOString(),
            createdAt: now,
          }),
        );
      } catch (caught) {
        const raced = this.deps.database.security.idempotency(
          "service_account",
          actor.serviceAccountId,
          "source.create",
          keyHash,
          nowIso(),
        );
        if (raced?.resource_id && raced.request_hash === requestHash)
          return {
            status: 200 as const,
            value: await this.issueExisting(actor, raced.resource_id),
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
    const sourceId = `source_${randomBytes(16).toString("hex")}`,
      nonce = randomBytes(24).toString("base64url"),
      expiresAt = new Date(Date.now() + 600_000).toISOString(),
      timestamp = nowIso();
    const uploadTicket = await this.deps.tickets.issueSourceUpload({
      ...toSourceSubject(actor, sourceId),
      size: input.size,
      sha256: input.sha256,
      nonce,
    });
    try {
      this.deps.database.transaction(() => {
        this.assertStorage(actor.userId, input.size);
        this.deps.database.sources.insertReserved({
          id: sourceId,
          ownerUserId: actor.userId,
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
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          operation: "source.create",
          keyHash,
          requestHash,
          resourceId: sourceId,
          responseCode: 201,
          expiresAt,
          createdAt: timestamp,
        });
        this.deps.database.audit({
          actorType: "service_account",
          actorId: actor.serviceAccountId,
          action: "source.reserved",
          targetType: "source",
          targetId: sourceId,
          result: "success",
          metadata: { size: input.size, sha256: input.sha256 },
        });
      });
    } catch (caught) {
      const raced = this.deps.database.security.idempotency(
        "service_account",
        actor.serviceAccountId,
        "source.create",
        keyHash,
        nowIso(),
      );
      if (raced?.resource_id && raced.request_hash === requestHash)
        return {
          status: 200 as const,
          value: await this.issueExisting(actor, raced.resource_id),
        };
      throw caught;
    }
    return {
      status: 201 as const,
      value: {
        sourceId,
        uploadRequired: true,
        uploadTicket,
        uploadUrl: this.uploadUrl(sourceId),
        expiresAt,
      },
    };
  }

  private assertStorage(userId: string, size: number): void {
    const max = this.deps.database.settings.value(
        "max_user_storage_bytes",
        this.deps.maxUserStorageBytes,
      ),
      used = this.deps.database.jobs.storageUsageForUser(userId);
    if (size > max - used)
      throw new AppError(
        "USER_STORAGE_QUOTA",
        "User storage quota is exhausted",
        429,
      );
  }
  private async issueExisting(
    actor: AuthenticatedServiceAccount,
    sourceId: string,
  ) {
    const source = this.deps.database.sources.getOwned(sourceId, actor.userId);
    if (source === undefined)
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    if (source.expires_at <= nowIso())
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
    const nonce = this.deps.database.security.latestUsableSourceNonce(
      sourceId,
      nowIso(),
    );
    const expiresAt = source.expires_at;
    if (nonce === undefined)
      throw new AppError(
        "IDEMPOTENT_RESOURCE_GONE",
        "Original Source upload reservation is no longer usable",
        410,
      );
    return {
      sourceId,
      uploadRequired: true,
      uploadTicket: await this.deps.tickets.issueSourceUpload({
        ...toSourceSubject(actor, sourceId),
        size: source.size,
        sha256: source.sha256,
        nonce,
      }),
      uploadUrl: this.uploadUrl(sourceId),
      expiresAt,
    };
  }
  private uploadUrl(sourceId: string): string {
    return new URL(
      `/api/v1/sources/${sourceId}/content`,
      this.deps.rendererPublicUrl,
    ).toString();
  }
}

function toSourceSubject(actor: AuthenticatedServiceAccount, sourceId: string) {
  return {
    sourceId,
    userId: actor.userId,
    serviceAccountId: actor.serviceAccountId,
    apiKeyId: actor.apiKeyId,
    userSecurityVersion: actor.userSecurityVersion,
    serviceAccountSecurityVersion: actor.serviceAccountSecurityVersion,
  };
}
