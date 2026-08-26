import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { safeError } from "@latex-renderer/shared";
import { installRequestPolicy } from "./middleware/request-policy.js";
import { createAdminV1Router } from "./routes/index.js";
import { createAppV1Router } from "./routes/app.js";
import { AdminSystemService } from "./services/system.js";
import type { AdminDependencies } from "./types.js";

export type { AdminActor, AdminDependencies } from "./types.js";

export function createAdminApp(deps: AdminDependencies): Hono {
  const app = new Hono();
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"] },
      xFrameOptions: "DENY",
    }),
  );
  installRequestPolicy(app, deps);
  app.route("/admin/api/v1", createAdminV1Router(deps));
  app.route("/admin/v1", createAdminV1Router(deps));
  app.route("/app/api/v1", createAppV1Router(deps));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/health/rendering", (c) => {
    const health = new AdminSystemService(deps).renderingHealth();
    return health.operational ? c.json(health) : c.json(health, 503);
  });
  app.onError((error, c) => {
    const safe = safeError(error);
    console.error(
      JSON.stringify({
        event: "admin_api.error",
        code: safe.code,
        path: c.req.path,
      }),
    );
    return c.json(
      { error: { code: safe.code, message: safe.message } },
      safe.status as ContentfulStatusCode,
    );
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );
  return app;
}
