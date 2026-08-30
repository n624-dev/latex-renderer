import { Hono } from "hono";
import { z } from "zod";
import { RemoteRenderService } from "@latex-renderer/remote-mcp-core";
import type { JobRow } from "@latex-renderer/database";
import { renderOutputsSchema } from "@latex-renderer/contracts";
import { AppError, DEFAULT_RESOURCE_LIMITS } from "@latex-renderer/shared";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import { requireAppActor } from "../auth/actor.js";
import { adminArtifactResponse } from "../services/artifacts.js";
import { AdminJobsService } from "../services/jobs.js";
import { AppProjectsService } from "../services/app-projects.js";
import type { AdminDependencies, AppActor } from "../types.js";
import { parse } from "./helpers.js";

const jobId = z.string().regex(/^job_[a-f0-9]{32}$/),
  sourceId = z.string().regex(/^source_[a-f0-9]{32}$/),
  projectId = z.string().regex(/^project_[a-f0-9]{32}$/),
  displayName = z.string().trim().min(1).max(200),
  filename = z
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
      "Filename is invalid",
    );

export function createAppV1Router(deps: AdminDependencies): Hono {
  const router = new Hono(),
    jobs = new AdminJobsService(deps),
    projects = new AppProjectsService(deps);

  router.get("/me", async (c) => {
    const actor = await requireAppActor(deps, c),
      user = deps.database.users.get(actor.userId);
    return c.json({
      userId: actor.userId,
      displayName: user?.display_name ?? actor.userId,
      role: actor.role,
      isAdmin: actor.role === "owner" || actor.role === "admin",
    });
  });

  router.get("/jobs", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json({
      items: deps.database.jobs
        .listOwned(actor.userId)
        .map((row) => jobSummary(deps, row)),
    });
  });
  router.get("/jobs/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    return c.json(jobSummary(deps, assertOwnedJob(deps, actor, id)));
  });
  router.post("/jobs/:id/access-ticket", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    return c.json(await jobs.issueAccessTicket(actor, id));
  });
  router.get("/jobs/:id/artifacts/*", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return adminArtifactResponse(
      deps,
      actor,
      id,
      c.req.param("*") || c.req.path.split("/artifacts/").at(-1) || "",
      false,
      c.req.query("disposition") === "inline",
    );
  });
  router.get("/jobs/:id/previews/:name", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return adminArtifactResponse(
      deps,
      actor,
      id,
      c.req.param("name"),
      true,
      true,
    );
  });
  router.post("/jobs/:id/cancel", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return c.json(jobs.cancel(actor, id), 202);
  });
  router.post("/jobs/:id/retry", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id")),
      key = idempotencyKey(c.req.header("Idempotency-Key"));
    assertOwnedJob(deps, actor, id);
    const retried = await jobs.retry(actor, id, key),
      access = await jobs.issueAccessTicket(actor, retried.id);
    return c.json({ ...access, retryOfJobId: id }, retried.reused ? 200 : 202);
  });

  router.post("/source-tickets", async (c) => {
    const actor = await requireAppActor(deps, c),
      key = idempotencyKey(c.req.header("Idempotency-Key")),
      input = parse(
        z
          .object({
            size: z
              .number()
              .int()
              .positive()
              .max(
                deps.maxUploadBytes ?? DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
              ),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
        await c.req.json<unknown>(),
      ),
      principal = ensureWebPrincipal(deps, actor);
    const result = await jobs.createSource(
      actor,
      { apiKeyId: principal.api_key_id, ...input },
      key,
    );
    return c.json(result.value, result.status);
  });
  router.post("/render-tickets", async (c) => {
    const actor = await requireAppActor(deps, c),
      key = idempotencyKey(c.req.header("Idempotency-Key")),
      input = parse(
        z
          .object({
            sourceId,
            entrypoint: z.string().min(1).max(240),
            projectId,
            displayName,
            originalFilename: filename,
            outputs: renderOutputsSchema,
          })
          .strict(),
        await c.req.json<unknown>(),
      );
    projects.get(actor, input.projectId);
    const principal = ensureWebPrincipal(deps, actor),
      entrypoint = validateEntrypointPath(input.entrypoint),
      result = await jobs.createRender(
        actor,
        {
          apiKeyId: principal.api_key_id,
          sourceId: input.sourceId,
          entrypoint,
          outputs: input.outputs,
        },
        key,
      ),
      revision = projects.attachRevision(actor, {
        projectId: input.projectId,
        sourceId: input.sourceId,
        jobId: result.value.jobId,
        displayName: input.displayName,
        originalFilename: input.originalFilename,
        entrypoint,
      });
    return c.json(
      { ...result.value, projectId: input.projectId, revisionId: revision.id },
      result.status,
    );
  });

  router.get("/projects", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json({ items: projects.list(actor) });
  });
  router.post("/projects", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(
        z.object({ displayName }).strict(),
        await c.req.json<unknown>(),
      );
    return c.json(projects.create(actor, input.displayName), 201);
  });
  router.get("/projects/:id", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(projects.get(actor, parse(projectId, c.req.param("id"))));
  });
  router.patch("/projects/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z.object({ displayName }).strict(),
        await c.req.json<unknown>(),
      );
    projects.rename(actor, id, input.displayName);
    return c.json({ id, displayName: input.displayName });
  });
  router.delete("/projects/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id"));
    projects.delete(actor, id);
    return c.body(null, 204);
  });
  router.post("/projects/:id/revisions/:revisionId/render", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      revisionId = parse(
        z.string().regex(/^revision_[a-f0-9]{32}$/),
        c.req.param("revisionId"),
      ),
      key = idempotencyKey(c.req.header("Idempotency-Key")),
      selected = projects.revision(actor, id, revisionId),
      principal = ensureWebPrincipal(deps, actor),
      result = await jobs.createRender(
        actor,
        {
          apiKeyId: principal.api_key_id,
          sourceId: selected.revision.source_id,
          entrypoint: selected.revision.entrypoint,
          outputs: ["pdf"],
        },
        key,
      );
    deps.database.transaction(() => {
      deps.database.jobs.attachProjectRevision(result.value.jobId, revisionId);
      deps.database.projects.touch(id, new Date().toISOString());
      deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.revision_rendered",
        targetType: "job",
        targetId: result.value.jobId,
        result: "success",
        metadata: { projectId: id, revisionId },
      });
    });
    return c.json(
      { ...result.value, projectId: id, revisionId },
      result.status,
    );
  });

  router.get("/environment", async (c) => {
    const actor = await requireAppActor(deps, c),
      service = environmentService(deps);
    return c.json(service.capabilities(environmentIdentity(actor)));
  });
  router.post("/environment/packages/check", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(namesSchema, await c.req.json<unknown>());
    return c.json({
      items: await environmentService(deps).checkPackages(
        environmentIdentity(actor),
        input.names,
      ),
    });
  });
  router.get("/environment/packages/search", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(searchSchema, {
        query: c.req.query("query"),
        cursor: c.req.query("cursor"),
      });
    return c.json(
      await environmentService(deps).searchPackages(
        environmentIdentity(actor),
        input.query,
        Number(input.cursor ?? "0"),
      ),
    );
  });
  router.post("/environment/fonts/check", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(namesSchema, await c.req.json<unknown>());
    return c.json({
      items: await environmentService(deps).checkFonts(
        environmentIdentity(actor),
        input.names,
      ),
    });
  });
  router.get("/environment/fonts/search", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(searchSchema, {
        query: c.req.query("query"),
        cursor: c.req.query("cursor"),
      });
    return c.json(
      await environmentService(deps).searchFonts(
        environmentIdentity(actor),
        input.query,
        Number(input.cursor ?? "0"),
      ),
    );
  });
  return router;
}

