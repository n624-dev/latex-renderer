import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import { RendererClient } from "@latex-renderer/api-client";
import { renderProject } from "@latex-renderer/client-core";
import {
  DEFAULT_DISTRIBUTION_URI,
  deleteCredential,
  doctorSetup,
  fetchDistribution,
  inspectSetup,
  installDistribution,
  loadCredential,
  repairSetup,
  saveCredential,
  type McpTarget,
  type SkillTarget,
} from "@latex-renderer/setup-core";
import { AppError, PUBLIC_ORIGIN } from "@latex-renderer/shared";
import { setupCss, setupHtml, setupJavaScript } from "./assets.js";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAXIMUM_LIFETIME_MS = 2 * 60 * 60 * 1000;
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const quietWriter = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

type LoopbackHost = "127.0.0.1" | "::1";
type CloseReason = "requested" | "idle" | "lifetime" | "external";

export interface SetupWebActionOptions {
  readonly installDirectory?: string;
  readonly binDirectory?: string;
  readonly distributionBaseUri?: string;
  readonly rendererBaseUrl?: string;
}

export interface SetupWebActions {
  status(): Promise<unknown>;
  doctor(): Promise<unknown>;
  saveApiKey(apiKey: string): Promise<unknown>;
  removeApiKey(): Promise<unknown>;
  update(input: IntegrationInput): Promise<unknown>;
  repair(input: IntegrationInput): Promise<unknown>;
  sampleRender(): Promise<unknown>;
}

export interface IntegrationInput {
  readonly skillTarget: SkillTarget;
  readonly mcpTarget: McpTarget;
}

export interface SetupWebServer {
  readonly origin: string;
  readonly bootstrapUrl: string;
  readonly closed: Promise<{ reason: CloseReason }>;
  close(): Promise<void>;
}

export interface SetupWebServerOptions extends SetupWebActionOptions {
  readonly host?: LoopbackHost;
  readonly idleTimeoutMs?: number;
  readonly maximumLifetimeMs?: number;
  readonly actions?: SetupWebActions;
}

export interface RunSetupWebOptions extends SetupWebServerOptions {
  readonly output?: NodeJS.WritableStream;
  readonly openBrowser?: (url: string) => Promise<boolean>;
}

export async function runSetupWeb(
  options: RunSetupWebOptions = {},
): Promise<{ reason: "requested" | "idle" | "lifetime" | "external" }> {
  const web = await createSetupWebServer(options);
  const output = options.output ?? process.stdout;
  output.write(`Local Setup Web UI: ${web.origin}\n`);
  const opened = await (options.openBrowser ?? openBrowser)(web.bootstrapUrl);
  if (!opened)
    output.write(`Open this one-time local URL: ${web.bootstrapUrl}\n`);
  return web.closed;
}

