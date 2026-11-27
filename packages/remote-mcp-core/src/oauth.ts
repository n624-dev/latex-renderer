import { createHash } from "node:crypto";
import { rendererMcpScopes } from "@latex-renderer/contracts";
import type {
  RemoteMcpAuthorizationCodeRow,
  RemoteMcpTokenRow,
  RendererDatabase,
} from "@latex-renderer/database";
import {
  AppError,
  exactHttpsOrigin,
  newId,
  randomSecret,
  sha256Hex,
} from "@latex-renderer/shared";

export const REMOTE_MCP_SCOPES = ["mcp", ...rendererMcpScopes] as const;
export type RemoteMcpScope = (typeof REMOTE_MCP_SCOPES)[number];

const ACCESS_TOKEN_MS = 10 * 60_000;
const REFRESH_TOKEN_MS = 30 * 86_400_000;
// Rotation replies can be lost or retried concurrently. A short overlap is
// bounded by the ORIGINAL consumption time, never extended by another replay.
const REFRESH_REPLAY_GRACE_MS = 30_000;
const REFRESH_REPLY_LIMIT = 128;
const AUTHORIZATION_CODE_MS = 5 * 60_000;
const OAUTH_CLIENT_LIMIT = 10_000;
// A connection may retain its DCR ID before completing browser consent. Keep
// registrations for 30 days of inactivity, bounded by OAUTH_CLIENT_LIMIT, and
// renew activity only after the complete authorization request is validated.
const UNUSED_OAUTH_CLIENT_MS = 30 * 24 * 60 * 60_000;
export interface RemoteAccess {
  token: string;
  clientId: string;
  grantId: string;
  userId: string;
  scopes: RemoteMcpScope[];
  resource: string;
  expiresAt: string;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state?: string | undefined;
  scopes: RemoteMcpScope[];
  resource: string;
  codeChallenge: string;
}

export interface OAuthDiagnostic {
  outcome:
    | "authorized"
    | "issued"
    | "replayed"
    | "retry_unavailable"
    | "invalid"
    | "binding"
    | "expired"
    | "reuse_revoked"
    | "subject_changed";
  familyId?: string;
  sequence?: number;
}

interface RefreshReply {
  response: OAuthTokenResponse;
  expiresAt: number;
  accessExpiresAt: number;
}

export class RemoteOAuthService {
  // Only short-lived replies, never an indefinite token store. The durable DB
  // still contains hashes only. A restart/eviction fails retryably, not open.
  private readonly refreshReplies = new Map<string, RefreshReply>();
  private refreshReplyTimer: ReturnType<typeof setTimeout> | undefined;
  private activityDeadline = 0;
  idleBlockedUntil(): number {
    return this.refreshReplies.size && this.activityDeadline > this.clock()
      ? this.activityDeadline
      : 0;
  }
  constructor(
    private readonly database: RendererDatabase,
    readonly issuer: string,
    readonly resource: string,
    private readonly clock: () => number = Date.now,
    private readonly diagnostic: (event: OAuthDiagnostic) => void = () => {},
  ) {
    this.issuer = exactHttpsOrigin(issuer);
  }

  registrationMetadata(input: {
    clientName: string;
    redirectUris: readonly string[];
  }): {
    clientName: string;
    redirectUris: readonly string[];
  } {
    if (
      input.clientName.length < 1 ||
      input.clientName.length > 200 ||
      hasControlCharacters(input.clientName)
    )
      throw new AppError(
        "INVALID_CLIENT_METADATA",
        "Client name is invalid",
        400,
      );
    const redirectUris = [...new Set(input.redirectUris)].map(validRedirectUri);
    if (redirectUris.length < 1 || redirectUris.length > 10)
      throw new AppError(
        "INVALID_REDIRECT_URI",
        "Between one and ten redirect URIs are required",
        400,
      );
    return { clientName: input.clientName, redirectUris };
  }

  registerClient(input: {
    clientName: string;
    redirectUris: readonly string[];
  }): {
    clientId: string;
    clientName: string;
    redirectUris: readonly string[];
  } {
    const { redirectUris } = this.registrationMetadata(input);
    const clientId = newId("mcp_client"),
      timestamp = this.now();
    this.database.transaction(() => {
      this.cleanupOAuth(timestamp);
      if (this.database.remoteMcp.countClients() >= OAUTH_CLIENT_LIMIT)
        throw new AppError(
          "OAUTH_REGISTRATION_CAPACITY",
          "OAuth client registration is temporarily unavailable",
          503,
        );
      this.database.remoteMcp.insertClient({
        id: clientId,
        name: input.clientName,
        redirectUris,
        timestamp,
      });
    });
    this.database.audit({
      actorType: "oauth",
      actorId: clientId,
      action: "oauth.client.registered",
      targetType: "oauth_client",
      targetId: clientId,
      result: "success",
      metadata: { redirectUriCount: redirectUris.length },
    });
    return { clientId, clientName: input.clientName, redirectUris };
  }

