import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import {
  appendSetCookies,
  type BrowserAuthenticationService,
} from "@latex-renderer/auth";
import type { RendererDatabase } from "@latex-renderer/database";
import {
  REMOTE_MCP_SCOPES,
  RemoteOAuthService,
  type AuthorizationRequest,
} from "@latex-renderer/remote-mcp-core";
import { AppError, parseBearer, safeError } from "@latex-renderer/shared";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface RemoteMcpAppDependencies {
  database: RendererDatabase;
  browserAuth: BrowserAuthenticationService;
  oauth: RemoteOAuthService;
  mcp: McpHttpHandler;
  publicOrigin: string;
}

const registerSchema = z
  .object({
    client_name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !hasControlCharacters(value)),
    redirect_uris: z.array(z.url().max(2048)).min(1).max(10),
    token_endpoint_auth_method: z.literal("none").optional(),
    grant_types: z
      .array(z.enum(["authorization_code", "refresh_token"]))
      .min(1)
      .max(2)
      .optional(),
    response_types: z.array(z.literal("code")).length(1).optional(),
  })
    .loose();

const OAUTH_CSRF_COOKIE = "oauth_csrf";
const OAUTH_CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function createRemoteMcpApp(deps: RemoteMcpAppDependencies) {
  const app = new Hono<{
      Variables: {
        mcpAccess: ReturnType<RemoteOAuthService["verifyAccessToken"]>;
      };
    }>(),
    registrationLimiter = new AnonymousRegistrationLimiter();
  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store, no-cache, max-age=0");
    c.header("Cloudflare-CDN-Cache-Control", "no-store");
    c.header("CDN-Cache-Control", "no-store");
    await next();
  });
  app.use("*", async (c, next) => {
    const expected = new URL(deps.publicOrigin).host.toLowerCase(),
      host = c.req.header("Host")?.toLowerCase();
    if (
      host !== expected &&
      host !== "127.0.0.1:3104" &&
      host !== "localhost:3104" &&
      host !== "[::1]:3104"
    )
      throw new AppError("INVALID_HOST", "Host is not allowed", 400);
    await next();
  });
  app.use("/mcp", async (c, next) => {
    try {
      c.set(
        "mcpAccess",
        deps.oauth.verifyAccessToken(
          parseBearer(c.req.header("Authorization")),
        ),
      );
    } catch {
      return mcpAuthenticationChallenge(deps.publicOrigin);
    }
    await next();
  });
  app.use("/mcp", async (c, next) => {
    c.req.raw = await boundedRequest(c.req.raw, 8 * 1024 * 1024);
    await next();
  });

  const oauthMetadata = {
      issuer: deps.oauth.issuer,
      authorization_endpoint: `${deps.publicOrigin}/oauth/authorize`,
      token_endpoint: `${deps.publicOrigin}/oauth/token`,
      registration_endpoint: `${deps.publicOrigin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: REMOTE_MCP_SCOPES,
    },
    resourceMetadata = {
      resource: deps.oauth.resource,
      authorization_servers: [deps.oauth.issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: REMOTE_MCP_SCOPES,
      resource_name: "LaTeX Renderer Remote MCP",
      resource_documentation: `${deps.publicOrigin}/docs/mcp/`,
    };
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json(oauthMetadata),
  );
  app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
    c.json(resourceMetadata),
  );
  app.get("/.well-known/oauth-protected-resource", (c) =>
    c.json(resourceMetadata),
  );

  app.post("/oauth/register", async (c) => {
    if (c.req.header("Content-Type")?.split(";", 1)[0] !== "application/json")
      throw new AppError(
        "INVALID_REQUEST",
        "Registration request must be JSON",
        400,
      );
    registrationLimiter.consume(trustedClientAddress(c.req.raw));
    const parsed = registerSchema.safeParse(await readJson(c.req.raw, 16_384));
    if (!parsed.success)
      throw new AppError(
        "INVALID_CLIENT_METADATA",
        "OAuth client metadata is invalid",
        400,
      );
    const client = deps.oauth.registerClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
    });
    return c.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  });

  app.get("/oauth/authorize", async (c) => {
    const request = deps.oauth.validateAuthorizationRequest(
        new URL(c.req.url).searchParams,
      ),
      session = await establishOrRedirect(deps, c.req.raw),
      csrf = randomBytes(24).toString("base64url");
    if (session instanceof Response) return session;
    appendSetCookies(c.res.headers, session.cookies);
    c.header(
      "Set-Cookie",
      `${oauthCsrfCookieName(csrf)}=${csrf}; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
      { append: true },
    );
    // Keep the legacy cookie as a compatibility alias. POST validation uses
    // the state-specific cookie first, so multiple consent tabs are isolated.
    c.header(
      "Set-Cookie",
      `${OAUTH_CSRF_COOKIE}=${csrf}; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
      { append: true },
    );
    return c.html(
      consentPage(request, request.clientName, session.principal.user.id, csrf),
    );
  });

  app.post("/oauth/authorize", async (c) => {
    const principal = deps.browserAuth.authenticateSession(c.req.raw);
    if (principal === undefined)
      throw new AppError("LOGIN_REQUIRED", "A browser login is required", 401);
    deps.browserAuth.requireExactOrigin(c.req.raw);
    const body = await readForm(c.req.raw, 16_384),
      csrf = stringField(body.get("csrf")),
      cookie = parseCookie(
        c.req.header("Cookie"),
        OAUTH_CSRF_TOKEN_PATTERN.test(csrf)
          ? oauthCsrfCookieName(csrf)
          : "",
      ) || parseCookie(c.req.header("Cookie"), OAUTH_CSRF_COOKIE);
    if (!safeEqual(csrf, cookie))
      throw new AppError(
        "OAUTH_CSRF",
        "Authorization confirmation expired",
        403,
      );
    const params = new URLSearchParams();
    for (const name of [
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "resource",
      "code_challenge",
      "code_challenge_method",
      "state",
    ]) {
      const value = body.get(name);
      if (value !== null && value !== "") params.set(name, value);
    }
    const request = deps.oauth.validateAuthorizationRequest(params),
      userId = principal.user.id;
    c.header(
      "Set-Cookie",
      `${oauthCsrfCookieName(csrf)}=; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    c.header(
      "Set-Cookie",
      `${OAUTH_CSRF_COOKIE}=; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      { append: true },
    );
    if (body.get("decision") !== "approve") {
      const redirect = new URL(request.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      if (request.state !== undefined)
        redirect.searchParams.set("state", request.state);
      return c.redirect(redirect.toString(), 303);
    }
    return c.redirect(deps.oauth.authorize(userId, request).toString(), 303);
  });

  app.post("/oauth/token", async (c) => {
    const type = c.req.header("Content-Type")?.split(";", 1)[0];
    if (type !== "application/x-www-form-urlencoded")
      throw new AppError(
        "INVALID_REQUEST",
        "Token request must be form encoded",
        400,
      );
    const form = await readForm(c.req.raw, 16_384),
      grant = stringField(form.get("grant_type")),
      clientId = stringField(form.get("client_id")),
      resource = stringField(form.get("resource")),
      tokens =
        grant === "authorization_code"
          ? deps.oauth.exchangeAuthorizationCode({
              code: stringField(form.get("code")),
              clientId,
              redirectUri: stringField(form.get("redirect_uri")),
              codeVerifier: stringField(form.get("code_verifier")),
              resource,
            })
          : grant === "refresh_token"
            ? deps.oauth.refresh({
                refreshToken: stringField(form.get("refresh_token")),
                clientId,
                resource,
              })
            : (() => {
                throw new AppError(
                  "UNSUPPORTED_GRANT_TYPE",
                  "OAuth grant type is not supported",
                  400,
                );
              })();
    return c.json(tokens);
  });

  app.all("/mcp", async (c) => {
    const access = c.get("mcpAccess");
    return deps.mcp.fetch(c.req.raw, {
      authInfo: {
        token: access.token,
        clientId: access.clientId,
        scopes: access.scopes,
        expiresAt: Math.floor(Date.parse(access.expiresAt) / 1000),
        resource: new URL(access.resource),
        extra: { userId: access.userId },
      },
    });
  });

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.onError((error, c) => {
    const safe = safeError(error),
      oauth = c.req.path.startsWith("/oauth/");
    console.error(
      JSON.stringify({
        event: "remote_mcp.error",
        code: safe.code,
        path: c.req.path,
        requestId: c.get("requestId"),
      }),
    );
    return c.json(
      oauth
        ? { error: oauthErrorCode(safe.code), error_description: safe.message }
        : { error: { code: safe.code, message: safe.message } },
      safe.status as 400,
    );
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );
  return app;
}

class AnonymousRegistrationLimiter {
  private readonly secret = randomBytes(32);
  private readonly entries = new Map<
    string,
    { count: number; windowStartedAt: number }
  >();

  consume(address: string, timestamp = Date.now()): void {
    const windowMs = 15 * 60_000;
    for (const [key, entry] of this.entries)
      if (entry.windowStartedAt + windowMs <= timestamp)
        this.entries.delete(key);
    const key = createHmac("sha256", this.secret).update(address).digest("hex");
    const previous = this.entries.get(key);
    if (previous === undefined) {
      if (this.entries.size >= 10_000)
        throw new AppError(
          "OAUTH_REGISTRATION_BUSY",
          "OAuth client registration is temporarily unavailable",
          503,
        );
      this.entries.set(key, { count: 1, windowStartedAt: timestamp });
      return;
    }
    if (previous.count >= 10)
      throw new AppError(
        "OAUTH_REGISTRATION_RATE_LIMIT",
        "Too many OAuth client registrations",
        429,
      );
    previous.count += 1;
  }
}

function trustedClientAddress(request: Request): string {
  for (const name of ["CF-Connecting-IP", "X-Latex-Renderer-Client-IP"]) {
    const value = request.headers.get(name)?.trim();
    if (value !== undefined && isIP(value) !== 0) return value;
  }
  return "unavailable";
}

function mcpAuthenticationChallenge(publicOrigin: string): Response {
  const metadataUrl = `${publicOrigin}/.well-known/oauth-protected-resource/mcp`;
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: "A valid Remote MCP access token is required",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`,
      },
    },
  );
}

