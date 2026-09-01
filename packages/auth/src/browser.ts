import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type {
  BrowserAuthMode,
  ExternalIdentityProvider,
  RendererDatabase,
  UserIdentityRow,
  UserRow,
  WebSessionRow,
} from "@latex-renderer/database";
import { AppError, newId } from "@latex-renderer/shared";
import type { AccessJwtVerifier, ExternalIdentity } from "./access.js";
import { OidcClient, safeReturnTo } from "./oidc.js";

export const SESSION_COOKIE = "__Host-latex_renderer_session";
export const CSRF_COOKIE = "__Host-latex_renderer_csrf";
export const OIDC_STATE_COOKIE = "__Host-latex_renderer_oidc_state";
const OIDC_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export type DeploymentMode = "cloudflare" | "standalone";

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const MAXIMUM_LOGIN_ATTEMPT_ROWS = 10_000;
const MAXIMUM_ACTIVE_SESSIONS_PER_USER = 20;
const MAXIMUM_ACTIVE_SESSIONS_GLOBAL = 10_000;
const MAXIMUM_PASSWORD_OPERATIONS = 8;
const DEFAULT_SCRYPT_LOG_N = 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const LOGIN_NAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export interface BrowserPrincipal {
  user: UserRow;
  authMode: BrowserAuthMode;
  identity?: UserIdentityRow | undefined;
  session?: WebSessionRow | undefined;
}

export interface CreatedBrowserSession {
  principal: BrowserPrincipal;
  token: string;
  csrfToken: string;
  cookies: readonly string[];
}

interface SessionAuditContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface BrowserAuthenticationOptions {
  database: RendererDatabase;
  mode: BrowserAuthMode;
  publicOrigin: string;
  access?: AccessJwtVerifier | undefined;
  oidc?: OidcClient | undefined;
  passwordPepper?: Uint8Array | undefined;
  sessionIdleMs?: number | undefined;
  sessionAbsoluteMs?: number | undefined;
  scryptLogN?: number | undefined;
  now?: (() => Date) | undefined;
}

export class BrowserAuthenticationService {
  readonly mode: BrowserAuthMode;
  readonly publicOrigin: string;
  readonly externalProvider?: ExternalIdentityProvider | undefined;
  readonly externalIssuer?: string | undefined;
  private readonly database: RendererDatabase;
  private readonly access?: AccessJwtVerifier | undefined;
  private readonly oidc?: OidcClient | undefined;
  private readonly passwordPepper?: Buffer | undefined;
  private readonly sessionIdleMs: number;
  private readonly sessionAbsoluteMs: number;
  private readonly scryptLogN: number;
  private readonly now: () => Date;
  private readonly dummyPasswordHash?: string | undefined;
  private passwordOperations = 0;

  constructor(options: BrowserAuthenticationOptions) {
    this.database = options.database;
    this.mode = options.mode;
    this.publicOrigin = exactHttpsOrigin(options.publicOrigin);
    this.access = options.access;
    this.oidc = options.oidc;
    this.sessionIdleMs = boundedDuration(
      options.sessionIdleMs ?? DEFAULT_IDLE_MS,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000,
      "session idle duration",
    );
    this.sessionAbsoluteMs = boundedDuration(
      options.sessionAbsoluteMs ?? DEFAULT_ABSOLUTE_MS,
      this.sessionIdleMs,
      7 * 24 * 60 * 60 * 1000,
      "session absolute duration",
    );
    this.scryptLogN = options.scryptLogN ?? DEFAULT_SCRYPT_LOG_N;
    if (this.scryptLogN < 12 || this.scryptLogN > 18)
      throw new Error("scrypt log N must be between 12 and 18");
    this.now = options.now ?? (() => new Date());

    if (this.mode === "cloudflare-access") {
      if (this.access === undefined)
        throw new Error("Cloudflare Access verifier is required");
      this.externalProvider = "cloudflare-access";
      this.externalIssuer = this.access.issuer;
      this.database.transaction(() =>
        this.database.browserAuth.migrateLegacyCloudflareIdentities(
          this.access?.issuer ?? "",
          this.timestamp(),
          (userId) =>
            deterministicLegacyIdentityId(userId, this.access?.issuer ?? ""),
        ),
      );
    } else if (this.mode === "oidc") {
      if (this.oidc === undefined) throw new Error("OIDC client is required");
      this.externalProvider = "oidc";
      this.externalIssuer = this.oidc.issuer;
    } else {
      if (
        options.passwordPepper === undefined ||
        options.passwordPepper.length < 32
      )
        throw new Error("A password pepper of at least 32 bytes is required");
      this.passwordPepper = Buffer.from(options.passwordPepper);
      const salt = createHash("sha256")
        .update("latex-renderer-password-dummy")
        .digest()
        .subarray(0, 16);
      this.dummyPasswordHash = encodePasswordHash(
        this.scryptLogN,
        salt,
        this.derivePasswordSync(
          "invalid-dummy-password",
          salt,
          this.scryptLogN,
        ),
      );
    }
  }

