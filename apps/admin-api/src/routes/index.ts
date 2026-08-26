import { Hono } from "hono";
import { requireAccessIdentity, requireActor, requireCsrfToken } from "../auth/actor.js";
import type { AdminDependencies } from "../types.js";
import { AdminSessionService } from "../services/session.js";
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
import { createUsersRouter } from "./users.js";

export function createAdminV1Router(deps: AdminDependencies): Hono {
  const r = new Hono();
  const sessions = new AdminSessionService(deps);
  r.get("/session", async (c) => c.json(sessions.inspect(await requireAccessIdentity(deps, c))));
  r.post("/session/claim-subject", async (c) => {
    requireCsrfToken(c);
    return c.json(sessions.claim(await requireAccessIdentity(deps, c), {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("User-Agent"),
    }));
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
  r.route("/audit-logs", createAuditRouter(deps));
  return r;
}
