import { AppError, nowIso } from "@latex-renderer/shared";
import { adminApiScopes, renderApiScopes } from "@latex-renderer/contracts";
import type { AdminActor, AdminDependencies } from "../types.js";

export class AdminApiKeysService {
  constructor(private readonly deps: AdminDependencies) {}

  list(options: {
    cursor?: string | undefined;
    limit?: number | undefined;
    query?: string | undefined;
  } = {}) {
    return this.deps.database.apiKeys.listPage(options);
  }

  get(id: string) {
    const row = this.deps.database.apiKeys.get(id);
    if (row === undefined) throw new AppError("API_KEY_NOT_FOUND", "API key does not exist", 404);
    return row;
  }

  create(
    actor: AdminActor,
    serviceAccountId: string,
    input: { name: string; scopes: string[]; expiresAt?: string | null | undefined },
  ): { id: string; prefix: string; apiKey: string } {
    const kind = keyKind(input.scopes);
    if (kind === "admin" && actor.role !== "owner") {
      throw new AppError("OWNER_REQUIRED", "Only an owner can issue admin keys", 403);
    }
    if (!this.deps.database.serviceAccounts.activeExists(serviceAccountId)) {
      throw new AppError("SERVICE_ACCOUNT_NOT_FOUND", "Active service account does not exist", 404);
    }

    const generated = this.deps.apiKeys.create(kind);
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      this.deps.database.apiKeys.insert({
        id: generated.id,
        serviceAccountId,
        name: input.name,
        prefix: generated.prefix,
        kind: generated.kind,
        secretHash: generated.secretHash,
        pepperId: generated.pepperId,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        createdAt: timestamp,
        createdBy: actor.id,
      });
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "api_key.created",
        targetType: "api_key",
        targetId: generated.id,
        result: "success",
        metadata: { prefix: generated.prefix, scopes: input.scopes },
      });
    });
    return { id: generated.id, prefix: generated.prefix, apiKey: generated.token };
  }

  revoke(actor: AdminActor, id: string): void {
    this.deps.database.transaction(() => {
      const row = this.get(id);
      if (row.revoked_at !== null) {
        throw new AppError("API_KEY_NOT_FOUND", "Active API key does not exist", 404);
      }
      this.deps.database.apiKeys.revoke(id, nowIso());
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: id,
        result: "success",
      });
    });
  }

  rotate(actor: AdminActor, id: string): { id: string; prefix: string; apiKey: string; replaces: string } {
    const old = this.get(id);
    if (old.revoked_at !== null) {
      throw new AppError("API_KEY_NOT_FOUND", "Active API key does not exist", 404);
    }
    const timestamp = nowIso();
    if (old.expires_at !== null && old.expires_at <= timestamp) {
      throw new AppError(
        "API_KEY_EXPIRED",
        "Expired API keys cannot be rotated",
        409,
      );
    }
    const scopes = JSON.parse(old.scopes_json) as unknown;
    if (!Array.isArray(scopes) || !scopes.every((scope): scope is string => typeof scope === "string")) {
      throw new AppError("INVALID_SCOPE_DATA", "Stored API key scopes are invalid");
    }
    const kind = old.kind;
    if (keyKind(scopes) !== kind) {
      throw new AppError(
        "INVALID_API_KEY_STATE",
        "Stored API key kind does not match its scopes",
        500,
      );
    }
    if (kind === "admin" && actor.role !== "owner") {
      throw new AppError("OWNER_REQUIRED", "Only an owner can rotate admin keys", 403);
    }

    const generated = this.deps.apiKeys.create(kind);
    this.deps.database.transaction(() => {
      const fresh = this.get(id);
      if (fresh.revoked_at !== null) {
        throw new AppError("API_KEY_STATE_CONFLICT", "API key changed concurrently", 409);
      }
      if (fresh.expires_at !== null && fresh.expires_at <= timestamp) {
        throw new AppError(
          "API_KEY_EXPIRED",
          "Expired API keys cannot be rotated",
          409,
        );
      }
      this.deps.database.apiKeys.revoke(id, timestamp);
      this.deps.database.apiKeys.insert({
        id: generated.id,
        serviceAccountId: old.service_account_id,
        name: old.name,
        prefix: generated.prefix,
        kind: generated.kind,
        secretHash: generated.secretHash,
        pepperId: generated.pepperId,
        scopes,
        expiresAt: old.expires_at,
        createdAt: timestamp,
        createdBy: actor.id,
      });
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "api_key.rotated",
        targetType: "api_key",
        targetId: generated.id,
        result: "success",
        metadata: { replaces: id, prefix: generated.prefix },
      });
    });
    return { id: generated.id, prefix: generated.prefix, apiKey: generated.token, replaces: id };
  }
}

function keyKind(scopes:readonly string[]):"render"|"admin"{
  if(scopes.length===0)throw new AppError("INVALID_SCOPES","At least one API key scope is required",400);
  if(new Set(scopes).size!==scopes.length)throw new AppError("INVALID_SCOPES","API key scopes must be unique",400);
  if(scopes.every((scope)=>renderApiScopes.includes(scope as typeof renderApiScopes[number])))return"render";
  if(scopes.every((scope)=>adminApiScopes.includes(scope as typeof adminApiScopes[number])))return"admin";
  throw new AppError("INVALID_SCOPES","API key scopes are unknown or mix render and admin permissions",400);
}