  configuration(): {
    mode: BrowserAuthMode;
    loginPath: string;
    passwordMinimumLength: number | null;
  } {
    return {
      mode: this.mode,
      loginPath: this.mode === "oidc" ? "/auth/oidc/start" : "/login/",
      passwordMinimumLength: this.mode === "password" ? 12 : null,
    };
  }

  async authenticate(request: Request): Promise<BrowserPrincipal> {
    const session = this.authenticateSession(request);
    if (session !== undefined) return session;
    if (this.mode !== "cloudflare-access" || this.access === undefined)
      throw new AppError("LOGIN_REQUIRED", "A browser login is required", 401);
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (assertion === null)
      throw new AppError(
        "ACCESS_ASSERTION_REQUIRED",
        "Cloudflare Access assertion is required",
        401,
      );
    return this.resolveExternal(await this.access.verify(assertion));
  }

  authenticateSession(request: Request): BrowserPrincipal | undefined {
    const token = uniqueCookie(request.headers.get("Cookie"), SESSION_COOKIE);
    if (token === undefined) return undefined;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const row = this.database.browserAuth.getSession(hash(token));
    if (row === undefined) return undefined;
    const timestamp = this.timestamp();
    const user = this.database.users.get(row.user_id);
    if (
      row.revoked_at !== null ||
      row.idle_expires_at <= timestamp ||
      row.absolute_expires_at <= timestamp ||
      user === undefined ||
      user.status !== "active" ||
      user.security_version !== row.user_security_version ||
      row.auth_mode !== this.mode
    ) {
      this.database.browserAuth.revokeSession(row.token_hash, timestamp);
      return undefined;
    }
    const identity =
      row.identity_id === null
        ? undefined
        : this.database.browserAuth
            .identitiesForUser(user.id)
            .find((candidate) => candidate.id === row.identity_id);
    const identityMatchesMode =
      this.mode === "password"
        ? row.identity_id === null
        : identity !== undefined &&
          identity.provider === this.externalProvider &&
          identity.issuer === this.externalIssuer;
    if (!identityMatchesMode) {
      this.database.browserAuth.revokeSession(row.token_hash, timestamp);
      return undefined;
    }
    const nextIdle = new Date(
      Math.min(
        this.now().getTime() + this.sessionIdleMs,
        Date.parse(row.absolute_expires_at),
      ),
    ).toISOString();
    this.database.browserAuth.touchSession(row.token_hash, timestamp, nextIdle);
    return {
      user,
      authMode: row.auth_mode,
      ...(identity ? { identity } : {}),
      session: { ...row, last_seen_at: timestamp, idle_expires_at: nextIdle },
    };
  }

  async establishSession(request: Request): Promise<CreatedBrowserSession> {
    const existing = this.authenticateSession(request);
    if (existing?.session !== undefined) {
      const csrfToken = uniqueCookie(
        request.headers.get("Cookie"),
        CSRF_COOKIE,
      );
      if (
        csrfToken === undefined ||
        !safeHashEqual(existing.session.csrf_hash, hash(csrfToken))
      ) {
        this.database.browserAuth.revokeSession(
          existing.session.token_hash,
          this.timestamp(),
        );
        return this.createSession(
          existing.user,
          existing.authMode,
          existing.identity,
          existing.session.absolute_expires_at,
        );
      }
      return {
        principal: existing,
        token: "",
        csrfToken,
        cookies: [],
      };
    }
    if (this.mode !== "cloudflare-access" || this.access === undefined)
      throw new AppError("LOGIN_REQUIRED", "A browser login is required", 401);
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (assertion === null)
      throw new AppError(
        "ACCESS_ASSERTION_REQUIRED",
        "Cloudflare Access assertion is required",
        401,
      );
    const identity = await this.access.verify(assertion);
    const principal = this.resolveExternal(identity);
    return this.createSession(
      principal.user,
      this.mode,
      principal.identity,
      identity.expiresAt,
      sessionAuditContext(request),
    );
  }

