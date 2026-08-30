import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  errorResponse,
  GATEWAY_RESPONSE_HEADERS,
  gatewayRoute,
  proxyGatewayJson,
} from "@latex-renderer/gateway-core";

if (process.env.DEPLOYMENT_MODE !== "standalone")
  throw new Error("Standalone Gateway requires DEPLOYMENT_MODE=standalone");
const upstream = exactInternalOrigin(
  process.env.INTERNAL_API_URL ?? "http://127.0.0.1:3103",
);
const app = new Hono();
app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  for (const [name, value] of Object.entries(GATEWAY_RESPONSE_HEADERS))
    c.header(name, value);
  await next();
});
app.all("*", async (c) => {
  const route = gatewayRoute(c.req.path, c.req.method);
  if (route === "health") return c.json({ status: "ok" });
  if (route === "invalid-job")
    return errorResponse("INVALID_JOB_ID", "Job id is invalid", 400);
  if (route === "method-not-allowed")
    return errorResponse("METHOD_NOT_ALLOWED", "Method is not allowed", 405);
  if (route === undefined)
    return errorResponse("NOT_FOUND", "Route not found", 404);
  const requestId = randomUUID();
  try {
    return await proxyGatewayJson({
      request: c.req.raw,
      requestId,
      upstreamPath: route.upstreamPath,
      idempotencyRequired: route.idempotencyRequired,
      fetchUpstream: (input, init) => {
        const url = new URL(input);
        url.protocol = upstream.protocol;
        url.hostname = upstream.hostname;
        url.port = upstream.port;
        return fetch(url, init);
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "standalone_gateway.error",
        requestId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return errorResponse("GATEWAY_ERROR", "Gateway request failed", 502);
  }
});

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? "3105"),
});

function exactInternalOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "3103" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error("INTERNAL_API_URL must be http://127.0.0.1:3103");
  return url;
}
