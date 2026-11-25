import {
  DocumentRequirementInventory,
  requirementsFingerprint,
  staticEntrypointRequirements,
  type DocumentRequirement,
} from "./document-requirements.js";
import {
  attachmentOrigins,
  downloadAttachment,
} from "./attachment-download.js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { dirname, extname, join } from "node:path";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ArtifactRow,
  JobRow,
  RemoteMcpAuthorizationCodeRow,
  RemoteMcpPrincipalRow,
  RemoteMcpTokenRow,
  RendererDatabase,
  SourceRow,
} from "@latex-renderer/database";
import {
  ProjectOperations,
  ProjectDraftOperations,
  ProjectDocumentState,
  ProjectStorage,
  type ProjectActor,
  SvgRetryOperations,
  artifactStoragePath,
  protectArtifactDownloadLeases,
  ARTIFACT_DOWNLOAD_LEASE_MS,
  artifactRetentionExpiresAt,
  PDF_INSPECTOR_VERSION,
  waitForPreview,
  assertSourceWritable,
} from "@latex-renderer/database";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  exactHttpsOrigin,
  newId,
  nowIso,
  randomSecret,
  sha256Hex,
  type ResourceLimits,
} from "@latex-renderer/shared";
import {
  validateAndExtract,
  extractValidatedSourceFiles,
  readValidatedSourceFile,
  listValidatedSourceFiles,
  validateEntrypointPath,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import {
  defaultRenderEngine,
  diagnosticCoverageSchema,
  documentProbeSchema,
  type DocumentProbe,
  pdfInspectionInputSchema,
  type PdfInspectionInput,
  renderEngineSchema,
  renderOutputsSchema,
  type ProjectDocumentCondition,
  type ProjectReviewCheck,
  type RenderEngine,
  type RenderOutput,
  type RenderReproducibility,
} from "@latex-renderer/contracts";
import yazl from "yazl";
export type { DocumentRequirement } from "./document-requirements.js";
export {
  RemoteMcpLoginContinuations,
  oauthLoginCookie,
  oauthLoginCookieName,
} from "./login-continuations.js";

export const REMOTE_MCP_SCOPES = [
  "mcp",
  "mcp:render",
  "mcp:read",
  "mcp:cancel",
  "mcp:delete",
] as const;
export type RemoteMcpScope = (typeof REMOTE_MCP_SCOPES)[number];

const ACCESS_TOKEN_MS = 10 * 60_000;
const REFRESH_TOKEN_MS = 30 * 86_400_000;
// Rotation replies can be lost or retried concurrently. A short overlap is
// bounded by the ORIGINAL consumption time, never extended by another replay.
const REFRESH_REPLAY_GRACE_MS = 30_000;
const REFRESH_REPLY_LIMIT = 128;
const AUTHORIZATION_CODE_MS = 5 * 60_000;
const SOURCE_REF_MS = 15 * 60_000;
const INLINE_SOURCE_MAX_BYTES = 64 * 1024;
const DIRECT_SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const DIRECT_SOURCE_MAX_FILE_BYTES = 1024 * 1024;
const DIRECT_SOURCE_MAX_FILES = 100;
const SOURCE_UPLOAD_CHUNK_MAX_BYTES = 512 * 1024;
const SOURCE_UPLOAD_MS = 10 * 60_000;
const SOURCE_UPLOAD_LEASE_MS = 60_000;
const SOURCE_RETENTION_MS = 60 * 60_000;
const OAUTH_CLIENT_LIMIT = 10_000;
// A connection may retain its DCR ID before completing browser consent. Keep
// registrations for 30 days of inactivity, bounded by OAUTH_CLIENT_LIMIT, and
// renew activity only after the complete authorization request is validated.
const UNUSED_OAUTH_CLIENT_MS = 30 * 24 * 60 * 60_000;
const ENVIRONMENT_INDEX_TTL_MS = 30_000;
/**
 * MCP Resource responses are encoded as a single blob/text value.  Keep this
 * well below the renderer's output limit so a client cannot turn a large
 * artifact into an unbounded Buffer + base64/string allocation.
 */
export const REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES = 16 * 1024 * 1024;
const REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT = 64 * 1024 * 1024;
const ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;
const ZIP_LIMITS = {
  maxExtractedBytes: DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
  maxFileBytes: DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
  maxEntries: DEFAULT_RESOURCE_LIMITS.maxZipEntries,
  maxFiles: DEFAULT_RESOURCE_LIMITS.maxFileCount,
  maxDepth: 10,
  maxNameLength: 200,
};

export interface RemoteAccess {
  token: string;
  clientId: string;
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
      userId: row.user_id,
      scopes: normalizeStoredScopes(row.scopes_json),
      resource: row.resource,
      expiresAt: row.expires_at,
    };
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

export interface RemoteJobSummary {
  id: string;
  status: JobRow["status"];
  engine: RenderEngine;
  runtimeDigest: string | null;
  previousRuntimeDigest?: string;
  rendererVersion: string;
  sourceId: string | null;
  projectRevisionId: string | null;
  entrypoint: string;
  outputs: Array<"pdf" | "svg">;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retentionExpiresAt: string | null;
  exitCode: number | null;
  retryOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  previewAvailable: boolean;
  previewPages: number[];
  artifacts: Array<{
    type: string;
    filename: string;
    mimeType: string;
    relativePath: string;
    size: number;
    sha256: string;
    pageCount: number | null;
    resourceUri: string;
  }>;
  webResultUrl: string;
  stages?: import("@latex-renderer/contracts").JobStages;
}

export interface RemoteRenderDiagnostic {
  severity: "error" | "warning";
  type: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  logLine?: number;
  messageTruncated?: boolean;
  tool?: string;
}

export interface RemoteRenderDiagnostics {
  jobId: string;
  status: JobRow["status"];
  engine: RenderEngine;
  diagnostics: RemoteRenderDiagnostic[];
  logExcerpt: string;
  rawLogResourceUri: string | null;
  coverage: {
    parser: ReturnType<typeof diagnosticCoverageSchema.parse> | null;
    storedItems: number;
    offset: number;
    nextOffset: number | null;
    storedListOmitted: number;
    logStatus: "absent" | "available" | "unavailable";
    logExcerptTruncated: boolean;
  };
  retryable: boolean;
  stage?: "pdf" | "svg";
}

export interface RemoteArtifactContent {
  jobId: string;
  relativePath: string;
  mimeType: string;
  size: number;
  sha256: string;
  bytes: Buffer;
}

export interface RemoteSourceFileInput {
  path: string;
  text?: string | undefined;
  base64?: string | undefined;
}

export interface RemoteSourceSummary {
  id: string;
  status: SourceRow["status"];
  size: number;
  sha256: string;
  paths: readonly string[];
  createdAt: string;
  expiresAt: string;
  revisionOf: string | null;
}

export interface RemoteSourceUpload {
  uploadId: string;
  sourceId: string;
  expectedBytes: number;
  receivedBytes: number;
  expiresAt: string;
  maxChunkBytes: number;
}

export interface RemoteRendererCapabilities {
  rendererVersion: string;
  texliveVersion: string;
  runtimeDigest: string | null;
  engineVerification: "verified" | "unknown";
  maxInlineArtifactBytes: number;
  engines: readonly RenderEngine[];
  engineOutputs?: ReadonlyArray<{
    engine: RenderEngine;
    pdf: boolean;
    svg: boolean;
    placement: boolean;
  }>;
  shellEscape: false;
  networkAccess: false;
  maxCompileSeconds: number;
  maxPdfPages: number;
  outputs: readonly ["pdf", "svg"];
  sourceLimits: {
    inlineBytes: number;
    directBytes: number;
    directFiles: number;
    directFileBytes: number;
    uploadBytes: number;
    files: number;
    fileBytes: number;
    chunkBytes: number;
  };
}

export interface RemoteEnvironmentSearch {
  query: string;
  matches: string[];
  nextCursor: string | null;
}

type OperationRequest = {
  keyHash: string;
  requestHash: string;
  operation:
    | "remote_mcp.create_render"
    | "remote_mcp.retry_render"
    | "remote_mcp.render_project_revision"
    | "remote_mcp.apply_project_changes"
    | "remote_mcp.import_source_attachment";
};

function operationRequest(
  operation: OperationRequest["operation"],
  key: string | undefined,
  input: object,
): OperationRequest | undefined {
  if (key === undefined) return undefined;
  if (key.length < 16 || key.length > 200)
    throw new AppError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key must contain 16 to 200 characters",
      400,
    );
  return {
    operation,
    keyHash: sha256Hex(key),
    requestHash: sha256Hex(JSON.stringify(input)),
  };
}

type DraftFileChange =
  | { path: string; remove: true }
  | RemoteSourceFileInput
  | {
      path: string;
      patch: {
        expectedSha256: string;
        original: string;
        replacement: string;
        expectedMatches: number;
      };
    };

type RenderInput = {
  entrypoint?: string | undefined;
  outputs?: Array<"pdf" | "svg"> | undefined;
  engine?: RenderEngine | undefined;
  reproducibility?: RenderReproducibility | undefined;
} & (
  | { inlineSource: string }
  | { sourceRef: string }
  | { sourceId: string; project?: { projectId: string; revisionId: string } }
);

export class RemoteRenderService {
  private environmentIndexPromise:
    Promise<{ packages: string[]; fonts: string[] }> | undefined;
  private environmentIndexCache:
    | {
        fingerprint: string;
        expiresAt: number;
        value: { packages: string[]; fonts: string[] };
      }
    | undefined;
  private readonly maxInlineArtifactBytes: number;
  private inlineArtifactBytesInFlight = 0;
  private attachmentImportsInFlight = 0;
  private readonly inlineArtifactWaiters: Array<{
    bytes: number;
    resolve: (release: () => void) => void;
  }> = [];

  constructor(
    private readonly database: RendererDatabase,
    private readonly storageRoot: string,
    private readonly rendererVersion: string,
    private readonly publicOrigin: string,
    private readonly maxQueueLength = 100,
    private readonly maxUserStorageBytes = 1024 * 1024 * 1024,
    private readonly environmentRoot = "/var/lib/latex-renderer/environment",
    private readonly resourceLimits: Readonly<ResourceLimits> = DEFAULT_RESOURCE_LIMITS,
    private readonly maxOutputBytes = 200 * 1024 * 1024,
    private readonly artifactRetentionHours = 24,
  ) {
    this.maxInlineArtifactBytes = Math.min(
      REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES,
      Number.isSafeInteger(maxOutputBytes) && maxOutputBytes > 0
        ? maxOutputBytes
        : REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES,
    );
  }

  get maxInlineResourceBytes(): number {
    return this.maxInlineArtifactBytes;
  }

  get maxSourceUploadBytes(): number {
    return this.resourceLimits.maxUploadBytes;
  }

  createSourceRef(
    userId: string,
    sourceId: string,
  ): {
    sourceRef: string;
    expiresAt: string;
  } {
    assertSourceWritable(this.database);
    const source = this.database.sources.getOwnedReady(
        sourceId,
        userId,
        nowIso(),
      ),
      timestamp = nowIso();
    if (source === undefined)
      throw new AppError("SOURCE_NOT_READY", "Source is not ready", 409);
    const sourceRef = newId("source_ref"),
      expiresAt = new Date(
        this.database.sources.isRetained(source.id)
          ? Date.now() + SOURCE_REF_MS
          : Math.min(Date.now() + SOURCE_REF_MS, Date.parse(source.expires_at)),
      ).toISOString();
    this.database.transaction(() => {
      assertSourceWritable(this.database);
      this.database.remoteMcp.insertSourceRef({
        id: sourceRef,
        source_id: sourceId,
        owner_user_id: userId,
        created_at: timestamp,
        expires_at: expiresAt,
        revoked_at: null,
      });
    });
    this.database.audit({
      actorType: "user",
      actorId: userId,
      action: "source_ref.created",
      targetType: "source",
      targetId: sourceId,
      result: "success",
      metadata: { expiresAt },
    });
    return { sourceRef, expiresAt };
  }

  createSourceReference(
    identity: RemoteMcpIdentity,
    sourceId: string,
  ): { sourceRef: string; expiresAt: string } {
    requireScope(identity.scopes, "mcp:render");
    return this.createSourceRef(identity.userId, sourceId);
  }

  hasAttachmentImport(): boolean {
    return attachmentOrigins(process.env.REMOTE_MCP_FILE_ORIGINS).size > 0;
  }

  async importSourceAttachment(
    identity: RemoteMcpIdentity,
    attachment: { download_url: string; file_id: string },
    idempotencyKey: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const origins = attachmentOrigins(process.env.REMOTE_MCP_FILE_ORIGINS);
    if (origins.size === 0)
      throw new AppError(
        "ATTACHMENT_UNSUPPORTED",
        "Attachment import is not configured for this connection",
        501,
      );
    const request = operationRequest(
      "remote_mcp.import_source_attachment",
      idempotencyKey,
      {
        fileId: attachment.file_id,
        urlHash: sha256Hex(attachment.download_url),
      },
    );
    const replay = this.findOperationRequest(
      identity.userId,
      request,
      nowIso(),
    );
    if (replay)
      return this.summarizeSource(
        this.resolveOwnedSource(identity.userId, replay),
        null,
      );
    assertSourceWritable(this.database);
    if (this.attachmentImportsInFlight >= 2)
      throw new AppError("ATTACHMENT_IMPORT_BUSY", "Attachment import capacity is in use", 503);
    this.attachmentImportsInFlight += 1;
    let root: string | undefined;
    try {
      root = await mkdtemp(join(this.storageRoot, ".remote-attachment-"));
      const archive = join(root, "source.zip");
      try {
        await downloadAttachment(
          attachment.download_url,
          origins,
          archive,
          this.resourceLimits.maxUploadBytes,
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "ATTACHMENT_UNAVAILABLE",
          "Could not retrieve the attachment. Attach it again or upload the ZIP directly.",
          409,
        );
      }
      const validated = await validateAndExtract(
        archive,
        join(root, "inspection"),
        this.zipLimits(),
        "",
      );
      let accepted: string | undefined;
      const source = await this.storeReadySourceArchive(
        identity.userId,
        archive,
        validated.paths,
        (sourceId) => {
          const timestamp = nowIso();
          accepted = this.findOperationRequest(
            identity.userId,
            request,
            timestamp,
          );
          if (accepted !== undefined && accepted !== sourceId)
            throw new AppError(
              "ATTACHMENT_REPLAY",
              "The attachment was already accepted",
              409,
            );
          if (accepted === undefined)
            this.recordOperationRequest(
              identity.userId,
              request,
              sourceId,
              timestamp,
            );
        },
      ).catch((error: unknown) => {
        if (
          error instanceof AppError &&
          error.code === "ATTACHMENT_REPLAY" &&
          accepted !== undefined
        )
          return this.resolveOwnedSource(identity.userId, accepted);
        throw error;
      });
      return this.summarizeSource(source, null);
    } finally {
      try {
        if (root !== undefined) await rm(root, { recursive: true, force: true });
      } finally {
        this.attachmentImportsInFlight -= 1;
      }
    }
  }

