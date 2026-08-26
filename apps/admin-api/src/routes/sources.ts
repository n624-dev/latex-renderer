import { Hono } from "hono";
import { z } from "zod";
import { renderOutputsSchema } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { requireActor } from "../auth/actor.js";
import { AdminSourcesService } from "../services/sources.js";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

export function createSourcesRouter(deps: AdminDependencies): Hono {
  const router = new Hono(),
    service = new AdminSourcesService(deps);
  router.get("/", async (c) => {
    await requireActor(deps, c, "admin:jobs:read");
    const query = c.req.query("query"),
      status = c.req.query("status");
    return c.json({
      items: service.list({
        ...(query === undefined ? {} : { query }),
        ...(status === undefined ? {} : { status }),
      }),
    });
  });
  router.get("/:id", async (c) => {
    await requireActor(deps, c, "admin:jobs:read");
    return c.json(service.get(c.req.param("id")));
  });
  router.post("/:id/render", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      key = c.req.header("Idempotency-Key");
    if (key === undefined)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const input = parse(
        z
          .object({
            apiKeyId: z.string().min(1).max(128),
            entrypoint: z.string().min(1).max(240).optional(),
            outputs: renderOutputsSchema,
          })
          .strict(),
        await c.req.json<unknown>(),
      ),
      result = await service.render(actor, c.req.param("id"), input, key);
    return c.json(result.value, result.status);
  });
  router.post("/:id/source-ref", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      input = parse(
        z.object({ apiKeyId: z.string().min(1).max(128) }).strict(),
        await c.req.json<unknown>(),
      );
    return c.json(
      service.createRef(actor, c.req.param("id"), input.apiKeyId),
      201,
    );
  });
  router.delete("/:id", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write");
    service.delete(actor, c.req.param("id"));
    return c.body(null, 202);
  });
  return router;
}
