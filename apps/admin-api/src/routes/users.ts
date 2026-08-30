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
    return c.json({ id: await service.create(actor, input) }, 201);
  });

  router.post("/:id/enable", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    return c.json(service.changeStatus(actor, c.req.param("id"), "enable"));
  });

  router.post("/:id/disable", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    return c.json(service.changeStatus(actor, c.req.param("id"), "disable"));
  });

  router.post("/:id/identities/:identityId/unlink", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(
      z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
      await c.req.json<unknown>(),
    );
    return c.json(
      service.unlinkIdentity(
        actor,
        c.req.param("id"),
        c.req.param("identityId"),
        input.reason,
      ),
    );
  });

  router.post("/:id/password", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(
      z
        .object({
          loginName: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
          password: z.string().min(12).max(1024),
          reason: z.string().trim().min(1).max(500),
        })
        .strict(),
      await c.req.json<unknown>(),
    );
    return c.json(await service.resetPassword(actor, c.req.param("id"), input));
  });

  router.patch("/:id", async (c) => {
    const actor = await requireActor(deps, c, "admin:users:write");
    const input = parse(
      z.object({
        email: z.email().max(320).nullable().optional(),
        displayName: z.string().min(1).max(200).optional(),
        role: z.enum(["user", "admin", "owner"]).optional(),
      }).refine(
        (value) =>
          value.email !== undefined ||
          value.displayName !== undefined ||
          value.role !== undefined,
      ),
      await c.req.json<unknown>(),
    );
    service.update(actor, c.req.param("id"), input);
    return c.json({ id: c.req.param("id"), updated: true });
  });

  return router;
}
