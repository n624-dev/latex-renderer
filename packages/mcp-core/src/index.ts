import { lstat, realpath } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { RendererClient } from "@latex-renderer/api-client";
import {
  createSourceRenderJob,
  downloadJobArtifacts,
  getJob,
  renderProject,
  requestJobAction,
  uploadProjectSource,
  type ArtifactPaths,
} from "@latex-renderer/client-core";
import {
  jobStatuses,
  projectPageSchema,
  projectDetailSchema,
  projectRevisionJobsPageSchema,
  projectIdSchema,
  projectRevisionIdSchema,
  attachProjectRevisionResponseSchema,
  renderOutputsSchema,
  type JobArtifact,
  type JobResponse,
} from "@latex-renderer/contracts";
import { loadCredential } from "@latex-renderer/setup-core";
import { AppError, PUBLIC_ORIGIN, safeError } from "@latex-renderer/shared";
import { z } from "zod";

export const MCP_TOOL_NAMES = [
  "upload_source",
  "create_render_job",
  "render_project",
  "get_render_status",
  "download_render_artifacts",
  "cancel_render",
  "delete_render",
  "list_projects",
  "get_project",
  "get_project_revision_jobs",
  "create_project",
  "rename_project",
  "delete_project",
  "attach_project_revision",
  "render_project_revision",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const mcpJobIdSchema = z.string().regex(/^job_[a-f0-9]{32}$/);
export const renderProjectInputSchema = z
  .object({
    directory: z.string().min(1),
    entrypoint: z.string().min(1).default("main.tex"),
  })
  .strict();
export const uploadSourceInputSchema = z
  .object({ path: z.string().min(1) })
  .strict();
export const createRenderJobInputSchema = z
  .object({
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    entrypoint: z.string().min(1).default("main.tex"),
  })
  .strict();
export const jobInputSchema = z.object({ jobId: mcpJobIdSchema }).strict();
export const downloadArtifactsInputSchema = z
  .object({
    jobId: mcpJobIdSchema,
    outputDirectory: z.string().min(1).default(".render"),
  })
  .strict();
export const projectIdInputSchema = z
  .object({ projectId: projectIdSchema })
  .strict();
export const projectPageInputSchema = z
  .object({
    cursor: z.string().max(1024).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export const attachProjectRevisionInputSchema = z
  .object({
    projectId: projectIdSchema,
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    entrypoint: z.string().min(1).max(240).default("main.tex"),
    displayName: z.string().trim().min(1).max(200),
    originalFilename: z.string().trim().min(1).max(240),
    outputs: renderOutputsSchema,
  })
  .strict();
const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
  })
  .strict();
const artifactSchema = z
  .object({
    type: z.string(),
    relativePath: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string(),
  })
  .strict();
const jobSchema = z
  .object({
    id: mcpJobIdSchema,
    status: z.enum(jobStatuses),
    sourceSize: z.number().int().nonnegative(),
    sourceSha256: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    retentionExpiresAt: z.string().nullable(),
    artifacts: z.array(artifactSchema),
    previews: z.array(artifactSchema),
    sourceId: z.string().nullable().optional(),
    entrypoint: z.string().optional(),
  })
  .strict();
const localArtifactsSchema = z
  .object({
    pdf: z.string().optional(),
    errors: z.string().optional(),
    log: z.string().optional(),
    job: z.string(),
    previews: z.array(z.string()),
  })
  .strict();
const sourceSchema = z
  .object({
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    uploadRequired: z.boolean(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.number().int().nonnegative(),
  })
  .strict();
function projectOutput<Name extends string, Result extends z.ZodType>(
  operation: Name,
  result: Result,
) {
  return z
    .object({
      success: z.boolean(),
      operation: z.literal(operation),
      result: result.optional(),
      error: errorSchema.optional(),
    })
    .strict();
}
export const listProjectsOutputSchema = projectOutput(
  "list_projects",
  z.object({ page: projectPageSchema }).strict(),
);
export const getProjectOutputSchema = projectOutput(
  "get_project",
  z.object({ project: projectDetailSchema }).strict(),
);
export const getProjectRevisionJobsOutputSchema = projectOutput(
  "get_project_revision_jobs",
  z.object({ page: projectRevisionJobsPageSchema }).strict(),
);
export const createProjectOutputSchema = projectOutput(
  "create_project",
  z.object({ project: z.object({ id: projectIdSchema }).strict() }).strict(),
);
export const renameProjectOutputSchema = projectOutput(
  "rename_project",
  z
    .object({
      project: z
        .object({ id: projectIdSchema, displayName: z.string() })
        .strict(),
    })
    .strict(),
);
export const deleteProjectOutputSchema = projectOutput(
  "delete_project",
  z
    .object({
      project: z
        .object({ id: projectIdSchema, deleted: z.literal(true) })
        .strict(),
    })
    .strict(),
);
export const attachProjectRevisionOutputSchema = projectOutput(
  "attach_project_revision",
  z.object({ revision: attachProjectRevisionResponseSchema }).strict(),
);
export const renderProjectRevisionOutputSchema = projectOutput(
  "render_project_revision",
  z
    .object({
      projectId: projectIdSchema,
      revisionId: projectRevisionIdSchema,
      job: jobSchema,
    })
    .strict(),
);

export const uploadSourceOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("upload_source"),
    result: z.object({ source: sourceSchema }).strict().optional(),
    error: errorSchema.optional(),
  })
  .strict();