async function establishOrRedirect(
  deps: RemoteMcpAppDependencies,
  request: Request,
) {
  try {
    return await deps.browserAuth.establishSession(request);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
    const target = `${new URL(request.url).pathname}${new URL(request.url).search}`;
    const login =
      deps.browserAuth.mode === "oidc"
        ? `/auth/oidc/start?return_to=${encodeURIComponent(target)}`
        : `/login/?return_to=${encodeURIComponent(target)}`;
    return Response.redirect(new URL(login, deps.publicOrigin), 302);
  }
}

function consentPage(
  request: AuthorizationRequest,
  clientName: string,
  _userId: string,
  csrf: string,
): string {
  const fields: Record<string, string | undefined> = {
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scopes.join(" "),
    resource: request.resource,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    state: request.state,
    csrf,
  };
  const scopes = request.scopes
    .map(
      (scope) =>
        `<li><code>${escapeHtml(scope)}</code> — ${escapeHtml(scopeDescription(scope))}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Remote MCPを承認 | LaTeX Renderer</title><link rel="stylesheet" href="/assets/styles.css"></head><body><header class="site-header"><strong><a href="/">LaTeX Renderer</a></strong></header><main><div class="hero"><p class="eyebrow">Remote MCP</p><h1>接続を承認</h1><p><strong>${escapeHtml(clientName)}</strong> がLaTeX Rendererへの接続を要求しています。</p></div><section class="card"><h2>許可する操作</h2><ul>${scopes}</ul><p class="muted">許可すると、この接続はあなたが所有するSourceとジョブだけを操作できます。</p><form class="actions" method="post" action="/oauth/authorize">${Object.entries(
    fields,
  )
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join(
      "",
    )}<button type="submit" name="decision" value="approve">接続を許可</button><button class="secondary" type="submit" name="decision" value="deny">拒否</button></form></section></main></body></html>`;
}

function scopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    mcp: "レンダリングの作成・確認・中止・削除",
    "mcp:render": "レンダリングジョブの作成",
    "mcp:read": "ジョブ状態と成果物メタデータの確認",
    "mcp:cancel": "実行中ジョブの中止",
    "mcp:delete": "終了済みジョブの削除",
  };
  return descriptions[scope] ?? scope;
}

