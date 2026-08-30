import type { Hono } from "hono";
import { AppError } from "@latex-renderer/shared";
import type { AdminDependencies } from "../types.js";

export function installRequestPolicy(app: Hono, deps: AdminDependencies): void {
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    c.header("Cloudflare-CDN-Cache-Control", "no-store");
    c.header("CDN-Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");

    const origin = c.req.header("Origin");
    if (origin !== undefined && !deps.allowedOrigins.has(origin)) {
      throw new AppError("ORIGIN_REJECTED", "Origin is not allowed", 403);
    }
    if (c.req.method === "OPTIONS") {
      if (origin === undefined) throw new AppError("ORIGIN_REQUIRED", "Origin is required", 403);
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token,Authorization,Idempotency-Key",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Vary": "Origin",
      } });
    }
    if (
      isMutation(c.req.method) &&
      !deps.writeEnabled &&
      !c.req.path.startsWith("/auth/")
    ) {
      throw new AppError("ADMIN_READ_ONLY", "Admin API writes are disabled", 503);
    }
    await next();
    if (origin !== undefined) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
  });
}

export function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
