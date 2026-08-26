import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "@latex-renderer/shared";
import {
  legacyRenderTicketRequestSchema,
  renderOutputsSchema,
  sourceRenderTicketRequestSchema,
  sourceTicketRequestSchema,
} from "@latex-renderer/contracts";
import { requireActor } from "../auth/actor.js";
import { AdminJobsService } from "../services/jobs.js";
import { adminArtifactResponse } from "../services/artifacts.js";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

export function createJobsRouter(deps: AdminDependencies): Hono {
  const r = new Hono(),
    service = new AdminJobsService(deps);
  r.get("/", async (c) => {
    await requireActor(deps, c, "admin:jobs:read");
    const status = c.req.query("status"),
      query = c.req.query("query"),
      sourceId = c.req.query("sourceId");
    return c.json({
      items: service.list({
        ...(status === undefined ? {} : { status }),
        ...(query === undefined ? {} : { query }),
        ...(sourceId === undefined ? {} : { sourceId }),
      }),
    });
  });
  r.get("/render-targets", async (c) => {
    await requireActor(deps, c, "admin:jobs:write");
    return c.json({ items: service.renderTargets() });
  });
  r.post("/render-tickets", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      key = c.req.header("Idempotency-Key");
    if (key === undefined)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const input = parse(
        z.union([
          legacyRenderTicketRequestSchema.extend({
            apiKeyId: z.string().min(1).max(128),
            outputs: renderOutputsSchema,
          }),
          sourceRenderTicketRequestSchema.extend({
            apiKeyId: z.string().min(1).max(128),
          }),
        ]),
        await c.req.json<unknown>(),
      ),
      result = await service.createRender(actor, input, key);
    return c.json(result.value, result.status);
  });
  r.post("/source-tickets", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      key = c.req.header("Idempotency-Key");
    if (key === undefined)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const input = parse(
        sourceTicketRequestSchema.extend({
          apiKeyId: z.string().min(1).max(128),
        }),
        await c.req.json<unknown>(),
      ),
      result = await service.createSource(actor, input, key);
    return c.json(result.value, result.status);
  });
  r.post("/source-refs", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      input = parse(
        z
          .object({
            apiKeyId: z.string().min(1).max(128),
            sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
          })
          .strict(),
        await c.req.json<unknown>(),
      );
    return c.json(service.createSourceRef(actor, input), 201);
  });
  r.post("/bulk-delete", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      input = parse(
        z.object({
          ids: z
            .array(z.string().regex(/^job_[a-f0-9]{32}$/))
            .min(1)
            .max(100),
        }),
        await c.req.json<unknown>(),
      );
    return c.json({ accepted: service.bulkDelete(actor, input.ids) }, 202);
  });
  r.get("/:id", async (c) => {
    await requireActor(deps, c, "admin:jobs:read");
    return c.json(service.get(c.req.param("id")));
  });
  r.get("/:id/artifacts/*", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:read");
    return adminArtifactResponse(
      deps,
      actor,
      c.req.param("id"),
      c.req.param("*") || c.req.path.split("/artifacts/").at(-1) || "",
      false,
      c.req.query("disposition") === "inline",
    );
  });
  r.get("/:id/previews/:name", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:read");
    return adminArtifactResponse(
      deps,
      actor,
      c.req.param("id"),
      c.req.param("name"),
      true,
      true,
    );
  });
  r.post("/:id/cancel", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write");
    return c.json(service.cancel(actor, c.req.param("id")), 202);
  });
  r.post("/:id/retry", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write"),
      key = c.req.header("Idempotency-Key");
    if (key === undefined)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const result = await service.retry(actor, c.req.param("id"), key);
    return c.json(
      { id: result.id, retryOfJobId: result.retryOfJobId },
      result.reused ? 200 : 202,
    );
  });
  r.delete("/:id", async (c) => {
    const actor = await requireActor(deps, c, "admin:jobs:write");
    service.delete(actor, c.req.param("id"));
    return c.body(null, 202);
  });
  return r;
}