const namesSchema = z
    .object({
      names: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
    })
    .strict(),
  searchSchema = z
    .object({
      query: z.string().trim().min(1).max(100),
      cursor: z.string().regex(/^\d+$/).optional(),
    })
    .strict();

function ensureWebPrincipal(deps: AdminDependencies, actor: AppActor) {
  return deps.database.transaction(() =>
    deps.database.webPrincipals.ensure(actor.userId),
  );
}

function assertOwnedJob(deps: AdminDependencies, actor: AppActor, id: string) {
  const row = deps.database.jobs.get(id);
  if (row === undefined || row.user_id !== actor.userId)
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  return row;
}

function jobSummary(deps: AdminDependencies, row: JobRow) {
  const revision = row.project_revision_id
      ? deps.database.projects.revisionOwned(
          row.project_revision_id,
          row.user_id,
        )
      : undefined,
    project = revision
      ? deps.database.projects.getOwned(revision.project_id, row.user_id)
      : undefined;
  return {
    id: row.id,
    status: row.status,
    documentName: revision?.display_name ?? row.entrypoint,
    projectName: project?.display_name ?? null,
    projectId: project?.id ?? null,
    revisionId: revision?.id ?? null,
    entrypoint: row.entrypoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorCode: row.error_code,
  };
}

function idempotencyKey(value: string | undefined): string {
  if (value === undefined)
    throw new AppError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key is required",
      400,
    );
  return value;
}

function environmentService(deps: AdminDependencies) {
  return new RemoteRenderService(
    deps.database,
    deps.storageRoot,
    deps.rendererVersion,
    deps.renderTickets?.rendererPublicUrl ?? deps.publicOrigin,
    deps.maxQueueLength,
    deps.maxUserStorageBytes,
    deps.environmentRoot ?? "/var/lib/latex-renderer/environment",
  );
}

function environmentIdentity(actor: AppActor) {
  return { userId: actor.userId, scopes: ["mcp:read"] as const };
}
