import type { Context } from "hono";
import type { AccessIdentity } from "@latex-renderer/auth";
import { AppError, parseBearer } from "@latex-renderer/shared";
import { isMutation } from "../middleware/request-policy.js";
import type { AdminActor, AdminDependencies, AppActor } from "../types.js";

export async function requireActor(
  deps: AdminDependencies,
  c: Context,
  scope: string,
): Promise<AdminActor> {
  const identity = await requireAccessIdentity(deps, c);
  const authorization = c.req.header("Authorization");
  if (authorization !== undefined) {
    const key = deps.apiKeys.authenticate(parseBearer(authorization), scope);
    if (key.keyKind !== "admin")
      throw new AppError(
        "ADMIN_KEY_REQUIRED",
        "Admin API key is required",
        403,
      );
    const owner = deps.database.users.get(key.userId);
    if (
      owner === undefined ||
      owner.status !== "active" ||
      (owner.role !== "owner" && owner.role !== "admin")
    ) {
      throw new AppError(
        "ADMIN_FORBIDDEN",
        "Admin key owner no longer has an administrative role",
        403,
      );
    }
    return {
      type: "admin_key",
      id: key.apiKeyId,
      role: owner.role,
      userId: key.userId,
    };
  }

  requireCsrfToken(c);
  const row = deps.database.users.findByAccessSubject(identity.subject);
  if (
    row === undefined ||
    row.status !== "active" ||
    (row.role !== "owner" && row.role !== "admin")
  ) {
    throw new AppError("ADMIN_FORBIDDEN", "Admin access is not permitted", 403);
  }
  return { type: "user", id: row.id, role: row.role, userId: row.id };
}

export async function requireAppActor(
  deps: AdminDependencies,
  c: Context,
): Promise<AppActor> {
  const identity = await requireAccessIdentity(deps, c);
  requireCsrfToken(c);
  const row = deps.database.users.findByAccessSubject(identity.subject);
  if (row === undefined || row.status !== "active")
    throw new AppError(
      "APP_FORBIDDEN",
      "Application access is not permitted",
      403,
    );
  return { type: "user", id: row.id, role: row.role, userId: row.id };
}

export async function requireAccessIdentity(
  deps: AdminDependencies,
  c: Context,
): Promise<AccessIdentity> {
  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (assertion === undefined) {
    throw new AppError(
      "ACCESS_ASSERTION_REQUIRED",
      "Cloudflare Access assertion is required",
      401,
    );
  }
  return deps.access.verify(assertion);
}

export function requireCsrfToken(c: Context): void {
  if (isMutation(c.req.method) && c.req.header("X-CSRF-Token") !== "1") {
    throw new AppError("CSRF_TOKEN_REQUIRED", "CSRF token is required", 403);
  }
}
