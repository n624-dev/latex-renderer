import { Hono } from "hono";
import {
  createRenderTicketRequestSchema,
  createSourceTicketRequestSchema,
} from "@latex-renderer/contracts";
import { AppError, DEFAULT_RESOURCE_LIMITS, parseBearer } from "@latex-renderer/shared";
import { RenderTicketsService } from "./services/render-tickets.js";
import { SourceTicketsService } from "./services/source-tickets.js";
import type { InternalApiDependencies } from "./types.js";

export function createInternalV1Router(deps: InternalApiDependencies): Hono {
  const r = new Hono(),
    maxUploadBytes = deps.maxUploadBytes ?? DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
    service = new RenderTicketsService(deps),
    sources = new SourceTicketsService(deps);
  r.post("/source-tickets", async (c) => {
    const actor = deps.apiKeys.authenticate(
        parseBearer(c.req.header("Authorization")),
        "render:create",
      ),
      key = c.req.header("Idempotency-Key");
    if (key === undefined || key.length < 16 || key.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const parsed = createSourceTicketRequestSchema(maxUploadBytes).safeParse(
      await c.req.json<unknown>(),
    );
    if (!parsed.success)
      throw new AppError(
        "INVALID_REQUEST",
        "Source ticket request is invalid",
        400,
      );
    const result = await sources.create(actor, parsed.data, key);
    return c.json(result.value, result.status);
  });
  r.post("/render-tickets", async (c) => {
    const actor = deps.apiKeys.authenticate(
        parseBearer(c.req.header("Authorization")),
        "render:create",
      ),
      key = c.req.header("Idempotency-Key");
    if (key === undefined || key.length < 16 || key.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const parsed = createRenderTicketRequestSchema(maxUploadBytes).safeParse(
      await c.req.json<unknown>(),
    );
    if (!parsed.success)
      throw new AppError("INVALID_REQUEST", "Ticket request is invalid", 400);
    const result = await service.create(actor, parsed.data, key);
    return c.json(result.value, result.status);
  });
  r.post("/jobs/:jobId/ticket", async (c) => {
    const actor = deps.apiKeys.authenticate(
      parseBearer(c.req.header("Authorization")),
      "render:read:own",
    );
    return c.json(await service.renew(actor, c.req.param("jobId")));
  });
  return r;
}