  async createSource(
    identity: RemoteMcpIdentity,
    files: readonly RemoteSourceFileInput[],
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const limits = this.directSourceLimits();
    if (files.length < 1 || files.length > limits.files)
      throw new AppError(
        "SOURCE_FILE_COUNT",
        `A direct Source must contain between 1 and ${limits.files} files`,
        400,
      );
    const seen = new Set<string>(),
      prepared: Array<{ path: string; bytes: Buffer }> = [];
    let totalBytes = 0;
    for (const file of files) {
      const path = validateSourceFilePath(file.path),
        duplicateKey = path.normalize("NFC").toLowerCase();
      if (seen.has(duplicateKey))
        throw new AppError(
          "SOURCE_DUPLICATE_PATH",
          "Source contains a duplicate normalized path",
          422,
        );
      seen.add(duplicateKey);
      if ((file.text === undefined) === (file.base64 === undefined))
        throw new AppError(
          "SOURCE_FILE_CONTENT",
          "Each Source file must contain exactly one of text or base64",
          400,
        );
      const bytes =
        file.text === undefined
          ? decodeBase64(file.base64 as string)
          : Buffer.from(file.text, "utf8");
      if (bytes.byteLength > limits.fileBytes)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          `A direct Source file exceeds the ${limits.fileBytes}-byte limit`,
          400,
        );
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.contentBytes)
        throw new AppError(
          "SOURCE_TOTAL_SIZE",
          `Direct Source content exceeds the ${limits.contentBytes}-byte limit`,
          400,
        );
      prepared.push({ path, bytes });
    }
    prepared.sort((left, right) => left.path.localeCompare(right.path));
    assertTexSource(prepared.map((file) => file.path));
    const archive = await zipFiles(prepared);
    const source = await this.validateAndStoreSource(identity.userId, archive);
    return this.summarizeSource(source, null);
  }

  private async validateAndStoreSource(
    userId: string,
    archive: Buffer,
  ): Promise<SourceRow> {
    if (archive.byteLength > this.resourceLimits.maxUploadBytes)
      throw new AppError(
        "SOURCE_ARCHIVE_SIZE",
        "Source archive exceeds the configured upload limit",
        422,
      );
    const archiveRoot = await mkdtemp(
      join(this.storageRoot, ".remote-direct-"),
    );
    try {
      const archivePath = join(archiveRoot, "source.zip");
      await writeFile(archivePath, archive, { flag: "wx", mode: 0o660 });
      const verified = await validateAndExtract(
          archivePath,
          join(archiveRoot, "inspection"),
          this.zipLimits(),
          "",
        ),
        source = await this.storeReadySource(userId, archive, verified.paths);
      return source;
    } finally {
      await rm(archiveRoot, { recursive: true, force: true });
    }
  }

  projectStorageUsage(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectStorage(this.database).usage(
      this.projectActor(identity),
      projectId,
      this.maxUserStorageBytes,
    );
  }

  protectSavedRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    value: boolean,
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectStorage(this.database).protect(
      this.projectActor(identity),
      projectId,
      revisionId,
      value,
    );
  }

  planRevisionCleanup(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionIds: string[],
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectStorage(this.database).cleanupPlan(
      this.projectActor(identity),
      projectId,
      revisionIds,
    );
  }

  applyRevisionCleanup(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionIds: string[],
    planHash: string,
  ) {
    requireScope(identity.scopes, "mcp:delete");
    return new ProjectStorage(this.database).applyCleanup(
      this.projectActor(identity),
      projectId,
      revisionIds,
      planHash,
    );
  }

  projectDocumentState(
    identity: RemoteMcpIdentity,
    projectId: string,
    conditionsVersion?: number,
    history?: { revisionId: string; offset?: number | undefined },
  ) {
    requireScope(identity.scopes, "mcp:read");
    const state = new ProjectDocumentState(this.database);
    const actor = this.projectActor(identity);
    return {
      ...state.get(actor, projectId, conditionsVersion),
      revisionChanges:
        history === undefined
          ? null
          : state.revisionChanges(
              actor,
              projectId,
              history.revisionId,
              history.offset ?? 0,
            ),
    };
  }

  updateProjectDocumentConditions(
    identity: RemoteMcpIdentity,
    projectId: string,
    expectedVersion: number,
    entries: ProjectDocumentCondition[],
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).updateConditions(
      this.projectActor(identity),
      projectId,
      expectedVersion,
      entries,
    );
  }

  adoptProjectRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string | null,
    expectedRevisionId: string | null,
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).adopt(
      this.projectActor(identity),
      projectId,
      revisionId,
      expectedRevisionId,
    );
  }

  recordProjectPdfReview(
    identity: RemoteMcpIdentity,
    projectId: string,
    input: {
      revisionId: string;
      jobId: string;
      pdfSha256: string;
      conditionsVersion: number | null;
      checks: ProjectReviewCheck[];
      guideVersion: string | null;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).recordReview(
      this.projectActor(identity),
      projectId,
      input,
      this.artifactRetentionHours,
    );
  }

  projectPdfReviews(
    identity: RemoteMcpIdentity,
    projectId: string,
    offset?: number,
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectDocumentState(this.database).reviews(
      this.projectActor(identity),
      projectId,
      offset,
    );
  }

  getSharedDraft(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:read");
    return this.draftOperations().get(this.projectActor(identity), projectId);
  }

  async startSharedDraft(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId?: string,
    replaceVersion?: number,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const actor = this.projectActor(identity);
    if (replaceVersion !== undefined) {
      if (revisionId === undefined)
        throw new AppError(
          "DRAFT_SOURCE_REQUIRED",
          "Choose a saved revision to replace the draft",
          400,
        );
      return this.draftOperations().replaceFromRevision(
        actor,
        projectId,
        revisionId,
        replaceVersion,
      );
    }
    return revisionId === undefined
      ? this.openProjectDraft(actor, projectId)
      : this.draftOperations().open(actor, projectId, revisionId, true);
  }

  async getSharedDraftText(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
    path: string,
    offset = 0,
  ) {
    requireScope(identity.scopes, "mcp:read");
    if (sourceFileKind(path) === "binary")
      throw new AppError("SOURCE_FILE_BINARY", "Source file is binary", 422);
    const file = await this.readDraftText(
      this.projectActor(identity),
      projectId,
      version,
      path,
    );
    return {
      projectId,
      path: file.path,
      version,
      sha256: sha256Hex(file.text),
      ...sourceTextPage(file.text, offset),
    };
  }

  async applyProjectChanges(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      version: number;
      idempotencyKey: string;
      files: readonly DraftFileChange[];
      entrypoint?: string | undefined;
      outputs?: readonly RenderOutput[] | undefined;
      engine?: RenderEngine | undefined;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const actor = this.projectActor(identity);
    const drafts = this.draftOperations();
    const draft = drafts.get(actor, input.projectId);
    if (draft === null)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    const request = operationRequest(
      "remote_mcp.apply_project_changes",
      input.idempotencyKey,
      {
        projectId: input.projectId,
        version: input.version,
        entrypoint: input.entrypoint,
        outputs: input.outputs,
        engine: input.engine,
        files: input.files.map((change) =>
          "remove" in change
            ? { path: change.path, remove: true }
            : "patch" in change
              ? { path: change.path, patch: change.patch }
              : { path: change.path, text: change.text, base64: change.base64 },
        ),
      },
    );
    const result = (version: number) => ({
      projectId: input.projectId,
      baseVersion: input.version,
      version,
      changedPaths: input.files.map(({ path }) => path),
    });
    const replay = this.findOperationRequest(actor.userId, request, nowIso());
    if (replay !== undefined) return result(Number(replay));
    if (draft.version !== input.version)
      throw draftVersionConflict(draft.version);
    const limits = this.directSourceLimits();
    const names = new Set<string>(),
      files: { path: string; bytes: Buffer }[] = [];
    let totalBytes = 0;
    for (const change of input.files) {
      const path = validateSourceFilePath(change.path, this.zipLimits());
      if (names.has(path))
        throw new AppError(
          "DRAFT_DUPLICATE_CHANGE",
          "A path was changed more than once",
          422,
        );
      names.add(path);
      if ("remove" in change) continue;
      let bytes: Buffer;
      if ("patch" in change) {
        if (sourceFileKind(path) === "binary")
          throw new AppError(
            "SOURCE_FILE_BINARY",
            "Source file is binary",
            422,
          );
        const original = await this.readDraftText(
          actor,
          input.projectId,
          input.version,
          path,
        );
        bytes = replaceExactDraftText(
          original.text,
          change.patch,
          limits.fileBytes,
        );
      } else {
        if ((change.text === undefined) === (change.base64 === undefined))
          throw new AppError(
            "SOURCE_FILE_CONTENT",
            "Specify exactly one of text or base64",
            400,
          );
        bytes =
          change.text === undefined
            ? decodeBase64(change.base64 as string)
            : Buffer.from(change.text, "utf8");
      }
      if (bytes.length > limits.fileBytes)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "Draft file exceeds the direct file limit",
          422,
        );
      totalBytes += bytes.length;
      if (totalBytes > limits.contentBytes || files.length >= limits.files)
        throw new AppError(
          "SOURCE_TOTAL_SIZE",
          "Draft changes exceed the direct upload limits",
          422,
        );
      files.push({ path, bytes });
    }
    const apply = (sourceId: string, rollbackIfReplayed = false) => {
      const timestamp = nowIso();
      const accepted = this.findOperationRequest(
        actor.userId,
        request,
        timestamp,
      );
      if (accepted !== undefined) {
        if (rollbackIfReplayed) throw new DraftEditReplayed(Number(accepted));
        return result(Number(accepted));
      }
      const current = this.database.drafts.getOwned(
        input.projectId,
        actor.userId,
      );
      if (current?.version !== input.version)
        throw draftVersionConflict(current?.version);
      const updated = drafts.updateInTransaction(actor, input.projectId, {
        version: input.version,
        entrypoint: input.entrypoint,
        engine: input.engine,
        outputs: input.outputs,
        files: input.files.map((change) =>
          "remove" in change
            ? { path: change.path, remove: true }
            : { path: change.path, sourceId, sourcePath: change.path },
        ),
      });
      this.recordOperationRequest(
        actor.userId,
        request,
        String(updated.version),
        timestamp,
      );
      return result(updated.version);
    };
    if (files.length === 0) return this.database.transaction(() => apply(""));
    const archive = await zipFiles(files);
    if (archive.length > this.resourceLimits.maxUploadBytes)
      throw new AppError(
        "SOURCE_ARCHIVE_SIZE",
        "Draft changes exceed the archive limit",
        422,
      );
    let accepted: ReturnType<typeof apply> | undefined;
    try {
      await this.storeReadySource(
        actor.userId,
        archive,
        files.map(({ path }) => path),
        (sourceId) => {
          accepted = apply(sourceId, true);
        },
      );
    } catch (error) {
      if (error instanceof DraftEditReplayed) return result(error.version);
      throw error;
    }
    if (accepted === undefined) throw new Error("Draft changes did not commit");
    return accepted;
  }

  queueSharedDraftPreview(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const actor = this.projectActor(identity);
    const principal = this.ensurePrincipal(actor.userId);
    return this.draftOperations().queuePreview(actor, projectId, version, {
      apiKeyId: principal.api_key_id,
      serviceAccountId: principal.service_account_id,
      rendererVersion: this.rendererVersion,
      runtime: process.env.RENDERER_IMAGE ?? null,
      retentionHours: this.artifactRetentionHours,
      reservedOutputBytes: this.maxOutputBytes,
      admit: () => this.assertQueue(actor.userId, principal.service_account_id),
    });
  }

  async persistSharedDraft(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
    displayName: string,
    description?: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const revision = await this.saveDraftRevision(
      this.projectActor(identity),
      projectId,
      version,
      displayName,
      undefined,
      description,
    );
    return {
      id: revision.id,
      projectId,
      sourceId: revision.source_id,
      revisionNumber: revision.revision_number,
      entrypoint: revision.entrypoint,
      outputs: this.database.projects.renderOutputs(revision),
      engine: revision.engine,
    };
  }

  private draftOperations() {
    return new ProjectDraftOperations(
      this.database,
      this.resourceLimits.maxFileCount,
      this.resourceLimits.maxZipEntries,
    );
  }

  async openProjectDraft(
    actor: ProjectActor,
    projectId: string,
    revisionId?: string,
  ) {
    const drafts = new ProjectDraftOperations(
      this.database,
      this.resourceLimits.maxFileCount,
      this.resourceLimits.maxZipEntries,
    );
    try {
      return drafts.open(actor, projectId, revisionId);
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        error.code !== "DRAFT_SOURCE_REQUIRED" ||
        revisionId !== undefined
      )
        throw error;
    }
    const path = "main.tex";
    const archive = await zipFiles([{ path, bytes: Buffer.alloc(0) }]);
    let draft:
      ReturnType<ProjectDraftOperations["startEmptyInTransaction"]> | undefined;
    await this.storeReadySource(actor.userId, archive, [path], (sourceId) => {
      draft = drafts.startEmptyInTransaction(actor, projectId, sourceId);
    });
    if (!draft) throw new Error("Draft initialization did not commit");
    return draft;
  }

  async readDraftText(
    actor: ProjectActor,
    projectId: string,
    version: number,
    path: string,
  ) {
    const { draft, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      version,
      path,
    );
    const file = draft.files.find((entry) => entry.path === target);
    if (file === undefined)
      throw new AppError(
        "SOURCE_FILE_NOT_FOUND",
        "Draft file does not exist",
        404,
      );
    const source = this.resolveOwnedSource(actor.userId, file.sourceId);
    const bytes = await readValidatedSourceFile(
      this.sourcePath(source),
      file.sourcePath,
      this.zipLimits(),
    );
    try {
      return {
        path: target,
        version,
        text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      };
    } catch {
      throw new AppError(
        "DRAFT_TEXT_ENCODING",
        "Draft file is not UTF-8. Convert it explicitly before editing.",
        422,
      );
    }
  }

  async saveDraftText(
    actor: ProjectActor,
    projectId: string,
    version: number,
    path: string,
    text: string,
  ) {
    assertSourceWritable(this.database);
    const { drafts, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      version,
      path,
    );
    if (Buffer.byteLength(text) > this.directSourceLimits().fileBytes)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Draft text exceeds the direct file limit",
        422,
      );
    const archive = await zipFiles([
      { path: target, bytes: Buffer.from(text, "utf8") },
    ]);
    let updated: ReturnType<ProjectDraftOperations["update"]> | undefined;
    await this.storeReadySource(actor.userId, archive, [target], (sourceId) => {
      updated = drafts.updateInTransaction(actor, projectId, {
        version,
        files: [{ path: target, sourceId, sourcePath: target }],
      });
    });
    if (updated === undefined) throw new Error("Draft update did not commit");
    return updated;
  }

  async saveDraftFileContent(
    actor: ProjectActor,
    projectId: string,
    file: { version: number; path: string; size: number; utf8: boolean },
    body: ReadableStream<Uint8Array> | null,
    signal: AbortSignal,
  ) {
    assertSourceWritable(this.database);
    const { drafts, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      file.version,
      file.path,
    );
    const maximum = this.resourceLimits.maxUploadBytes;
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > maximum
    )
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Draft file exceeds the upload limit",
        413,
      );
    const id = newId("source");
    const storageKey = `sources/${id}/source.zip`;
    const archive = join(this.storageRoot, storageKey);
    const timestamp = nowIso();
    const reservedBytes = Math.min(
      maximum,
      file.size +
        Math.ceil(file.size / 100) +
        Buffer.byteLength(target) * 2 +
        1024,
    );
    this.database.transaction(() => {
      assertSourceWritable(this.database);
      this.assertStorageQuota(actor.userId, reservedBytes);
      this.database.sources.insertReserved({
        id,
        ownerUserId: actor.userId,
        storageKey,
        timestamp,
        size: reservedBytes,
        sha256: "0".repeat(64),
        expiresAt: new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString(),
        dedupeEligible: false,
      });
    });
    let retained = false;
    try {
      await mkdir(dirname(archive), { recursive: true, mode: 0o770 });
      // The DOM and Node declarations use different BYOB reader signatures.
      const input =
        body === null
          ? Readable.from([])
          : Readable.fromWeb(
              body as unknown as Parameters<typeof Readable.fromWeb>[0],
            );
      const decoder = file.utf8
        ? new TextDecoder("utf-8", { fatal: true })
        : undefined;
      let received = 0;
      const checked = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.byteLength;
          if (received > file.size) {
            callback(
              new AppError(
                "SOURCE_FILE_SIZE",
                "Draft file is longer than declared",
                413,
              ),
            );
            return;
          }
          try {
            decoder?.decode(chunk, { stream: true });
            callback(null, chunk);
          } catch {
            callback(
              new AppError(
                "DRAFT_TEXT_ENCODING",
                "Draft text must be UTF-8",
                422,
              ),
            );
          }
        },
        flush(callback) {
          if (received !== file.size) {
            callback(
              new AppError(
                "SOURCE_FILE_SIZE",
                "Draft file is shorter than declared",
                422,
              ),
            );
            return;
          }
          try {
            decoder?.decode();
            callback();
          } catch {
            callback(
              new AppError(
                "DRAFT_TEXT_ENCODING",
                "Draft text must be UTF-8",
                422,
              ),
            );
          }
        },
      });
      const zip = new yazl.ZipFile();
      const compressed = zip.outputStream as Readable;
      const abort = AbortSignal.any([
        signal,
        AbortSignal.timeout(SOURCE_UPLOAD_MS),
      ]);
      const inputResult = pipeline(input, checked, { signal: abort });
      zip.on("error", (error: Error) => compressed.destroy(error));
      zip.addReadStreamLazy(
        target,
        { mtime: new Date(0), mode: 0o600, size: file.size },
        (callback) => callback(null, checked),
      );
      const outputResult = pipeline(
        compressed,
        boundedArchiveStream(reservedBytes),
        createWriteStream(archive, { flags: "wx", mode: 0o660 }),
        { signal: abort },
      );
      try {
        zip.end();
        await Promise.all([inputResult, outputResult]);
      } catch (error) {
        checked.destroy();
        compressed.destroy();
        await Promise.allSettled([inputResult, outputResult]);
        throw error;
      }
      const metadata = await stat(archive);
      const sha256 = await sha256File(archive);
      const handle = await open(archive, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(dirname(archive));
      await syncDirectory(dirname(dirname(archive)));
      const saved = this.database.transaction(() => {
        assertSourceWritable(this.database);
        const now = nowIso();
        const existing = this.database.sources.findReady(
          actor.userId,
          sha256,
          metadata.size,
          now,
        );
        if (existing === undefined)
          this.database.sources.transitionBeforeExpiry(
            id,
            ["reserved"],
            "ready",
            now,
            {
              sha256,
              size: String(metadata.size),
              dedupe_eligible: "1",
              expires_at: this.sourceRetentionExpiresAt(),
              uploaded_at: now,
              paths_json: JSON.stringify([target]),
            },
          );
        const next = drafts.updateInTransaction(actor, projectId, {
          version: file.version,
          files: [
            { path: target, sourceId: existing?.id ?? id, sourcePath: target },
          ],
        });
        return { next, keep: existing === undefined };
      });
      retained = saved.keep;
      return saved.next;
    } finally {
      if (!retained) {
        await rm(dirname(archive), { recursive: true, force: true });
        this.database.transaction(() => {
          this.database.sources.discardReservation(id);
        });
      }
    }
  }

  async saveDraftRevision(
    actor: ProjectActor,
    projectId: string,
    version: number,
    displayName: string,
    outputs?: readonly RenderOutput[],
    changeDescription?: string,
  ) {
    assertSourceWritable(this.database);
    const drafts = new ProjectDraftOperations(
      this.database,
      this.resourceLimits.maxFileCount,
      this.resourceLimits.maxZipEntries,
    );
    const draft = drafts.get(actor, projectId);
    if (draft === null)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    if (draft.version !== version)
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    const groups = new Map<string, typeof draft.files>();
    for (const file of draft.files) {
      const files = groups.get(file.sourceId) ?? [];
      files.push(file);
      groups.set(file.sourceId, files);
    }
    const save = (sourceId: string) => {
      const current = this.database.drafts.getOwned(projectId, actor.userId);
      if (current?.version !== version)
        throw new AppError(
          "DRAFT_VERSION_CONFLICT",
          "The draft has changed since it was loaded",
          409,
        );
      const revision = new ProjectOperations(
        this.database,
      ).attachRevisionInTransaction(actor, {
        projectId,
        sourceId,
        displayName,
        entrypoint: draft.entrypoint,
        engine: draft.engine,
        originalFilename: draft.entrypoint.split("/").at(-1) ?? "source.zip",
        outputs: outputs ?? draft.outputs,
      });
      new ProjectDocumentState(this.database).recordRevisionChange(actor, {
        projectId,
        revisionId: revision.id,
        parentRevisionId: current.base_revision_id ?? null,
        draftVersion: version,
        description: changeDescription ?? "",
      });
      this.database.drafts.setBaseRevision(projectId, version, revision.id);
      return revision;
    };
    const [group] = groups;
    if (groups.size === 1 && group !== undefined) {
      const [sourceId, files] = group;
      const source = this.resolveOwnedSource(actor.userId, sourceId);
      if (
        files.length === this.database.sources.paths(source).length &&
        files.every(({ path, sourcePath }) => path === sourcePath)
      )
        return this.database.transaction(() => save(source.id));
    }
    const directory = await mkdtemp(join(this.storageRoot, ".remote-archive-"));
    try {
      const input = join(directory, "input");
      await mkdir(input, { mode: 0o700 });
      const limits = this.zipLimits();
      let remaining = limits.maxExtractedBytes;
      for (const [sourceId, files] of groups) {
        const source = this.resolveOwnedSource(actor.userId, sourceId);
        const archive = this.sourcePath(source);
        const info = await stat(archive);
        if (
          !info.isFile() ||
          info.size !== source.size ||
          (await sha256File(archive)) !== source.sha256
        )
          throw new AppError(
            "SOURCE_CHECKSUM_INVALID",
            "Source changed after validation",
            409,
          );
        remaining -= await extractValidatedSourceFiles(archive, input, files, {
          ...limits,
          maxExtractedBytes: remaining,
        });
      }
      const files = await readDirectoryFiles(input, "", {
        files: 0,
        bytes: 0,
        maxFiles: limits.maxFiles,
        maxBytes: limits.maxExtractedBytes,
        maxFileBytes: limits.maxFileBytes,
      });
      const archive = join(directory, "source.zip");
      await writeZipFiles(files, archive, {
        maxArchiveBytes: this.resourceLimits.maxUploadBytes,
        maxExtractedBytes: limits.maxExtractedBytes,
        maxFileBytes: limits.maxFileBytes,
      });
      const handle = await open(archive, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      let revision: ReturnType<typeof save> | undefined;
      await this.storeReadySourceArchive(
        actor.userId,
        archive,
        draft.files.map(({ path }) => path),
        (sourceId) => {
          revision = save(sourceId);
        },
      );
      if (revision === undefined)
        throw new Error("Draft revision did not commit");
      return revision;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private requireDraftVersion(
    actor: ProjectActor,
    projectId: string,
    version: number,
    candidate: string,
  ) {
    const drafts = new ProjectDraftOperations(
      this.database,
      this.resourceLimits.maxFileCount,
      this.resourceLimits.maxZipEntries,
    );
    const draft = drafts.get(actor, projectId);
    if (draft === null)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    if (draft.version !== version)
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    return { drafts, draft, path: validateSourceFilePath(candidate) };
  }

  async beginSourceUpload(
    identity: RemoteMcpIdentity,
    expectedBytes: number,
    sha256: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > this.resourceLimits.maxUploadBytes
    )
      throw new AppError(
        "SOURCE_UPLOAD_SIZE",
        `Source upload size must be between 1 byte and ${this.resourceLimits.maxUploadBytes} bytes`,
        400,
      );
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new AppError(
        "SOURCE_UPLOAD_HASH",
        "Source upload SHA-256 is invalid",
        400,
      );
    const existing = this.database.sources.findReady(
      identity.userId,
      sha256,
      expectedBytes,
      nowIso(),
    );
    if (existing !== undefined)
      return {
        uploadId: existing.id,
        sourceId: existing.id,
        expectedBytes,
        receivedBytes: expectedBytes,
        expiresAt: existing.expires_at,
        maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      };
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(identity.userId, expectedBytes);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: identity.userId,
        size: expectedBytes,
        sha256,
        storageKey,
        timestamp,
        expiresAt,
        dedupeEligible: false,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await writeFile(path, Buffer.alloc(0), { flag: "wx", mode: 0o660 });
      // Chunks are immutable, offset-addressed files.  They prevent a writer
      // whose DB lease expired mid-I/O from overwriting a newer writer's bytes.
      await mkdir(join(dirname(path), ".chunks"), { mode: 0o770 });
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "uploading",
          nowIso(),
        );
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    return {
      uploadId: sourceId,
      sourceId,
      expectedBytes,
      receivedBytes: 0,
      expiresAt,
      maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
    };
  }

  sourceUploadStatus(identity: RemoteMcpIdentity, uploadId: string) {
    requireScope(identity.scopes, "mcp:render");
    const source = this.database.sources.getVisible(uploadId);
    if (source?.owner_user_id !== identity.userId)
      throw new AppError(
        "SOURCE_NOT_FOUND",
        "Source upload does not exist",
        404,
      );
    const now = nowIso();
    const ready = this.database.sources.getOwnedReady(
      uploadId,
      identity.userId,
      now,
    );
    const status =
      ready !== undefined
        ? "ready"
        : source.status !== "deleted" &&
            source.status !== "deleting" &&
            source.expires_at <= now
          ? "expired"
          : source.status;
    return {
      ...uploadProgress(
        source,
        status === "ready" ? source.size : source.upload_received_bytes,
      ),
      status,
    };
  }

  async uploadSourceChunk(
    identity: RemoteMcpIdentity,
    uploadId: string,
    offset: number,
    base64: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    return this.appendSourceChunk(identity.userId, uploadId, offset, base64);
  }

  async finalizeSourceUpload(
    identity: RemoteMcpIdentity,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    return this.completeSourceUpload(identity.userId, uploadId);
  }

  async updateSourceFile(
    identity: RemoteMcpIdentity,
    sourceId: string,
    file: RemoteSourceFileInput,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const path = validateSourceFilePath(file.path);
    if ((file.text === undefined) === (file.base64 === undefined))
      throw new AppError(
        "SOURCE_FILE_CONTENT",
        "Source file must contain exactly one of text or base64",
        400,
      );
    const bytes =
      file.text === undefined
        ? decodeBase64(file.base64 as string)
        : Buffer.from(file.text, "utf8");
    const maxRevisionFileBytes = Math.min(
      20 * 1024 * 1024,
      this.resourceLimits.maxUploadBytes,
    );
    if (bytes.byteLength > maxRevisionFileBytes)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file exceeds the configured revision file limit",
        400,
      );
    return this.reviseSource(identity.userId, sourceId, async (root) => {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o770 });
      await writeFile(target, bytes, { mode: 0o660 });
    });
  }

  async deleteSourceFile(
    identity: RemoteMcpIdentity,
    sourceId: string,
    filePath: string,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const path = validateSourceFilePath(filePath);
    return this.reviseSource(identity.userId, sourceId, async (root) => {
      const target = join(root, ...path.split("/"));
      try {
        const current = await stat(target);
        if (!current.isFile()) throw new Error("not a file");
      } catch {
        throw new AppError(
          "SOURCE_FILE_NOT_FOUND",
          "Source file does not exist",
          404,
        );
      }
      await rm(target, { force: true });
    });
  }

  private projectActor(identity: RemoteMcpIdentity) {
    return { userId: identity.userId, type: "oauth", id: identity.userId };
  }

  listProjects(
    identity: RemoteMcpIdentity,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).list(
      this.projectActor(identity),
      options,
    );
  }

  getProject(
    identity: RemoteMcpIdentity,
    projectId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).get(
      this.projectActor(identity),
      projectId,
      options,
    );
  }

  private savedRevisionSource(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const { revision } = new ProjectOperations(this.database).revision(
      this.projectActor(identity),
      projectId,
      revisionId,
    );
    const source = this.resolveOwnedSource(identity.userId, revision.source_id);
    return {
      source,
      path: this.sourcePath(source),
      entrypoint: revision.entrypoint,
      engine: revision.engine,
      revision: {
        projectId,
        revisionId,
        sourceId: source.id,
        sourceSha256: source.sha256,
      },
    };
  }

  projectDelivery(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    jobId?: string,
  ) {
    const { source, revision, entrypoint, engine } = this.savedRevisionSource(
      identity,
      projectId,
      revisionId,
    );
    const url = (path: string) =>
      new URL(`/app/api/v1/${path}`, this.publicOrigin).href;
    const sourceZip = {
      size: source.size,
      sha256: source.sha256,
      filename: `${revisionId}.zip`,
      availability: "available" as const,
      mimeType: "application/zip",
      downloadUrl: url(
        `projects/${projectId}/revisions/${revisionId}/source.zip`,
      ),
    };
    if (jobId === undefined) return { ...revision, sourceZip, pdf: null };
    const job = this.assertReadableJob(identity.userId, jobId);
    if (
      job.project_revision_id !== revisionId ||
      job.source_id !== source.id ||
      job.source_sha256 !== source.sha256 ||
      job.entrypoint !== entrypoint ||
      job.engine !== engine
    )
      throw new AppError(
        "DELIVERY_TARGET_MISMATCH",
        "The Job does not match the requested saved Source and revision",
        409,
      );
    const pdf = this.database.artifacts.getDownloadable(jobId, "result.pdf", {
      retentionHours: this.artifactRetentionHours,
    });
    const expiresAt = pdf !== undefined || job.completed_at !== null ? this.artifactExpiry(job) : null;
    return {
      ...revision,
      sourceZip,
      pdf:
        pdf === undefined
          ? {
              jobId,
              availability:
                job.status === "expired" || (expiresAt !== null && expiresAt <= nowIso()) ? "expired" as const :
                ["queued", "validating", "running"].includes(job.status) ? "pending" as const :
                "unavailable" as const,
              status: job.status,
            }
          : {
              jobId,
              availability: "available" as const,
              status: job.status,
              size: pdf.size,
              sha256: pdf.sha256,
              filename: "result.pdf",
              mimeType: "application/pdf",
              expiresAt: this.artifactExpiry(job),
              inlineMaxBytes: this.maxInlineArtifactBytes,
              manifestResourceUri: `latex-renderer://jobs/${jobId}/manifest/${pdf.sha256}`,
              downloadUrl: url(`jobs/${jobId}/artifacts/result.pdf`),
              resourceUri:
                pdf.size <= this.maxInlineArtifactBytes
                  ? resourceUri(jobId, "result.pdf")
                  : null,
            },
    };
  }

  async listProjectRevisionFiles(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    offset = 0,
    limit = 25,
  ) {
    const { path, revision } = this.savedRevisionSource(
      identity,
      projectId,
      revisionId,
    );
    const files = await readSavedSource(() =>
      listValidatedSourceFiles(path, this.zipLimits()),
    );
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > files.length ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 25
    )
      throw new AppError(
        "SOURCE_FILE_RANGE",
        "Invalid Source file list range",
        416,
      );
    const items = files.slice(offset, offset + limit).map((file) => ({
      ...file,
      kind: sourceFileKind(file.path),
    }));
    return {
      ...revision,
      items,
      totalFiles: files.length,
      nextOffset:
        offset + items.length < files.length ? offset + items.length : null,
    };
  }

  async getProjectRevisionFile(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    requestedPath: string,
    offset = 0,
  ) {
    const { source, path, revision } = this.savedRevisionSource(
      identity,
      projectId,
      revisionId,
    );
    const target = validateSourceFilePath(requestedPath, this.zipLimits());
    if (!this.database.sources.paths(source).includes(target))
      throw new AppError(
        "SOURCE_FILE_NOT_FOUND",
        "Source file does not exist",
        404,
      );
    if (sourceFileKind(target) === "binary")
      throw new AppError("SOURCE_FILE_BINARY", "Source file is binary", 422);
    const bytes = await readSavedSource(() =>
      readValidatedSourceFile(path, target, this.zipLimits()),
    );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw new AppError(
        "SOURCE_FILE_ENCODING",
        "Source file is not UTF-8",
        422,
      );
    }
    return {
      ...revision,
      path: target,
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      ...sourceTextPage(text, offset),
    };
  }

  projectRevisionJobs(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).jobs(
      this.projectActor(identity),
      projectId,
      revisionId,
      options,
    );
  }

  createProject(identity: RemoteMcpIdentity, displayName: string) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectOperations(this.database).create(
      this.projectActor(identity),
      displayName,
    );
  }

  renameProject(
    identity: RemoteMcpIdentity,
    projectId: string,
    displayName: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    new ProjectOperations(this.database).rename(
      this.projectActor(identity),
      projectId,
      displayName,
    );
    return { id: projectId, displayName };
  }

  deleteProject(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:delete");
    new ProjectOperations(this.database).delete(
      this.projectActor(identity),
      projectId,
    );
    return { id: projectId, deleted: true as const };
  }

  attachProjectRevision(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      sourceId: string;
      entrypoint: string;
      displayName: string;
      originalFilename: string;
      outputs: Array<"pdf" | "svg">;
      engine?: RenderEngine | undefined;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const revision = new ProjectOperations(this.database).attachRevision(
      this.projectActor(identity),
      { ...input, entrypoint: validateEntrypointPath(input.entrypoint) },
    );
    return {
      id: revision.id,
      projectId: input.projectId,
      sourceId: revision.source_id,
      revisionNumber: revision.revision_number,
      entrypoint: revision.entrypoint,
      outputs: this.database.projects.renderOutputs(revision),
      engine: revision.engine,
    };
  }

  async updateProjectFile(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      revisionId: string;
      file: RemoteSourceFileInput;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const path = validateSourceFilePath(input.file.path);
    if ((input.file.text === undefined) === (input.file.base64 === undefined))
      throw new AppError(
        "SOURCE_FILE_CONTENT",
        "Source file must contain exactly one of text or base64",
        400,
      );
    const bytes =
      input.file.text === undefined
        ? decodeBase64(input.file.base64 as string)
        : Buffer.from(input.file.text, "utf8");
    if (
      bytes.byteLength >
      Math.min(20 * 1024 * 1024, this.resourceLimits.maxUploadBytes)
    )
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file exceeds the configured revision file limit",
        400,
      );
    return this.reviseProjectFile(
      identity,
      input.projectId,
      input.revisionId,
      async (root) => {
        const target = join(root, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o770 });
        await writeFile(target, bytes, { mode: 0o660 });
      },
    );
  }

  async deleteProjectFile(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      revisionId: string;
      path: string;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const path = validateSourceFilePath(input.path);
    return this.reviseProjectFile(
      identity,
      input.projectId,
      input.revisionId,
      async (root) => {
        const target = join(root, ...path.split("/"));
        const current = await stat(target).catch(() => undefined);
        if (current === undefined || !current.isFile())
          throw new AppError(
            "SOURCE_FILE_NOT_FOUND",
            "Source file does not exist",
            404,
          );
        await rm(target);
      },
    );
  }

  private async reviseProjectFile(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    mutation: (root: string) => Promise<void>,
  ) {
    const projects = new ProjectOperations(this.database),
      selected = projects.revision(
        this.projectActor(identity),
        projectId,
        revisionId,
      );
    let projectRevision:
      ReturnType<ProjectOperations["attachRevisionInTransaction"]> | undefined;
    const source = await this.reviseSource(
      identity.userId,
      selected.revision.source_id,
      mutation,
      (sourceId) => {
        projectRevision = projects.attachRevisionInTransaction(
          this.projectActor(identity),
          {
            projectId,
            sourceId,
            entrypoint: selected.revision.entrypoint,
            displayName: selected.revision.display_name,
            originalFilename: selected.revision.original_filename,
            outputs: this.database.projects.renderOutputs(selected.revision),
            engine: selected.revision.engine,
          },
        );
      },
    );
    if (projectRevision === undefined)
      throw new AppError(
        "PROJECT_REVISION_MISSING",
        "Project revision was not attached",
        500,
      );
    return {
      source,
      revision: {
        id: projectRevision.id,
        projectId,
        sourceId: projectRevision.source_id,
        revisionNumber: projectRevision.revision_number,
        entrypoint: projectRevision.entrypoint,
        outputs: this.database.projects.renderOutputs(projectRevision),
        engine: projectRevision.engine,
      },
    };
  }

  async renderProjectRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    outputs?: Array<"pdf" | "svg">,
    idempotencyKey?: string,
    reproducibility?: RenderReproducibility,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.render_project_revision",
      idempotencyKey,
      {
        projectId,
        revisionId,
        outputs,
        reproducibility,
      },
    );
    const replay = this.findRenderRequest(identity.userId, request, nowIso());
    if (replay) return this.summarize(replay);
    const projects = new ProjectOperations(this.database),
      selected = projects.revision(
        this.projectActor(identity),
        projectId,
        revisionId,
      );
    return this.queueRender(
      identity,
      {
        sourceId: selected.revision.source_id,
        entrypoint: selected.revision.entrypoint,
        outputs: outputs ?? projects.renderOutputs(selected.revision),
        engine: selected.revision.engine,
        reproducibility,
        project: { projectId, revisionId },
      },
      request,
    );
  }

  async createRender(
    identity: RemoteMcpIdentity,
    input: RenderInput,
    idempotencyKey?: string,
  ): Promise<RemoteJobSummary> {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.create_render",
      idempotencyKey,
      {
        ...("inlineSource" in input
          ? { inlineSourceHash: sha256Hex(input.inlineSource) }
          : "sourceRef" in input
            ? { sourceRef: input.sourceRef }
            : { sourceId: input.sourceId, project: input.project }),
        entrypoint: input.entrypoint,
        outputs: input.outputs,
        engine: input.engine,
        reproducibility: input.reproducibility,
      },
    );
    return this.queueRender(identity, input, request);
  }

  private async queueRender(
    identity: RemoteMcpIdentity,
    input: RenderInput,
    request: OperationRequest | undefined,
  ): Promise<RemoteJobSummary> {
    const replay = this.findRenderRequest(identity.userId, request, nowIso());
    if (replay) return this.summarize(replay);
    this.assertMaintenance();
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      outputs = normalizeRenderOutputs(input.outputs),
      engine = input.engine ?? defaultRenderEngine,
      dateProfile = input.reproducibility,
      fixedEpoch =
        dateProfile?.mode === "fixed"
          ? Math.floor(Date.parse(dateProfile.date) / 1000)
          : null;
    if (dateProfile && engine !== "lualatex")
      throw new AppError(
        "DATE_PROFILE_UNSUPPORTED",
        "The date profile requires LuaLaTeX",
        422,
      );
    if (
      fixedEpoch !== null &&
      (!Number.isSafeInteger(fixedEpoch) || fixedEpoch < 0)
    )
      throw new AppError(
        "DATE_PROFILE_INVALID",
        "Use a valid UTC date on or after the Unix epoch",
        422,
      );
    const principal = this.ensurePrincipal(identity.userId),
      source =
        "sourceRef" in input
          ? this.resolveSourceRef(identity.userId, input.sourceRef)
          : "sourceId" in input
            ? this.resolveOwnedSource(identity.userId, input.sourceId)
            : await this.createInlineSource(
                identity.userId,
                input.inlineSource,
                entrypoint,
              );
    if (!this.database.sources.paths(source).includes(entrypoint))
      throw new AppError(
        "ENTRYPOINT_MISSING",
        "Source does not contain the requested entrypoint",
        422,
      );
    const acceptedId = this.database.transaction(() => {
      const timestamp = nowIso();
      const replay = this.findRenderRequest(
        identity.userId,
        request,
        timestamp,
      );
      if (replay) return replay.id;
      const jobId = newId("job");
      this.assertQueue(identity.userId, principal.service_account_id);
      const currentSource = this.database.sources.getOwnedReady(
        source.id,
        identity.userId,
        timestamp,
      );
      if (currentSource === undefined)
        throw new AppError(
          "SOURCE_NOT_READY",
          "Source does not exist or is not ready",
          409,
        );
      if (!this.database.sources.paths(currentSource).includes(entrypoint))
        throw new AppError(
          "ENTRYPOINT_MISSING",
          "Source does not contain the requested entrypoint",
          422,
        );
      const project = "project" in input ? input.project : undefined;
      const revision =
        project !== undefined
          ? this.database.projects.revisionOwned(
              project.revisionId,
              identity.userId,
            )
          : undefined;
      if (
        project !== undefined &&
        (this.database.projects.getOwned(project.projectId, identity.userId) ===
          undefined ||
          revision?.project_id !== project.projectId ||
          revision.source_id !== currentSource.id ||
          revision.entrypoint !== entrypoint ||
          revision.engine !== engine)
      )
        throw new AppError(
          "PROJECT_REVISION_NOT_FOUND",
          "Project revision does not exist",
          404,
        );
      if (
        this.database.jobs.insertQueued({
          id: jobId,
          userId: identity.userId,
          serviceAccountId: principal.service_account_id,
          apiKeyId: principal.api_key_id,
          rendererVersion: this.rendererVersion,
          sourceId: currentSource.id,
          entrypoint,
          outputs,
          engine,
          ...(revision === undefined ? {} : { projectRevisionId: revision.id }),
          timestamp,
          reservedOutputBytes: this.maxOutputBytes,
        }) !== 1
      )
        throw new AppError(
          "SOURCE_NOT_READY",
          "Source changed while the Render Job was being created",
          409,
        );
      this.database.audit({
        actorType: "oauth",
        actorId: identity.userId,
        action: "remote_mcp.render.queued",
        targetType: "job",
        targetId: jobId,
        result: "success",
        metadata: { sourceId: currentSource.id, entrypoint, outputs },
      });
      if (dateProfile)
        this.database.jobs.setReproducibility(
          jobId,
          dateProfile.mode,
          fixedEpoch ?? Math.floor(Date.parse(timestamp) / 1000),
        );
      this.recordOperationRequest(identity.userId, request, jobId, timestamp);
      return jobId;
    });
    const created = this.database.jobs.get(acceptedId);
    if (created === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Render job was not created");
    return this.summarize(created);
  }

  retryRender(
    identity: RemoteMcpIdentity,
    jobId: string,
    idempotencyKey?: string,
  ): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.retry_render",
      idempotencyKey,
      {
        jobId,
      },
    );
    const acceptedId = this.database.transaction(() => {
      const timestamp = nowIso();
      const replay = this.findRenderRequest(
        identity.userId,
        request,
        timestamp,
      );
      if (replay) return replay.id;
      const previous = this.assertOwned(identity.userId, jobId);
      if (
        ![
          "succeeded",
          "failed",
          "timeout",
          "canceled",
          "rejected",
          "expired",
        ].includes(previous.status)
      )
        throw new AppError(
          "JOB_NOT_RETRYABLE",
          "Only a terminal Job can be retried",
          409,
        );
      if (previous.source_id === null)
        throw new AppError(
          "SOURCE_NOT_READY",
          "The previous Job has no reusable Source",
          409,
        );
      const sourceId = previous.source_id;
      const retryId = newId("job");
      this.assertQueue(identity.userId, previous.service_account_id);
      const currentSource = this.database.sources.getOwnedReady(
        sourceId,
        identity.userId,
        timestamp,
      );
      if (currentSource === undefined)
        throw new AppError(
          "SOURCE_NOT_READY",
          "The previous Job Source is not ready",
          409,
        );
      this.database.jobs.insertRetry({
        id: retryId,
        source: previous,
        rendererVersion: this.rendererVersion,
        timestamp,
        reservedOutputBytes: this.maxOutputBytes,
      });
      this.database.audit({
        actorType: "oauth",
        actorId: identity.userId,
        action: "remote_mcp.render.retried",
        targetType: "job",
        targetId: retryId,
        result: "success",
        metadata: { retryOf: previous.id, sourceId: previous.source_id },
      });
      this.recordOperationRequest(identity.userId, request, retryId, timestamp);
      return retryId;
    });
    const retry = this.database.jobs.get(acceptedId);
    if (retry === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Retry Job was not created");
    return this.summarize(retry);
  }

  private findOperationRequest(
    userId: string,
    request: OperationRequest | undefined,
    timestamp: string,
  ): string | undefined {
    if (!request) return undefined;
    const record = this.database.security.idempotency(
      "oauth",
      userId,
      request.operation,
      request.keyHash,
      timestamp,
    );
    if (!record) return undefined;
    if (record.request_hash !== request.requestHash)
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was reused with different inputs",
        409,
      );
    if (!record.resource_id)
      throw new AppError(
        "REQUEST_UNAVAILABLE",
        "The accepted request is unavailable",
        409,
      );
    return record.resource_id;
  }

  private findRenderRequest(
    userId: string,
    request: OperationRequest | undefined,
    timestamp: string,
  ): JobRow | undefined {
    const jobId = this.findOperationRequest(userId, request, timestamp);
    return jobId === undefined ? undefined : this.assertOwned(userId, jobId);
  }

  private recordOperationRequest(
    userId: string,
    request: OperationRequest | undefined,
    resourceId: string,
    timestamp: string,
  ): void {
    if (!request) return;
    this.database.security.insertIdempotency({
      actorType: "oauth",
      actorId: userId,
      ...request,
      resourceId,
      responseCode: 202,
      createdAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + 86_400_000).toISOString(),
    });
  }

  retrySvgRender(
    identity: RemoteMcpIdentity,
    jobId: string,
    idempotencyKey: string,
  ): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:render");
    const previous = this.assertOwned(identity.userId, jobId);
    new SvgRetryOperations(this.database, {
      maxQueueLength: this.maxQueueLength,
      maxUserStorageBytes: this.maxUserStorageBytes,
      maxOutputBytes: this.maxOutputBytes,
      artifactRetentionHours: this.artifactRetentionHours,
      runtimeImage: process.env.RENDERER_IMAGE,
    }).retry(
      {
        userId: identity.userId,
        type: "oauth",
        id: identity.userId,
        serviceAccountId: previous.service_account_id,
      },
      jobId,
      idempotencyKey,
    );
    const row = this.database.jobs.get(jobId);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return this.summarize(row);
  }

  job(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:read");
    return this.summarize(this.assertReadableJob(identity.userId, jobId));
  }

  pdfInspection(
    identity: RemoteMcpIdentity,
    jobId: string,
    sha256: string,
    request = false,
    params?: PdfInspectionInput,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const geometry =
      params === undefined ? undefined : pdfInspectionInputSchema.parse(params);
    const lookup = () => {
      const job = this.assertReadableJob(identity.userId, jobId);
      const pdf = this.database.artifacts.getDownloadable(jobId, "result.pdf", {
        retentionHours: this.artifactRetentionHours,
      });
      if (!pdf)
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The canonical PDF is not available",
          410,
        );
      if (pdf.sha256 !== sha256)
        throw new AppError(
          "PDF_CHECKSUM_MISMATCH",
          "The canonical PDF does not match the requested digest",
          409,
        );
      const expiresAt = this.artifactExpiry(job);
      const document = this.database.previews.document(jobId);
      if (geometry && "direction" in geometry) {
        if (!this.database.artifacts.sourceMap(pdf))
          throw new AppError(
            "SYNCTEX_UNAVAILABLE",
            "No source map for this PDF",
            410,
          );
        if (geometry.direction === "source_to_pdf")
          geometry.path = validateSourceFilePath(
            geometry.path,
            this.zipLimits(),
          );
      }
      if (
        geometry &&
        "page" in geometry &&
        document?.pdf_sha256 === pdf.sha256 &&
        geometry.page > document.page_count
      )
        throw new AppError(
          "PREVIEW_PAGE_INVALID",
          "Preview page is outside the PDF",
          404,
        );
      if (
        geometry &&
        "pages" in geometry &&
        document?.pdf_sha256 === pdf.sha256 &&
        geometry.pages.some((page) => page > document.page_count)
      )
        throw new AppError(
          "PREVIEW_PAGE_INVALID",
          "A contact sheet page is outside the PDF",
          404,
        );
      const row = request
        ? this.database.pdfInspections.request(
            pdf,
            expiresAt,
            nowIso(),
            geometry,
          )
        : this.database.pdfInspections.forArtifact(pdf, geometry);
      return {
        jobId,
        revisionId: job.project_revision_id,
        pdfSha256: pdf.sha256,
        generation: pdf.storage_generation ?? null,
        inspectorVersion: PDF_INSPECTOR_VERSION,
        expiresAt,
        state: row?.status ?? ("not_requested" as const),
        errorCode: row?.error_code ?? null,
        report: row?.result_json
          ? (JSON.parse(row.result_json) as unknown)
          : null,
      };
    };
    return request ? this.database.transaction(lookup) : lookup();
  }

  comparePdfInspections(
    identity: RemoteMcpIdentity,
    before: { jobId: string; pdfSha256: string },
    after: { jobId: string; pdfSha256: string },
  ) {
    const left = this.pdfInspection(identity, before.jobId, before.pdfSha256);
    const right = this.pdfInspection(identity, after.jobId, after.pdfSha256);
    const observations = (value: unknown) => {
      if (typeof value !== "object" || value === null || !("checks" in value))
        return {};
      return value.checks as Record<
        string,
        { text: string | null; truncated: boolean }
      >;
    };
    const leftChecks = observations(left.report),
      rightChecks = observations(right.report);
    const compare = (name: string) => {
      const a = leftChecks[name],
        b = rightChecks[name];
      if (
        !a ||
        !b ||
        a.text === null ||
        b.text === null ||
        a.truncated ||
        b.truncated
      )
        return "not_checked" as const;
      return a.text === b.text
        ? ("same_observation" as const)
        : ("changed_observation" as const);
    };
    const rasterVersion = compare("versions");
    const pageRasters = (checks: ReturnType<typeof observations>) => {
      const sample = checks["page-rasters"];
      if (sample?.text == null || sample.truncated) return [];
      return sample.text
        .trim()
        .split("\n")
        .filter((hash) => /^[a-f0-9]{64}$/.test(hash));
    };
    const leftPages = pageRasters(leftChecks),
      rightPages = pageRasters(rightChecks);
    const comparedPages =
      rasterVersion === "same_observation"
        ? Math.min(leftPages.length, rightPages.length)
        : 0;
    const changedPreviewPages = Array.from(
      { length: comparedPages },
      (_, i) => i + 1,
    ).filter((page) => leftPages[page - 1] !== rightPages[page - 1]);
    const leftJob = this.assertReadableJob(identity.userId, before.jobId);
    const rightJob = this.assertReadableJob(identity.userId, after.jobId);
    return {
      before: { ...before, revisionId: left.revisionId, state: left.state },
      after: { ...after, revisionId: right.revisionId, state: right.state },
      samePdfBytes: left.pdfSha256 === right.pdfSha256,
      extractedText: compare("extracted-text"),
      fontInventory: compare("font-info"),
      pageInfoAndMetadata: compare("page-info"),
      navigation: compare("navigation"),
      visual:
        comparedPages === 0
          ? ("not_checked" as const)
          : changedPreviewPages.length > 0
            ? ("changed_observation" as const)
            : ("same_observation" as const),
      visualCoverage: {
        comparedPages,
        changedPreviewPages,
        maxPageSidePixels: 512,
        pagePairing: "physical_page_number" as const,
      },
      sourceComparison:
        leftJob.source_id !== null && rightJob.source_id !== null
          ? leftJob.source_sha256 === rightJob.source_sha256 &&
            leftJob.entrypoint === rightJob.entrypoint
            ? ("same_observation" as const)
            : ("changed_observation" as const)
          : ("not_checked" as const),
      documentMeaning: "not_checked" as const,
      sameEngine: leftJob.engine === rightJob.engine,
      sameRuntime:
        leftJob.runtime_digest === null || rightJob.runtime_digest === null
          ? null
          : leftJob.runtime_digest === rightJob.runtime_digest,
    };
  }

  renderManifest(identity: RemoteMcpIdentity, jobId: string) {
    requireScope(identity.scopes, "mcp:read");
    const row = this.assertReadableJob(identity.userId, jobId);
    const summary = this.summarize(row);
    return {
      schemaVersion: 1 as const,
      jobId,
      status: summary.status,
      projectRevisionId: row.project_revision_id,
      sourceId: row.source_id,
      inputSha256: row.source_sha256,
      inputKind: row.source_id
        ? ("source_zip" as const)
        : this.database.drafts.isPreviewJob(jobId)
          ? ("draft_manifest" as const)
          : ("unknown" as const),
      entrypoint: row.entrypoint,
      engine: row.engine,
      runtimeDigest: row.runtime_digest,
      outputs: summary.outputs,
      pdfSha256:
        summary.artifacts.find(
          ({ relativePath }) => relativePath === "result.pdf",
        )?.sha256 ?? null,
      artifacts: summary.artifacts,
      stages: summary.stages ?? null,
      recordedTiming: {
        createdAt: row.created_at,
        queuedAt: row.queued_at,
        startedAt: row.started_at,
        finishedAt: row.completed_at,
      },
      workerObservations: this.database.jobs.stageObservations(jobId),
      reproducibility: this.database.jobs.reproducibility(jobId) ?? null,
      pdfSvgMatch: "not_checked" as const,
    };
  }

  async diagnostics(
    identity: RemoteMcpIdentity,
    jobId: string,
    stage?: "pdf" | "svg",
    offset?: number,
    limit?: number,
  ): Promise<RemoteRenderDiagnostics> {
    requireScope(identity.scopes, "mcp:read");
    const row = this.assertReadableJob(identity.userId, jobId),
      stages = this.database.outputStages.publicState(jobId),
      selectedStage =
        stage ??
        (stages?.pdf.status === "succeeded" &&
        ["failed", "timeout", "canceled"].includes(stages.svg.status)
          ? "svg"
          : "pdf"),
      prefix = selectedStage === "svg" ? "svg/" : "",
      available = this.database.artifacts.listDownloadable(jobId, {
        retentionHours: this.artifactRetentionHours,
      }),
      errorsArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}errors.json`,
      ),
      logArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}compile.log`,
      ),
      parsed =
        errorsArtifact === undefined
          ? { errors: [], warnings: [], coverage: null, storedListOmitted: 0 }
          : parseDiagnosticsJson(
              (
                await this.artifact(
                  identity,
                  jobId,
                  errorsArtifact.relative_path,
                )
              ).bytes.toString("utf8"),
            ),
      entries: RemoteRenderDiagnostic[] = [
        ...parsed.errors.map((item) => ({
          ...item,
          severity: "error" as const,
          column: null,
        })),
        ...parsed.warnings.map((item) => ({
          ...item,
          severity: "warning" as const,
          column: null,
        })),
      ];
    const start = offset ?? 0;
    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      start > entries.length ||
      (limit !== undefined &&
        (!Number.isSafeInteger(limit) || limit < 1 || limit > 25))
    )
      throw new AppError(
        "DIAGNOSTICS_RANGE",
        "Diagnostic page is outside stored results",
        416,
      );
    const diagnostics = entries.slice(
      start,
      start + (limit ?? (offset === undefined ? entries.length : 25)),
    );
    const log =
      logArtifact === undefined
        ? null
        : await this.logWindow(logArtifact, undefined, undefined, 16_384).catch(
            () => null,
          );
    const excerpt =
      log === null ? null : diagnosticLogExcerpt(log.text, entries);
    const rawLogResourceUri =
      logArtifact === undefined ||
      logArtifact.size > this.maxInlineArtifactBytes
        ? null
        : resourceUri(jobId, logArtifact.relative_path);
    return {
      jobId,
      status: row.status,
      engine: row.engine,
      diagnostics,
      logExcerpt: excerpt?.text ?? "",
      rawLogResourceUri,
      coverage: {
        parser: parsed.coverage,
        storedItems: entries.length,
        offset: start,
        nextOffset:
          start + diagnostics.length < entries.length
            ? start + diagnostics.length
            : null,
        storedListOmitted: parsed.storedListOmitted,
        logStatus:
          logArtifact === undefined
            ? "absent"
            : log
              ? "available"
              : "unavailable",
        logExcerptTruncated:
          log !== null && (log.startByte > 0 || excerpt?.truncated === true),
      },
      retryable:
        ["failed", "timeout", "rejected"].includes(row.status) ||
        (row.status === "canceled" &&
          stages?.pdf.status === "succeeded" &&
          stages.svg.attempt < 8),
      ...(stages === undefined && stage === undefined
        ? {}
        : { stage: selectedStage }),
    };
  }

  previewPages(
    identity: RemoteMcpIdentity,
    jobId: string,
    pdfSha256: string,
    requested: number[],
  ) {
    requireScope(identity.scopes, "mcp:read");
    const job = this.assertReadableJob(identity.userId, jobId);
    if (
      requested.length < 1 ||
      requested.length > 8 ||
      new Set(requested).size !== requested.length ||
      requested.some(
        (page) => !Number.isSafeInteger(page) || page < 1 || page > 100,
      )
    )
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "Select 1 to 8 distinct PDF pages",
        400,
      );
    const policy = { retentionHours: this.artifactRetentionHours };
    return this.database.transaction(() => {
      const pdf = this.database.artifacts.getDownloadable(
        jobId,
        "result.pdf",
        policy,
      );
      if (!pdf)
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The canonical PDF is not available",
          410,
        );
      if (pdf.sha256 !== pdfSha256)
        throw new AppError(
          "PDF_CHECKSUM_MISMATCH",
          "The canonical PDF does not match the requested digest",
          409,
        );
      const document = this.database.previews.document(jobId);
      const available = this.database.artifacts.listDownloadable(jobId, policy);
      const pages = requested.map((page) => {
        const ready = available.find(
          (artifact) => artifact.relative_path === `previews/page-${page}.png`,
        );
        if (ready)
          return {
            page,
            state: "ready" as const,
            sha256: ready.sha256,
            resourceUri:
              ready.size <= this.maxInlineArtifactBytes
                ? resourceUri(jobId, ready.relative_path)
                : null,
            errorCode: null,
            retryable: false,
          };
        try {
          this.database.previews.request(jobId, page, nowIso(), policy);
          return {
            page,
            state: "pending" as const,
            sha256: null,
            resourceUri: null,
            errorCode: null,
            retryable: true,
          };
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const busy = error.code === "PREVIEW_QUEUE_FULL";
          return {
            page,
            state: busy
              ? ("busy" as const)
              : error.code === "PREVIEW_FAILED"
                ? ("failed" as const)
                : ("unavailable" as const),
            sha256: null,
            resourceUri: null,
            errorCode:
              typeof error.details?.previewErrorCode === "string"
                ? error.details.previewErrorCode
                : error.code,
            retryable: busy || error.details?.retryable === true,
          };
        }
      });
      return {
        jobId,
        projectRevisionId: job.project_revision_id,
        pdfSha256,
        pageCount:
          document?.pdf_sha256 === pdf.sha256 ? document.page_count : null,
        pages,
      };
    });
  }

  async artifact(
    identity: RemoteMcpIdentity,
    jobId: string,
    relativePath: string,
  ): Promise<RemoteArtifactContent> {
    requireScope(identity.scopes, "mcp:read");
    this.assertReadableJob(identity.userId, jobId);
    let artifact = this.database.artifacts.getDownloadable(
      jobId,
      relativePath,
      { retentionHours: this.artifactRetentionHours },
    );
    const page = /^previews\/page-[1-9][0-9]*\.png$/.test(relativePath)
      ? previewPage(relativePath)
      : null;
    if (page !== null) {
      const candidates = this.database.artifacts
        .listDownloadable(jobId, {
          retentionHours: this.artifactRetentionHours,
        })
        .filter(
          (item) =>
            item.type === "preview" && previewPage(item.relative_path) === page,
        );
      if (candidates.length > 1)
        throw new AppError("INVALID_PREVIEW", "Preview page is ambiguous", 409);
      artifact =
        candidates[0] ??
        (await waitForPreview(this.database, jobId, page, {
          retentionHours: this.artifactRetentionHours,
        }));
    }
    if (artifact === undefined)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    if (
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 0 ||
      artifact.size > this.maxInlineArtifactBytes
    )
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        `Artifact exceeds the ${this.maxInlineArtifactBytes}-byte MCP inline resource limit; use the protected Web result instead`,
        413,
      );
    const release = await this.acquireInlineArtifactBytes(artifact.size);
    try {
      return {
        jobId,
        relativePath: artifact.relative_path,
        mimeType: artifactMimeType(artifact.type),
        size: artifact.size,
        sha256: artifact.sha256,
        bytes: await this.withArtifactLease(artifact, (path, signal) =>
          readBoundedArtifact(
            path,
            artifact.size,
            this.maxInlineArtifactBytes,
            signal,
          ),
        ),
      };
    } finally {
      release();
    }
  }

  async readRenderLog(
    identity: RemoteMcpIdentity,
    jobId: string,
    stage: "pdf" | "svg",
    startByte?: number,
    startLine?: number,
    sha256?: string,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const job = this.assertReadableJob(identity.userId, jobId);
    const path = stage === "svg" ? "svg/compile.log" : "compile.log";
    const artifact = this.database.artifacts.getDownloadable(jobId, path, {
      retentionHours: this.artifactRetentionHours,
    });
    if (artifact === undefined) {
      const stored =
        job.status === "expired" ||
        job.status === "deleted" ||
        job.status === "deleting";
      throw new AppError(
        stored ? "LOG_EXPIRED" : "LOG_NOT_FOUND",
        stored
          ? "The compile log has expired"
          : "The compile log is not available",
        stored ? 410 : 404,
      );
    }
    if (sha256 !== undefined && artifact.sha256 !== sha256)
      throw new AppError(
        "LOG_CHANGED",
        "The stored log changed; start a new read",
        409,
      );
    return {
      jobId,
      stage,
      sha256: artifact.sha256,
      ...(await this.logWindow(artifact, startByte, startLine, 8192)),
    };
  }

  private async logWindow(
    artifact: ArtifactRow,
    startByte: number | undefined,
    startLine: number | undefined,
    maxBytes: number,
  ) {
    if (
      (startByte !== undefined &&
        (!Number.isSafeInteger(startByte) ||
          startByte < 0 ||
          startByte > artifact.size ||
          startLine !== undefined)) ||
      (startLine !== undefined &&
        (!Number.isSafeInteger(startLine) || startLine < 1))
    )
      throw new AppError("LOG_RANGE_INVALID", "Invalid compile log range", 416);

    const release = await this.acquireInlineArtifactBytes(maxBytes);
    try {
      return await this.withArtifactLease(artifact, async (path, signal) => {
        const file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size !== artifact.size)
            throw new AppError(
              "LOG_UNAVAILABLE",
              "The stored compile log cannot be read",
              409,
            );
          let start = startByte ?? Math.max(0, artifact.size - maxBytes);
          if (startLine !== undefined)
            start = await locateLogLine(
              file,
              startLine,
              AbortSignal.any([signal, AbortSignal.timeout(3000)]),
            );
          const bytes = Buffer.alloc(Math.min(maxBytes, artifact.size - start));
          const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
          signal.throwIfAborted();
          if (bytesRead !== bytes.length)
            throw new AppError(
              "LOG_UNAVAILABLE",
              "The stored compile log cannot be read",
              409,
            );
          // Avoid cutting a UTF-8 code point at the end of a requested page.
          let end = bytesRead;
          if (start + bytesRead < artifact.size) {
            const leading = Buffer.alloc(1);
            while (end > 0) {
              const next = await file.read(leading, 0, 1, start + end);
              if (next.bytesRead !== 1)
                throw new AppError(
                  "LOG_UNAVAILABLE",
                  "The stored compile log cannot be read",
                  409,
                );
              if ((leading.readUInt8(0) & 0xc0) !== 0x80) break;
              end--;
            }
          }
          let begin = 0;
          if (start > 0 && startLine === undefined)
            while (begin < end && (bytes.readUInt8(begin) & 0xc0) === 0x80)
              begin++;
          return {
            startByte: start + begin,
            endByte: start + end,
            totalBytes: artifact.size,
            startLine: startLine ?? (start === 0 ? 1 : null),
            nextByte: start + end < artifact.size ? start + end : null,
            text: sanitizeLog(bytes.subarray(begin, end).toString("utf8")),
          };
        } finally {
          await file.close();
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "LOG_UNAVAILABLE",
        "The stored compile log cannot be read",
        409,
      );
    } finally {
      release();
    }
  }

  private async withArtifactLease<T>(
    artifact: ArtifactRow,
    read: (path: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let releaseLease: (() => void) | undefined;
    try {
      // Admission may wait behind other reads. Recheck retention and register
      // protection together only after the memory budget is actually acquired.
      const leaseId = this.database.transaction(() => {
        const current = this.database.artifacts.getDownloadable(
          artifact.job_id,
          artifact.relative_path,
          { retentionHours: this.artifactRetentionHours },
        );
        if (current === undefined || current.id !== artifact.id)
          throw new AppError(
            "ARTIFACT_NOT_FOUND",
            "Artifact is no longer available",
            404,
          );
        const id = newId("download");
        this.database.artifacts.createLease({
          id,
          jobId: artifact.job_id,
          artifactId: current.id,
          createdAt: nowIso(),
          expiresAt: new Date(
            Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
          ).toISOString(),
        });
        return id;
      });
      const controller = new AbortController();
      releaseLease = protectArtifactDownloadLeases(
        this.database.artifacts,
        [leaseId],
        () =>
          controller.abort(
            new AppError(
              "ARTIFACT_UNAVAILABLE",
              "Artifact download protection was lost",
              503,
            ),
          ),
      );
      return await read(this.artifactPath(artifact), controller.signal);
    } finally {
      releaseLease?.();
    }
  }

  private runtimeDigest() {
    return this.rendererVersion.match(/(?:^|@)(sha256:[a-f0-9]{64})$/)?.[1] ?? null;
  }

  capabilities(identity: RemoteMcpIdentity): RemoteRendererCapabilities {
    requireScope(identity.scopes, "mcp:read");
    const direct = this.directSourceLimits();
    return {
      rendererVersion: this.rendererVersion,
      texliveVersion: "2026",
      runtimeDigest: this.runtimeDigest(),
      engineVerification: "unknown",
      maxInlineArtifactBytes: this.maxInlineArtifactBytes,
      engines: ["lualatex"],
      shellEscape: false,
      networkAccess: false,
      maxCompileSeconds: 300,
      maxPdfPages: 100,
      outputs: ["pdf", "svg"],
      sourceLimits: {
        inlineBytes: Math.min(
          INLINE_SOURCE_MAX_BYTES,
          direct.fileBytes,
          direct.contentBytes,
        ),
        directBytes: direct.contentBytes,
        directFiles: direct.files,
        directFileBytes: direct.fileBytes,
        uploadBytes: this.resourceLimits.maxUploadBytes,
        files: this.resourceLimits.maxFileCount,
        fileBytes: this.resourceLimits.maxUploadBytes,
        chunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      },
    };
  }

  async verifiedCapabilities(
    identity: RemoteMcpIdentity,
  ): Promise<RemoteRendererCapabilities> {
    const capabilities = this.capabilities(identity);
    if (capabilities.runtimeDigest === null) return capabilities;
    try {
      const file = await open(
        join(this.environmentRoot, "engines.json"),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const metadata = await file.stat();
        if (!metadata.isFile() || metadata.size > 4096) return capabilities;
        const bytes = Buffer.alloc(metadata.size);
        const { bytesRead } = await file.read(bytes);
        if (bytesRead !== metadata.size) return capabilities;
        const proof = JSON.parse(bytes.toString("utf8")) as {
          schemaVersion?: unknown;
          runtimeImage?: unknown;
          engines?: unknown;
        } | null;
        if (
          proof?.schemaVersion !== 1 ||
          proof.runtimeImage !== this.rendererVersion ||
          !Array.isArray(proof.engines) ||
          proof.engines.length > renderEngineSchema.options.length
        )
          return capabilities;
        const engineOutputs: NonNullable<
          RemoteRendererCapabilities["engineOutputs"]
        >[number][] = [];
        const seen = new Set<RenderEngine>();
        for (const entry of proof.engines as unknown[]) {
          if (typeof entry !== "object" || entry === null) return capabilities;
          const item = entry as {
            engine?: unknown;
            pdf?: unknown;
            svg?: unknown;
            placement?: unknown;
          };
          const result = renderEngineSchema.safeParse(item.engine);
          if (
            !result.success ||
            seen.has(result.data) ||
            typeof item.pdf !== "boolean" ||
            typeof item.svg !== "boolean" ||
            typeof item.placement !== "boolean" ||
            (item.placement && !item.svg) ||
            (item.svg && !item.pdf)
          )
            return capabilities;
          seen.add(result.data);
          engineOutputs.push({
            engine: result.data,
            pdf: item.pdf,
            svg: item.svg,
            placement: item.placement,
          });
        }
        const engines = engineOutputs
          .filter(({ pdf }) => pdf)
          .map(({ engine }) => engine);
        return engines.includes(defaultRenderEngine)
          ? {
              ...capabilities,
              engines,
              engineOutputs,
              engineVerification: "verified",
            }
          : capabilities;
      } finally {
        await file.close();
      }
    } catch {
      return capabilities;
    }
  }

  async taggedJapaneseProfile(
    identity: RemoteMcpIdentity,
    fixtureSha256: string,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const runtimeDigest = this.capabilities(identity).runtimeDigest;
    let verified = false;
    if (runtimeDigest !== null) {
      try {
        const file = await open(
          join(this.environmentRoot, "authoring-profiles.json"),
          "r",
        );
        try {
          const info = await file.stat();
          if (info.isFile() && info.size <= 4096) {
            const bytes = Buffer.alloc(info.size);
            if ((await file.read(bytes)).bytesRead === info.size) {
              const value = JSON.parse(bytes.toString("utf8")) as {
                schemaVersion?: number;
                runtimeImage?: string;
                profile?: string;
                fixtureSha256?: string;
                machineChecks?: unknown;
              } | null;
              verified =
                value?.schemaVersion === 1 &&
                value.runtimeImage === this.rendererVersion &&
                value.profile === "tagged-ja-v1" &&
                value.fixtureSha256 === fixtureSha256 &&
                Array.isArray(value.machineChecks) &&
                ["pdf-structure", "tagged", "japanese-text"].every((check) =>
                  (value.machineChecks as unknown[]).includes(check),
                );
            }
          }
        } finally {
          await file.close();
        }
      } catch {
        // Missing or stale evidence leaves this profile unavailable.
      }
    }
    return {
      id: "tagged-ja-v1",
      runtimeDigest,
      fixtureSha256,
      engine: "lualatex" as const,
      documentClass: "article",
      state: verified
        ? ("verified_tagged_fixture" as const)
        : ("not_checked" as const),
      guideTopic: "accessibility",
      templateTopic: "japanese-tagged",
      readingOrder: "not_checked" as const,
      pdfUa: "not_checked" as const,
    };
  }

  async documentRequirements(
    identity: RemoteMcpIdentity,
    engine: RenderEngine,
    requirements: readonly DocumentRequirement[],
    revision?: {
      projectId: string;
      revisionId: string;
      inspectEntrypoint?: boolean | undefined;
    },
  ) {
    requireScope(identity.scopes, "mcp:read");
    const saved =
      revision === undefined
        ? null
        : this.savedRevisionSource(
            identity,
            revision.projectId,
            revision.revisionId,
          );
    const entrypoint =
      saved && revision?.inspectEntrypoint
        ? await this.getProjectRevisionFile(
            identity,
            saved.revision.projectId,
            saved.revision.revisionId,
            saved.entrypoint,
          )
        : null;
    const sourceCandidates = entrypoint && {
      path: entrypoint.path,
      sha256: entrypoint.sha256,
      coverage: "literal_entrypoint_declarations" as const,
      ...staticEntrypointRequirements(
        entrypoint.text,
        entrypoint.nextOffset !== null,
      ),
    };
    const capabilities = await this.verifiedCapabilities(identity);
    const inventory = await (this.requirementInventory ??=
      new DocumentRequirementInventory(
        this.environmentRoot,
        this.rendererVersion,
      )).check(requirements);
    return {
      version: 1 as const,
      runtimeDigest: capabilities.runtimeDigest,
      engine,
      engineState: capabilities.engineOutputs?.some(
        (item) => item.engine === engine && item.pdf,
      )
        ? ("verified" as const)
        : ("not_checked" as const),
      inventoryVersion: inventory.inventoryVersion,
      requirementFingerprint: requirementsFingerprint({
        engine,
        requirements,
        saved: saved?.revision ?? null,
        inspectEntrypoint: revision?.inspectEntrypoint === true,
      }),
      revision: saved?.revision ?? null,
      sourceCandidates,
      items: inventory.items,
    };
  }

  documentProbe(identity: RemoteMcpIdentity, input: DocumentProbe) {
    requireScope(identity.scopes, "mcp:render");
    this.assertMaintenance();
    const probe = documentProbeSchema.parse(input);
    const runtimeDigest = this.runtimeDigest();
    if (runtimeDigest === null)
      throw new AppError(
        "DOCUMENT_PROBE_RUNTIME_UNVERIFIED",
        "The active Runtime is not pinned",
        503,
      );
    const result = this.database.transaction(() =>
      this.database.documentProbes.request(
        identity.userId,
        this.rendererVersion,
        probe,
        nowIso(),
      ),
    );
    return {
      probeId: result.id,
      requestFingerprint: result.fingerprint,
      runtimeDigest,
      input: probe,
      scope: "isolated_synthetic_document" as const,
      state: result.status,
      code: result.result_code,
      expiresAt: result.expires_at,
    };
  }

  private requirementInventory?: DocumentRequirementInventory;

  async checkPackages(
    identity: RemoteMcpIdentity,
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    requireScope(identity.scopes, "mcp:read");
    return checkEnvironmentNames(
      names,
      (await this.environmentIndex()).packages,
    );
  }

  async searchPackages(
    identity: RemoteMcpIdentity,
    query: string,
    cursor = 0,
  ): Promise<RemoteEnvironmentSearch> {
    requireScope(identity.scopes, "mcp:read");
    return searchEnvironmentNames(
      query,
      cursor,
      (await this.environmentIndex()).packages,
    );
  }

  async checkFonts(
    identity: RemoteMcpIdentity,
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    requireScope(identity.scopes, "mcp:read");
    return checkEnvironmentNames(names, (await this.environmentIndex()).fonts);
  }

  async searchFonts(
    identity: RemoteMcpIdentity,
    query: string,
    cursor = 0,
  ): Promise<RemoteEnvironmentSearch> {
    requireScope(identity.scopes, "mcp:read");
    return searchEnvironmentNames(
      query,
      cursor,
      (await this.environmentIndex()).fonts,
    );
  }

  cancel(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:cancel");
    this.assertOwned(identity.userId, jobId);
    if (this.database.jobs.cancel(jobId, nowIso()) !== 1)
      throw new AppError("JOB_NOT_CANCELABLE", "Job is not cancelable", 409);
    return this.job({ ...identity, scopes: ["mcp"] }, jobId);
  }

  delete(
    identity: RemoteMcpIdentity,
    jobId: string,
  ): { jobId: string; accepted: true } {
    requireScope(identity.scopes, "mcp:delete");
    this.assertOwned(identity.userId, jobId);
    if (this.database.jobs.markDeleting(jobId, nowIso()) !== 1)
      throw new AppError("JOB_NOT_DELETABLE", "Job is not deletable", 409);
    return { jobId, accepted: true };
  }

  enforceRateLimit(userId: string, toolName: string, limit: number): void {
    const minute = new Date();
    minute.setUTCSeconds(0, 0);
    const count = this.database.remoteMcp.incrementRateLimit(
      userId,
      toolName,
      minute.toISOString(),
    );
    if (count > limit)
      throw new AppError(
        "REMOTE_MCP_RATE_LIMIT",
        "Remote MCP tool rate limit exceeded",
        429,
        { retryAfterSeconds: 60 },
      );
  }

  auditToolCall(
    identity: RemoteMcpIdentity,
    toolName: string,
    result: "success" | "failure",
    metadata: Readonly<Record<string, unknown>> = {},
  ): void {
    this.database.audit({
      actorType: "oauth",
      actorId: identity.userId,
      action: `remote_mcp.tool.${toolName}`,
      targetType: "remote_mcp_tool",
      targetId: toolName,
      result,
      metadata,
    });
  }

  private async appendSourceChunk(
    userId: string,
    uploadId: string,
    offset: number,
    base64: string,
  ): Promise<RemoteSourceUpload> {
    const source = this.assertOwnedSource(userId, uploadId);
    if (source.status === "ready") this.resolveOwnedSource(userId, uploadId);
    if (source.status !== "ready" && source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status !== "ready" && source.status !== "uploading")
      throw new AppError(
        "SOURCE_UPLOAD_STATE",
        "Source upload is not active",
        409,
      );
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new AppError(
        "SOURCE_UPLOAD_OFFSET",
        "Chunk offset is invalid",
        400,
      );
    const bytes = decodeBase64(base64);
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > SOURCE_UPLOAD_CHUNK_MAX_BYTES
    )
      throw new AppError(
        "SOURCE_UPLOAD_CHUNK_SIZE",
        "Chunk must contain between 1 byte and 512 KiB",
        400,
      );
    if (source.status === "ready") {
      if (offset + bytes.byteLength > source.size)
        throw uploadOffsetMismatch(source.size);
      const handle = await open(this.sourcePath(source), "r");
      try {
        const received = Buffer.alloc(bytes.byteLength);
        const { bytesRead } = await handle.read(
          received,
          0,
          received.length,
          offset,
        );
        if (bytesRead !== bytes.length || !received.equals(bytes))
          throw uploadOffsetMismatch(source.size);
      } finally {
        await handle.close();
      }
      return uploadProgress(source, source.size);
    }
    const leaseOwner = `remote-mcp:${process.pid}:${randomUUID()}`,
      timestamp = nowIso(),
      leaseExpiresAt = new Date(
        Date.now() + SOURCE_UPLOAD_LEASE_MS,
      ).toISOString(),
      leased = this.database.sources.claimUploadLease(
        uploadId,
        userId,
        leaseOwner,
        timestamp,
        leaseExpiresAt,
      );
    if (leased === undefined)
      throw new AppError(
        "SOURCE_UPLOAD_CONCURRENT",
        "Another chunk or finalize operation is using this upload",
        409,
      );
    try {
      const path = this.sourcePath(leased),
        current = await stat(path),
        chunks = this.sourceUploadChunkRoot(leased),
        expectedOffset = leased.upload_received_bytes;
      // Pre-v15 partial uploads were written in place and cannot safely be
      // fenced after an upgrade. Fail closed rather than letting a stale
      // writer race a new instance; clients can begin a fresh upload.
      if (current.size !== 0)
        throw new AppError(
          "SOURCE_UPLOAD_STATE",
          "Source upload uses an unsafe legacy staging format; start a new upload",
          409,
        );
      try {
        if (!(await stat(chunks)).isDirectory())
          throw new Error("not a directory");
      } catch {
        throw new AppError(
          "SOURCE_UPLOAD_STATE",
          "Source upload uses an unsafe legacy staging format; start a new upload",
          409,
        );
      }
      if (offset < expectedOffset && offset + bytes.length <= expectedOffset) {
        const prior = await readFile(join(chunks, String(offset))).catch(
          (error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
              return undefined;
            throw error;
          },
        );
        if (prior?.equals(bytes)) return uploadProgress(leased, expectedOffset);
      }
      if (offset !== expectedOffset) throw uploadOffsetMismatch(expectedOffset);
      if (offset + bytes.byteLength > leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_OVERFLOW",
          "Chunk exceeds the declared Source size",
          400,
        );
      await writeUploadChunk(chunks, offset, bytes);
      const nextOffset = offset + bytes.byteLength;
      if (
        this.database.transaction(() => {
          assertSourceWritable(this.database);
          return this.database.sources.commitUploadOffset(
            uploadId,
            leaseOwner,
            expectedOffset,
            nextOffset,
            nowIso(),
          );
        }) !== 1
      )
        throw new AppError(
          "SOURCE_UPLOAD_CONCURRENT",
          "Source upload lease expired or changed while writing",
          409,
        );
      return uploadProgress(leased, nextOffset);
    } finally {
      this.database.sources.releaseUploadLease(uploadId, leaseOwner);
    }
  }

  private async completeSourceUpload(
    userId: string,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    const source = this.assertOwnedSource(userId, uploadId);
    if (source.status === "ready")
      return this.summarizeSource(
        this.resolveOwnedSource(userId, uploadId),
        null,
      );
    if (source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status !== "uploading")
      throw new AppError(
        "SOURCE_UPLOAD_STATE",
        "Source upload is not active",
        409,
      );
    const leaseOwner = `remote-mcp:${process.pid}:${randomUUID()}`,
      leased = this.database.sources.claimUploadLease(
        uploadId,
        userId,
        leaseOwner,
        nowIso(),
        new Date(Date.now() + SOURCE_UPLOAD_LEASE_MS).toISOString(),
      );
    if (leased === undefined)
      throw new AppError(
        "SOURCE_UPLOAD_CONCURRENT",
        "Another chunk or finalize operation is using this upload",
        409,
      );
    const heartbeatState: { error?: AppError } = {};
    const assertHeartbeat = (): void => {
      if (heartbeatState.error !== undefined) throw heartbeatState.error;
    };
    const renewLease = (): void => {
        assertSourceWritable(this.database);
        const timestamp = nowIso();
        if (
          this.database.sources.extendUploadLease(
            uploadId,
            leaseOwner,
            timestamp,
            new Date(Date.now() + SOURCE_UPLOAD_LEASE_MS).toISOString(),
          ) !== 1
        )
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload lease expired or changed while finalizing",
            409,
          );
      },
      heartbeat = setInterval(
        () => {
          if (heartbeatState.error !== undefined) return;
          try {
            renewLease();
          } catch (error) {
            heartbeatState.error =
              error instanceof AppError
                ? error
                : new AppError(
                    "SOURCE_UPLOAD_CONCURRENT",
                    "Source upload lease could not be renewed",
                    409,
                  );
          }
        },
        Math.floor(SOURCE_UPLOAD_LEASE_MS / 3),
      );
    heartbeat.unref();
    try {
      const path = this.sourcePath(leased),
        current = await stat(path);
      if (!current.isFile() || leased.upload_received_bytes !== leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_MISMATCH",
          "Uploaded Source size does not match the durable upload offset",
          422,
        );
      if (current.size !== 0 && current.size !== leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_MISMATCH",
          "Source upload storage does not match the durable upload offset",
          422,
        );
      const assembled =
        current.size === leased.size
          ? path
          : await assembleUploadChunks(
              this.sourceUploadChunkRoot(leased),
              path,
              leaseOwner,
              leased.size,
            );
      let inspection: string | undefined;
      try {
        const digest = await sha256File(assembled),
          verified = await stat(assembled);
        assertHeartbeat();
        renewLease();
        if (verified.size !== leased.size || digest !== leased.sha256)
          throw new AppError(
            "SOURCE_UPLOAD_MISMATCH",
            "Uploaded Source size or SHA-256 does not match",
            422,
          );
        inspection = await mkdtemp(
          join(this.storageRoot, `.remote-source-${leased.id}-`),
        );
        const result = await validateAndExtract(
            assembled,
            inspection,
            this.zipLimits(),
            "",
          ),
          timestamp = nowIso(),
          expiresAt = this.sourceRetentionExpiresAt();
        assertHeartbeat();
        renewLease();
        if (assembled !== path) {
          await rename(assembled, path);
          await syncDirectory(dirname(path));
        }
        if (
          this.database.transaction(() => {
            assertSourceWritable(this.database);
            return this.database.sources.completeUpload(
              leased.id,
              leaseOwner,
              timestamp,
              expiresAt,
              JSON.stringify([...result.paths].sort()),
            );
          }) !== 1
        )
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload lease expired or changed while finalizing",
            409,
          );
        clearInterval(heartbeat);
        await rm(this.sourceUploadChunkRoot(leased), {
          recursive: true,
          force: true,
        });
        const ready = this.database.sources.get(leased.id);
        if (ready === undefined)
          throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
        return this.summarizeSource(ready, null);
      } finally {
        // The temporary assembled archive is only promoted after all checks.
        await Promise.all([
          ...(assembled !== path ? [rm(assembled, { force: true })] : []),
          ...(inspection !== undefined
            ? [rm(inspection, { recursive: true, force: true })]
            : []),
        ]);
      }
    } finally {
      clearInterval(heartbeat);
      this.database.sources.releaseUploadLease(uploadId, leaseOwner);
    }
  }

  private async storeReadySource(
    userId: string,
    archive: Buffer,
    paths: readonly string[],
    onReady?: (sourceId: string) => void,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const sha256 = sha256Hex(archive),
      existing = this.database.sources.findReady(
        userId,
        sha256,
        archive.byteLength,
        nowIso(),
      );
    if (existing !== undefined) {
      if (onReady !== undefined)
        this.database.transaction(() => onReady(existing.id));
      return existing;
    }
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, archive.byteLength);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: userId,
        size: archive.byteLength,
        sha256,
        storageKey,
        timestamp,
        expiresAt: stagingExpiresAt,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await writeFile(path, archive, {
        flag: "wx",
        mode: 0o660,
        flush: onReady !== undefined,
      });
      if (onReady !== undefined) {
        await syncDirectory(dirname(path));
        await syncDirectory(dirname(dirname(path)));
      }
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "ready",
          nowIso(),
          {
            uploaded_at: nowIso(),
            expires_at: expiresAt,
            paths_json: JSON.stringify(paths),
          },
        );
        onReady?.(sourceId);
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    const source = this.database.sources.get(sourceId);
    if (source === undefined)
      throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
    return source;
  }

  /** Promote a revision archive that was streamed to local storage. */
  private async storeReadySourceArchive(
    userId: string,
    archive: string,
    paths: readonly string[],
    onReady?: (sourceId: string) => void,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const metadata = await stat(archive);
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 1 ||
      metadata.size > this.resourceLimits.maxUploadBytes
    )
      throw new AppError(
        "SOURCE_ARCHIVE_SIZE",
        "Source archive size is invalid",
        422,
      );
    const sha256 = await sha256File(archive),
      verified = await stat(archive);
    if (!verified.isFile() || verified.size !== metadata.size)
      throw new AppError(
        "SOURCE_FILE_CHANGED",
        "Source changed while its revision was being archived",
        409,
      );
    const existing = this.database.sources.findReady(
      userId,
      sha256,
      metadata.size,
      nowIso(),
    );
    if (existing !== undefined) {
      if (onReady !== undefined)
        this.database.transaction(() => onReady(existing.id));
      return existing;
    }
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, metadata.size);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: userId,
        size: metadata.size,
        sha256,
        storageKey,
        timestamp,
        expiresAt: stagingExpiresAt,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await rename(archive, path);
      await syncDirectory(dirname(path));
      if (onReady !== undefined) await syncDirectory(dirname(dirname(path)));
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "ready",
          nowIso(),
          {
            uploaded_at: nowIso(),
            expires_at: expiresAt,
            paths_json: JSON.stringify(paths),
          },
        );
        onReady?.(sourceId);
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    const source = this.database.sources.get(sourceId);
    if (source === undefined)
      throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
    return source;
  }

  private async reviseSource(
    userId: string,
    sourceId: string,
    mutation: (root: string) => Promise<void>,
    onReady?: (sourceId: string) => void,
  ): Promise<RemoteSourceSummary> {
    assertSourceWritable(this.database);
    const source = this.resolveOwnedSource(userId, sourceId),
      root = await mkdtemp(
        join(this.storageRoot, `.remote-revision-${source.id}-`),
      );
    try {
      await validateAndExtract(
        this.sourcePath(source),
        root,
        this.zipLimits(),
        "",
      );
      await mutation(root);
      const files = (
          await readDirectoryFiles(root, "", {
            files: 0,
            bytes: 0,
            maxFiles: this.resourceLimits.maxFileCount,
            maxBytes: this.resourceLimits.maxExtractedBytes,
            maxFileBytes: this.resourceLimits.maxUploadBytes,
          })
        ).sort((left, right) => left.path.localeCompare(right.path)),
        paths = files.map((file) => file.path),
        archiveRoot = await mkdtemp(join(this.storageRoot, ".remote-archive-")),
        archive = join(archiveRoot, "source.zip");
      try {
        assertTexSource(paths);
        await writeZipFiles(files, archive, {
          maxArchiveBytes: this.resourceLimits.maxUploadBytes,
          maxExtractedBytes: this.resourceLimits.maxExtractedBytes,
          maxFileBytes: this.resourceLimits.maxUploadBytes,
        });
        // A mutation can introduce case- or Unicode-colliding paths even
        // though each path passed validation on its own. Validate the exact
        // archive the worker will consume before making the Source ready.
        const verified = await validateAndExtract(
          archive,
          join(archiveRoot, "inspection"),
          this.zipLimits(),
          "",
        );
        const revision = await this.storeReadySourceArchive(
          userId,
          archive,
          verified.paths,
          onReady,
        );
        return this.summarizeSource(revision, source.id);
      } finally {
        await rm(archiveRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private summarizeSource(
    source: SourceRow,
    revisionOf: string | null,
  ): RemoteSourceSummary {
    return {
      id: source.id,
      status: source.status,
      size: source.size,
      sha256: source.sha256,
      paths: this.database.sources.paths(source),
      createdAt: source.created_at,
      expiresAt: source.expires_at,
      revisionOf,
    };
  }

  private assertStorageQuota(userId: string, bytes: number): void {
    if (
      bytes >
      this.database.settings.value(
        "max_user_storage_bytes",
        this.maxUserStorageBytes,
      ) -
        this.database.jobs.storageUsageForUser(userId)
    )
      throw new AppError(
        "USER_STORAGE_QUOTA",
        "User storage quota is exhausted",
        429,
      );
  }

  private zipLimits() {
    return {
      maxExtractedBytes: this.resourceLimits.maxExtractedBytes,
      maxFileBytes: this.resourceLimits.maxUploadBytes,
      maxEntries: this.resourceLimits.maxZipEntries,
      maxFiles: this.resourceLimits.maxFileCount,
      maxDepth: 10,
      maxNameLength: 200,
    };
  }

  private directSourceLimits() {
    return {
      files: Math.min(
        DIRECT_SOURCE_MAX_FILES,
        this.resourceLimits.maxFileCount,
      ),
      fileBytes: Math.min(
        DIRECT_SOURCE_MAX_FILE_BYTES,
        this.resourceLimits.maxUploadBytes,
        this.resourceLimits.maxExtractedBytes,
      ),
      contentBytes: Math.min(
        DIRECT_SOURCE_MAX_BYTES,
        this.resourceLimits.maxExtractedBytes,
      ),
    };
  }

  private assertOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.database.sources.getOwned(sourceId, userId);
    if (source === undefined)
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    return source;
  }

  private resolveOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.assertOwnedSource(userId, sourceId);
    if (
      this.database.sources.getOwnedReady(source.id, userId, nowIso()) ===
      undefined
    )
      throw new AppError("SOURCE_NOT_READY", "Source is not ready", 409);
    return source;
  }

  private sourcePath(source: SourceRow): string {
    if (
      source.storage_key.startsWith("/") ||
      source.storage_key.split("/").includes("..")
    )
      throw new AppError(
        "SOURCE_STORAGE_INVALID",
        "Source storage path is invalid",
      );
    return join(this.storageRoot, source.storage_key);
  }

  private sourceUploadChunkRoot(source: SourceRow): string {
    return join(dirname(this.sourcePath(source)), ".chunks");
  }

  private environmentIndex(): Promise<{ packages: string[]; fonts: string[] }> {
    if (this.environmentIndexPromise !== undefined)
      return this.environmentIndexPromise;
    this.environmentIndexPromise = this.loadEnvironmentIndex().finally(() => {
      this.environmentIndexPromise = undefined;
    });
    return this.environmentIndexPromise;
  }

  private async loadEnvironmentIndex(): Promise<{
    packages: string[];
    fonts: string[];
  }> {
    const fingerprint = await environmentFingerprint(
      this.environmentRoot,
      this.rendererVersion,
    );
    const cached = this.environmentIndexCache;
    if (
      cached !== undefined &&
      cached.fingerprint === fingerprint &&
      cached.expiresAt > Date.now()
    )
      return cached.value;
    const [packages, fonts] = await Promise.all([
      readEnvironmentList(join(this.environmentRoot, "packages.txt")),
      readEnvironmentList(join(this.environmentRoot, "fonts.txt")),
    ]);
    const value = { packages, fonts };
    this.environmentIndexCache = {
      fingerprint,
      expiresAt: Date.now() + ENVIRONMENT_INDEX_TTL_MS,
      value,
    };
    return value;
  }

  private ensurePrincipal(userId: string): RemoteMcpPrincipalRow {
    const existing = this.database.remoteMcp.principal(userId);
    if (existing !== undefined) return existing;
    const timestamp = nowIso(),
      principal: RemoteMcpPrincipalRow = {
        user_id: userId,
        service_account_id: newId("sa"),
        api_key_id: newId("key"),
        created_at: timestamp,
      };
    try {
      this.database.transaction(() => {
        this.database.serviceAccounts.insert({
          id: principal.service_account_id,
          ownerUserId: userId,
          // Display names are user-editable, not a reserved identity. Keep a
          // same-named account separate and check under this write transaction.
          name: this.database.serviceAccounts.nameExists(userId, "Remote MCP")
            ? `Remote MCP (${principal.service_account_id})`
            : "Remote MCP",
          clientType: "mcp",
          timestamp,
        });
        this.database.apiKeys.insert({
          id: principal.api_key_id,
          serviceAccountId: principal.service_account_id,
          name: "Remote MCP accounting principal",
          prefix: `oauth_${principal.api_key_id.slice(4)}`,
          kind: "render",
          secretHash: "0".repeat(64),
          pepperId: "oauth-principal",
          scopes: ["oauth:mcp"],
          createdAt: timestamp,
          createdBy: "remote_mcp",
        });
        this.database.remoteMcp.insertPrincipal(principal);
      });
      return principal;
    } catch (error) {
      const raced = this.database.remoteMcp.principal(userId);
      if (raced !== undefined) return raced;
      throw error;
    }
  }

  private resolveSourceRef(userId: string, sourceRef: string): SourceRow {
    const reference = this.database.remoteMcp.sourceRef(
      sourceRef,
      userId,
      nowIso(),
    );
    if (reference === undefined)
      throw new AppError(
        "SOURCE_REF_INVALID",
        "Source reference is invalid",
        404,
      );
    const source = this.database.sources.getOwnedReady(
      reference.source_id,
      userId,
      nowIso(),
    );
    if (source === undefined)
      throw new AppError(
        "SOURCE_NOT_READY",
        "Referenced Source is not ready",
        409,
      );
    return source;
  }

  private async createInlineSource(
    userId: string,
    content: string,
    entrypoint: string,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes < 1 || contentBytes > INLINE_SOURCE_MAX_BYTES)
      throw new AppError(
        "INLINE_SOURCE_SIZE",
        "Inline source must be between 1 byte and 64 KiB",
        400,
      );
    const limits = this.directSourceLimits();
    if (contentBytes > limits.fileBytes)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Inline Source exceeds the configured file limit",
        400,
      );
    if (contentBytes > limits.contentBytes)
      throw new AppError(
        "SOURCE_TOTAL_SIZE",
        "Inline Source exceeds the configured content limit",
        400,
      );
    return this.validateAndStoreSource(
      userId,
      await zipInline(entrypoint, content),
    );
  }

  private assertQueue(userId: string, serviceAccountId: string): void {
    this.assertMaintenance();
    const maxQueueLength = this.database.settings.value(
      "max_queue_length",
      this.maxQueueLength,
    );
    if (this.database.jobs.countActive() >= maxQueueLength)
      throw new AppError("QUEUE_FULL", "Render queue is full", 503);
    if (this.database.jobs.countActiveForServiceAccount(serviceAccountId) >= 5)
      throw new AppError(
        "ACCOUNT_QUEUE_LIMIT",
        "Remote MCP pending job limit reached",
        429,
      );
    const maxUserActiveJobs = this.database.settings.value(
      "max_user_active_jobs",
      20,
    );
    if (this.database.jobs.countActiveForUser(userId) >= maxUserActiveJobs)
      throw new AppError(
        "USER_QUEUE_LIMIT",
        "User pending job limit reached",
        429,
      );
    this.assertStorageQuota(userId, this.maxOutputBytes);
  }

  private assertMaintenance(): void {
    if (
      this.database.settings.value<
        "normal" | "reject-new-jobs" | "read-only" | "lockdown"
      >("maintenance_mode", "normal") !== "normal"
    )
      throw new AppError(
        "MAINTENANCE",
        "New jobs are temporarily unavailable",
        503,
      );
  }

  private sourceRetentionExpiresAt(): string {
    const minutes = this.database.settings.value(
      "source_orphan_retention_minutes",
      SOURCE_RETENTION_MS / 60_000,
    );
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  private assertReadableJob(userId: string, jobId: string): JobRow {
    const visible = this.database.jobs.getVisible(jobId);
    if (
      visible?.user_id === userId &&
      visible.deleted_at === null &&
      this.database.drafts.isOwnedProjectPreview(jobId, userId)
    )
      return visible;
    return this.assertOwned(userId, jobId);
  }

  private assertOwned(userId: string, jobId: string): JobRow {
    const principal = this.ensurePrincipal(userId),
      row = this.database.jobs.getOwned(
        jobId,
        userId,
        principal.service_account_id,
      );
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return row;
  }

  private artifactExpiry(job: JobRow) {
    return artifactRetentionExpiresAt(
      this.database.outputStages.retentionStart(job.id, job.completed_at ?? job.updated_at),
      this.artifactRetentionHours,
    );
  }

  private summarize(row: JobRow): RemoteJobSummary {
    const stages = this.database.outputStages.publicState(row.id);
    const artifacts = this.database.artifacts.listDownloadable(row.id, {
        retentionHours: this.artifactRetentionHours,
      }),
      generatedPages = artifacts
        .filter((artifact) => artifact.type === "preview")
        .map((artifact) => previewPage(artifact.relative_path))
        .filter((page): page is number => page !== null)
        .sort((left, right) => left - right),
      document = this.database.previews.verifiedPdf(row.id, {
        retentionHours: this.artifactRetentionHours,
      })
        ? this.database.previews.document(row.id)
        : undefined,
      previewPages = document
        ? Array.from({ length: document.page_count }, (_, index) => index + 1)
        : generatedPages;
    return {
      id: row.id,
      status: row.status,
      ...this.database.jobs.renderProvenance(row),
      rendererVersion: row.renderer_version,
      sourceId: row.source_id,
      projectRevisionId: row.project_revision_id,
      entrypoint: row.entrypoint,
      outputs: this.database.jobs.outputs(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      retentionExpiresAt: artifacts.length > 0 || row.completed_at !== null
        ? this.artifactExpiry(row)
        : null,
      exitCode: row.exit_code,
      retryOf: row.retry_of_job_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      previewAvailable: previewPages.length > 0,
      previewPages,
      artifacts: artifacts.map((artifact) => ({
        type: artifact.type,
        filename: artifact.relative_path.split("/").at(-1) as string,
        mimeType: artifactMimeType(artifact.type),
        relativePath: artifact.relative_path,
        size: artifact.size,
        sha256: artifact.sha256,
        pageCount: artifact.type === "pdf" ? previewPages.length || null : null,
        resourceUri: resourceUri(row.id, artifact.relative_path),
      })),
      webResultUrl: new URL(
        `/app/jobs/${encodeURIComponent(row.id)}/`,
        this.publicOrigin,
      ).toString(),
      ...(stages === undefined ? {} : { stages }),
    };
  }

  private artifactPath(artifact: ArtifactRow): string {
    return artifactStoragePath(this.storageRoot, artifact);
  }

  private acquireInlineArtifactBytes(bytes: number): Promise<() => void> {
    if (
      this.inlineArtifactBytesInFlight + bytes <=
      REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT
    ) {
      this.inlineArtifactBytesInFlight += bytes;
      return Promise.resolve(() => this.releaseInlineArtifactBytes(bytes));
    }
    return new Promise((resolve) => {
      this.inlineArtifactWaiters.push({ bytes, resolve });
    });
  }

  private releaseInlineArtifactBytes(bytes: number): void {
    this.inlineArtifactBytesInFlight = Math.max(
      0,
      this.inlineArtifactBytesInFlight - bytes,
    );
    while (this.inlineArtifactWaiters.length > 0) {
      const index = this.inlineArtifactWaiters.findIndex(
        (waiter) =>
          this.inlineArtifactBytesInFlight + waiter.bytes <=
          REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT,
      );
      if (index < 0) return;
      const waiter = this.inlineArtifactWaiters.splice(index, 1)[0];
      if (waiter === undefined) return;
      this.inlineArtifactBytesInFlight += waiter.bytes;
      waiter.resolve(() => this.releaseInlineArtifactBytes(waiter.bytes));
    }
  }
}

function artifactMimeType(type: string): string {
  return (
    {
      pdf: "application/pdf",
      log: "text/plain; charset=utf-8",
      errors: "application/json",
      dependencies: "application/json",
      preview: "image/png",
      svg: "image/svg+xml",
      svg_manifest: "application/json",
    }[type] ?? "application/octet-stream"
  );
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

async function readBoundedArtifact(
  path: string,
  expectedSize: number,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    throw error;
  }
  try {
    signal.throwIfAborted();
    const initial = await handle.stat();
    if (
      !initial.isFile() ||
      !Number.isSafeInteger(initial.size) ||
      initial.size !== expectedSize
    )
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact metadata does not match the stored file",
        503,
      );
    if (initial.size > maximumBytes)
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        "Artifact exceeds the MCP inline resource limit",
        413,
      );

    const bytes = Buffer.allocUnsafe(initial.size);
    let offset = 0;
    while (offset < initial.size) {
      signal.throwIfAborted();
      const length = Math.min(ARTIFACT_READ_CHUNK_BYTES, initial.size - offset);
      const result = await handle.read(bytes, offset, length, offset);
      if (result.bytesRead <= 0)
        throw new AppError(
          "ARTIFACT_UNAVAILABLE",
          "Artifact ended before its recorded size",
          503,
        );
      offset += result.bytesRead;
      if (offset > maximumBytes)
        throw new AppError(
          "ARTIFACT_TOO_LARGE",
          "Artifact exceeds the MCP inline resource limit",
          413,
        );
    }
    const final = await handle.stat();
    signal.throwIfAborted();
    if (final.size !== expectedSize)
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact changed while it was being read",
        503,
      );
    return bytes;
  } finally {
    await handle.close();
  }
}

