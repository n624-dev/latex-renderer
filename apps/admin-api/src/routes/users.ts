import { Hono } from "hono";
import { z } from "zod";
import { createUserSchema } from "@latex-renderer/contracts";
import { requireActor } from "../auth/actor.js";
import { UsersService } from "../services/users.js";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

export function createUsersRouter(deps: AdminDependencies): Hono {
  const router = new Hono();
  const service = new UsersService(deps);

  router.get("/", async (c) => {
    await requireActor(deps, c, "admin:users:read");
    return c.json({ items: service.list() });
  });

  router.get("/:id", async (c) => {
    await requireActor(deps, c, "admin:users:read");
    return c.json(service.get(c.req.param("id")));
  });

  router.post("/", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(createUserSchema, await c.req.json<unknown>());
    return c.json({ id: service.create(actor, input) }, 201);
  });

  router.post("/:id/enable", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    return c.json(service.changeStatus(actor, c.req.param("id"), "enable"));
  });

  router.post("/:id/disable", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    return c.json(service.changeStatus(actor, c.req.param("id"), "disable"));
  });

  router.post("/:id/unlink-access-subject", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(
      z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
      await c.req.json<unknown>(),
    );
    return c.json(service.unlinkAccessSubject(actor, c.req.param("id"), input.reason));
  });

  router.patch("/:id", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(
      z.object({
        displayName: z.string().min(1).max(200).optional(),
        role: z.enum(["user", "admin", "owner"]).optional(),
      }).refine((value) => value.displayName !== undefined || value.role !== undefined),
      await c.req.json<unknown>(),
    );
    service.update(actor, c.req.param("id"), input);
    return c.json({ id: c.req.param("id"), updated: true });
  });

  return router;
}
