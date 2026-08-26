import { Hono, type Context } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

export interface GatewayEnv {
  INTERNAL_API: { fetch: typeof fetch };
}

const app = new Hono<{ Bindings: GatewayEnv }>();
const maxJsonBytes = 1024;

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  for (const [name, value] of Object.entries({
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
  })) {
    c.header(name, value);
  }
  await next();
});

app.onError((error, c) => {
  const id = c.get("requestId");
  console.error(
    JSON.stringify({
      event: "gateway.error",
      requestId: id,
      message: error.message,
    }),
  );
  return c.json(
    {
      error: {
        code: "GATEWAY_ERROR",
        message: "Gateway request failed",
        requestId: id,
      },
    },
    502,
  );
});

const createTicket = (c: Context<{ Bindings: GatewayEnv }>) => {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined || key.length < 16 || key.length > 200) {
    return c.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A valid Idempotency-Key is required",
        },
      },
      400,
    );
  }
  return proxySmallJson(c, "/internal/v1/render-tickets", {
    "Idempotency-Key": key,
  });
};
const createSourceTicket = (c: Context<{ Bindings: GatewayEnv }>) => {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined || key.length < 16 || key.length > 200)
    return c.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A valid Idempotency-Key is required",
        },
      },
      400,
    );
  return proxySmallJson(c, "/internal/v1/source-tickets", {
    "Idempotency-Key": key,
  });
};

const renewTicket = (c: Context<{ Bindings: GatewayEnv }>) => {
  const id = c.req.param("jobId");
  if (id === undefined || !/^job_[a-f0-9]{32}$/.test(id)) {
    return c.json(
      { error: { code: "INVALID_JOB_ID", message: "Job id is invalid" } },
      400,
    );
  }
  return proxySmallJson(c, `/internal/v1/jobs/${id}/ticket`);
};

app.post("/api/v1/render-tickets", createTicket);
app.post("/api/v1/source-tickets", createSourceTicket);
app.post("/api/v1/job-tickets/:jobId", renewTicket);
app.get("/api/v1/health", (c) => c.json({ status: "ok" }));
app.post("/v1/render-tickets", createTicket);
app.post("/v1/source-tickets", createSourceTicket);
app.post("/v1/jobs/:jobId/ticket", renewTicket);
app.get("/health", (c) => c.json({ status: "ok" }));
app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
);

async function proxySmallJson(
  c: Context<{ Bindings: GatewayEnv }>,
  path: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const authorization = c.req.header("Authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return c.json(
      {
        error: { code: "UNAUTHORIZED", message: "Bearer API key is required" },
      },
      401,
    );
  }

  const lengthText = c.req.header("Content-Length");
  if (lengthText === undefined) {
    return c.json(
      {
        error: {
          code: "LENGTH_REQUIRED",
          message: "Content-Length is required",
        },
      },
      411,
    );
  }
  const length = Number(lengthText);
  if (!Number.isInteger(length) || length < 0 || length > maxJsonBytes) {
    return c.json(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "JSON request is too large",
        },
      },
      413,
    );
  }

  const id = c.get("requestId");

  const response = await c.env.INTERNAL_API.fetch(
    new URL(path, "http://internal-api.local"),
    {
      method: c.req.method,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        "X-Request-Id": id,
        ...extraHeaders,
      },
      body: c.req.raw.body,
      redirect: "manual",
    },
  );

  if (response.status >= 300 && response.status < 400) {
    console.error(
      JSON.stringify({
        event: "gateway.upstream_redirect_rejected",
        requestId: id,
        status: response.status,
      }),
    );
    return c.json(
      {
        error: {
          code: "UPSTREAM_REDIRECT_REJECTED",
          message: "Private upstream returned a redirect",
        },
      },
      502,
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export default app;
