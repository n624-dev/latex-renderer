import type { RenderEngine } from "@latex-renderer/contracts";
import {
  artifactRetentionExpiresAt,
  type JobRow,
  type RendererDatabase,
} from "@latex-renderer/database";

export interface RenderJobSummary {
  id: string;
  status: JobRow["status"];
  engine: RenderEngine;
  runtimeDigest: string | null;
  previousRuntimeDigest?: string;
  rendererVersion: string;
  sourceId: string | null;
  projectRevisionId: string | null;
  entrypoint: string;
  outputs: Array<"pdf" | "svg">;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retentionExpiresAt: string | null;
  exitCode: number | null;
  retryOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  previewAvailable: boolean;
  previewPages: number[];
  artifacts: Array<{
    type: string;
    filename: string;
    mimeType: string;
    relativePath: string;
    size: number;
    sha256: string;
    pageCount: number | null;
    resourceUri: string;
  }>;
  webResultUrl: string;
  stages?: import("@latex-renderer/contracts").JobStages;
}

export function summarizeRenderJob(
  database: RendererDatabase,
  row: JobRow,
  retentionHours: number,
  publicOrigin: string,
): RenderJobSummary {
  const stages = database.outputStages.publicState(row.id);
  const artifacts = database.artifacts.listDownloadable(row.id, {
      retentionHours: retentionHours,
    }),
    generatedPages = artifacts
      .filter((artifact) => artifact.type === "preview")
      .map((artifact) => previewPage(artifact.relative_path))
      .filter((page): page is number => page !== null)
      .sort((left, right) => left - right),
    document = database.previews.verifiedPdf(row.id, {
      retentionHours: retentionHours,
    })
      ? database.previews.document(row.id)
      : undefined,
    previewPages = document
      ? Array.from({ length: document.page_count }, (_, index) => index + 1)
      : generatedPages;
  return {
    id: row.id,
    status: row.status,
    ...database.jobs.renderProvenance(row),
    rendererVersion: row.renderer_version,
    sourceId: row.source_id,
    projectRevisionId: row.project_revision_id,
    entrypoint: row.entrypoint,
    outputs: database.jobs.outputs(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.completed_at,
    retentionExpiresAt:
      artifacts.length > 0 || row.completed_at !== null
        ? renderArtifactExpiry(database, row, retentionHours)
        : null,
    exitCode: row.exit_code,
    retryOf: row.retry_of_job_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    previewAvailable: previewPages.length > 0,
    previewPages,
    artifacts: artifacts.map((artifact) => ({
      type: artifact.type,
      filename: artifact.relative_path.split("/").at(-1) as string,
      mimeType: artifactMimeType(artifact.type),
      relativePath: artifact.relative_path,
      size: artifact.size,
      sha256: artifact.sha256,
      pageCount: artifact.type === "pdf" ? previewPages.length || null : null,
      resourceUri: resourceUri(row.id, artifact.relative_path),
    })),
    webResultUrl: new URL(
      `/app/jobs/${encodeURIComponent(row.id)}/`,
      publicOrigin,
    ).toString(),
    ...(stages === undefined ? {} : { stages }),
  };
}

export function renderArtifactExpiry(
  database: RendererDatabase,
  job: JobRow,
  retentionHours: number,
) {
  return artifactRetentionExpiresAt(
    database.outputStages.retentionStart(
      job.id,
      job.completed_at ?? job.updated_at,
    ),
    retentionHours,
  );
}

export function renderJobManifest(
  database: RendererDatabase,
  row: JobRow,
  retentionHours: number,
  publicOrigin: string,
) {
  const jobId = row.id;
  const summary = summarizeRenderJob(
    database,
    row,
    retentionHours,
    publicOrigin,
  );
  return {
    schemaVersion: 1 as const,
    jobId,
    status: summary.status,
    projectRevisionId: row.project_revision_id,
    sourceId: row.source_id,
    inputSha256: row.source_sha256,
    inputKind: row.source_id
      ? ("source_zip" as const)
      : database.drafts.isPreviewJob(jobId)
        ? ("draft_manifest" as const)
        : ("unknown" as const),
    entrypoint: row.entrypoint,
    engine: row.engine,
    runtimeDigest: row.runtime_digest,
    outputs: summary.outputs,
    pdfSha256:
      summary.artifacts.find(
        ({ relativePath }) => relativePath === "result.pdf",
      )?.sha256 ?? null,
    artifacts: summary.artifacts,
    stages: summary.stages ?? null,
    recordedTiming: {
      createdAt: row.created_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
    },
    workerObservations: database.jobs.stageObservations(jobId),
    reproducibility: database.jobs.reproducibility(jobId) ?? null,
    pdfSvgMatch: "not_checked" as const,
  };
}

export function artifactMimeType(type: string): string {
  return (
    {
      pdf: "application/pdf",
      log: "text/plain; charset=utf-8",
      errors: "application/json",
      dependencies: "application/json",
      preview: "image/png",
      svg: "image/svg+xml",
      svg_manifest: "application/json",
    }[type] ?? "application/octet-stream"
  );
}

export function previewPage(relativePath: string): number | null {
  const match = /^previews\/page-(\d+)\.png$/.exec(relativePath);
  return match === null ? null : Number(match[1]);
}

export function resourceUri(jobId: string, relativePath: string): string {
  if (relativePath === "result.pdf")
    return `latex-renderer://jobs/${jobId}/output.pdf`;
  if (relativePath === "compile.log")
    return `latex-renderer://jobs/${jobId}/build.log`;
  const page = previewPage(relativePath);
  if (page !== null) return `latex-renderer://jobs/${jobId}/preview/${page}`;
  return `latex-renderer://jobs/${jobId}/artifact/${encodeURIComponent(relativePath)}`;
}