  async loginPassword(input: {
    loginName: string;
    password: string;
    ipAddress: string;
    request: Request;
  }): Promise<CreatedBrowserSession> {
    if (this.mode !== "password" || this.passwordPepper === undefined)
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "Password authentication is not enabled",
        404,
      );
    this.requireExactOrigin(input.request);
    const normalized = normalizeLoginNameSoft(input.loginName);
    const ip = boundedIdentifier(input.ipAddress, "unknown");
    const loginRateKey = this.rateKey(`login:${normalized}`);
    const rateKeys = [
      loginRateKey,
      this.rateKey(`ip:${ip}`),
    ];
    this.assertNotRateLimited(rateKeys);
    const credential = LOGIN_NAME.test(normalized)
      ? this.database.browserAuth.getCredentialByLogin(normalized)
      : undefined;
    const candidateHash =
      credential?.password_hash ?? this.dummyPasswordHash ?? "";
    const valid = await this.verifyPassword(input.password, candidateHash);
    const user =
      credential === undefined
        ? undefined
        : this.database.users.get(credential.user_id);
    if (!valid || user === undefined || user.status !== "active") {
      this.recordLoginFailure(rateKeys);
      this.database.audit({
        actorType: "password",
        actorId: this.rateKey(`audit:${normalized}`).slice(0, 24),
        action: "auth.login",
        targetType: "user",
        targetId: "unmatched",
        result: "failure",
        ipAddress: ip,
        metadata: { code: "INVALID_CREDENTIALS" },
      });
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Login name or password is invalid",
        401,
      );
    }
    this.database.transaction(() => {
      // Keep the address-wide failure history independent from a successful
      // login to one account. Only the account-specific window is reset.
      this.database.browserAuth.clearLoginAttempts([loginRateKey]);
      this.database.users.touchLogin(user.id, this.timestamp());
    });
    this.logout(input.request);
    return this.createSession(
      user,
      "password",
      undefined,
      undefined,
      sessionAuditContext(input.request, ip),
    );
  }

  async hashPassword(password: string, loginName: string): Promise<string> {
    normalizeLoginName(loginName);
    validatePassword(password, loginName);
    const salt = randomBytes(16);
    const derived = await this.withPasswordSlot(() =>
      this.derivePassword(password, salt, this.scryptLogN),
    );
    return encodePasswordHash(this.scryptLogN, salt, derived);
  }

  async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const parsed = parsePasswordHash(encoded);
    if (parsed === undefined || password.length > 1024) return false;
    const actual = await this.withPasswordSlot(() =>
      this.derivePassword(password, parsed.salt, parsed.logN),
    );
    return (
      actual.length === parsed.hash.length &&
      timingSafeEqual(actual, parsed.hash)
    );
  }

  async beginOidc(returnTo?: string, clientAddress = "unavailable") {
    if (this.mode !== "oidc" || this.oidc === undefined)
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "OIDC authentication is not enabled",
        404,
      );
    return this.oidc.begin(
      safeReturnTo(returnTo ?? "/app/"),
      clientAddress,
    );
  }

  async finishOidc(input: {
    code: string;
    state: string;
    stateCookie: string;
    request?: Request | undefined;
  }): Promise<CreatedBrowserSession & { returnTo: string }> {
    if (this.mode !== "oidc" || this.oidc === undefined)
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "OIDC authentication is not enabled",
        404,
      );
    const completed = await this.oidc.callback(input);
    const principal = this.resolveExternal(completed.identity);
    return {
      ...this.createSession(
        principal.user,
        "oidc",
        principal.identity,
        completed.identity.expiresAt,
        sessionAuditContext(input.request),
      ),
      returnTo: completed.returnTo,
    };
  }

  requireMutationCsrf(request: Request, principal: BrowserPrincipal): void {
    if (principal.session === undefined)
      throw new AppError(
        "SESSION_REQUIRED",
        "A browser session is required for this operation",
        401,
      );
    this.requireExactOrigin(request);
    const header = request.headers.get("X-CSRF-Token");
    const cookie = uniqueCookie(request.headers.get("Cookie"), CSRF_COOKIE);
    if (
      header === null ||
      cookie === undefined ||
      !safeEqual(header, cookie) ||
      !safeHashEqual(principal.session.csrf_hash, hash(header))
    )
      throw new AppError("CSRF_TOKEN_REQUIRED", "CSRF token is invalid", 403);
  }

  requireExactOrigin(request: Request): void {
    if (request.headers.get("Origin") !== this.publicOrigin)
      throw new AppError("ORIGIN_REJECTED", "Origin is not allowed", 403);
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite !== null && fetchSite !== "same-origin")
      throw new AppError(
        "CROSS_SITE_REJECTED",
        "Cross-site request is not allowed",
        403,
      );
  }

  logout(request: Request): readonly string[] {
    const token = uniqueCookie(request.headers.get("Cookie"), SESSION_COOKIE);
    if (token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token))
      this.database.browserAuth.revokeSession(hash(token), this.timestamp());
    return clearCookies();
  }

  createExternalIdentity(input: {
    userId: string;
    subject: string;
    email?: string | undefined;
    preferredUsername?: string | undefined;
    createdAt?: string | undefined;
  }): UserIdentityRow {
    if (
      this.externalProvider === undefined ||
      this.externalIssuer === undefined
    )
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "External identities are not enabled",
        409,
      );
    if (
      input.subject.length < 1 ||
      input.subject.length > 500 ||
      hasControlCharacters(input.subject) ||
      (input.preferredUsername !== undefined &&
        (input.preferredUsername.length < 1 ||
          input.preferredUsername.length > 500 ||
          hasControlCharacters(input.preferredUsername))) ||
      (input.email !== undefined &&
        (input.email.length < 1 ||
          input.email.length > 320 ||
          hasControlCharacters(input.email)))
    )
      throw new AppError(
        "IDENTITY_METADATA_INVALID",
        "External identity metadata is invalid",
        400,
      );
    const timestamp = input.createdAt ?? this.timestamp();
    const row: UserIdentityRow = {
      id: newId("identity"),
      user_id: input.userId,
      provider: this.externalProvider,
      issuer: this.externalIssuer,
      subject: input.subject,
      preferred_username: input.preferredUsername ?? null,
      email_at_provider: input.email ?? null,
      linked_at: timestamp,
      last_seen_at: timestamp,
    };
    this.database.browserAuth.insertIdentity(row);
    return row;
  }

  async createPasswordCredential(input: {
    userId: string;
    loginName: string;
    password: string;
    timestamp?: string | undefined;
  }): Promise<void> {
    if (this.mode !== "password")
      throw new AppError(
        "AUTH_MODE_MISMATCH",
        "Password credentials are not enabled",
        409,
      );
    const loginName = normalizeLoginName(input.loginName);
    const passwordHash = await this.hashPassword(input.password, loginName);
    this.database.browserAuth.upsertCredential({
      user_id: input.userId,
      login_name: loginName,
      password_hash: passwordHash,
      password_updated_at: input.timestamp ?? this.timestamp(),
    });
  }

  private createSession(
    user: UserRow,
    mode: BrowserAuthMode,
    identity?: UserIdentityRow,
    capExpiresAt?: string,
    auditLogin?: SessionAuditContext,
  ): CreatedBrowserSession {
    const now = this.now();
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const absoluteMs = Math.min(
      now.getTime() + this.sessionAbsoluteMs,
      capExpiresAt === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(capExpiresAt),
    );
    if (!Number.isFinite(absoluteMs) || absoluteMs <= now.getTime())
      throw new AppError(
        "IDENTITY_EXPIRED",
        "Authenticated identity has expired",
        401,
      );
    const absoluteExpiresAt = new Date(absoluteMs).toISOString();
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + this.sessionIdleMs, absoluteMs),
    ).toISOString();
    const row: WebSessionRow = {
      token_hash: hash(token),
      user_id: user.id,
      auth_mode: mode,
      identity_id: identity?.id ?? null,
      user_security_version: user.security_version,
      csrf_hash: hash(csrfToken),
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      idle_expires_at: idleExpiresAt,
      absolute_expires_at: absoluteExpiresAt,
      revoked_at: null,
    };
    this.database.transaction(() => {
      const timestamp = now.toISOString();
      this.database.browserAuth.deleteExpiredSessions(timestamp);
      const activeForUser =
        this.database.browserAuth.activeSessionCountForUser(
          user.id,
          timestamp,
        );
      this.database.browserAuth.revokeOldestActiveSessionsForUser(
        user.id,
        timestamp,
        Math.max(0, activeForUser - MAXIMUM_ACTIVE_SESSIONS_PER_USER + 1),
      );
      const activeGlobally = this.database.browserAuth.activeSessionCount(
        timestamp,
      );
      this.database.browserAuth.revokeOldestActiveSessions(
        timestamp,
        Math.max(0, activeGlobally - MAXIMUM_ACTIVE_SESSIONS_GLOBAL + 1),
      );
      this.database.browserAuth.insertSession(row);
      this.database.users.touchLogin(user.id, timestamp);
      if (auditLogin !== undefined) {
        this.database.audit({
          actorType: "user",
          actorId: user.id,
          action: "auth.login",
          targetType: "user",
          targetId: user.id,
          result: "success",
          ...(auditLogin.ipAddress
            ? { ipAddress: auditLogin.ipAddress }
            : {}),
          ...(auditLogin.userAgent
            ? { userAgent: auditLogin.userAgent }
            : {}),
          metadata: {
            mode,
            ...(identity
              ? {
                  provider: identity.provider,
                  issuer: identity.issuer,
                  identityId: identity.id,
                }
              : {}),
          },
        });
      }
    });
    const maxAge = Math.max(1, Math.floor((absoluteMs - now.getTime()) / 1000));
    return {
      principal: {
        user,
        authMode: mode,
        ...(identity ? { identity } : {}),
        session: row,
      },
      token,
      csrfToken,
      cookies: [
        `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
        `${CSRF_COOKIE}=${csrfToken}; Path=/; Secure; SameSite=Strict; Max-Age=${maxAge}`,
      ],
    };
  }

  private resolveExternal(identity: ExternalIdentity): BrowserPrincipal {
    const linked = this.database.browserAuth.findIdentity(
      identity.provider,
      identity.issuer,
      identity.subject,
    );
    if (linked === undefined)
      throw new AppError(
        "IDENTITY_NOT_PROVISIONED",
        "External identity is not provisioned for this instance",
        403,
      );
    const user = this.database.users.get(linked.user_id);
    if (user === undefined || user.status !== "active")
      throw new AppError("ACCOUNT_DISABLED", "Account is disabled", 403);
    const timestamp = this.timestamp();
    this.database.transaction(() => {
      this.database.browserAuth.touchIdentity(linked.id, {
        preferredUsername: identity.preferredUsername,
        email: identity.email,
        timestamp,
      });
      this.database.users.touchLogin(user.id, timestamp);
    });
    return {
      user,
      authMode: identity.provider,
      identity: {
        ...linked,
        preferred_username: identity.preferredUsername ?? null,
        email_at_provider: identity.email ?? null,
        last_seen_at: timestamp,
      },
    };
  }

  private assertNotRateLimited(keys: readonly string[]): void {
    const timestamp = this.timestamp();
    if (
      keys.some((key) => {
        const attempt = this.database.browserAuth.getLoginAttempt(key);
        return attempt?.blocked_until !== null &&
          attempt?.blocked_until !== undefined
          ? attempt.blocked_until > timestamp
          : false;
      })
    )
      throw new AppError(
        "LOGIN_RATE_LIMITED",
        "Too many login attempts; try again later",
        429,
      );
  }

  private recordLoginFailure(keys: readonly string[]): void {
    const now = this.now();
    const timestamp = now.toISOString();
    this.database.transaction(() => {
      this.database.browserAuth.pruneLoginAttempts(
        new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        Math.max(0, MAXIMUM_LOGIN_ATTEMPT_ROWS - keys.length),
      );
      for (const key of keys) {
        const previous = this.database.browserAuth.getLoginAttempt(key);
        const insideWindow =
          previous !== undefined &&
          Date.parse(previous.window_started_at) + LOGIN_WINDOW_MS >
            now.getTime();
        const failureCount = insideWindow ? previous.failure_count + 1 : 1;
        this.database.browserAuth.putLoginAttempt({
          key_hash: key,
          failure_count: failureCount,
          window_started_at: insideWindow
            ? previous.window_started_at
            : timestamp,
          blocked_until:
            failureCount >= LOGIN_FAILURE_LIMIT
              ? new Date(now.getTime() + LOGIN_BLOCK_MS).toISOString()
              : null,
          updated_at: timestamp,
        });
      }
    });
  }

  private rateKey(value: string): string {
    return createHmac("sha256", this.passwordPepper ?? Buffer.alloc(32))
      .update(value)
      .digest("hex");
  }

  private derivePassword(
    password: string,
    salt: Uint8Array,
    logN: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        this.passwordSalt(salt),
        SCRYPT_KEY_BYTES,
        {
          N: 2 ** logN,
          r: SCRYPT_R,
          p: SCRYPT_P,
          maxmem: SCRYPT_MAX_MEMORY,
        },
        (error, derived) => (error ? reject(error) : resolve(derived)),
      );
    });
  }

  private async withPasswordSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.passwordOperations >= MAXIMUM_PASSWORD_OPERATIONS)
      throw new AppError(
        "PASSWORD_AUTH_BUSY",
        "Password authentication is temporarily busy",
        503,
      );
    this.passwordOperations += 1;
    try {
      return await operation();
    } finally {
      this.passwordOperations -= 1;
    }
  }

  private derivePasswordSync(
    password: string,
    salt: Uint8Array,
    logN: number,
  ): Buffer {
    return scryptSync(password, this.passwordSalt(salt), SCRYPT_KEY_BYTES, {
      N: 2 ** logN,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    });
  }

  private passwordSalt(salt: Uint8Array): Buffer {
    return Buffer.concat([
      Buffer.from(salt),
      this.passwordPepper ?? Buffer.alloc(32),
    ]);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function parseAuthMode(value: string | undefined): BrowserAuthMode {
  if (value === "cloudflare-access" || value === "oidc" || value === "password")
    return value;
  throw new Error("AUTH_MODE must be cloudflare-access, oidc, or password");
}

export function parseDeploymentMode(value: string | undefined): DeploymentMode {
  if (value === "cloudflare" || value === "standalone") return value;
  throw new Error("DEPLOYMENT_MODE must be cloudflare or standalone");
}

export function normalizeLoginName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!LOGIN_NAME.test(normalized))
    throw new AppError(
      "LOGIN_NAME_INVALID",
      "Login name must be 3-64 ASCII letters, numbers, dots, underscores, or hyphens",
      400,
    );
  return normalized;
}

export function validatePassword(password: string, loginName?: string): void {
  if (
    password.length < 12 ||
    password.length > 1024 ||
    Buffer.byteLength(password, "utf8") > 4096 ||
    password.includes("\u0000") ||
    (loginName !== undefined && password.toLowerCase().includes(loginName))
  )
    throw new AppError(
      "PASSWORD_POLICY",
      "Password must be 12-1024 characters and must not contain the login name",
      400,
    );
}

export function appendSetCookies(
  headers: Headers,
  cookies: readonly string[],
): void {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
}

export function clearCookies(): readonly string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`,
  ];
}

