import { Hono } from "hono";
import { requireActor } from "../auth/actor.js";
import { AdminApiKeysService } from "../services/api-keys.js";
import type { AdminDependencies } from "../types.js";

export function createApiKeysRouter(deps: AdminDependencies): Hono {
  const router = new Hono();
  const service = new AdminApiKeysService(deps);

  router.get("/", async (c) => {
    await requireActor(deps, c, "admin:api-keys:read");
    return c.json({ items: service.list() });
  });

  router.get("/:id", async (c) => {
    await requireActor(deps, c, "admin:api-keys:read");
    return c.json(service.get(c.req.param("id")));
  });

  router.post("/:id/revoke", async (c) => {
    const actor = await requireActor(deps, c, "admin:api-keys:write");
    service.revoke(actor, c.req.param("id"));
    return c.json({ id: c.req.param("id"), revoked: true });
  });

  router.post("/:id/rotate", async (c) => {
    const actor = await requireActor(deps, c, "admin:api-keys:write");
    return c.json(service.rotate(actor, c.req.param("id")), 201);
  });

  return router;
}