function normalizeRenderOutputs(
  value: Array<"pdf" | "svg"> | undefined,
): Array<"pdf" | "svg"> {
  const result = renderOutputsSchema.safeParse(value);
  if (!result.success)
    throw new AppError("INVALID_OUTPUTS", "Render outputs are invalid", 400);
  return result.data;
}

function previewPage(relativePath: string): number | null {
  const match = /^previews\/page-(\d+)\.png$/.exec(relativePath);
  return match === null ? null : Number(match[1]);
}

function resourceUri(jobId: string, relativePath: string): string {
  if (relativePath === "result.pdf")
    return `latex-renderer://jobs/${jobId}/output.pdf`;
  if (relativePath === "compile.log")
    return `latex-renderer://jobs/${jobId}/build.log`;
  const page = previewPage(relativePath);
  if (page !== null) return `latex-renderer://jobs/${jobId}/preview/${page}`;
  return `latex-renderer://jobs/${jobId}/artifact/${encodeURIComponent(relativePath)}`;
}

type ParsedDiagnosticItem = Omit<RemoteRenderDiagnostic, "severity" | "column">;

function parseDiagnosticsJson(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  const object = parsed as {
    errors?: unknown;
    warnings?: unknown;
    coverage?: unknown;
  };
  const coverage = diagnosticCoverageSchema.safeParse(object.coverage);
  const count = (entries: unknown): number =>
    Array.isArray(entries) ? Math.max(0, entries.length - 500) : 0;
  return {
    errors: diagnosticItems(object.errors, "latex-error"),
    warnings: diagnosticItems(object.warnings, "latex-warning"),
    coverage: coverage.success ? coverage.data : null,
    storedListOmitted: count(object.errors) + count(object.warnings),
  };
}

