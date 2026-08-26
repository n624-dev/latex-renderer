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
    return this.deps.database.users.list();
  }

  get(id: string) {
    const row = this.deps.database.users.get(id);
    if (row === undefined)
      throw new AppError("USER_NOT_FOUND", "User does not exist", 404);
    return row;
  }

  create(
    actor: AdminActor,
    input: {
      email: string;
      displayName: string;
      role: "owner" | "admin" | "user";
    },
  ): string {
    if (input.role === "owner" && actor.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can create another owner",
        403,
      );
    }
    const id = newId("user");
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      if (this.deps.database.users.findByEmail(input.email) !== undefined) {
        throw new AppError(
          "USER_EMAIL_CONFLICT",
          "A user with this email already exists",
          409,
        );
      }
      this.deps.database.users.insertInvitation({
        id,
        ...input,
        createdBy: actor.id,
        timestamp,
      });
      this.deps.database.webPrincipals.ensure(id);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "user.invited",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: { role: input.role, accessSubjectState: "unlinked" },
      });
    });
    return id;
  }

  unlinkAccessSubject(
    actor: AdminActor,
    id: string,
    reason: string,
  ): { id: string; generation: number } {
    if (actor.role !== "owner") {
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can unlink an Access identity",
        403,
      );
    }
    return this.deps.database.transaction(() => {
      const target = this.get(id);
      if (target.access_subject === null) {
        throw new AppError(
          "ACCESS_SUBJECT_NOT_LINKED",
          "User is not linked to an Access identity",
          409,
        );
      }
      const timestamp = nowIso();
      if (this.deps.database.users.unlinkAccessSubject(id, timestamp) !== 1) {
        throw new AppError(
          "ACCESS_SUBJECT_CONFLICT",
          "Access identity changed while it was being unlinked",
          409,
        );
      }
      const generation = target.access_subject_generation + 1;
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "user.access_subject_unlinked",
        targetType: "user",
        targetId: id,
        result: "success",
        metadata: {
          reason: redactAuditReason(reason),
          accessSubjectGeneration: generation,
        },
      });
      return { id, generation };
    });
  }

  changeStatus(
    actor: AdminActor,
    id: string,
    action: "enable" | "disable",
  ): { id: string; status: string } {
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

    const status = action === "disable" ? "disabled" : "active";
    this.deps.database.transaction(() => {
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
    });
    return { id, status };
  }

  update(
    actor: AdminActor,
    id: string,
    input: {
      displayName?: string | undefined;
      role?: "owner" | "admin" | "user" | undefined;
    },
  ): void {
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
    this.deps.database.transaction(() => {
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
}
