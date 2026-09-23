import { Hono } from "hono";
import { z } from "zod";
import {
  createRenderTicketRequestSchema,
  createSourceTicketRequestSchema,
  renderOutputsSchema,
} from "@latex-renderer/contracts";
import { ProjectOperations } from "@latex-renderer/database";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  pageSize,
  parseBearer,
} from "@latex-renderer/shared";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import { RenderTicketsService } from "./services/render-tickets.js";
import { SourceTicketsService } from "./services/source-tickets.js";
import type { InternalApiDependencies } from "./types.js";

export function createInternalV1Router(deps: InternalApiDependencies): Hono {
  const r = new Hono(),
    maxUploadBytes =
      deps.maxUploadBytes ?? DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
    service = new RenderTicketsService(deps),
    sources = new SourceTicketsService(deps),
    projects = new ProjectOperations(deps.database);
  const projectId = z.string().regex(/^project_[a-f0-9]{32}$/),
    revisionId = z.string().regex(/^revision_[a-f0-9]{32}$/),
    sourceId = z.string().regex(/^source_[a-f0-9]{32}$/),
    displayName = z.string().trim().min(1).max(200),
    originalFilename = z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(
        (value) =>
          !value.includes("/") &&
          !value.includes("\\") &&
          value !== "." &&
          value !== "..",
      );
  function actor(
    c: string | undefined,
    scope: "render:create" | "render:read:own",
  ) {
    const identity = deps.apiKeys.authenticate(parseBearer(c), scope);
    return {
      userId: identity.userId,
      type: "service_account",
      id: identity.serviceAccountId,
    };
  }
  function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new AppError("INVALID_REQUEST", "Project request is invalid", 400);
    return result.data;
  }
  r.get("/projects", (c) =>
    c.json(
      projects.list(actor(c.req.header("Authorization"), "render:read:own"), {
        cursor: c.req.query("cursor"),
        limit: pageSize(c.req.query("pageSize")),
      }),
    ),
  );
  r.post("/projects", async (c) => {
    const owner = actor(c.req.header("Authorization"), "render:create"),
      input = parse(
        z.object({ displayName }).strict(),
        await c.req.json<unknown>(),
      );
    return c.json(projects.create(owner, input.displayName), 201);
  });
  r.get("/projects/:id", (c) =>
    c.json(
      projects.get(
        actor(c.req.header("Authorization"), "render:read:own"),
        parse(projectId, c.req.param("id")),
        {
          cursor: c.req.query("cursor"),
          limit: pageSize(c.req.query("pageSize")),
        },
      ),
    ),
  );
  r.patch("/projects/:id", async (c) => {
    const owner = actor(c.req.header("Authorization"), "render:create"),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z.object({ displayName }).strict(),
        await c.req.json<unknown>(),
      );
    projects.rename(owner, id, input.displayName);
    return c.json({ id, displayName: input.displayName });
  });
  r.delete("/projects/:id", (c) => {
    const owner = actor(c.req.header("Authorization"), "render:create"),
      id = parse(projectId, c.req.param("id"));
    projects.delete(owner, id);
    return c.json({ id, deleted: true });
  });
  r.get("/projects/:id/revisions/:revisionId/jobs", (c) =>
    c.json(
      projects.jobs(
        actor(c.req.header("Authorization"), "render:read:own"),
        parse(projectId, c.req.param("id")),
        parse(revisionId, c.req.param("revisionId")),
        {
          cursor: c.req.query("cursor"),
          limit: pageSize(c.req.query("pageSize")),
        },
      ),
    ),
  );
  r.post("/projects/:id/revisions", async (c) => {
    const owner = actor(c.req.header("Authorization"), "render:create"),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z
          .object({
            sourceId,
            entrypoint: z.string().min(1).max(240),
            displayName,
            originalFilename,
            outputs: renderOutputsSchema,
          })
          .strict(),
        await c.req.json<unknown>(),
      ),
      revision = projects.attachRevision(owner, {
        projectId: id,
        sourceId: input.sourceId,
        entrypoint: validateEntrypointPath(input.entrypoint),
        displayName: input.displayName,
        originalFilename: input.originalFilename,
        outputs: input.outputs,
      });
    return c.json(
      {
        id: revision.id,
        projectId: id,
        sourceId: revision.source_id,
        revisionNumber: revision.revision_number,
        entrypoint: revision.entrypoint,
        outputs: projects.renderOutputs(revision),
      },
      201,
    );
  });
  r.post("/projects/:id/revisions/:revisionId/render", async (c) => {
    const identity = deps.apiKeys.authenticate(
        parseBearer(c.req.header("Authorization")),
        "render:create",
      ),
      id = parse(projectId, c.req.param("id")),
      revision = parse(revisionId, c.req.param("revisionId")),
      selected = projects.revision(
        {
          userId: identity.userId,
          type: "service_account",
          id: identity.serviceAccountId,
        },
        id,
        revision,
      ),
      raw = await c.req.text(),
      input = parse(
        z.object({ outputs: renderOutputsSchema.unwrap().optional() }).strict(),
        raw === "" ? {} : (JSON.parse(raw) as unknown),
      ),
      key = c.req.header("Idempotency-Key");
    if (key === undefined || key.length < 16 || key.length > 200)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid Idempotency-Key is required",
        400,
      );
    const result = await service.create(
      identity,
      {
        sourceId: selected.revision.source_id,
        entrypoint: selected.revision.entrypoint,
        outputs: input.outputs ?? projects.renderOutputs(selected.revision),
        project: { projectId: id, revisionId: revision },
      },
      key,
    );
    return c.json(
      { ...result.value, projectId: id, revisionId: revision },
      result.status,
    );
  });
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