function diagnosticItems(
  value: unknown,
  fallbackType: string,
): ParsedDiagnosticItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.message !== "string") return [];
    const logLine = candidate.logLine;
    return [
      {
        type:
          typeof candidate.type === "string"
            ? candidate.type.slice(0, 100)
            : fallbackType,
        file:
          typeof candidate.file === "string"
            ? candidate.file.slice(0, 500)
            : null,
        line:
          typeof candidate.line === "number" &&
          Number.isSafeInteger(candidate.line)
            ? candidate.line
            : null,
        message: candidate.message.slice(0, 2000),
        ...(typeof logLine === "number" &&
        Number.isSafeInteger(logLine) &&
        logLine > 0
          ? { logLine }
          : {}),
        ...(candidate.messageTruncated === true ||
        candidate.message.length > 2000
          ? { messageTruncated: true }
          : {}),
        ...(typeof candidate.tool === "string"
          ? { tool: candidate.tool.slice(0, 50) }
          : {}),
      },
    ];
  });
}

function diagnosticLogExcerpt(
  text: string,
  entries: readonly RemoteRenderDiagnostic[],
) {
  const lines = text.split(/\r?\n/);
  const needle = entries
    .find((item) => item.severity === "error")
    ?.message.slice(0, 160);
  const match = needle ? lines.findIndex((line) => line.includes(needle)) : -1;
  const start =
    match < 0 ? Math.max(0, lines.length - 80) : Math.max(0, match - 12);
  const end = match < 0 ? lines.length : Math.min(lines.length, match + 12);
  return {
    text: lines.slice(start, end).join("\n"),
    truncated: start > 0 || end < lines.length,
  };
}

