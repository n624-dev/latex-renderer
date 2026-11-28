import { Hono } from "hono";
import { z } from "zod";
import {
  displayLocales,
  preferredDisplayLanguages,
  resolveDisplayLocale,
} from "@latex-renderer/shared/locale";
import {
  RendererDrafts,
  RendererEnvironment,
  RendererSourceStore,
  downloadProjectSource,
  inlineArtifactLimit,
} from "@latex-renderer/renderer-core";
import {
  ProjectDraftOperations,
  ProjectDocumentState,
  type JobRow,
  type OwnedJobListRow,
} from "@latex-renderer/database";
import {
  createProjectDraftUpdateRequestSchema,
  projectDraftOpenRequestSchema,
  projectDocumentConditionsSchema,
  projectRevisionIdSchema,
  renderEngineSchema,
  renderOutputsSchema,
} from "@latex-renderer/contracts";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  effectiveResourceLimits,
  pageSize,
} from "@latex-renderer/shared";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import { requireAppActor } from "../auth/actor.js";
import {
  adminArtifactResponse,
  adminArtifactsArchiveResponse,
  adminPreviewResponse,
} from "../services/artifacts.js";
import { AdminJobsService } from "../services/jobs.js";
import { AppProjectsService } from "../services/app-projects.js";
import type { AdminDependencies, AppActor } from "../types.js";
import { parse, readJson } from "./helpers.js";

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
    projects = new AppProjectsService(deps),
    sourceLimits = effectiveResourceLimits(deps),
    draftFiles = new RendererDrafts(
      deps.database,
      new RendererSourceStore(
        deps.database,
        deps.storageRoot,
        sourceLimits,
        deps.maxUserStorageBytes,
      ),
    ),
    environment = new RendererEnvironment(
      deps.environmentRoot ?? "/var/lib/latex-renderer/environment",
      deps.rendererVersion,
      sourceLimits,
      inlineArtifactLimit(deps.maxOutputBytes),
    ),
    drafts = new ProjectDraftOperations(
      deps.database,
      deps.maxFileCount,
      deps.maxZipEntries,
    ),
    draftUpdate = createProjectDraftUpdateRequestSchema(
      (deps.maxFileCount ?? DEFAULT_RESOURCE_LIMITS.maxFileCount) * 2,
    );

  router.get("/me", async (c) => {
    const actor = await requireAppActor(deps, c),
      user = deps.database.users.get(actor.userId),
      displayLocale = deps.database.users.displayLocale(actor.userId);
    return c.json({
      userId: actor.userId,
      displayName: user?.display_name ?? actor.userId,
      displayLocale,
      resolvedDisplayLocale: resolveDisplayLocale({
        selected: c.req.query("locale"),
        saved: displayLocale ?? undefined,
        preferred: preferredDisplayLanguages(c.req.header("Accept-Language")),
      }),
      role: actor.role,
      isAdmin: actor.role === "owner" || actor.role === "admin",
      sourceLimits,
    });
  });

  router.patch("/me/locale", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(
        z.object({ locale: z.enum(displayLocales) }).strict(),
        await readJson(c),
      );
    deps.database.transaction(() => {
      const maintenance = deps.database.settings.value<string>(
        "maintenance_mode",
        "normal",
      );
      if (maintenance !== "normal" && maintenance !== "reject-new-jobs")
        throw new AppError(
          "MAINTENANCE",
          "Account settings cannot be changed during maintenance",
          503,
        );
      if (!deps.database.users.setDisplayLocale(actor.userId, input.locale))
        throw new AppError(
          "APP_FORBIDDEN",
          "Application access is not permitted",
          403,
        );
    });
    return c.json({ displayLocale: input.locale });
  });

  router.get("/jobs", async (c) => {
    const actor = await requireAppActor(deps, c);
    const limit = pageSize(c.req.query("pageSize")),
      page = deps.database.jobs.listOwnedPage(actor.userId, {
        cursor: c.req.query("cursor"),
        limit,
      });
    const stages = deps.database.outputStages.publicStates(
      page.items.map((job) => job.id),
    );
    return c.json({
      ...page,
      items: page.items.map((row) => jobSummary(deps, row, stages)),
    });
  });
  router.get("/jobs/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    const job = assertOwnedJob(deps, actor, id);
    return c.json({
      ...jobSummary(deps, job),
      pdfPageCount: deps.database.previews.document(id)?.page_count ?? null,
    });
  });
  router.get("/jobs/:id/archive", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return adminArtifactsArchiveResponse(deps, actor, id);
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
      { range: c.req.header("Range"), ifRange: c.req.header("If-Range") },
    );
  });
  router.get("/jobs/:id/previews/:name", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return adminPreviewResponse(
      deps,
      actor,
      id,
      c.req.param("name"),
      c.req.raw.signal,
    );
  });
  router.post("/jobs/:id/cancel", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    return c.json(jobs.cancel(actor, id), 202);
  });
  router.post("/jobs/:id/retry-svg", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id")),
      key = idempotencyKey(c.req.header("Idempotency-Key"));
    assertOwnedJob(deps, actor, id);
    const retried = await jobs.retrySvg(actor, id, key),
      access = await jobs.issueAccessTicket(actor, retried.id);
    return c.json(access, retried.reused ? 200 : 202);
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
  router.delete("/jobs/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(jobId, c.req.param("id"));
    assertOwnedJob(deps, actor, id);
    jobs.delete(actor, id);
    return c.body(null, 204);
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
        await readJson(c),
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
            engine: renderEngineSchema.optional(),
          })
          .strict(),
        await readJson(c),
      );
    const principal = ensureWebPrincipal(deps, actor),
      entrypoint = validateEntrypointPath(input.entrypoint),
      result = await jobs.createRender(
        actor,
        {
          apiKeyId: principal.api_key_id,
          sourceId: input.sourceId,
          entrypoint,
          outputs: input.outputs,
          engine: input.engine,
          project: {
            projectId: input.projectId,
            displayName: input.displayName,
            originalFilename: input.originalFilename,
            outputs: input.outputs,
          },
        },
        key,
      );
    if (
      !("projectRevisionId" in result.value) ||
      result.value.projectRevisionId === undefined
    )
      throw new AppError(
        "PROJECT_REVISION_MISSING",
        "Project revision was not attached atomically",
        500,
      );
    const revisionId = result.value.projectRevisionId;
    return c.json(
      {
        ...result.value,
        projectId: input.projectId,
        revisionId,
      },
      result.status,
    );
  });

  router.get("/projects", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(
      projects.list(actor, {
        cursor: c.req.query("cursor"),
        limit: pageSize(c.req.query("pageSize")),
      }),
    );
  });
  router.post("/projects", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(z.object({ displayName }).strict(), await readJson(c));
    return c.json(projects.create(actor, input.displayName), 201);
  });
  router.get("/projects/:id", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(
      projects.get(actor, parse(projectId, c.req.param("id")), {
        cursor: c.req.query("cursor"),
        limit: pageSize(c.req.query("pageSize")),
      }),
    );
  });
  router.get("/projects/:id/document-state", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(
      new ProjectDocumentState(deps.database).get(
        actor,
        parse(projectId, c.req.param("id")),
      ),
    );
  });
  router.patch("/projects/:id/document-state/conditions", async (c) => {
    const actor = await requireAppActor(deps, c);
    const input = parse(
      z
        .object({
          expectedVersion: z.number().int().nonnegative(),
          entries: projectDocumentConditionsSchema,
        })
        .strict(),
      await readJson(c),
    );
    return c.json(
      new ProjectDocumentState(deps.database).updateConditions(
        actor,
        parse(projectId, c.req.param("id")),
        input.expectedVersion,
        input.entries,
      ),
    );
  });
  router.get("/projects/:id/revisions/:revisionId/source.zip", async (c) =>
    downloadProjectSource(
      deps.database,
      deps.storageRoot,
      await requireAppActor(deps, c),
      parse(projectId, c.req.param("id")),
      parse(projectRevisionIdSchema, c.req.param("revisionId")),
      c.req.raw.signal,
    ),
  );
  router.get("/projects/:id/draft", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(drafts.get(actor, parse(projectId, c.req.param("id"))));
  });
  router.post("/projects/:id/draft", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(projectDraftOpenRequestSchema, await readJson(c, true));
    return c.json(
      await draftFiles.openProjectDraft(
        actor,
        parse(projectId, c.req.param("id")),
        input.revisionId,
      ),
    );
  });
  router.post("/projects/:id/draft/replace", async (c) => {
    const actor = await requireAppActor(deps, c);
    const input = parse(
      z
        .object({
          revisionId: z.string().regex(/^revision_[a-f0-9]{32}$/),
          version: z.number().int().positive(),
        })
        .strict(),
      await readJson(c),
    );
    return c.json(
      drafts.replaceFromRevision(
        actor,
        parse(projectId, c.req.param("id")),
        input.revisionId,
        input.version,
      ),
    );
  });
  router.patch("/projects/:id/draft", async (c) => {
    const actor = await requireAppActor(deps, c),
      input = parse(draftUpdate, await readJson(c));
    return c.json(
      drafts.update(actor, parse(projectId, c.req.param("id")), input),
    );
  });
  router.get("/projects/:id/draft/file", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      path = parse(z.string().min(1).max(2048), c.req.query("path")),
      version = parse(
        z.coerce.number().int().positive(),
        c.req.query("version"),
      );
    return c.json(await draftFiles.readDraftText(actor, id, version, path));
  });
  router.put("/projects/:id/draft/file", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z
          .object({
            version: z.number().int().positive(),
            path: z.string().min(1).max(2048),
            text: z.string(),
          })
          .strict(),
        await readJson(c),
      );
    return c.json(
      await draftFiles.saveDraftText(
        actor,
        id,
        input.version,
        input.path,
        input.text,
      ),
    );
  });
  router.put("/projects/:id/draft/file/content", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      path = parse(z.string().min(1).max(2048), c.req.query("path")),
      version = parse(
        z.coerce.number().int().positive(),
        c.req.query("version"),
      ),
      size = parse(z.coerce.number().int().nonnegative(), c.req.query("size"));
    const type = c.req.header("Content-Type");
    if (
      type !== "application/octet-stream" &&
      type !== "text/plain; charset=utf-8"
    )
      throw new AppError(
        "INVALID_REQUEST",
        "Unsupported Draft file content type",
        415,
      );
    const length = c.req.header("Content-Length");
    if (
      length !== undefined &&
      (!/^(?:0|[1-9][0-9]{0,9})$/.test(length) || Number(length) !== size)
    )
      throw new AppError(
        "CONTENT_LENGTH_MISMATCH",
        "Content-Length does not match the declared file size",
        400,
      );
    const result = await draftFiles.saveDraftFileContent(
      actor,
      id,
      { version, path, size, utf8: type.startsWith("text/") },
      c.req.raw.body,
      c.req.raw.signal,
    );
    return c.json(result);
  });
  router.get("/projects/:id/draft/preview", async (c) => {
    const actor = await requireAppActor(deps, c);
    return c.json(
      drafts.previewActivity(
        actor,
        parse(projectId, c.req.param("id")),
        process.env.RENDERER_IMAGE ?? null,
        deps.artifactRetentionHours ?? 24,
      ),
    );
  });
  router.post("/projects/:id/draft/preview", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z.object({ version: z.number().int().positive() }).strict(),
        await readJson(c),
      ),
      principal = ensureWebPrincipal(deps, actor),
      result = await jobs.createDraftPreview(
        actor,
        id,
        input.version,
        principal,
      );
    return c.json(result, result.reused ? 200 : 202);
  });
  router.post("/projects/:id/draft/revisions", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      input = parse(
        z
          .object({
            version: z.number().int().positive(),
            displayName,
            outputs: renderOutputsSchema.unwrap().optional(),
          })
          .strict(),
        await readJson(c),
      );
    const revision = await draftFiles.saveDraftRevision(
      actor,
      id,
      input.version,
      input.displayName,
      input.outputs,
    );
    return c.json({ revisionId: revision.id });
  });
  router.get("/projects/:id/revisions/:revisionId/jobs", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      revisionId = parse(
        z.string().regex(/^revision_[a-f0-9]{32}$/),
        c.req.param("revisionId"),
      );
    return c.json(
      projects.jobs(actor, id, revisionId, {
        cursor: c.req.query("cursor"),
        limit: pageSize(c.req.query("pageSize")),
      }),
    );
  });
  router.patch("/projects/:id", async (c) => {
    const actor = await requireAppActor(deps, c),
      id = parse(projectId, c.req.param("id")),
      input = parse(z.object({ displayName }).strict(), await readJson(c));
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
      input = parse(
        z.object({ outputs: renderOutputsSchema.unwrap().optional() }).strict(),
        await readJson(c, true),
      ),
      principal = ensureWebPrincipal(deps, actor),
      result = await jobs.createRender(
        actor,
        {
          apiKeyId: principal.api_key_id,
          sourceId: selected.revision.source_id,
          entrypoint: selected.revision.entrypoint,
          outputs: input.outputs ?? projects.renderOutputs(selected.revision),
          engine: selected.revision.engine,
          project: { projectId: id, revisionId },
        },
        key,
      );
    if (
      !("projectRevisionId" in result.value) ||
      result.value.projectRevisionId !== revisionId
    )
      throw new AppError(
        "PROJECT_REVISION_CONFLICT",
        "Render Job belongs to another Project revision",
        409,
      );
    return c.json(
      { ...result.value, projectId: id, revisionId },
      result.status,
    );
  });

  router.get("/environment", async (c) => {
    await requireAppActor(deps, c);
    return c.json(await environment.verifiedCapabilities());
  });
  router.post("/environment/packages/check", async (c) => {
    await requireAppActor(deps, c);
    const input = parse(namesSchema, await readJson(c));
    return c.json({
      items: await environment.checkPackages(input.names),
    });
  });
  router.get("/environment/packages/search", async (c) => {
    await requireAppActor(deps, c);
    const input = parse(searchSchema, {
      query: c.req.query("query"),
      cursor: c.req.query("cursor"),
    });
    return c.json(
      await environment.searchPackages(
        input.query,
        Number(input.cursor ?? "0"),
      ),
    );
  });
  router.post("/environment/fonts/check", async (c) => {
    await requireAppActor(deps, c);
    const input = parse(namesSchema, await readJson(c));
    return c.json({
      items: await environment.checkFonts(input.names),
    });
  });
  router.get("/environment/fonts/search", async (c) => {
    await requireAppActor(deps, c);
    const input = parse(searchSchema, {
      query: c.req.query("query"),
      cursor: c.req.query("cursor"),
    });
    return c.json(
      await environment.searchFonts(input.query, Number(input.cursor ?? "0")),
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
  const row = deps.database.jobs.getVisible(id);
  if (row === undefined || row.user_id !== actor.userId)
    throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
  return row;
}

function jobSummary(
  deps: AdminDependencies,
  row: JobRow | OwnedJobListRow,
  states?: ReadonlyMap<string, import("@latex-renderer/contracts").JobStages>,
) {
  const stages =
    states === undefined
      ? deps.database.outputStages.publicState(row.id)
      : states.get(row.id);
  const joined = "project_name" in row,
    revision =
      !joined && row.project_revision_id
        ? deps.database.projects.revisionOwned(
            row.project_revision_id,
            row.user_id,
          )
        : undefined,
    project =
      !joined && revision
        ? deps.database.projects.getOwned(revision.project_id, row.user_id)
        : undefined;
  return {
    id: row.id,
    status: row.status,
    documentName: joined
      ? (row.revision_display_name ?? row.entrypoint)
      : (revision?.display_name ?? row.entrypoint),
    projectName: joined
      ? (row.project_name ?? null)
      : (project?.display_name ?? null),
    projectId: joined ? (row.project_id ?? null) : (project?.id ?? null),
    revisionId: joined
      ? (row.project_revision_id ?? null)
      : (revision?.id ?? null),
    entrypoint: row.entrypoint,
    engine: row.engine,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorCode: row.error_code,
    ...(stages === undefined ? {} : { stages }),
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