  validateAuthorizationRequest(
    params: URLSearchParams,
  ): AuthorizationRequest & {
    clientName: string;
  } {
    if (params.get("response_type") !== "code")
      throw new AppError(
        "UNSUPPORTED_RESPONSE_TYPE",
        "Only code is supported",
        400,
      );
    if (params.get("code_challenge_method") !== "S256")
      throw new AppError("INVALID_REQUEST", "PKCE S256 is required", 400);
    const clientId = requiredParam(params, "client_id");
    if (!/^mcp_client_[a-f0-9]{32}$/.test(clientId))
      throw new AppError("INVALID_CLIENT", "OAuth client is unknown", 400);
    const redirectUri = validRedirectUri(requiredParam(params, "redirect_uri")),
      resource = requiredParam(params, "resource"),
      codeChallenge = requiredParam(params, "code_challenge"),
      client = this.database.remoteMcp.client(clientId),
      state = optionalState(params.get("state"));
    if (client === undefined)
      throw new AppError("INVALID_CLIENT", "OAuth client is unknown", 400);
    const registered = parseStringArray(client.redirect_uris_json);
    if (!registered.includes(redirectUri))
      throw new AppError(
        "INVALID_REDIRECT_URI",
        "Redirect URI is not registered",
        400,
      );
    if (resource !== this.resource)
      throw new AppError("INVALID_TARGET", "OAuth resource is invalid", 400);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))
      throw new AppError("INVALID_REQUEST", "PKCE challenge is invalid", 400);
    const scopes = normalizeScopes(params.get("scope"));
    this.database.remoteMcp.touchClient(clientId, this.now());
    return {
      clientId,
      clientName: client.client_name,
      redirectUri,
      ...(state === undefined ? {} : { state }),
      scopes,
      resource,
      codeChallenge,
    };
  }

  authorize(userId: string, input: AuthorizationRequest): URL {
    const user = this.database.users.get(userId);
    if (user === undefined || user.status !== "active")
      throw new AppError(
        "OAUTH_USER_INACTIVE",
        "User is not eligible for Remote MCP",
        403,
      );
    const code = `mcp_code_${randomSecret(32)}`,
      timestamp = this.now();
    this.database.remoteMcp.insertAuthorizationCode({
      codeHash: sha256Hex(code),
      clientId: input.clientId,
      userId,
      userSecurityVersion: user.security_version,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      resource: input.resource,
      codeChallenge: input.codeChallenge,
      timestamp,
      expiresAt: this.after(AUTHORIZATION_CODE_MS),
    });
    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set("code", code);
    if (input.state !== undefined)
      redirect.searchParams.set("state", input.state);
    this.database.audit({
      actorType: "user",
      actorId: userId,
      action: "oauth.authorization.approved",
      targetType: "oauth_client",
      targetId: input.clientId,
      result: "success",
      metadata: { scopes: input.scopes, resource: input.resource },
    });
    return redirect;
  }

  exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
  }): OAuthTokenResponse {
    const timestamp = this.now();
    this.cleanupOAuth(timestamp);
    const codeHash = sha256Hex(input.code),
      code = this.database.remoteMcp.authorizationCode(codeHash);
    this.validateCode(code, input, timestamp);
    const familyId = newId("oauth_family"),
      scopes = normalizeStoredScopes(code.scopes_json);
    const response = this.database.transaction(() => {
      // Re-read the user while holding BEGIN IMMEDIATE so a security-version
      // bump cannot race the code consumption and token-family creation.
      const user = this.database.users.get(code.user_id);
      if (
        user === undefined ||
        user.status !== "active" ||
        user.security_version !== code.user_security_version
      )
        throw new AppError("INVALID_GRANT", "User authorization changed", 400);
      if (
        this.database.remoteMcp.consumeAuthorizationCode(
          codeHash,
          timestamp,
        ) !== 1
      )
        throw new AppError(
          "INVALID_GRANT",
          "Authorization code is no longer valid",
          400,
        );
      this.database.remoteMcp.insertTokenFamily({
        id: familyId,
        clientId: code.client_id,
        userId: code.user_id,
        userSecurityVersion: user.security_version,
        scopes,
        resource: code.resource,
        timestamp,
        expiresAt: this.after(REFRESH_TOKEN_MS),
      });
      const tokens = this.issueTokens(familyId, scopes, 0, timestamp);
      // Client activity is part of the grant commit. A failure here rolls
      // back the consumed code and both newly issued token rows.
      this.database.remoteMcp.touchClient(code.client_id, timestamp);
      return tokens;
    });
    this.reportOAuth({ outcome: "authorized", familyId, sequence: 0 });
    return response;
  }

  refresh(input: {
    refreshToken: string;
    clientId: string;
    resource: string;
  }): OAuthTokenResponse {
    const timestamp = this.now();
    for (const [family, reply] of this.refreshReplies)
      if (reply.expiresAt <= this.clock()) this.refreshReplies.delete(family);
    this.cleanupOAuth(timestamp);
    const tokenHash = sha256Hex(input.refreshToken);
    const observed: { token?: RemoteMcpTokenRow } = {};
    const result = this.database.transaction(() => {
      // Re-read while holding BEGIN IMMEDIATE. A caller that fetched the old
      // row before another rotation must observe the committed CAS result.
      const token = this.database.remoteMcp.token(tokenHash);
      if (token !== undefined) observed.token = token;
      if (token === undefined || token.token_type !== "refresh")
        return {
          kind: "invalid",
          outcome: "invalid",
          message: "Refresh token is invalid",
        } as const;
      // Check binding before reuse handling so an unrelated caller cannot
      // revoke a grant merely by presenting a token hash.
      if (
        token.client_id !== input.clientId ||
        token.resource !== input.resource
      )
        return {
          kind: "invalid",
          outcome: "binding",
          message: "Refresh token binding is invalid",
        } as const;
      if (!this.isActiveToken(token, timestamp))
        return {
          kind: "invalid",
          outcome: "expired",
          message: "Refresh token is expired or revoked",
        } as const;
      const user = this.database.users.get(token.user_id);
      if (
        user === undefined ||
        user.status !== "active" ||
        user.security_version !== token.user_security_version
      ) {
        this.database.remoteMcp.revokeFamily(token.family_id, timestamp);
        return {
          kind: "invalid",
          outcome: "subject_changed",
          message: "User authorization changed",
        } as const;
      }
      if (token.used_at !== null) {
        if (withinRefreshReplayGrace(token.used_at, timestamp)) {
          const reply = this.refreshReplies.get(token.family_id);
          const successor =
            reply === undefined
              ? undefined
              : this.database.remoteMcp.token(
                  sha256Hex(reply.response.refresh_token),
                );
          if (
            reply !== undefined &&
            reply.expiresAt > this.clock() &&
            reply.accessExpiresAt > this.clock() &&
            successor !== undefined &&
            successor.family_id === token.family_id &&
            successor.used_at === null &&
            this.isActiveToken(successor, timestamp)
          )
            return {
              kind: "replayed",
              response: {
                ...reply.response,
                expires_in: Math.max(
                  1,
                  Math.floor((reply.accessExpiresAt - this.clock()) / 1000),
                ),
              },
              familyId: token.family_id,
              sequence: token.sequence,
            } as const;
          return {
            kind: "retry",
            message:
              "Refresh result is temporarily unavailable; retry with the latest saved token",
            familyId: token.family_id,
            sequence: token.sequence,
          } as const;
        }
        this.database.remoteMcp.revokeFamily(token.family_id, timestamp);
        this.refreshReplies.delete(token.family_id);
        return {
          kind: "invalid",
          outcome: "reuse_revoked",
          message: "Refresh token reuse revoked the grant",
        } as const;
      }
      if (this.database.remoteMcp.consumeRefresh(tokenHash, timestamp) !== 1)
        return {
          kind: "retry",
          familyId: token.family_id,
          sequence: token.sequence,
          message: "Refresh token is already being retried",
        } as const;
      return {
        kind: "issued",
        familyId: token.family_id,
        sequence: token.sequence + 1,
        response: this.issueTokens(
          token.family_id,
          normalizeStoredScopes(token.scopes_json),
          token.sequence + 1,
          timestamp,
        ),
      } as const;
    });
    if (result.kind === "invalid") {
      this.reportOAuth({
        outcome: result.outcome,
        ...(observed.token === undefined
          ? {}
          : {
              familyId: observed.token.family_id,
              sequence: observed.token.sequence,
            }),
      });
      throw new AppError("INVALID_GRANT", result.message, 400);
    }
    if (result.kind === "retry") {
      this.reportOAuth({
        outcome: "retry_unavailable",
        familyId: result.familyId,
        sequence: result.sequence,
      });
      throw new AppError("OAUTH_REFRESH_RETRY", result.message, 503, {
        retryAfterSeconds: 1,
      });
    }
    if (result.kind === "issued") {
      this.refreshReplies.delete(result.familyId);
      while (this.refreshReplies.size >= REFRESH_REPLY_LIMIT)
        this.refreshReplies.delete(
          this.refreshReplies.keys().next().value as string,
        );
      const reply = {
        response: { ...result.response },
        expiresAt: this.clock() + REFRESH_REPLAY_GRACE_MS,
        accessExpiresAt: Date.parse(timestamp) + ACCESS_TOKEN_MS,
      };
      this.refreshReplies.set(result.familyId, reply);
      this.activityDeadline = Math.max(this.activityDeadline, reply.expiresAt);
      this.scheduleReplyExpiry();
    }
    this.reportOAuth({
      outcome: result.kind,
      familyId: result.familyId,
      sequence: result.sequence,
    });
    return result.response;
  }

  private reportOAuth(event: OAuthDiagnostic): void {
    try {
      this.diagnostic(event);
    } catch {
      /* Diagnostics cannot change a grant. */
    }
  }

  private scheduleReplyExpiry(): void {
    if (this.refreshReplyTimer !== undefined || this.refreshReplies.size === 0)
      return;
    const next = Math.min(
      ...[...this.refreshReplies.values()].map((reply) => reply.expiresAt),
    );
    this.refreshReplyTimer = setTimeout(
      () => {
        this.refreshReplyTimer = undefined;
        for (const [family, reply] of this.refreshReplies)
          if (reply.expiresAt <= this.clock())
            this.refreshReplies.delete(family);
        this.scheduleReplyExpiry();
      },
      Math.max(1, next - this.clock()),
    );
    this.refreshReplyTimer.unref();
  }

  verifyAccessToken(value: string): RemoteAccess {
    if (!/^mcp_at_[A-Za-z0-9_-]{43}$/.test(value))
      throw new AppError("INVALID_TOKEN", "Access token is invalid", 401);
    const timestamp = this.now(),
      row = this.database.remoteMcp.token(sha256Hex(value));
    if (
      row === undefined ||
      row.token_type !== "access" ||
      !this.isActiveToken(row, timestamp) ||
      row.resource !== this.resource
    )
      throw new AppError("INVALID_TOKEN", "Access token is invalid", 401);
    const user = this.database.users.get(row.user_id);
    if (
      user === undefined ||
      user.status !== "active" ||
      user.security_version !== row.user_security_version
    )
      throw new AppError(
        "INVALID_TOKEN",
        "Access token subject is inactive",
        401,
      );
    return {
      token: value,
      clientId: row.client_id,
      grantId: row.family_id,
      userId: row.user_id,
      scopes: normalizeStoredScopes(row.scopes_json),
      resource: row.resource,
      expiresAt: row.expires_at,
    };
  }

  revokeAccessGrant(value: string): void {
    const access = this.verifyAccessToken(value);
    this.database.remoteMcp.revokeFamily(access.grantId, this.now());
    this.refreshReplies.delete(access.grantId);
  }

  private validateCode(
    code: RemoteMcpAuthorizationCodeRow | undefined,
    input: {
      clientId: string;
      redirectUri: string;
      codeVerifier: string;
      resource: string;
    },
    timestamp: string,
  ): asserts code is RemoteMcpAuthorizationCodeRow {
    const actualChallenge = createHash("sha256")
      .update(input.codeVerifier)
      .digest("base64url");
    if (
      code === undefined ||
      code.used_at !== null ||
      code.expires_at <= timestamp ||
      code.client_id !== input.clientId ||
      code.redirect_uri !== validRedirectUri(input.redirectUri) ||
      code.resource !== input.resource ||
      code.code_challenge !== actualChallenge
    )
      throw new AppError("INVALID_GRANT", "Authorization code is invalid", 400);
  }

  private issueTokens(
    familyId: string,
    scopes: RemoteMcpScope[],
    sequence: number,
    timestamp: string,
  ): OAuthTokenResponse {
    const accessToken = `mcp_at_${randomSecret(32)}`,
      refreshToken = `mcp_rt_${randomSecret(32)}`,
      accessExpiresAt = this.after(ACCESS_TOKEN_MS),
      refreshExpiresAt = this.after(REFRESH_TOKEN_MS);
    this.database.remoteMcp.insertToken({
      tokenHash: sha256Hex(accessToken),
      familyId,
      type: "access",
      sequence,
      timestamp,
      expiresAt: accessExpiresAt,
    });
    this.database.remoteMcp.insertToken({
      tokenHash: sha256Hex(refreshToken),
      familyId,
      type: "refresh",
      sequence,
      timestamp,
      expiresAt: refreshExpiresAt,
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_MS / 1000,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  private isActiveToken(row: RemoteMcpTokenRow, timestamp: string): boolean {
    return (
      row.revoked_at === null &&
      row.family_revoked_at === null &&
      row.expires_at > timestamp &&
      row.family_expires_at > timestamp
    );
  }

  private now(): string {
    return new Date(this.clock()).toISOString();
  }
  private after(milliseconds: number): string {
    return new Date(this.clock() + milliseconds).toISOString();
  }

  private cleanupOAuth(timestamp: string): void {
    const now = Date.parse(timestamp);
    this.database.remoteMcp.cleanup({
      now: timestamp,
      rateLimitBefore: new Date(now - 24 * 60 * 60_000).toISOString(),
      unusedClientBefore: new Date(now - UNUSED_OAUTH_CLIENT_MS).toISOString(),
    });
  }
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface RemoteMcpIdentity {
  userId: string;
  scopes: readonly RemoteMcpScope[];
  resource?: string;
}

function withinRefreshReplayGrace(usedAt: string, timestamp: string): boolean {
  const used = Date.parse(usedAt),
    now = Date.parse(timestamp);
  return (
    Number.isFinite(used) &&
    Number.isFinite(now) &&
    now >= used &&
    now - used < REFRESH_REPLAY_GRACE_MS
  );
}

export function requireScope(
  scopes: readonly RemoteMcpScope[],
  required: RemoteMcpScope,
): void {
  if (!scopes.includes("mcp") && !scopes.includes(required))
    throw new AppError(
      "INSUFFICIENT_SCOPE",
      `Scope ${required} is required`,
      403,
    );
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (
    value === null ||
    value.length === 0 ||
    value.length > 4096 ||
    hasControlCharacters(value)
  )
    throw new AppError("INVALID_REQUEST", `${name} is required`, 400);
  return value;
}

function validRedirectUri(value: string): string {
  if (value.length > 2048 || hasControlCharacters(value))
    throw new AppError("INVALID_REDIRECT_URI", "Redirect URI is invalid", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_REDIRECT_URI", "Redirect URI is invalid", 400);
  }
  const local =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]");
  if (
    (url.protocol !== "https:" && !local) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    throw new AppError(
      "INVALID_REDIRECT_URI",
      "Redirect URI must use HTTPS or localhost",
      400,
    );
  return url.toString();
}

function normalizeScopes(value: string | null): RemoteMcpScope[] {
  if (value !== null && (value.length > 500 || hasControlCharacters(value)))
    throw new AppError(
      "INVALID_SCOPE",
      "Requested OAuth scope is invalid",
      400,
    );
  const requested =
    value === null || value.trim() === "" ? ["mcp"] : value.trim().split(/\s+/);
  if (
    !requested.every((scope): scope is RemoteMcpScope =>
      REMOTE_MCP_SCOPES.includes(scope as RemoteMcpScope),
    )
  )
    throw new AppError(
      "INVALID_SCOPE",
      "Requested OAuth scope is not supported",
      400,
    );
  return [...new Set(requested)];
}

function optionalState(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (value.length > 2048 || hasControlCharacters(value))
    throw new AppError("INVALID_REQUEST", "state is invalid", 400);
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeStoredScopes(value: string): RemoteMcpScope[] {
  const parsed = parseStringArray(value);
  if (
    !parsed.every((scope): scope is RemoteMcpScope =>
      REMOTE_MCP_SCOPES.includes(scope as RemoteMcpScope),
    )
  )
    throw new AppError("INVALID_SCOPE_DATA", "Stored OAuth scopes are invalid");
  return parsed;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  )
    throw new AppError("INVALID_STORED_DATA", "Stored string array is invalid");
  return parsed;
}
