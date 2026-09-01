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
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { PassThrough, Readable, Transform } from "node:stream";
import type {
  JobRow,
  RemoteMcpAuthorizationCodeRow,
  RemoteMcpPrincipalRow,
  RemoteMcpTokenRow,
  RendererDatabase,
  SourceRow,
} from "@latex-renderer/database";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  newId,
  nowIso,
  randomSecret,
  sha256Hex,
  type ResourceLimits,
} from "@latex-renderer/shared";
import {
  validateAndExtract,
  validateEntrypointPath,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import yazl from "yazl";

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
// A second request that was already in flight when rotation committed may
// arrive just after the first response. Keep that short retry window from
// revoking the family; a later replay still triggers strict reuse detection.
const REFRESH_REPLAY_GRACE_MS = 5_000;
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
const UNUSED_OAUTH_CLIENT_MS = 24 * 60 * 60_000;
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

export class RemoteOAuthService {
  constructor(
    private readonly database: RendererDatabase,
    readonly issuer: string,
    readonly resource: string,
    private readonly clock: () => number = Date.now,
  ) {}

  registerClient(input: {
    clientName: string;
    redirectUris: readonly string[];
  }): {
    clientId: string;
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
    return {
      clientId,
      clientName: client.client_name,
      redirectUri,
      ...(state === undefined ? {} : { state }),
      scopes: normalizeScopes(params.get("scope")),
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
    return response;
  }

  refresh(input: {
    refreshToken: string;
    clientId: string;
    resource: string;
  }): OAuthTokenResponse {
    const timestamp = this.now();
    this.cleanupOAuth(timestamp);
    const tokenHash = sha256Hex(input.refreshToken);
    const result = this.database.transaction(() => {
      // Re-read while holding BEGIN IMMEDIATE. A caller that fetched the old
      // row before another rotation must observe the committed CAS result.
      const token = this.database.remoteMcp.token(tokenHash);
      if (token === undefined || token.token_type !== "refresh")
        return {
          kind: "invalid",
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
          message: "Refresh token binding is invalid",
        } as const;
      if (token.used_at !== null) {
        if (withinRefreshReplayGrace(token.used_at, timestamp))
          return {
            kind: "invalid",
            message: "Refresh token is already being retried",
          } as const;
        this.database.remoteMcp.revokeFamily(token.family_id, timestamp);
        return {
          kind: "invalid",
          message: "Refresh token reuse revoked the grant",
        } as const;
      }
      if (!this.isActiveToken(token, timestamp))
        return {
          kind: "invalid",
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
          message: "User authorization changed",
        } as const;
      }
      if (this.database.remoteMcp.consumeRefresh(tokenHash, timestamp) !== 1)
        return {
          kind: "invalid",
          message: "Refresh token is already being retried",
        } as const;
      return {
        kind: "issued",
        response: this.issueTokens(
          token.family_id,
          normalizeStoredScopes(token.scopes_json),
          token.sequence + 1,
          timestamp,
        ),
      } as const;
    });
    if (result.kind !== "issued")
      throw new AppError("INVALID_GRANT", result.message, 400);
    return result.response;
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
}

export interface RemoteJobSummary {
  id: string;
  status: JobRow["status"];
  engine: "lualatex";
  rendererVersion: string;
  sourceId: string | null;
  entrypoint: string;
  outputs: Array<"pdf" | "svg">;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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
}

export interface RemoteRenderDiagnostic {
  severity: "error" | "warning";
  type: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

export interface RemoteRenderDiagnostics {
  jobId: string;
  status: JobRow["status"];
  engine: "lualatex";
  diagnostics: RemoteRenderDiagnostic[];
  logExcerpt: string;
  rawLogResourceUri: string | null;
  retryable: boolean;
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
  engines: readonly ["lualatex"];
  shellEscape: false;
  networkAccess: false;
  maxCompileSeconds: number;
  maxPdfPages: number;
  outputs: readonly ["pdf", "svg"];
  sourceLimits: {
    directBytes: number;
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
        Math.min(Date.now() + SOURCE_REF_MS, Date.parse(source.expires_at)),
      ).toISOString();
    this.database.remoteMcp.insertSourceRef({
      id: sourceRef,
      source_id: sourceId,
      owner_user_id: userId,
      created_at: timestamp,
      expires_at: expiresAt,
      revoked_at: null,
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

  async createSource(
    identity: RemoteMcpIdentity,
    files: readonly RemoteSourceFileInput[],
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    if (files.length < 1 || files.length > DIRECT_SOURCE_MAX_FILES)
      throw new AppError(
        "SOURCE_FILE_COUNT",
        `A direct Source must contain between 1 and ${DIRECT_SOURCE_MAX_FILES} files`,
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
      if (bytes.byteLength > DIRECT_SOURCE_MAX_FILE_BYTES)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "A direct Source file exceeds the 1 MiB limit",
          400,
        );
      totalBytes += bytes.byteLength;
      if (totalBytes > DIRECT_SOURCE_MAX_BYTES)
        throw new AppError(
          "SOURCE_TOTAL_SIZE",
          "Direct Source content exceeds the 4 MiB limit",
          400,
        );
      prepared.push({ path, bytes });
    }
    prepared.sort((left, right) => left.path.localeCompare(right.path));
    assertTexSource(prepared.map((file) => file.path));
    const archive = await zipFiles(prepared),
      source = await this.storeReadySource(
        identity.userId,
        archive,
        prepared.map((file) => file.path),
      );
    return this.summarizeSource(source, null);
  }

  async beginSourceUpload(
    identity: RemoteMcpIdentity,
    expectedBytes: number,
    sha256: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
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

  async uploadSourceChunk(
    identity: RemoteMcpIdentity,
    uploadId: string,
    offset: number,
    base64: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
    return this.appendSourceChunk(identity.userId, uploadId, offset, base64);
  }

  async finalizeSourceUpload(
    identity: RemoteMcpIdentity,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    return this.completeSourceUpload(identity.userId, uploadId);
  }

  async updateSourceFile(
    identity: RemoteMcpIdentity,
    sourceId: string,
    file: RemoteSourceFileInput,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
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

  async createRender(
    identity: RemoteMcpIdentity,
    input:
      | {
          inlineSource: string;
          entrypoint?: string | undefined;
          outputs?: Array<"pdf" | "svg">;
        }
      | {
          sourceRef: string;
          entrypoint?: string | undefined;
          outputs?: Array<"pdf" | "svg">;
        }
      | {
          sourceId: string;
          entrypoint?: string | undefined;
          outputs?: Array<"pdf" | "svg">;
        },
  ): Promise<RemoteJobSummary> {
    requireScope(identity.scopes, "mcp:render");
    this.assertMaintenance();
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      outputs = normalizeRenderOutputs(input.outputs),
      principal = this.ensurePrincipal(identity.userId),
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
    const jobId = newId("job"),
      timestamp = nowIso();
    this.database.transaction(() => {
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
    });
    const created = this.database.jobs.get(jobId);
    if (created === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Render job was not created");
    return this.summarize(created);
  }

  retryRender(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:render");
    this.assertMaintenance();
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
    this.resolveOwnedSource(identity.userId, sourceId);
    const retryId = newId("job"),
      timestamp = nowIso();
    this.database.transaction(() => {
      this.assertQueue(identity.userId, previous.service_account_id);
      const currentSource = this.database.sources.getReady(sourceId, timestamp);
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
    });
    const retry = this.database.jobs.get(retryId);
    if (retry === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Retry Job was not created");
    return this.summarize(retry);
  }

  job(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:read");
    const principal = this.ensurePrincipal(identity.userId),
      row = this.database.jobs.getOwned(
        jobId,
        identity.userId,
        principal.service_account_id,
      );
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return this.summarize(row);
  }

  async diagnostics(
    identity: RemoteMcpIdentity,
    jobId: string,
  ): Promise<RemoteRenderDiagnostics> {
    requireScope(identity.scopes, "mcp:read");
    const row = this.assertOwned(identity.userId, jobId),
      available = this.database.artifacts.listDownloadable(jobId),
      errorsArtifact = available.find(
        (artifact) => artifact.relative_path === "errors.json",
      ),
      logArtifact = available.find(
        (artifact) => artifact.relative_path === "compile.log",
      ),
      parsed =
        errorsArtifact === undefined
          ? { errors: [], warnings: [] }
          : parseDiagnosticsJson(
              await readFile(
                this.artifactPath(jobId, errorsArtifact.relative_path),
                "utf8",
              ),
            ),
      diagnostics: RemoteRenderDiagnostic[] = [
        ...parsed.errors.map((item) => ({
          severity: "error" as const,
          type: "latex-error",
          file: item.file,
          line: item.line,
          column: null,
          message: item.message,
        })),
        ...parsed.warnings.map((item) => ({
          severity: "warning" as const,
          type: item.type,
          file: item.file,
          line: item.line,
          column: null,
          message: item.message,
        })),
      ],
      log =
        logArtifact === undefined
          ? ""
          : await readFile(
              this.artifactPath(jobId, logArtifact.relative_path),
              "utf8",
            ),
      rawLogResourceUri =
        logArtifact === undefined
          ? null
          : resourceUri(jobId, logArtifact.relative_path);
    return {
      jobId,
      status: row.status,
      engine: "lualatex",
      diagnostics,
      logExcerpt: logExcerpt(log, diagnostics),
      rawLogResourceUri,
      retryable: ["failed", "timeout", "rejected"].includes(row.status),
    };
  }

  async artifact(
    identity: RemoteMcpIdentity,
    jobId: string,
    relativePath: string,
  ): Promise<RemoteArtifactContent> {
    requireScope(identity.scopes, "mcp:read");
    this.assertOwned(identity.userId, jobId);
    const artifact = this.database.artifacts.getDownloadable(
      jobId,
      relativePath,
    );
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
        relativePath,
        mimeType: artifactMimeType(artifact.type),
        size: artifact.size,
        sha256: artifact.sha256,
        bytes: await readBoundedArtifact(
          this.artifactPath(jobId, relativePath),
          artifact.size,
          this.maxInlineArtifactBytes,
        ),
      };
    } finally {
      release();
    }
  }

  capabilities(identity: RemoteMcpIdentity): RemoteRendererCapabilities {
    requireScope(identity.scopes, "mcp:read");
    return {
      rendererVersion: this.rendererVersion,
      texliveVersion: "2026",
      engines: ["lualatex"],
      shellEscape: false,
      networkAccess: false,
      maxCompileSeconds: 300,
      maxPdfPages: 100,
      outputs: ["pdf", "svg"],
      sourceLimits: {
        directBytes: DIRECT_SOURCE_MAX_BYTES,
        uploadBytes: this.resourceLimits.maxUploadBytes,
        files: this.resourceLimits.maxFileCount,
        fileBytes: this.resourceLimits.maxUploadBytes,
        chunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      },
    };
  }

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
    if (source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status === "ready")
      return {
        uploadId: source.id,
        sourceId: source.id,
        expectedBytes: source.size,
        receivedBytes: source.size,
        expiresAt: source.expires_at,
        maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      };
    if (source.status !== "uploading")
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
      if (offset !== expectedOffset)
        throw new AppError(
          "SOURCE_UPLOAD_OFFSET",
          "Chunk offset does not match received bytes",
          409,
          { expectedOffset },
        );
      if (offset + bytes.byteLength > leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_OVERFLOW",
          "Chunk exceeds the declared Source size",
          400,
        );
      await writeUploadChunk(chunks, offset, bytes);
      const nextOffset = offset + bytes.byteLength;
      if (
        this.database.sources.commitUploadOffset(
          uploadId,
          leaseOwner,
          expectedOffset,
          nextOffset,
          nowIso(),
        ) !== 1
      )
        throw new AppError(
          "SOURCE_UPLOAD_CONCURRENT",
          "Source upload lease expired or changed while writing",
          409,
        );
      return {
        uploadId: leased.id,
        sourceId: leased.id,
        expectedBytes: leased.size,
        receivedBytes: nextOffset,
        expiresAt: leased.expires_at,
        maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      };
    } finally {
      this.database.sources.releaseUploadLease(uploadId, leaseOwner);
    }
  }

  private async completeSourceUpload(
    userId: string,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    const source = this.assertOwnedSource(userId, uploadId);
    if (source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status === "ready") return this.summarizeSource(source, null);
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
              ),
        digest = await sha256File(assembled),
        verified = await stat(assembled);
      assertHeartbeat();
      renewLease();
      if (verified.size !== leased.size || digest !== leased.sha256)
        throw new AppError(
          "SOURCE_UPLOAD_MISMATCH",
          "Uploaded Source size or SHA-256 does not match",
          422,
        );
      const inspection = await mkdtemp(
        join(this.storageRoot, `.remote-source-${leased.id}-`),
      );
      try {
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
          this.database.sources.completeUpload(
            leased.id,
            leaseOwner,
            timestamp,
            expiresAt,
            JSON.stringify([...result.paths].sort()),
          ) !== 1
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
        if (assembled !== path) await rm(assembled, { force: true });
        await rm(inspection, { recursive: true, force: true });
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
  ): Promise<SourceRow> {
    const sha256 = sha256Hex(archive),
      existing = this.database.sources.findReady(
        userId,
        sha256,
        archive.byteLength,
        nowIso(),
      );
    if (existing !== undefined) return existing;
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, archive.byteLength);
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
      await writeFile(path, archive, { flag: "wx", mode: 0o660 });
      this.database.transaction(() => {
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
  ): Promise<SourceRow> {
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
    if (existing !== undefined) return existing;
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, metadata.size);
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
      this.database.transaction(() => {
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
  ): Promise<RemoteSourceSummary> {
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
        const revision = await this.storeReadySourceArchive(
          userId,
          archive,
          paths,
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

  private assertOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.database.sources.getOwned(sourceId, userId);
    if (source === undefined)
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    return source;
  }

  private resolveOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.assertOwnedSource(userId, sourceId);
    if (source.status !== "ready" || source.expires_at <= nowIso())
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
          name: "Remote MCP",
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
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes < 1 || contentBytes > INLINE_SOURCE_MAX_BYTES)
      throw new AppError(
        "INLINE_SOURCE_SIZE",
        "Inline source must be between 1 byte and 64 KiB",
        400,
      );
    const archive = await zipInline(entrypoint, content),
      sha256 = sha256Hex(archive),
      existing = this.database.sources.findReady(
        userId,
        sha256,
        archive.byteLength,
        nowIso(),
      );
    if (existing !== undefined) return existing;
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, archive.byteLength);
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
      await writeFile(path, archive, { flag: "wx", mode: 0o660 });
      this.database.transaction(() => {
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "ready",
          nowIso(),
          {
            uploaded_at: nowIso(),
            expires_at: expiresAt,
            paths_json: JSON.stringify([entrypoint]),
          },
        );
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

  private summarize(row: JobRow): RemoteJobSummary {
    const artifacts = this.database.artifacts.listDownloadable(row.id),
      previewPages = artifacts
        .filter((artifact) => artifact.type === "preview")
        .map((artifact) => previewPage(artifact.relative_path))
        .filter((page): page is number => page !== null)
        .sort((left, right) => left - right);
    return {
      id: row.id,
      status: row.status,
      engine: "lualatex",
      rendererVersion: row.renderer_version,
      sourceId: row.source_id,
      entrypoint: row.entrypoint,
      outputs: this.database.jobs.outputs(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
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
        `/admin/jobs/?job=${encodeURIComponent(row.id)}`,
        this.publicOrigin,
      ).toString(),
    };
  }

  private artifactPath(jobId: string, relativePath: string): string {
    return join(this.storageRoot, "jobs", jobId, "output", relativePath);
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
    Math.abs(now - used) <= REFRESH_REPLAY_GRACE_MS
  );
}

async function readBoundedArtifact(
  path: string,
  expectedSize: number,
  maximumBytes: number,
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
  const outputs = value ?? ["pdf"];
  if (
    outputs.length < 1 ||
    outputs.length > 2 ||
    !outputs.includes("pdf") ||
    new Set(outputs).size !== outputs.length
  )
    throw new AppError("INVALID_OUTPUTS", "Render outputs are invalid", 400);
  return outputs;
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

interface ParsedDiagnosticItem {
  type: string;
  file: string | null;
  line: number | null;
  message: string;
}

function parseDiagnosticsJson(value: string): {
  errors: ParsedDiagnosticItem[];
  warnings: ParsedDiagnosticItem[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  const object = parsed as { errors?: unknown; warnings?: unknown };
  return {
    errors: diagnosticItems(object.errors, "latex-error"),
    warnings: diagnosticItems(object.warnings, "latex-warning"),
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
      },
    ];
  });
}

function logExcerpt(
  log: string,
  diagnostics: readonly RemoteRenderDiagnostic[],
): string {
  const sanitized = log
      // eslint-disable-next-line no-control-regex -- renderer logs are untrusted input.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g, "")
      .slice(0, 4 * 1024 * 1024),
    lines = sanitized.split(/\r?\n/),
    needle = diagnostics.find((item) => item.severity === "error")?.message,
    matched =
      needle === undefined
        ? -1
        : lines.findIndex((line) => line.includes(needle.slice(0, 160))),
    end = matched >= 0 ? Math.min(lines.length, matched + 12) : lines.length,
    start = matched >= 0 ? Math.max(0, matched - 12) : Math.max(0, end - 80);
  return lines.slice(start, end).join("\n").slice(0, 16_384);
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
    output = createWriteStream(archive, { flags: "wx", mode: 0o660 });
  let offset = 0;
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
        if (!output.write(chunk)) await once(output, "drain");
      }
      offset += metadata.size;
    }
    output.end();
    await once(output, "finish");
    const handle = await open(archive, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return archive;
  } catch (error) {
    output.destroy();
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
  const zip = new yazl.ZipFile(),
    output = createWriteStream(destination, { flags: "wx", mode: 0o660 });
  let totalBytes = 0;
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > limits.maxArchiveBytes) {
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
  addZipFiles(zip, files, {
    maxExtractedBytes: limits.maxExtractedBytes,
    maxFileBytes: limits.maxFileBytes,
  });
  const completed = new Promise<void>((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
    bound.once("error", reject);
    zip.outputStream.once("error", reject);
    zip.once("error", reject);
  });
  zip.outputStream.pipe(bound).pipe(output);
  zip.end();
  try {
    await completed;
    await assertZipInputsUnchanged(files);
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
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