function stringField(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("INVALID_REQUEST", "OAuth form field is missing", 400);
  return value;
}

function parseCookie(header: string | undefined, name: string): string {
  if (header === undefined) return "";
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function oauthCsrfCookieName(token: string): string {
  return `${OAUTH_CSRF_COOKIE}_${token}`;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] as string,
  );
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function readJson(request: Request, maximum: number): Promise<unknown> {
  const text = await readLimitedBody(request, maximum);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(
      "INVALID_REQUEST",
      "Request body is not valid JSON",
      400,
    );
  }
}

async function readForm(
  request: Request,
  maximum: number,
): Promise<URLSearchParams> {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0] !==
    "application/x-www-form-urlencoded"
  )
    throw new AppError("INVALID_REQUEST", "Request must be form encoded", 400);
  return new URLSearchParams(await readLimitedBody(request, maximum));
}

async function readLimitedBody(
  request: Request,
  maximum: number,
): Promise<string> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
      throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
  }
  if (request.body === null)
    throw new AppError("INVALID_REQUEST", "Request body is required", 400);
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new AppError(
      "INVALID_REQUEST",
      "Request body is not valid UTF-8",
      400,
    );
  }
}

async function boundedRequest(
  request: Request,
  maximum: number,
): Promise<Request> {
  if (request.body === null) return request;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && !/^(?:0|[1-9][0-9]{0,9})$/.test(declared))
    throw new AppError(
      "INVALID_CONTENT_LENGTH",
      "Content-Length is invalid",
      400,
    );
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError(
        "REQUEST_TOO_LARGE",
        "MCP request body is too large",
        413,
      );
    }
    chunks.push(value);
  }
  if (declared !== null && Number(declared) !== length)
    throw new AppError(
      "CONTENT_LENGTH_MISMATCH",
      "Content-Length does not match the request body",
      400,
    );
  return new Request(request, {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function oauthErrorCode(code: string): string {
  const known: Record<string, string> = {
    INVALID_CLIENT: "invalid_client",
    INVALID_GRANT: "invalid_grant",
    INVALID_SCOPE: "invalid_scope",
    INVALID_TARGET: "invalid_target",
    INVALID_REQUEST: "invalid_request",
    INVALID_CLIENT_METADATA: "invalid_client_metadata",
    INVALID_REDIRECT_URI: "invalid_redirect_uri",
    UNSUPPORTED_GRANT_TYPE: "unsupported_grant_type",
    UNSUPPORTED_RESPONSE_TYPE: "unsupported_response_type",
  };
  return known[code] ?? "server_error";
}
