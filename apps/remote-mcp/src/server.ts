import { resolveDisplayLocale } from "@latex-renderer/shared/locale";
import { createAdaptorServer } from "@hono/node-server";
import {
  startHttpService,
  createHttpActivity,
} from "../../../deploy/scripts/http-idle-server.mjs";
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
import { rendererIdentityFromEnvironment } from "./relay-identity.js";
import { loadLocalRelay } from "./relay-agent.js";

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
  relayIdentity = rendererIdentityFromEnvironment(publicOrigin, process.env),
  mcp = createRemoteMcpHandler(renders, PLATFORM_VERSION, (userId) =>
    resolveDisplayLocale({ saved: database.users.displayLocale(userId) ?? undefined }),
  ),
  appDependencies = { database, browserAuth: authentication.browserAuth, mcp, publicOrigin, relayDownload: renders.relayDownload.bind(renders) },
  relayAgent = loadLocalRelay(appDependencies, relayIdentity?.instance.id, process.env),
  app = createRemoteMcpApp({
    ...appDependencies,
    registrationLimiter,
    oauth,
    ...(relayIdentity === undefined ? {} : { relayIdentity }),
    ...(relayAgent === undefined ? {} : { localRelay: relayAgent.handle }),
  }),
  port = validPortEnvironment(process.env, "PORT", 3104);

const activity = createHttpActivity();
startHttpService(
  createAdaptorServer({
    fetch: activity.track(app.fetch),
    hostname: "127.0.0.1",
  }),
  {
    activity,
    port,
    name: "remote_mcp",
    onIdle: () => { relayAgent?.close(); database.close(); },
    busyUntil: () =>
      Math.max(
        oauth.idleBlockedUntil(),
        registrationLimiter.idleBlockedUntil(),
        authentication.browserAuth.idleBlockedUntil(),
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