export function oidcStateCookieName(state: string): string {
  if (!OIDC_STATE_PATTERN.test(state))
    throw new AppError("OIDC_STATE_INVALID", "OIDC login state is invalid or expired", 401);
  return `${OIDC_STATE_COOKIE}_${state}`;
}

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("PUBLIC_ORIGIN must be an exact HTTPS origin");
  return url.origin;
}

function uniqueCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) values.push(rest.join("="));
  }
  return values.length === 1 && values[0] !== "" ? values[0] : undefined;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function deterministicLegacyIdentityId(userId: string, issuer: string): string {
  return `identity_${createHash("sha256")
    .update(`cloudflare-access\u0000${issuer}\u0000${userId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function normalizeLoginNameSoft(value: string): string {
  return value.trim().toLowerCase().slice(0, 128);
}

function boundedIdentifier(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : fallback;
}

function sessionAuditContext(
  request: Request | undefined,
  ipAddress?: string,
): SessionAuditContext {
  const resolvedIp =
    ipAddress ??
    boundedIdentifier(
      request?.headers.get("CF-Connecting-IP") ??
        request?.headers.get("X-Latex-Renderer-Client-IP") ??
        "",
      "",
    );
  const userAgent = boundedIdentifier(
    request?.headers.get("User-Agent") ?? "",
    "",
  );
  return {
    ...(resolvedIp ? { ipAddress: resolvedIp } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function boundedDuration(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} is invalid`);
  return value;
}

function encodePasswordHash(
  logN: number,
  salt: Uint8Array,
  derived: Uint8Array,
): string {
  return `$scrypt$ln=${logN},r=${SCRYPT_R},p=${SCRYPT_P}$${Buffer.from(salt).toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

function parsePasswordHash(
  value: string,
): { logN: number; salt: Buffer; hash: Buffer } | undefined {
  const match =
    /^\$scrypt\$ln=(1[2-8]),r=8,p=1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(
      value,
    );
  if (match === null) return undefined;
  return {
    logN: Number(match[1]),
    salt: Buffer.from(String(match[2]), "base64url"),
    hash: Buffer.from(String(match[3]), "base64url"),
  };
}
