import { serve } from "@hono/node-server";
import { createBrowserAuthenticationFromEnvironment } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import {
  RemoteOAuthService,
  RemoteRenderService,
} from "@latex-renderer/remote-mcp-core";
import { loadResourceLimits, PLATFORM_VERSION } from "@latex-renderer/shared";
import { createRemoteMcpApp } from "./app.js";
import { createRemoteMcpHandler } from "./mcp.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

const publicOrigin = required("PUBLIC_ORIGIN"),
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
  ),
  renders = new RemoteRenderService(
    database,
    required("STORAGE_ROOT"),
    required("RENDERER_IMAGE"),
    publicOrigin,
    Number(process.env.MAX_QUEUE_LENGTH ?? "100"),
    Number(process.env.MAX_USER_STORAGE_BYTES ?? String(1024 * 1024 * 1024)),
    "/var/lib/latex-renderer/environment",
    loadResourceLimits(process.env),
  ),
  app = createRemoteMcpApp({
    database,
    browserAuth: authentication.browserAuth,
    oauth,
    mcp: createRemoteMcpHandler(renders, PLATFORM_VERSION),
    publicOrigin,
  }),
  port = Number(process.env.PORT ?? "3104");

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(
    JSON.stringify({
      event: "remote_mcp.started",
      address: info.address,
      port: info.port,
      resource: oauth.resource,
    }),
  );
});
