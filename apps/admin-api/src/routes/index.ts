import { Hono } from "hono";
import { appendSetCookies } from "@latex-renderer/auth";
import { requireActor } from "../auth/actor.js";
import type { AdminDependencies } from "../types.js";
import { createApiKeysRouter } from "./api-keys.js";
import { createJobsRouter } from "./jobs.js";
import { createServiceAccountsRouter } from "./service-accounts.js";
import { createSourcesRouter } from "./sources.js";
import {
  createAuditRouter,
  createSystemRouter,
  createWorkerRouter,
} from "./system.js";
import { createTexEnvironmentRouter } from "./tex-environment.js";
import { createUpdatesRouter } from "./updates.js";
import { createUsersRouter } from "./users.js";

export function createAdminV1Router(deps: AdminDependencies): Hono {
  const r = new Hono();
  r.get("/session", async (c) => {
    const session = await deps.browserAuth.establishSession(c.req.raw);
    appendSetCookies(c.res.headers, session.cookies);
    return c.json({
      authenticated: true,
      authMode: session.principal.authMode,
      csrfToken: session.csrfToken,
      user: {
        id: session.principal.user.id,
        email: session.principal.user.email,
        displayName: session.principal.user.display_name,
        role: session.principal.user.role,
        status: session.principal.user.status,
      },
    });
  });
  r.get("/me", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:read"),
      user = deps.database.users.get(actor.userId);
    return c.json({
      userId: actor.userId,
      displayName: user?.display_name ?? actor.userId,
      role: actor.role,
    });
  });
  r.route("/users", createUsersRouter(deps));
  r.route("/service-accounts", createServiceAccountsRouter(deps));
  r.route("/api-keys", createApiKeysRouter(deps));
  r.route("/jobs", createJobsRouter(deps));
  r.route("/sources", createSourcesRouter(deps));
  r.route("/system", createSystemRouter(deps));
  r.route("/worker", createWorkerRouter(deps));
  r.route("/tex-environment", createTexEnvironmentRouter(deps));
  r.route("/updates", createUpdatesRouter(deps));
  r.route("/audit-logs", createAuditRouter(deps));
  return r;
}
