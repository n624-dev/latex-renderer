import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { AppError, safeError } from "@latex-renderer/shared";
import { createInternalV1Router } from "./routes.js";
import type { InternalApiDependencies } from "./types.js";
export type { InternalApiDependencies } from "./types.js";
export function createInternalApp(deps: InternalApiDependencies): Hono {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    c.header(
      "Cache-Control",
      "private, no-store, no-cache, max-age=0, must-revalidate",
    );
    c.header("Cloudflare-CDN-Cache-Control", "no-store");
    c.header("CDN-Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    await next();
  });
  app.route("/internal/v1", createInternalV1Router(deps));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.onError((error, c) => {
    const { code, message, status } = safeError(error);
    console.error(
      JSON.stringify({ event: "internal_api.error", code, path: c.req.path }),
    );
    const currentVersion =
      error instanceof AppError && code === "DRAFT_VERSION_CONFLICT"
        ? error.details?.currentVersion
        : undefined;
    const recovery =
      currentVersion === null ||
      (typeof currentVersion === "number" &&
        Number.isSafeInteger(currentVersion) &&
        currentVersion >= 0)
        ? { currentVersion }
        : {};
    return c.json({ error: { code, message, ...recovery } }, status as 400);
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );
  return app;
}
