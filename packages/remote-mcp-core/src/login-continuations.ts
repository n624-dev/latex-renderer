import { randomBytes } from "node:crypto";
import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, sha256Hex } from "@latex-renderer/shared";

export const OAUTH_LOGIN_TTL_MS = 10 * 60_000;
export const OAUTH_LOGIN_MAX_PENDING = 1_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const cookiePrefix = "__Host-latex_renderer_oauth_login_";

export function oauthLoginCookieName(handle: string): string {
  if (!tokenPattern.test(handle)) throw invalidContinuation();
  return cookiePrefix + handle;
}

export function oauthLoginCookie(
  header: string | null,
  handle: string,
): string {
  const name = oauthLoginCookieName(handle);
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="))
    .map((part) => part.slice(name.length + 1));
  const value = values[0];
  if (values.length !== 1 || value === undefined || !tokenPattern.test(value))
    throw invalidContinuation();
  return value;
}

export class RemoteMcpLoginContinuations {
  constructor(
    private readonly database: RendererDatabase,
    private readonly clock: () => number = Date.now,
  ) {}

  create(
    target: string,
    clientId: string,
    cookies: string | null,
  ): { returnTo: string; cookie: string } {
    assertTarget(target, clientId);
    // Independent cookies support parallel tabs, but cannot grow without bound.
    if (
      (cookies ?? "")
        .split(";")
        .filter((part) => part.trim().startsWith(cookiePrefix)).length >= 8
    )
      throw new AppError(
        "OAUTH_LOGIN_CAPACITY",
        "Too many pending OAuth logins; finish or retry later",
        503,
      );
    // These independent 256-bit server-generated secrets are not passwords.
    // SHA-256 is an exact lookup identifier here, not a password KDF. Preserve
    // hashing of the encoded text so live persisted flows remain compatible.
    const handle = randomBytes(32).toString("base64url"),
      binding = randomBytes(32).toString("base64url");
    const now = this.clock();
    this.database.transaction(() => {
      this.database.remoteMcp.cleanupLoginContinuations(
        new Date(now).toISOString(),
      );
      if (
        this.database.remoteMcp.loginContinuationCount() >=
        OAUTH_LOGIN_MAX_PENDING
      )
        throw new AppError(
          "OAUTH_LOGIN_CAPACITY",
          "OAuth login is temporarily unavailable",
          503,
        );
      this.database.remoteMcp.insertLoginContinuation({
        handleHash: sha256Hex(handle),
        browserHash: sha256Hex(binding),
        clientId,
        target,
        expiresAt: new Date(now + OAUTH_LOGIN_TTL_MS).toISOString(),
      });
    });
    return {
      returnTo: `/oauth/continue/${handle}`,
      cookie: `${oauthLoginCookieName(handle)}=${binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    };
  }

  consume(handle: string, binding: string): string {
    if (!tokenPattern.test(handle) || !tokenPattern.test(binding))
      throw invalidContinuation();
    const now = new Date(this.clock()).toISOString();
    const target = this.database.transaction(() => {
      this.database.remoteMcp.cleanupLoginContinuations(now);
      return this.database.remoteMcp.consumeLoginContinuation(
        sha256Hex(handle),
        sha256Hex(binding),
        now,
      );
    });
    if (target === undefined) throw invalidContinuation();
    // Even a corrupt persisted target must never become an external redirect.
    assertTarget(target);
    return target;
  }
}

function assertTarget(target: string, clientId?: string): void {
  const parsed = new URL(target, "https://oauth-return.invalid");
  if (
    Buffer.byteLength(target) > 65_536 ||
    !target.startsWith("/oauth/authorize?") ||
    parsed.origin !== "https://oauth-return.invalid" ||
    parsed.pathname !== "/oauth/authorize" ||
    parsed.hash !== "" ||
    target.includes("\\") ||
    hasControlCharacters(target) ||
    (clientId !== undefined &&
      parsed.searchParams.get("client_id") !== clientId)
  )
    throw invalidContinuation();
}

function invalidContinuation(): AppError {
  return new AppError(
    "INVALID_OAUTH_LOGIN_CONTINUATION",
    "OAuth login expired or belongs to another browser; start again",
    400,
  );
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
