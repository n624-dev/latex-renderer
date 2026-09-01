import type { Context } from "hono";
import { AppError, parseBearer } from "@latex-renderer/shared";
import { isMutation } from "../middleware/request-policy.js";
import type { AdminActor, AdminDependencies, AppActor } from "../types.js";

export async function requireActor(
  deps: AdminDependencies,
  c: Context,
  scope: string,
): Promise<AdminActor> {
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

  const principal = await deps.browserAuth.authenticate(c.req.raw);
  if (isMutation(c.req.method))
    deps.browserAuth.requireMutationCsrf(c.req.raw, principal);
  const row = principal.user;
  if (
    row.status !== "active" ||
    (row.role !== "owner" && row.role !== "admin")
  ) {
    throw new AppError("ADMIN_FORBIDDEN", "Admin access is not permitted", 403);
  }
  return { type: "user", id: row.id, role: row.role, userId: row.id };
}

export async function requireOwnerActor(
  deps: AdminDependencies,
  c: Context,
  scope: string,
): Promise<AdminActor> {
  const actor = await requireActor(deps, c, scope);
  if (actor.role !== "owner")
    throw new AppError(
      "OWNER_REQUIRED",
      "Only an owner can perform this operation",
      403,
    );
  return actor;
}

export async function requireAppActor(
  deps: AdminDependencies,
  c: Context,
): Promise<AppActor> {
  const principal = await deps.browserAuth.authenticate(c.req.raw);
  if (isMutation(c.req.method))
    deps.browserAuth.requireMutationCsrf(c.req.raw, principal);
  const row = principal.user;
  if (row.status !== "active")
    throw new AppError(
      "APP_FORBIDDEN",
      "Application access is not permitted",
      403,
    );
  return { type: "user", id: row.id, role: row.role, userId: row.id };
}