function sanitizeLog(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex -- renderer logs are untrusted input.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g,
    "",
  );
}

async function locateLogLine(
  file: Awaited<ReturnType<typeof open>>,
  line: number,
  signal: AbortSignal,
): Promise<number> {
  if (line === 1) return 0;
  const bytes = Buffer.alloc(64 * 1024);
  let position = 0;
  let current = 1;
  for (;;) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(bytes, 0, bytes.length, position);
    if (bytesRead === 0)
      throw new AppError(
        "LOG_RANGE_INVALID",
        "Log line is outside the stored log",
        416,
      );
    const window = bytes.subarray(0, bytesRead);
    for (let at = window.indexOf(10); at >= 0; at = window.indexOf(10, at + 1))
      if (++current === line) return position + at + 1;
    position += bytesRead;
  }
}

function requireScope(
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

async function zipInline(entrypoint: string, content: string): Promise<Buffer> {
  return zipFiles([{ path: entrypoint, bytes: Buffer.from(content, "utf8") }]);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest("hex");
}

function uploadProgress(
  source: SourceRow,
  receivedBytes: number,
): RemoteSourceUpload {
  return {
    uploadId: source.id,
    sourceId: source.id,
    expectedBytes: source.size,
    receivedBytes,
    expiresAt: source.expires_at,
    maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
  };
}

function uploadOffsetMismatch(expectedOffset: number): AppError {
  return new AppError(
    "SOURCE_UPLOAD_OFFSET",
    "Chunk does not match the accepted Source data or offset",
    409,
    { expectedOffset },
  );
}

async function writeUploadChunk(
  root: string,
  offset: number,
  bytes: Buffer,
): Promise<void> {
  const temporary = join(root, `.pending-${randomUUID()}`),
    target = join(root, String(offset));
  try {
    const handle = await open(temporary, "wx", 0o660);
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const result = await handle.write(
          bytes,
          written,
          bytes.byteLength - written,
          written,
        );
        if (result.bytesWritten <= 0)
          throw new AppError(
            "SOURCE_UPLOAD_IO",
            "Failed to write Source chunk",
            503,
          );
        written += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // link(2) is create-only: unlike rename it cannot replace a chunk left
      // by a stale writer whose lease has expired.
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // A writer may have linked the exact same chunk just before losing
        // its lease. Its DB CAS will fail, but an identical client retry can
        // safely adopt those immutable bytes and advance the durable offset.
        const existing = await readFile(target);
        if (existing.byteLength !== bytes.byteLength || !existing.equals(bytes))
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload chunk was written by another instance",
            409,
          );
      } else {
        throw error;
      }
    }
    await syncDirectory(root);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assembleUploadChunks(
  root: string,
  sourcePath: string,
  leaseOwner: string,
  expectedBytes: number,
): Promise<string> {
  const archive = `${sourcePath}.finalizing-${leaseOwner}`,
    // Acquire ownership before cleanup can remove the destination. A failed
    // exclusive open must never unlink another writer's archive.
    output = await open(archive, "wx", 0o660);
  let offset = 0;
  try {
    try {
      while (offset < expectedBytes) {
        const path = join(root, String(offset)),
          metadata = await stat(path);
        if (
          !metadata.isFile() ||
          !Number.isSafeInteger(metadata.size) ||
          metadata.size < 1 ||
          metadata.size > SOURCE_UPLOAD_CHUNK_MAX_BYTES ||
          offset + metadata.size > expectedBytes
        )
          throw new AppError(
            "SOURCE_UPLOAD_MISMATCH",
            "Uploaded Source chunks do not match the durable offset",
            422,
          );
        for await (const chunk of createReadStream(path)) {
          await output.writeFile(chunk as Buffer);
        }
        offset += metadata.size;
      }
      await output.sync();
    } finally {
      await output.close();
    }
    return archive;
  } catch (error) {
    await rm(archive, { force: true });
    throw error;
  }
}