export const createRenderJobOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("create_render_job"),
    result: z.object({ job: jobSchema }).strict().optional(),
    error: errorSchema.optional(),
  })
  .strict();

export const renderProjectOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("render_project"),
    result: z
      .object({
        job: jobSchema,
        source: sourceSchema,
        outputDirectory: z.string(),
        artifacts: localArtifactsSchema,
      })
      .strict()
      .optional(),
    error: errorSchema.optional(),
  })
  .strict();
export const getRenderStatusOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("get_render_status"),
    result: z.object({ job: jobSchema }).strict().optional(),
    error: errorSchema.optional(),
  })
  .strict();
export const downloadArtifactsOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("download_render_artifacts"),
    result: z
      .object({
        job: jobSchema,
        outputDirectory: z.string(),
        artifacts: localArtifactsSchema,
      })
      .strict()
      .optional(),
    error: errorSchema.optional(),
  })
  .strict();
const actionResultSchema = z
  .object({
    jobId: mcpJobIdSchema,
    action: z.enum(["cancel", "delete"]),
    requested: z.literal(true),
  })
  .strict();
export const cancelRenderOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("cancel_render"),
    result: actionResultSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict();
export const deleteRenderOutputSchema = z
  .object({
    success: z.boolean(),
    operation: z.literal("delete_render"),
    result: actionResultSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict();

export type RenderProjectOutput = z.infer<typeof renderProjectOutputSchema>;
export type UploadSourceOutput = z.infer<typeof uploadSourceOutputSchema>;
export type CreateRenderJobOutput = z.infer<typeof createRenderJobOutputSchema>;
export type GetRenderStatusOutput = z.infer<typeof getRenderStatusOutputSchema>;
export type DownloadArtifactsOutput = z.infer<
  typeof downloadArtifactsOutputSchema
>;
export type CancelRenderOutput = z.infer<typeof cancelRenderOutputSchema>;
export type DeleteRenderOutput = z.infer<typeof deleteRenderOutputSchema>;
export type ListProjectsOutput = z.infer<typeof listProjectsOutputSchema>;
export type GetProjectOutput = z.infer<typeof getProjectOutputSchema>;
export type GetProjectRevisionJobsOutput = z.infer<
  typeof getProjectRevisionJobsOutputSchema
>;
export type CreateProjectOutput = z.infer<typeof createProjectOutputSchema>;
export type RenameProjectOutput = z.infer<typeof renameProjectOutputSchema>;
export type DeleteProjectOutput = z.infer<typeof deleteProjectOutputSchema>;
export type AttachProjectRevisionOutput = z.infer<
  typeof attachProjectRevisionOutputSchema
>;
export type RenderProjectRevisionOutput = z.infer<
  typeof renderProjectRevisionOutputSchema
>;
export type McpToolOutput =
  | UploadSourceOutput
  | CreateRenderJobOutput
  | RenderProjectOutput
  | GetRenderStatusOutput
  | DownloadArtifactsOutput
  | CancelRenderOutput
  | DeleteRenderOutput
  | ListProjectsOutput
  | GetProjectOutput
  | GetProjectRevisionJobsOutput
  | CreateProjectOutput
  | RenameProjectOutput
  | DeleteProjectOutput
  | AttachProjectRevisionOutput
  | RenderProjectRevisionOutput;

export interface McpOperations {
  uploadSource(path: string): Promise<UploadSourceOutput>;
  createRenderJob(
    sourceId: string,
    entrypoint: string,
  ): Promise<CreateRenderJobOutput>;
  renderProject(
    directory: string,
    entrypoint: string,
  ): Promise<RenderProjectOutput>;
  getRenderStatus(jobId: string): Promise<GetRenderStatusOutput>;
  downloadRenderArtifacts(
    jobId: string,
    outputDirectory: string,
  ): Promise<DownloadArtifactsOutput>;
  cancelRender(jobId: string): Promise<CancelRenderOutput>;
  deleteRender(jobId: string): Promise<DeleteRenderOutput>;
  listProjects(options: {
    cursor?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<ListProjectsOutput>;
  getProject(
    projectId: string,
    options: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<GetProjectOutput>;
  getProjectRevisionJobs(
    projectId: string,
    revisionId: string,
    options: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<GetProjectRevisionJobsOutput>;
  createProject(displayName: string): Promise<CreateProjectOutput>;
  renameProject(
    projectId: string,
    displayName: string,
  ): Promise<RenameProjectOutput>;
  deleteProject(projectId: string): Promise<DeleteProjectOutput>;
  attachProjectRevision(
    input: z.infer<typeof attachProjectRevisionInputSchema>,
  ): Promise<AttachProjectRevisionOutput>;
  renderProjectRevision(
    projectId: string,
    revisionId: string,
  ): Promise<RenderProjectRevisionOutput>;
}

export interface McpOperationsOptions {
  readonly baseUrl?: string;
  readonly renderTimeoutMs?: number;
  readonly allowedRoots?: readonly string[];
  readonly clientFactory?: () => Promise<RendererClient>;
}

export function createMcpOperations(
  options: McpOperationsOptions = {},
): McpOperations {
  const allowedRoots = lazyAllowedRoots(options.allowedRoots);
  const client =
    options.clientFactory ??
    (async () =>
      new RendererClient(
        options.baseUrl ?? rendererBaseUrl(),
        await loadCredential(),
      ));
  return {
    uploadSource: async (path) => {
      const localPath = await resolveAllowedMcpPath(path, allowedRoots(), true);
      return {
        success: true,
        operation: "upload_source",
        result: {
          source: await uploadProjectSource(await client(), localPath),
        },
      };
    },
    createRenderJob: async (sourceId, entrypoint) => ({
      success: true,
      operation: "create_render_job",
      result: {
        job: summarizeJob(
          await createSourceRenderJob(await client(), sourceId, entrypoint),
        ),
      },
    }),
    renderProject: async (directory, entrypoint) => {
      const localDirectory = await resolveAllowedMcpPath(
        directory,
        allowedRoots(),
        true,
      );
      const rendered = await renderProject(await client(), localDirectory, {
        entrypoint,
        ...(options.renderTimeoutMs === undefined
          ? {}
          : { pollTimeoutMs: options.renderTimeoutMs }),
      });
      const result = {
        job: summarizeJob(rendered.job),
        source: rendered.source,
        outputDirectory: rendered.outputDirectory,
        artifacts: summarizeLocalArtifacts(rendered.artifacts),
      };
      if (rendered.job.status === "succeeded")
        return { success: true, operation: "render_project", result };
      return {
        success: false,
        operation: "render_project",
        result,
        error: {
          code: rendered.job.errorCode ?? "RENDER_FAILED",
          message: rendered.job.errorMessage ?? "Render did not succeed",
          status: 422,
        },
      };
    },
    getRenderStatus: async (jobId) => ({
      success: true,
      operation: "get_render_status",
      result: { job: summarizeJob(await getJob(await client(), jobId)) },
    }),
    downloadRenderArtifacts: async (jobId, outputDirectory) => {
      const localOutput = await resolveAllowedMcpPath(
        outputDirectory,
        allowedRoots(),
        false,
      );
      const downloaded = await downloadJobArtifacts(
        await client(),
        jobId,
        localOutput,
      );
      return {
        success: true,
        operation: "download_render_artifacts",
        result: {
          job: summarizeJob(downloaded.job),
          outputDirectory: downloaded.outputDirectory,
          artifacts: summarizeLocalArtifacts(downloaded.artifacts),
        },
      };
    },
    cancelRender: async (jobId) => ({
      success: true,
      operation: "cancel_render",
      result: await requestJobAction(await client(), jobId, "cancel"),
    }),
    deleteRender: async (jobId) => ({
      success: true,
      operation: "delete_render",
      result: await requestJobAction(await client(), jobId, "delete"),
    }),
    listProjects: async (query) => ({
      success: true,
      operation: "list_projects",
      result: { page: await (await client()).listProjects(query) },
    }),
    getProject: async (projectId, query) => ({
      success: true,
      operation: "get_project",
      result: { project: await (await client()).getProject(projectId, query) },
    }),
    getProjectRevisionJobs: async (projectId, revisionId, query) => ({
      success: true,
      operation: "get_project_revision_jobs",
      result: {
        page: await (
          await client()
        ).listProjectRevisionJobs(projectId, revisionId, query),
      },
    }),
    createProject: async (displayName) => ({
      success: true,
      operation: "create_project",
      result: { project: await (await client()).createProject(displayName) },
    }),
    renameProject: async (projectId, displayName) => ({
      success: true,
      operation: "rename_project",
      result: {
        project: await (await client()).renameProject(projectId, displayName),
      },
    }),
    deleteProject: async (projectId) => {
      await (await client()).deleteProject(projectId);
      return {
        success: true,
        operation: "delete_project",
        result: { project: { id: projectId, deleted: true } },
      };
    },
    attachProjectRevision: async (input) => ({
      success: true,
      operation: "attach_project_revision",
      result: { revision: await (await client()).attachProjectRevision(input) },
    }),
    renderProjectRevision: async (projectId, revisionId) => {
      const api = await client(),
        ticket = await api.renderProjectRevision(
          projectId,
          revisionId,
          randomUUID(),
        ),
        job = await api.job(ticket.jobId, ticket.jobTicket);
      return {
        success: true,
        operation: "render_project_revision",
        result: {
          projectId,
          revisionId,
          job: summarizeJob(job),
        },
      };
    },
  };
}

export function mcpFailure<T extends McpToolName>(
  operation: T,
  error: unknown,
): {
  success: false;
  operation: T;
  error: { code: string; message: string; status: number };
} {
  const normalized = safeError(error);
  return {
    success: false,
    operation,
    error: {
      ...normalized,
      message: redactSecrets(normalized.message),
    },
  };
}

function summarizeJob(job: JobResponse): z.infer<typeof jobSchema> {
  return {
    id: job.id,
    status: job.status,
    sourceSize: job.sourceSize,
    sourceSha256: job.sourceSha256,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorCode: job.errorCode,
    errorMessage:
      job.errorMessage === null ? null : redactSecrets(job.errorMessage),
    retentionExpiresAt: job.retentionExpiresAt,
    artifacts: job.artifacts.map(summarizeArtifact),
    previews: job.previews.map(summarizeArtifact),
    ...(job.sourceId === undefined ? {} : { sourceId: job.sourceId }),
    ...(job.entrypoint === undefined ? {} : { entrypoint: job.entrypoint }),
  };
}

function summarizeArtifact(
  artifact: JobArtifact,
): z.infer<typeof artifactSchema> {
  return {
    type: artifact.type,
    relativePath: artifact.relativePath,
    size: artifact.size,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
  };
}

function summarizeLocalArtifacts(
  artifacts: ArtifactPaths,
): z.infer<typeof localArtifactsSchema> {
  return {
    ...(artifacts.pdf === undefined ? {} : { pdf: artifacts.pdf }),
    ...(artifacts.errors === undefined ? {} : { errors: artifacts.errors }),
    ...(artifacts.log === undefined ? {} : { log: artifacts.log }),
    job: artifacts.job,
    previews: artifacts.previews,
  };
}

function resolveAllowedRoots(
  configured: readonly string[] | undefined,
): Promise<string[]> {
  const roots =
    configured ??
    (process.env.LATEX_RENDER_ALLOWED_ROOTS ?? "")
      .split(delimiter)
      .map((value) => value.trim())
      .filter((value) => value !== "");
  const selected = roots.length === 0 ? [process.cwd()] : roots;
  return Promise.all(selected.map((root) => realpath(resolve(root))));
}

function lazyAllowedRoots(
  configured: readonly string[] | undefined,
): () => Promise<readonly string[]> {
  let result: Promise<readonly string[]> | undefined;
  return () => (result ??= resolveAllowedRoots(configured));
}

export async function resolveAllowedMcpPath(
  value: string,
  roots: Promise<readonly string[]> | readonly string[],
  mustExist: boolean,
): Promise<string> {
  const requested = resolve(value);
  let checked: string;
  if (mustExist || (await lstat(requested).catch(notFoundOnly)) !== undefined) {
    checked = await realpath(requested);
  } else {
    const ancestor = await nearestExistingAncestor(dirname(requested));
    const realAncestor = await realpath(ancestor);
    checked = resolve(realAncestor, relative(ancestor, requested));
  }
  const allowed = await roots;
  if (!allowed.some((root) => containsPath(root, checked)))
    throw new AppError(
      "OUTSIDE_ALLOWED_ROOT",
      "Local MCP path is outside LATEX_RENDER_ALLOWED_ROOTS",
      403,
    );
  return checked;
}

async function nearestExistingAncestor(value: string): Promise<string> {
  let current = value;
  for (;;) {
    if ((await lstat(current).catch(notFoundOnly)) !== undefined)
      return current;
    const parent = dirname(current);
    if (parent === current)
      throw new AppError(
        "INVALID_LOCAL_PATH",
        "Local path has no existing ancestor",
        400,
      );
    current = parent;
  }
}

function containsPath(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return (
    suffix === "" ||
    (!suffix.split(/[\\/]/).includes("..") && !isAbsolute(suffix))
  );
}

function notFoundOnly(error: unknown): undefined {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
  throw error;
}

function rendererBaseUrl(): string {
  return (
    process.env.LATEX_RENDER_BASE_URL ??
    process.env.LATEX_RENDER_RENDERER_URL ??
    process.env.LATEX_RENDER_GATEWAY_URL ??
    PUBLIC_ORIGIN
  );
}

export function assertValidMcpOutput(output: McpToolOutput): McpToolOutput {
  const schema = {
    upload_source: uploadSourceOutputSchema,
    create_render_job: createRenderJobOutputSchema,
    render_project: renderProjectOutputSchema,
    get_render_status: getRenderStatusOutputSchema,
    download_render_artifacts: downloadArtifactsOutputSchema,
    cancel_render: cancelRenderOutputSchema,
    delete_render: deleteRenderOutputSchema,
    list_projects: listProjectsOutputSchema,
    get_project: getProjectOutputSchema,
    get_project_revision_jobs: getProjectRevisionJobsOutputSchema,
    create_project: createProjectOutputSchema,
    rename_project: renameProjectOutputSchema,
    delete_project: deleteProjectOutputSchema,
    attach_project_revision: attachProjectRevisionOutputSchema,
    render_project_revision: renderProjectRevisionOutputSchema,
  }[output.operation];
  return schema.parse(output);
}

export function validateRenderTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AppError(
      "INVALID_MCP_TIMEOUT",
      "MCP render timeout must be a positive integer",
      400,
    );
  return value;
}

function redactSecrets(value: string): string {
  return value.replace(/lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}/g, "[redacted]");
}
