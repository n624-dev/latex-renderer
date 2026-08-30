import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { AdminActor, AdminDependencies } from "../types.js";

const AUDIT_SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    "[REDACTED_JWT]",
  ],
  [/\b(?:lra|lrk)_[A-Za-z0-9_-]{4,}\b/gi, "[REDACTED_API_TOKEN]"],
  [/\bBearer\s+\S+/gi, "Bearer [REDACTED_TOKEN]"],
  [/\b\d{6,8}\b/g, "[REDACTED_OTP]"],
];

function redactAuditReason(reason: string): string {
  return AUDIT_SECRET_PATTERNS.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    reason,
  );
}

export class UsersService {
  constructor(private readonly deps: AdminDependencies) {}

  list() {
    return this.deps.database.users.list().map((row) => this.snapshot(row));
  }

  get(id: string) {
    const row = this.deps.database.users.get(id);
    if (row === undefined)
      throw new AppError("USER_NOT_FOUND", "User does not exist", 404);
    return this.snapshot(row);
  }

  async create(
    actor: AdminActor,
    input: {
      email?: string | null | undefined;
      displayName: string;
      role: "owner" | "admin" | "user";
      authentication:
        | {
            type: "external";
            subject: string;
            preferredUsername?: string | undefined;
            emailAtProvider?: string | undefined;
          }
        | { type: "password"; loginName: string; password: string };
    },
  ): Promise<string> {
    if (input.role === "owner" && actor.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can create another owner",
        403,
      );
    }
    if (
      (this.deps.browserAuth.mode === "password") !==
      (input.authentication.type === "password")
    )
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "User authentication must match the configured authentication mode",
        409,
      );
    if (input.authentication.type === "password") {
      const existing = this.deps.database.browserAuth.getCredentialByLogin(
        input.authentication.loginName,
      );
      if (existing !== undefined)
        throw new AppError(
          "LOGIN_NAME_CONFLICT",
          "Login name is already assigned",
          409,
        );
    } else if (
      this.deps.browserAuth.externalProvider !== undefined &&
      this.deps.browserAuth.externalIssuer !== undefined &&
      this.deps.database.browserAuth.findIdentity(
        this.deps.browserAuth.externalProvider,
        this.deps.browserAuth.externalIssuer,
        input.authentication.subject,
      ) !== undefined
    ) {
      throw new AppError(
        "IDENTITY_CONFLICT",
        "External identity is already assigned",
        409,
      );
    }
    const passwordHash =
      input.authentication.type === "password"
        ? await this.deps.browserAuth.hashPassword(
            input.authentication.password,
            input.authentication.loginName,
          )
        : undefined;
    const id = newId("user");
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      this.deps.database.users.insertInvitation({
        id,
        email: input.email ?? null,
        displayName: input.displayName,
        role: input.role,
        createdBy: actor.id,
        timestamp,
      });
      if (input.authentication.type === "password") {
        this.deps.database.browserAuth.upsertCredential({
          user_id: id,
          login_name: input.authentication.loginName,
          password_hash: passwordHash ?? "",
          password_updated_at: timestamp,
        });
      } else {
        this.deps.browserAuth.createExternalIdentity({
          userId: id,
          subject: input.authentication.subject,
          preferredUsername: input.authentication.preferredUsername,
          email: input.authentication.emailAtProvider,
          createdAt: timestamp,
        });
      }
      this.deps.database.webPrincipals.ensure(id);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "user.created",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: {
          role: input.role,
          authenticationType: input.authentication.type,
        },
      });
    });
    return id;
  }

  unlinkIdentity(
    actor: AdminActor,
    id: string,
    identityId: string,
    reason: string,
  ): { id: string; identityId: string } {
    if (actor.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can unlink an external identity",
        403,
      );
    }
    if (actor.userId === id)
      throw new AppError(
        "SELF_IDENTITY_UNLINK_REJECTED",
        "Use another owner account to unlink this identity",
        409,
      );
    return this.deps.database.transaction(() => {
      this.get(id);
      const identity = this.deps.database.browserAuth
        .identitiesForUser(id)
        .find((candidate) => candidate.id === identityId);
      if (identity === undefined)
        throw new AppError(
          "IDENTITY_NOT_FOUND",
          "Identity does not exist",
          404,
        );
      const timestamp = nowIso();
      this.deps.database.browserAuth.revokeUserSessions(id, timestamp);
      if (this.deps.database.browserAuth.deleteIdentity(id, identityId) !== 1)
        throw new AppError(
          "IDENTITY_CONFLICT",
          "Identity changed while unlinking",
          409,
        );
      this.deps.database.users.incrementSecurityVersion(id, timestamp);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "user.identity_unlinked",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: {
          reason: redactAuditReason(reason),
          identityId,
          provider: identity.provider,
          issuer: identity.issuer,
        },
      });
      return { id, identityId };
    });
  }

  async resetPassword(
    actor: AdminActor,
    id: string,
    input: { loginName: string; password: string; reason: string },
  ): Promise<{ id: string; loginName: string }> {
    if (actor.role !== "owner")
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can reset passwords",
        403,
      );
    if (this.deps.browserAuth.mode !== "password")
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "Password authentication is not enabled",
        409,
      );
    this.get(id);
    const existing = this.deps.database.browserAuth.getCredentialByLogin(
      input.loginName,
    );
    if (existing !== undefined && existing.user_id !== id)
      throw new AppError(
        "LOGIN_NAME_CONFLICT",
        "Login name is already assigned",
        409,
      );
    const passwordHash = await this.deps.browserAuth.hashPassword(
      input.password,
      input.loginName,
    );
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      this.deps.database.browserAuth.upsertCredential({
        user_id: id,
        login_name: input.loginName,
        password_hash: passwordHash,
        password_updated_at: timestamp,
      });
      this.deps.database.users.incrementSecurityVersion(id, timestamp);
      this.deps.database.browserAuth.revokeUserSessions(id, timestamp);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "user.password_reset",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: { reason: redactAuditReason(input.reason) },
      });
    });
    return { id, loginName: input.loginName };
  }

  changeStatus(
    actor: AdminActor,
    id: string,
    action: "enable" | "disable",
  ): { id: string; status: string } {
    const status = action === "disable" ? "disabled" : "active";
    return this.deps.database.transaction(() => {
      const target = this.get(id);
      if (target.role === "owner" && action === "disable") {
        if (actor.role !== "owner") {
          throw new AppError(
            "OWNER_REQUIRED",
            "Only an owner can disable an owner",
            403,
          );
        }
        if (this.deps.database.users.countActiveOwners() <= 1) {
          throw new AppError(
            "LAST_OWNER",
            "The final active owner cannot be disabled",
            409,
          );
        }
      }
      if (this.deps.database.users.setStatus(id, status, nowIso()) !== 1) {
        throw new AppError("USER_NOT_FOUND", "User does not exist", 404);
      }
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: action === "disable" ? "user.disabled" : "user.enabled",
        targetType: "user",
        targetId: id,
        result: "success",
      });
      return { id, status };
    });
  }

  update(
    actor: AdminActor,
    id: string,
    input: {
      email?: string | null | undefined;
      displayName?: string | undefined;
      role?: "owner" | "admin" | "user" | undefined;
    },
  ): void {
    this.deps.database.transaction(() => {
      const target = this.get(id);
      if (input.role !== undefined && input.role !== target.role) {
        if (actor.role !== "owner") {
          throw new AppError(
            "OWNER_REQUIRED",
            "Only an owner can change roles",
            403,
          );
        }
        if (
          target.role === "owner" &&
          input.role !== "owner" &&
          this.deps.database.users.countActiveOwners() <= 1
        ) {
          throw new AppError(
            "LAST_OWNER",
            "The final active owner cannot be demoted",
            409,
          );
        }
      }
      if (this.deps.database.users.update(id, input, nowIso()) !== 1) {
        throw new AppError("USER_NOT_FOUND", "User does not exist", 404);
      }
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: input.role !== undefined ? "user.role_changed" : "user.updated",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: input,
      });
    });
  }

  private snapshot(
    row: ReturnType<
      AdminDependencies["database"]["users"]["get"]
    > extends infer T
      ? Exclude<T, undefined>
      : never,
  ) {
    const credential = this.deps.database.browserAuth.getCredentialForUser(
      row.id,
    );
    return {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      status: row.status,
      security_version: row.security_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_login_at: row.last_login_at,
      identities: this.deps.database.browserAuth
        .identitiesForUser(row.id)
        .map((identity) => ({
          id: identity.id,
          provider: identity.provider,
          issuer: identity.issuer,
          subject: identity.subject,
          preferred_username: identity.preferred_username,
          email_at_provider: identity.email_at_provider,
          linked_at: identity.linked_at,
          last_seen_at: identity.last_seen_at,
        })),
      credential:
        credential === undefined
          ? null
          : {
              login_name: credential.login_name,
              password_updated_at: credential.password_updated_at,
            },
    };
  }
}