async function zipFiles(
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
): Promise<Buffer> {
  const zip = new yazl.ZipFile(),
    stream = new PassThrough(),
    chunks: Buffer[] = [];
  addZipFiles(zip, files, ZIP_LIMITS);
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
    zip.outputStream.once("error", reject);
    zip.once("error", reject);
  });
  zip.outputStream.pipe(stream);
  zip.end();
  await completed;
  await assertZipInputsUnchanged(files);
  return Buffer.concat(chunks);
}

/** Build a revision ZIP on disk, bounded by configured archive limits. */
async function writeZipFiles(
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
  destination: string,
  limits: {
    maxArchiveBytes: number;
    maxExtractedBytes: number;
    maxFileBytes: number;
  },
): Promise<void> {
  const zip = new yazl.ZipFile();
  const outputStream = zip.outputStream as Readable;
  addZipFiles(zip, files, {
    maxExtractedBytes: limits.maxExtractedBytes,
    maxFileBytes: limits.maxFileBytes,
  });
  zip.on("error", (error: Error) => outputStream.destroy(error));
  const completed = pipeline(
    outputStream,
    boundedArchiveStream(limits.maxArchiveBytes),
    createWriteStream(destination, { flags: "wx", mode: 0o660 }),
  );
  try {
    zip.end();
    await completed;
    await assertZipInputsUnchanged(files);
  } catch (error) {
    outputStream.destroy();
    await completed.catch(() => {});
    await rm(destination, { force: true });
    throw error;
  }
}

