import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { RenderApiScope } from "@latex-renderer/contracts";
import {
  rendererApiAuthoringTools,
  rendererAuthoringRequestBytes,
} from "@latex-renderer/contracts/renderer-mcp-definitions";
import {
  canRenderDraftPreview,
  ProjectDocumentState,
  ProjectStorage,
  type ProjectActor,
} from "@latex-renderer/database";
import {
  RendererDrafts,
  inspectJobPdf,
  type RendererSourceStore,
} from "@latex-renderer/renderer-core";
import { AppError, parseBearer } from "@latex-renderer/shared";
import type { InternalApiDependencies } from "./types.js";
import type { RenderTicketsService } from "./services/render-tickets.js";

const definitions = rendererApiAuthoringTools();
const projectDraft = "/projects/:id/draft";
const numericQuery = z.string().max(16).regex(/^\d+$/).transform(Number);
const projectPath = "/projects/:id";
const historyQuery = z.string().transform((value, ctx): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid history query" });
    return z.NEVER;
  }
});

export function mountAuthoringRoutes(
  router: Hono,
  deps: InternalApiDependencies,
  tickets: RenderTicketsService,
  sourceStore: () => RendererSourceStore,
  projectActor: (
    authorization: string | undefined,
    scope: RenderApiScope,
  ) => ProjectActor,
): void {
  const drafts = () => new RendererDrafts(deps.database, sourceStore());
  const documentState = new ProjectDocumentState(deps.database);
  const storage = new ProjectStorage(deps.database);
  function actor(context: Context, scope: RenderApiScope) {
    return projectActor(context.req.header("Authorization"), scope);
  }
  router.get(`${projectPath}/document-state`, (c) => {
    const owner = actor(c, "render:project:state:read");
    const query = parse(
      z.strictObject({
        conditionsVersion: numericQuery.optional(),
        history: historyQuery.optional(),
      }),
      c.req.query(),
    );
    const { projectId, conditionsVersion, history } = parse(
      definitions.get_project_document_state.inputSchema,
      { ...query, projectId: c.req.param("id") },
    );
    return c.json(
      documentState.getWithHistory(
        owner,
        projectId,
        conditionsVersion,
        history,
      ),
    );
  });
  router.patch(`${projectPath}/document-state/conditions`, async (c) => {
    const owner = actor(c, "render:project:state:write");
    const { projectId, expectedVersion, entries } = await projectInput(
      c,
      definitions.update_project_document_conditions.inputSchema,
    );
    return c.json(
      documentState.updateConditions(
        owner,
        projectId,
        expectedVersion,
        entries,
      ),
    );
  });
  router.post(`${projectPath}/document-state/adoption`, async (c) => {
    const owner = actor(c, "render:project:state:write");
    const { projectId, revisionId, expectedRevisionId } = await projectInput(
      c,
      definitions.adopt_project_revision.inputSchema,
    );
    return c.json(
      documentState.adopt(owner, projectId, revisionId, expectedRevisionId),
    );
  });
  router.get(`${projectPath}/pdf-reviews`, (c) => {
    const owner = actor(c, "render:project:state:read");
    const query = parse(
      z.strictObject({ offset: numericQuery.optional() }),
      c.req.query(),
    );
    const { projectId, offset } = parse(
      definitions.list_project_pdf_reviews.inputSchema,
      { ...query, projectId: c.req.param("id") },
    );
    return c.json(documentState.reviews(owner, projectId, offset));
  });
  router.post(`${projectPath}/pdf-reviews`, async (c) => {
    const owner = actor(c, "render:project:state:write");
    const { projectId, ...input } = await projectInput(
      c,
      definitions.record_project_pdf_review.inputSchema,
    );
    return c.json({
      review: documentState.recordReview(
        owner,
        projectId,
        input,
        deps.artifactRetentionHours ?? 24,
      ),
    });
  });
  router.get(`${projectPath}/storage-usage`, (c) => {
    const owner = actor(c, "render:project:read");
    const { projectId } = parse(
      definitions.get_project_storage_usage.inputSchema,
      {
        ...c.req.query(),
        projectId: c.req.param("id"),
      },
    );
    return c.json(storage.usage(owner, projectId, deps.maxUserStorageBytes));
  });
  router.post(`${projectPath}/revision-protection`, async (c) => {
    const owner = actor(c, "render:create");
    const input = await projectInput(
      c,
      definitions.protect_project_revision.inputSchema,
    );
    return c.json(
      storage.protect(
        owner,
        input.projectId,
        input.revisionId,
        input.protected,
      ),
    );
  });
  router.post(`${projectPath}/revision-cleanup/plan`, async (c) => {
    const owner = actor(c, "render:project:read");
    const { projectId, revisionIds } = await projectInput(
      c,
      definitions.plan_project_revision_cleanup.inputSchema,
    );
    return c.json(storage.cleanupPlan(owner, projectId, revisionIds));
  });
  router.post(`${projectPath}/revision-cleanup/apply`, async (c) => {
    const owner = actor(c, "render:project:delete");
    const { projectId, revisionIds, planHash } = await projectInput(
      c,
      definitions.apply_project_revision_cleanup.inputSchema,
    );
    return c.json(
      storage.applyCleanup(owner, projectId, revisionIds, planHash),
    );
  });
  router.get(projectDraft, (c) => {
    const owner = actor(c, "render:draft:read");
    const { projectId } = parse(definitions.get_project_draft.inputSchema, {
      projectId: c.req.param("id"),
    });
    return c.json({ draft: drafts().getDraft(owner, projectId) });
  });
  router.get(`${projectDraft}/file`, async (c) => {
    const owner = actor(c, "render:draft:read");
    const { version, path, offset } = parse(
      z
        .object({
          version: numericQuery.pipe(z.int().nonnegative()),
          path: z.string().min(1).max(2048),
          offset: numericQuery.pipe(z.int().nonnegative()).optional(),
        })
        .strict(),
      c.req.query(),
    );
    const input = parse(definitions.get_project_draft_file.inputSchema, {
      projectId: c.req.param("id"),
      version,
      path,
      offset,
    });
    return c.json(
      await drafts().readDraftPage(
        owner,
        input.projectId,
        input.version,
        input.path,
        input.offset,
      ),
    );
  });
  router.post(`${projectDraft}/open`, async (c) => {
    const owner = actor(c, "render:draft:write");
    const input = await projectInput(
      c,
      definitions.open_project_draft.inputSchema,
    );
    return c.json({
      draft: await drafts().openSharedDraft(
        owner,
        input.projectId,
        input.revisionId,
        input.replaceVersion,
      ),
    });
  });
  router.post(
    `${projectDraft}/changes`,
    bodyLimit({
      maxSize: rendererAuthoringRequestBytes,
      onError: () => {
        throw new AppError(
          "REQUEST_TOO_LARGE",
          "Draft changes exceed the request limit",
          413,
        );
      },
    }),
    async (c) => {
      const owner = actor(c, "render:draft:write");
      const input = await projectInput(
        c,
        definitions.apply_project_changes.inputSchema,
      );
      return c.json(await drafts().applyProjectChanges(owner, input));
    },
  );
  router.post(`${projectDraft}/preview`, async (c) => {
    const identity = deps.apiKeys.authenticate(
      parseBearer(c.req.header("Authorization")),
      "render:draft:write",
    );
    if (!canRenderDraftPreview(identity))
      throw new AppError(
        "INSUFFICIENT_SCOPE",
        "Draft preview requires rendering and draft editing permissions",
        403,
      );
    const { projectId, version } = await projectInput(
      c,
      definitions.render_project_draft.inputSchema,
    );
    return c.json(
      await tickets.createDraftPreview(identity, projectId, version),
    );
  });
  router.post(`${projectDraft}/save`, async (c) => {
    const owner = actor(c, "render:draft:write");
    const input = await projectInput(
      c,
      definitions.save_project_draft.inputSchema,
    );
    const revision = await drafts().saveDraftRevision(
      owner,
      input.projectId,
      input.version,
      input.displayName,
      undefined,
      input.description,
    );
    return c.json({
      revision: {
        id: revision.id,
        projectId: input.projectId,
        sourceId: revision.source_id,
        revisionNumber: revision.revision_number,
        entrypoint: revision.entrypoint,
        engine: revision.engine,
        outputs: deps.database.projects.renderOutputs(revision),
      },
    });
  });
  router.on(["GET", "POST"], "/jobs/:jobId/pdf-inspection", async (c) => {
    const identity = deps.apiKeys.authenticate(
      parseBearer(c.req.header("Authorization")),
      "render:pdf:inspect",
    );
    if (identity.keyKind !== "render")
      throw new AppError(
        "INSUFFICIENT_SCOPE",
        "A rendering API key is required",
        403,
      );
    const request = c.req.method === "POST";
    const input = request ? await json(c) : c.req.query();
    const { jobId, pdfSha256 } = parse(
      definitions.get_render_quality_report.inputSchema,
      {
        ...input,
        jobId: c.req.param("jobId"),
      },
    );
    return c.json(
      inspectJobPdf(deps.database, jobId, pdfSha256, {
        readJob: () => tickets.requireOwnedJob(identity, jobId),
        sources: sourceStore(),
        retentionHours: deps.artifactRetentionHours ?? 24,
        request,
      }),
    );
  });
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError(
      "INVALID_REQUEST",
      "The authoring request is invalid",
      400,
    );
  return result.data;
}

async function json(context: Context): Promise<Record<string, unknown>> {
  const input: unknown = await context.req.json<unknown>().catch(() => null);
  return parse(z.record(z.string(), z.unknown()), input);
}

async function projectInput<T>(
  context: Context,
  schema: z.ZodType<T>,
): Promise<T> {
  const input = await json(context);
  if (Object.hasOwn(input, "projectId"))
    throw new AppError(
      "INVALID_REQUEST",
      "Provide the Project ID in the URL",
      400,
    );
  return parse(schema, { ...input, projectId: context.req.param("id") });
}
