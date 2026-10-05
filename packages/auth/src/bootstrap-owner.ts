import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import { BrowserAuthenticationService, normalizeLoginName } from "./browser.js";

export type InitialOwnerInput = {
  displayName: string;
  email?: string | undefined;
} & (
  | {
      method: "password";
      loginName: string;
      password: string;
      passwordPepper: Uint8Array;
    }
  | { method: "oidc" | "cloudflare-access"; issuer: string; subject: string }
);

function hasControls(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
function text(value: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maximum ||
    hasControls(value)
  )
    throw new AppError(
      "BOOTSTRAP_VALUE_INVALID",
      "Initial owner metadata is invalid",
      400,
    );
  return value;
}

/** Shared by privileged CUI/Web adapters. Never resets an owner or links by email.
 * Hashing happens outside the transaction; the owner check is repeated under
 * BEGIN IMMEDIATE so concurrent bootstraps cannot create two owners.
 * The caller owns authorization, migration and secret-file access.
 */
export async function bootstrapInitialOwner(
  database: RendererDatabase,
  input: InitialOwnerInput,
  actorId: string,
): Promise<string> {
  const displayName = text(input.displayName, 200);
  const email = input.email === undefined ? null : text(input.email, 320);
  if (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email))
    throw new AppError(
      "BOOTSTRAP_VALUE_INVALID",
      "Initial owner email is invalid",
      400,
    );
  if (!["password", "oidc", "cloudflare-access"].includes(input.method))
    throw new AppError(
      "BOOTSTRAP_OPTIONS_INVALID",
      "Initial owner method is invalid",
      400,
    );
  const requireNoOwner = () => {
    const row = database.raw
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner'")
      .get() as { count: number };
    if (row.count !== 0)
      throw new AppError("OWNER_EXISTS", "An owner already exists", 409);
  };
  // Refuse known initialized databases before expensive password hashing.
  // This is only a fast guard; the transaction below remains authoritative.
  requireNoOwner();
  let loginName: string | undefined, passwordHash: string | undefined;
  let issuer: string | undefined, subject: string | undefined;
  if (input.method === "password") {
    loginName = normalizeLoginName(input.loginName);
    const service = new BrowserAuthenticationService({
      database,
      mode: "password",
      publicOrigin: "https://bootstrap.invalid",
      passwordPepper: input.passwordPepper,
    });
    passwordHash = await service.hashPassword(input.password, loginName);
  } else {
    subject = text(input.subject, 500);
    const url = new URL(text(input.issuer, 2048));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (input.method === "cloudflare-access" && url.pathname !== "/")
    )
      throw new AppError(
        "ISSUER_INVALID",
        "Initial owner issuer must be HTTPS",
        400,
      );
    issuer = input.method === "cloudflare-access" ? url.origin : url.toString();
  }
  return database.transaction(() => {
    requireNoOwner();
    const id = newId("user"),
      timestamp = nowIso();
    database.users.insertInvitation({
      id,
      email,
      displayName,
      role: "owner",
      createdBy: "local-bootstrap",
      timestamp,
    });
    if (input.method === "password") {
      database.browserAuth.upsertCredential({
        user_id: id,
        login_name: loginName ?? "",
        password_hash: passwordHash ?? "",
        password_updated_at: timestamp,
      });
    } else {
      database.browserAuth.insertIdentity({
        id: newId("identity"),
        user_id: id,
        provider: input.method,
        issuer: issuer ?? "",
        subject: subject ?? "",
        preferred_username: null,
        email_at_provider: email,
        linked_at: timestamp,
        last_seen_at: timestamp,
      });
    }
    database.webPrincipals.ensure(id);
    database.audit({
      actorType: "local",
      actorId,
      action: "user.created",
      targetType: "user",
      targetId: id,
      result: "success",
      metadata: { role: "owner", authMode: input.method },
    });
    return id;
  });
}