function boundedArchiveStream(maximum: number) {
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maximum) {
        callback(
          new AppError(
            "SOURCE_ARCHIVE_SIZE",
            "Source archive exceeds the configured upload limit",
            422,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

function addZipFiles(
  zip: yazl.ZipFile,
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
  limits: Pick<typeof ZIP_LIMITS, "maxExtractedBytes" | "maxFileBytes">,
): void {
  let totalBytes = 0;
  for (const file of files) {
    const size = file.bytes?.byteLength ?? file.size ?? -1;
    if (!Number.isSafeInteger(size) || size < 0)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file size is invalid",
        422,
      );
    if (size > limits.maxFileBytes)
      throw new AppError(
        "ZIP_FILE_TOO_LARGE",
        "Source file exceeds limit",
        422,
      );
    totalBytes += size;
    if (totalBytes > limits.maxExtractedBytes)
      throw new AppError("ZIP_BOMB", "Source content exceeds limit", 422);
  }
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (file.bytes !== undefined)
      zip.addBuffer(file.bytes, file.path, {
        mode: 0o600,
        mtime: new Date(0),
      });
    else if (file.absolutePath !== undefined) {
      const size = file.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "Source file size is invalid",
          422,
        );
      zip.addReadStreamLazy(
        file.path,
        {
          mode: 0o600,
          mtime: new Date(0),
          // Bound the stream to the size checked by readDirectoryFiles.  A
          // file that grows while the archive is being built cannot make the
          // archive exceed the extracted-byte limit.
          size,
        },
        (callback) => {
          if (size === 0) {
            callback(null, Readable.from([]));
            return;
          }
          callback(
            null,
            createReadStream(file.absolutePath as string, {
              start: 0,
              end: size - 1,
            }),
          );
        },
      );
    } else throw new Error(`Source file has no readable content: ${file.path}`);
  }
}