export async function createSetupWebServer(
  options: SetupWebServerOptions = {},
): Promise<SetupWebServer> {
  const host = options.host ?? "127.0.0.1";
  const bootstrapToken = randomToken();
  let activeBootstrap = bootstrapToken;
  let sessionToken = "";
  let csrfToken = "";
  let expectedHost = "";
  let origin = "";
  let closing = false;
  let mutationActive = false;
  let activeReads = 0;
  let closeReason: CloseReason = "external";
  let idleTimer: NodeJS.Timeout | undefined;
  const actions = options.actions ?? createSetupWebActions(options);
  let resolveClosed: ((value: { reason: CloseReason }) => void) | undefined;
  const closed = new Promise<{ reason: CloseReason }>((resolve) => {
    resolveClosed = resolve;
  });

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendError(response, error);
    });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 8;
  server.maxRequestsPerSocket = 50;
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Setup Web UI did not receive a TCP address");
  }
  expectedHost =
    host === "::1" ? `[::1]:${address.port}` : `${host}:${address.port}`;
  origin = `http://${expectedHost}`;
  const lifetimeTimer = setTimeout(() => {
    closeReason = "lifetime";
    closeServer();
  }, options.maximumLifetimeMs ?? DEFAULT_MAXIMUM_LIFETIME_MS);
  lifetimeTimer.unref();
  server.on("close", () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    clearTimeout(lifetimeTimer);
    resolveClosed?.({ reason: closeReason });
  });
  resetIdleTimer();

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    setSecurityHeaders(response);
    if (!isLoopbackAddress(request.socket.remoteAddress))
      throw new HttpError(
        403,
        "LOOPBACK_REQUIRED",
        "Loopback access is required",
      );
    if (request.headers.host !== expectedHost)
      throw new HttpError(
        421,
        "INVALID_HOST",
        "Host header does not match the local listener",
      );
    resetIdleTimer();
    const url = new URL(request.url ?? "/", origin);
    if (url.origin !== origin)
      throw new HttpError(400, "INVALID_URL", "Request URL is invalid");

    if (request.method === "GET" && url.pathname === "/") {
      send(response, 200, "text/html; charset=utf-8", setupHtml);
      return;
    }
    if (request.method === "GET" && url.pathname === "/assets/setup.css") {
      send(response, 200, "text/css; charset=utf-8", setupCss);
      return;
    }
    if (request.method === "GET" && url.pathname === "/assets/setup.js") {
      send(response, 200, "text/javascript; charset=utf-8", setupJavaScript);
      return;
    }
    if (request.method !== "POST")
      throw new HttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Only local POST API requests are allowed",
      );
    requireSameOrigin(request, origin);
    const body = await readJsonBody(request);

    if (url.pathname === "/api/session") {
      const supplied = requiredString(body, "bootstrapToken", 256);
      if (activeBootstrap === "" || !safeEqual(supplied, activeBootstrap))
        throw new HttpError(
          401,
          "INVALID_BOOTSTRAP",
          "Bootstrap token is invalid or already used",
        );
      activeBootstrap = "";
      sessionToken = randomToken();
      csrfToken = randomToken();
      sendJson(response, 200, {
        success: true,
        result: { sessionToken, csrfToken },
      });
      return;
    }

    requireSession(request, sessionToken, csrfToken);
    let result: unknown;
    switch (url.pathname) {
      case "/api/status":
        result = await runRead(() => actions.status());
        break;
      case "/api/doctor":
        result = await runRead(() => actions.doctor());
        break;
      case "/api/auth":
        result = await runMutation(() =>
          actions.saveApiKey(requiredString(body, "apiKey", 512)),
        );
        break;
      case "/api/auth/logout":
        result = await runMutation(() => actions.removeApiKey());
        break;
      case "/api/update":
        result = await runMutation(() =>
          actions.update(integrationInput(body)),
        );
        break;
      case "/api/repair":
        result = await runMutation(() =>
          actions.repair(integrationInput(body)),
        );
        break;
      case "/api/sample-render":
        result = await runMutation(() => actions.sampleRender());
        break;
      case "/api/close":
        result = { closed: true };
        closeReason = "requested";
        response.once("finish", closeServer);
        break;
      default:
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Local setup endpoint was not found",
        );
    }
    sendJson(response, 200, { success: true, result: redactSecrets(result) });
  }

  function resetIdleTimer(): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      closeReason = "idle";
      closeServer();
    }, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    idleTimer.unref();
  }

  function closeServer(): void {
    if (closing) return;
    closing = true;
    server.close();
    server.closeAllConnections();
  }

  async function runRead(operation: () => Promise<unknown>): Promise<unknown> {
    if (mutationActive)
      throw new HttpError(
        409,
        "SETUP_BUSY",
        "A setup operation is already running",
      );
    activeReads += 1;
    try {
      return await operation();
    } finally {
      activeReads -= 1;
    }
  }

  async function runMutation(
    operation: () => Promise<unknown>,
  ): Promise<unknown> {
    if (mutationActive || activeReads > 0)
      throw new HttpError(
        409,
        "SETUP_BUSY",
        "A setup operation is already running",
      );
    mutationActive = true;
    try {
      return await operation();
    } finally {
      mutationActive = false;
    }
  }

  return {
    origin,
    bootstrapUrl: `${origin}/#${bootstrapToken}`,
    closed,
    close: async () => {
      closeReason = "external";
      closeServer();
      await closed;
    },
  };
}

export function createSetupWebActions(
  options: SetupWebActionOptions = {},
): SetupWebActions {
  const setupOptions = {
    ...(options.installDirectory
      ? { installDirectory: options.installDirectory }
      : {}),
    ...(options.binDirectory ? { binDirectory: options.binDirectory } : {}),
  };
  return {
    status: () => inspectSetup(setupOptions),
    doctor: () => doctorSetup(setupOptions),
    saveApiKey: async (apiKey) => {
      await saveCredential(apiKey);
      return { configured: true };
    },
    removeApiKey: async () => {
      await deleteCredential();
      return { removed: true };
    },
    update: async ({ skillTarget, mcpTarget }) => {
      const distribution = await fetchDistribution({
        baseUri: options.distributionBaseUri ?? DEFAULT_DISTRIBUTION_URI,
      });
      return installDistribution({
        ...distribution,
        ...setupOptions,
        skillTarget,
        mcpTarget,
        output: quietWriter,
        warning: quietWriter,
      });
    },
    repair: ({ skillTarget, mcpTarget }) =>
      repairSetup({
        ...setupOptions,
        skillTarget,
        mcpTarget,
        output: quietWriter,
        warning: quietWriter,
      }),
    sampleRender: () => sampleRender(options.rendererBaseUrl ?? PUBLIC_ORIGIN),
  };
}

