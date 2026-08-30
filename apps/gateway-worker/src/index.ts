import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import {
  errorResponse,
  GATEWAY_RESPONSE_HEADERS,
  gatewayRoute,
  proxyGatewayJson,
} from "@latex-renderer/gateway-core";

export interface GatewayEnv {
  INTERNAL_API: { fetch: typeof fetch };
}

const app = new Hono<{ Bindings: GatewayEnv }>();
app.use("*", requestId());
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
  try {
    return await proxyGatewayJson({
      request: c.req.raw,
      requestId: c.get("requestId"),
      upstreamPath: route.upstreamPath,
      idempotencyRequired: route.idempotencyRequired,
      fetchUpstream: (input, init) => c.env.INTERNAL_API.fetch(input, init),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gateway.error",
        requestId: c.get("requestId"),
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return errorResponse("GATEWAY_ERROR", "Gateway request failed", 502);
  }
});

export default app;
