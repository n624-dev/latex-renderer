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
  function actor(
    context: Context,
    scope: "render:draft:read" | "render:draft:write",
  ) {
    return projectActor(context.req.header("Authorization"), scope);
  }
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