async function sampleRender(rendererBaseUrl: string): Promise<unknown> {
  const root = await mkdtemp(join(tmpdir(), "latex-renderer-setup-sample-"));
  try {
    await writeFile(
      join(root, "main.tex"),
      String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage{luatexja}
\begin{document}
LaTeX Renderer setup test.\\
日本語のサンプルレンダリングです。
\end{document}
`,
      { mode: 0o600 },
    );
    const rendered = await renderProject(
      new RendererClient(rendererBaseUrl, await loadCredential()),
      root,
      { outputDirectory: join(root, ".render") },
    );
    return {
      job: {
        id: rendered.job.id,
        status: rendered.job.status,
        errorCode: rendered.job.errorCode,
        errorMessage: rendered.job.errorMessage,
      },
      source: rendered.source,
      artifacts: rendered.job.artifacts.map(({ type, size, sha256 }) => ({
        type,
        size,
        sha256,
      })),
      previews: rendered.job.previews.map(({ type, size, sha256 }) => ({
        type,
        size,
        sha256,
      })),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function integrationInput(
  body: Readonly<Record<string, unknown>>,
): IntegrationInput {
  return {
    skillTarget: setupTarget(body.skillTarget, "skillTarget"),
    mcpTarget: setupTarget(body.mcpTarget, "mcpTarget"),
  };
}

function setupTarget(value: unknown, name: string): SkillTarget {
  if (
    value === "both" ||
    value === "codex" ||
    value === "claude" ||
    value === "none"
  )
    return value;
  throw new HttpError(
    400,
    "INVALID_SETUP_TARGET",
    `${name} must be both, codex, claude, or none`,
  );
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Readonly<Record<string, unknown>>> {
  if (
    request.headers["content-type"]?.split(";", 1)[0]?.trim() !==
    "application/json"
  )
    throw new HttpError(
      415,
      "JSON_REQUIRED",
      "Content-Type must be application/json",
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAXIMUM_BODY_BYTES)
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HttpError(
      400,
      "JSON_OBJECT_REQUIRED",
      "Request body must be a JSON object",
    );
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(
  body: Readonly<Record<string, unknown>>,
  name: string,
  maximumLength: number,
): string {
  const value = body[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  )
    throw new HttpError(400, "INVALID_INPUT", `${name} is required`);
  return value;
}

function requireSameOrigin(request: IncomingMessage, origin: string): void {
  if (request.headers.origin !== origin)
    throw new HttpError(
      403,
      "INVALID_ORIGIN",
      "Origin does not match the local setup UI",
    );
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin")
    throw new HttpError(
      403,
      "CROSS_SITE_REQUEST",
      "Cross-site requests are not allowed",
    );
}

function requireSession(
  request: IncomingMessage,
  sessionToken: string,
  csrfToken: string,
): void {
  const authorization = request.headers.authorization;
  if (
    sessionToken === "" ||
    typeof authorization !== "string" ||
    !safeEqual(authorization, `Bearer ${sessionToken}`)
  )
    throw new HttpError(
      401,
      "SESSION_REQUIRED",
      "Local setup session is required",
    );
  const suppliedCsrf = request.headers["x-csrf-token"];
  if (typeof suppliedCsrf !== "string" || !safeEqual(suppliedCsrf, csrfToken))
    throw new HttpError(403, "CSRF_REJECTED", "CSRF token is invalid");
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  send(
    response,
    status,
    "application/json; charset=utf-8",
    JSON.stringify(value),
  );
}

function sendError(response: ServerResponse, error: unknown): void {
  const status =
    error instanceof HttpError
      ? error.status
      : error instanceof AppError
        ? error.status
        : 500;
  const code =
    error instanceof HttpError || error instanceof AppError
      ? error.code
      : "INTERNAL_ERROR";
  const message = redactMessage(
    error instanceof HttpError || error instanceof AppError
      ? error.message
      : "Local setup operation failed",
  );
  sendJson(response, status, { success: false, error: { code, message } });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "string") return redactMessage(value);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value))
    result[key] =
      /api.?key|upload.?ticket|job.?ticket|authorization|bootstrap|session.?token|csrf.?token|secret|credential/i.test(
        key,
      )
        ? "[redacted]"
        : redactSecrets(item);
  return result;
}

function redactMessage(message: string): string {
  return message.replace(/lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}/g, "[redacted]");
}

function openBrowser(url: string): Promise<boolean> {
  const child =
    process.platform === "win32"
      ? spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Process -LiteralPath $env:LATEX_RENDER_SETUP_URL",
          ],
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: { ...process.env, LATEX_RENDER_SETUP_URL: url },
          },
        )
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
  return new Promise((resolve) => {
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}