async function assertZipInputsUnchanged(
  files: readonly {
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
): Promise<void> {
  for (const file of files) {
    if (file.absolutePath === undefined) continue;
    const metadata = await stat(file.absolutePath);
    if (!metadata.isFile() || metadata.size !== file.size)
      throw new AppError(
        "SOURCE_FILE_CHANGED",
        "Source changed while its revision was being archived",
        409,
      );
  }
}

async function readDirectoryFiles(
  root: string,
  relative = "",
  state: {
    files: number;
    bytes: number;
    maxFiles: number;
    maxBytes: number;
    maxFileBytes: number;
  } = {
    files: 0,
    bytes: 0,
    maxFiles: ZIP_LIMITS.maxFiles,
    maxBytes: ZIP_LIMITS.maxExtractedBytes,
    maxFileBytes: ZIP_LIMITS.maxFileBytes,
  },
): Promise<Array<{ path: string; absolutePath: string; size: number }>> {
  const directory = join(root, ...relative.split("/").filter(Boolean)),
    entries = await readdir(directory, { withFileTypes: true }),
    files: Array<{ path: string; absolutePath: string; size: number }> = [];
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await readDirectoryFiles(root, path, state)));
    else if (entry.isFile()) {
      const absolutePath = join(root, ...path.split("/")),
        metadata = await stat(absolutePath);
      if (!metadata.isFile())
        throw new AppError(
          "SOURCE_FILE_TYPE",
          "Source contains an unsupported file type",
          422,
        );
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "Source file size is invalid",
          422,
        );
      state.files += 1;
      if (state.files > state.maxFiles)
        throw new AppError(
          "ZIP_TOO_MANY_FILES",
          "Source file count exceeds limit",
          422,
        );
      if (metadata.size > state.maxFileBytes)
        throw new AppError(
          "ZIP_FILE_TOO_LARGE",
          "Source file exceeds limit",
          422,
        );
      state.bytes += metadata.size;
      if (state.bytes > state.maxBytes)
        throw new AppError("ZIP_BOMB", "Source content exceeds limit", 422);
      files.push({
        path: validateSourceFilePath(path),
        absolutePath,
        size: metadata.size,
      });
    } else
      throw new AppError(
        "SOURCE_FILE_TYPE",
        "Source contains an unsupported file type",
        422,
      );
  }
  return files;
}

function assertTexSource(paths: readonly string[]): void {
  if (!paths.some((path) => path.toLowerCase().endsWith(".tex")))
    throw new AppError(
      "TEX_ENTRYPOINT_MISSING",
      "Source must contain at least one .tex file",
      422,
    );
}

function decodeBase64(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new AppError(
      "INVALID_BASE64",
      "Binary Source content is invalid",
      400,
    );
  return Buffer.from(value, "base64");
}

async function readEnvironmentList(path: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError(
        "ENVIRONMENT_INVENTORY_UNAVAILABLE",
        "Renderer environment inventory is unavailable",
        503,
      );
    throw error;
  }
  return [
    ...new Set(
      content
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

async function environmentFingerprint(
  root: string,
  rendererVersion: string,
): Promise<string> {
  const entries = await Promise.all(
    ["packages.txt", "fonts.txt"].map(async (name) => {
      try {
        const info = await stat(join(root, name));
        return `${name}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return `${name}:missing`;
        throw error;
      }
    }),
  );
  return `${rendererVersion}|${entries.join("|")}`;
}

function checkEnvironmentNames(
  names: readonly string[],
  available: readonly string[],
): Array<{ name: string; available: boolean }> {
  if (names.length < 1 || names.length > 50)
    throw new AppError(
      "ENVIRONMENT_NAME_COUNT",
      "Between 1 and 50 names are required",
      400,
    );
  const normalized = new Set(available.map((name) => name.toLocaleLowerCase()));
  return names.map((name) => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 200)
      throw new AppError(
        "ENVIRONMENT_NAME",
        "Package or font name is invalid",
        400,
      );
    return {
      name: trimmed,
      available: normalized.has(trimmed.toLocaleLowerCase()),
    };
  });
}

function searchEnvironmentNames(
  query: string,
  cursor: number,
  available: readonly string[],
): RemoteEnvironmentSearch {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length < 1 || normalizedQuery.length > 100)
    throw new AppError(
      "ENVIRONMENT_QUERY",
      "Search query must be between 1 and 100 characters",
      400,
    );
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new AppError("ENVIRONMENT_CURSOR", "Search cursor is invalid", 400);
  const all = available.filter((name) =>
      name.toLocaleLowerCase().includes(normalizedQuery),
    ),
    matches = all.slice(cursor, cursor + 50),
    next = cursor + matches.length;
  return {
    query,
    matches,
    nextCursor: next < all.length ? String(next) : null,
  };
}

function sourceFileKind(path: string): "text" | "binary" {
  return [".png", ".jpg", ".jpeg", ".pdf"].includes(extname(path).toLowerCase())
    ? "binary"
    : "text";
}

async function readSavedSource<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EACCES")
    )
      throw new AppError(
        "SOURCE_ARCHIVE_UNAVAILABLE",
        "Saved Source archive is unavailable",
        409,
      );
    throw error;
  }
}

function replaceExactDraftText(
  text: string,
  patch: Extract<DraftFileChange, { patch: unknown }>["patch"],
  maxBytes: number,
): Buffer {
  if (sha256Hex(text) !== patch.expectedSha256)
    throw new AppError(
      "DRAFT_PATCH_MISMATCH",
      "The draft file does not match the expected digest",
      409,
    );
  if (
    !Number.isSafeInteger(patch.expectedMatches) ||
    patch.expectedMatches < 1 ||
    patch.expectedMatches > 100 ||
    patch.original.length === 0
  )
    throw new AppError(
      "DRAFT_PATCH_INVALID",
      "Invalid patch match requirement",
      422,
    );
  let matches = 0;
  for (
    let offset = text.indexOf(patch.original);
    offset !== -1;
    offset = text.indexOf(patch.original, offset + patch.original.length)
  ) {
    if (++matches > patch.expectedMatches) break;
  }
  if (
    matches !== patch.expectedMatches ||
    countOverlappingMatches(text, patch.original, matches) !== matches
  )
    throw new AppError(
      "DRAFT_PATCH_MISMATCH",
      "The patch does not match the expected number of non-overlapping locations",
      409,
    );
  const resultBytes =
    Buffer.byteLength(text) +
    matches *
      (Buffer.byteLength(patch.replacement) -
        Buffer.byteLength(patch.original));
  if (resultBytes > maxBytes)
    throw new AppError(
      "SOURCE_FILE_SIZE",
      "Patched file exceeds the direct file limit",
      422,
    );
  return Buffer.from(
    text.replaceAll(patch.original, () => patch.replacement),
    "utf8",
  );
}

function countOverlappingMatches(
  text: string,
  value: string,
  limit: number,
): number {
  let matches = 0;
  for (
    let offset = text.indexOf(value);
    offset !== -1;
    offset = text.indexOf(value, offset + 1)
  ) {
    if (++matches > limit) break;
  }
  return matches;
}

class DraftEditReplayed extends Error {
  constructor(readonly version: number) {
    super("The edit was accepted by another request");
  }
}

function draftVersionConflict(currentVersion: number | undefined) {
  return new AppError(
    "DRAFT_VERSION_CONFLICT",
    "The draft has changed since it was loaded",
    409,
    {
      currentVersion: currentVersion ?? null,
    },
  );
}

function sourceTextPage(text: string, offset: number) {
  const isLowSurrogate = (at: number) =>
    (text.charCodeAt(at) & 0xfc00) === 0xdc00;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    isLowSurrogate(offset)
  )
    throw new AppError("SOURCE_FILE_RANGE", "Invalid UTF-16 offset", 416);
  let end = Math.min(offset + 4000, text.length);
  if (isLowSurrogate(end)) end--;
  return {
    text: text.slice(offset, end),
    unit: "utf16" as const,
    offset,
    nextOffset: end < text.length ? end : null,
    totalUnits: text.length,
  };
}
