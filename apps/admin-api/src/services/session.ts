import type { AccessIdentity } from "@latex-renderer/auth";
import type { UserRow } from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { AdminDependencies } from "../types.js";

type LinkageState =
  | "identity_incomplete"
  | "not_invited"
  | "disabled"
  | "ineligible"
  | "claimable"
  | "linked"
  | "conflict";

interface RequestMetadata {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export class AdminSessionService {
  constructor(
    private readonly deps: AdminDependencies,
    private readonly administratorOnly = true,
  ) {}

  inspect(identity: AccessIdentity): ReturnType<typeof snapshot> {
    const email = validEmail(identity.email);
    if (email === undefined) return snapshot(identity, "identity_incomplete");
    return this.inspectRows(identity, email);
  }

  claim(
    identity: AccessIdentity,
    metadata: RequestMetadata,
  ): ReturnType<typeof snapshot> & { claimed: boolean } {
    try {
      return this.claimVerified(identity, metadata);
    } catch (error) {
      this.auditClaimFailure(identity, error, metadata);
      throw error;
    }
  }

  private claimVerified(
    identity: AccessIdentity,
    metadata: RequestMetadata,
  ): ReturnType<typeof snapshot> & { claimed: boolean } {
    const email = validEmail(identity.email);
    if (email === undefined)
      throw new AppError(
        "ACCESS_EMAIL_MISSING",
        "Access token email is missing or invalid",
        401,
      );
    if (identity.subject.length > 500)
      throw new AppError(
        "ACCESS_SUBJECT_INVALID",
        "Access token subject is invalid",
        401,
      );

    return this.deps.database.transaction(() => {
      const invited = this.deps.database.users.findByEmail(email);
      const subjectOwner = this.deps.database.users.findByAccessSubject(
        identity.subject,
      );
      assertClaimable(
        invited,
        subjectOwner,
        identity.subject,
        this.administratorOnly,
      );
      if (invited?.access_subject === identity.subject)
        return { ...snapshot(identity, "linked", invited), claimed: false };
      if (invited === undefined)
        throw new AppError(
          this.administratorOnly
            ? "ADMIN_INVITE_REQUIRED"
            : "APP_INVITE_REQUIRED",
          this.administratorOnly
            ? "An administrator invitation is required"
            : "A user invitation is required",
          403,
        );

      const timestamp = nowIso();
      if (
        this.deps.database.users.claimAccessSubject(
          invited.id,
          identity.subject,
          timestamp,
        ) !== 1
      ) {
        throw new AppError(
          "ACCESS_SUBJECT_CONFLICT",
          "Access identity changed while it was being linked",
          409,
        );
      }
      const linked = this.deps.database.users.get(invited.id);
      if (linked === undefined || linked.access_subject !== identity.subject) {
        throw new AppError(
          "ACCESS_SUBJECT_CONFLICT",
          "Access identity link could not be verified",
          409,
        );
      }
      this.deps.database.audit({
        actorType: "access_identity",
        actorId: identity.subject,
        action: "user.access_subject_claimed",
        targetType: "user",
        targetId: linked.id,
        result: "success",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: { accessSubjectGeneration: linked.access_subject_generation },
      });
      return { ...snapshot(identity, "linked", linked), claimed: true };
    });
  }

  private auditClaimFailure(
    identity: AccessIdentity,
    error: unknown,
    metadata: RequestMetadata,
  ): void {
    const email = validEmail(identity.email);
    const target =
      email === undefined
        ? undefined
        : this.deps.database.users.findByEmail(email);
    this.deps.database.audit({
      actorType: "access_identity",
      actorId: identity.subject,
      action: "user.access_subject_claimed",
      targetType: "user",
      targetId: target?.id ?? "unmatched",
      result: "failure",
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: {
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
      },
    });
  }

  private inspectRows(
    identity: AccessIdentity,
    email: string,
  ): ReturnType<typeof snapshot> {
    const invited = this.deps.database.users.findByEmail(email);
    const subjectOwner = this.deps.database.users.findByAccessSubject(
      identity.subject,
    );
    if (invited === undefined)
      return snapshot(
        identity,
        subjectOwner === undefined ? "not_invited" : "conflict",
      );
    if (subjectOwner !== undefined && subjectOwner.id !== invited.id)
      return snapshot(identity, "conflict", invited);
    if (invited.status !== "active")
      return snapshot(identity, "disabled", invited);
    if (
      this.administratorOnly &&
      invited.role !== "owner" &&
      invited.role !== "admin"
    )
      return snapshot(identity, "ineligible", invited);
    if (invited.access_subject === null)
      return snapshot(identity, "claimable", invited);
    return snapshot(
      identity,
      invited.access_subject === identity.subject ? "linked" : "conflict",
      invited,
    );
  }
}

function assertClaimable(
  invited: UserRow | undefined,
  subjectOwner: UserRow | undefined,
  subject: string,
  administratorOnly: boolean,
): void {
  if (invited === undefined) {
    if (subjectOwner !== undefined)
      throw new AppError(
        "ACCESS_SUBJECT_CONFLICT",
        "Access subject belongs to another user",
        409,
      );
    throw new AppError(
      administratorOnly ? "ADMIN_INVITE_REQUIRED" : "APP_INVITE_REQUIRED",
      administratorOnly
        ? "An administrator invitation is required"
        : "A user invitation is required",
      403,
    );
  }
  if (subjectOwner !== undefined && subjectOwner.id !== invited.id) {
    throw new AppError(
      "ACCESS_SUBJECT_CONFLICT",
      "Access subject belongs to another user",
      409,
    );
  }
  if (invited.status !== "active")
    throw new AppError(
      administratorOnly ? "ADMIN_ACCOUNT_DISABLED" : "APP_ACCOUNT_DISABLED",
      administratorOnly
        ? "Administrator account is disabled"
        : "User account is disabled",
      403,
    );
  if (
    administratorOnly &&
    invited.role !== "owner" &&
    invited.role !== "admin"
  ) {
    throw new AppError(
      "ADMIN_ROLE_REQUIRED",
      "An administrator role is required",
      403,
    );
  }
  if (invited.access_subject !== null && invited.access_subject !== subject) {
    throw new AppError(
      "ACCESS_IDENTITY_CHANGED",
      "Administrator is already linked to another Access identity",
      409,
    );
  }
}

function validEmail(email: string | undefined): string | undefined {
  const value = email?.trim();
  return value !== undefined && value.length > 0 && value.length <= 320
    ? value
    : undefined;
}

function snapshot(
  identity: AccessIdentity,
  state: LinkageState,
  user?: UserRow,
): {
  identity: { subject: string; email: string | null };
  linkage: {
    state: LinkageState;
    claimable: boolean;
    user: null | {
      id: string;
      email: string;
      displayName: string;
      role: UserRow["role"];
      status: UserRow["status"];
      linkedAt: string | null;
      generation: number;
    };
  };
} {
  return {
    identity: { subject: identity.subject, email: identity.email ?? null },
    linkage: {
      state,
      claimable: state === "claimable",
      user:
        user === undefined
          ? null
          : {
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              role: user.role,
              status: user.status,
              linkedAt: user.access_subject_linked_at,
              generation: user.access_subject_generation,
            },
    },
  };
}
