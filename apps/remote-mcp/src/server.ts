import { createAdaptorServer } from "@hono/node-server";
import { startHttpService } from "../../../deploy/scripts/http-idle-server.mjs";
import { createBrowserAuthenticationFromEnvironment } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import {
  RemoteOAuthService,
  RemoteRenderService,
} from "@latex-renderer/remote-mcp-core";
import {
  exactHttpsOrigin,
  loadResourceLimits,
  PLATFORM_VERSION,
  positiveBytesEnvironment,
  positiveIntegerEnvironment,
  validPortEnvironment,
} from "@latex-renderer/shared";
import { createRemoteMcpApp, AnonymousRegistrationLimiter } from "./app.js";
import { createRemoteMcpHandler } from "./mcp.js";
import { oauthDiagnostics } from "./diagnostics.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

const publicOrigin = exactHttpsOrigin(required("PUBLIC_ORIGIN")),
  database = new RendererDatabase(required("DATABASE_PATH"));
database.migrate();
const authentication = createBrowserAuthenticationFromEnvironment(
  database,
  "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
);
const oauth = new RemoteOAuthService(
    database,
    publicOrigin,
    new URL("/mcp", publicOrigin).toString(),
    Date.now,
    oauthDiagnostics(required("STORAGE_ROOT")),
  ),
  renders = new RemoteRenderService(
    database,
    required("STORAGE_ROOT"),
    required("RENDERER_IMAGE"),
    publicOrigin,
    positiveIntegerEnvironment(process.env, "MAX_QUEUE_LENGTH", 100),
    positiveBytesEnvironment(
      process.env,
      "MAX_USER_STORAGE_BYTES",
      1024 * 1024 * 1024,
    ),
    "/var/lib/latex-renderer/environment",
    loadResourceLimits(process.env),
    positiveBytesEnvironment(
      process.env,
      "MAX_OUTPUT_BYTES",
      200 * 1024 * 1024,
    ),
    positiveIntegerEnvironment(process.env, "ARTIFACT_RETENTION_HOURS", 24),
  ),
  registrationLimiter = new AnonymousRegistrationLimiter(),
  app = createRemoteMcpApp({
    registrationLimiter,
    database,
    browserAuth: authentication.browserAuth,
    oauth,
    mcp: createRemoteMcpHandler(renders, PLATFORM_VERSION),
    publicOrigin,
  }),
  port = validPortEnvironment(process.env, "PORT", 3104);

startHttpService(
  createAdaptorServer({ fetch: app.fetch, hostname: "127.0.0.1" }),
  {
    port,
    name: "remote_mcp",
    onIdle: () => database.close(),
    busyUntil: () =>
      Math.max(
        oauth.idleBlockedUntil(),
        registrationLimiter.idleBlockedUntil(),
      ),
    onListening: (info) => {
      console.log(
        JSON.stringify({
          event: "remote_mcp.started",
          address: info.address,
          port: info.port,
          resource: oauth.resource,
        }),
      );
    },
  },
);
