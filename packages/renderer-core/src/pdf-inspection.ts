import {
  pdfInspectionInputSchema,
  type PdfInspectionInput,
} from "@latex-renderer/contracts";
import {
  artifactRetentionExpiresAt,
  PDF_INSPECTOR_VERSION,
  type JobRow,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";
import { validateSourceFilePath } from "@latex-renderer/zip-validation";
import type { RendererSourceStore } from "./source-store.js";

export function inspectJobPdf(
  database: RendererDatabase,
  jobId: string,
  sha256: string,
  options: {
    readJob: () => JobRow;
    sources: RendererSourceStore;
    retentionHours: number;
    request: boolean;
    params?: PdfInspectionInput | undefined;
  },
) {
  const geometry =
    options.params === undefined
      ? undefined
      : pdfInspectionInputSchema.parse(options.params);
  const lookup = () => {
    const job = options.readJob();
    const pdf = database.artifacts.getDownloadable(jobId, "result.pdf", {
      retentionHours: options.retentionHours,
    });
    if (!pdf)
      throw new AppError(
        "PDF_UNAVAILABLE",
        "The canonical PDF is not available",
        410,
      );
    if (pdf.sha256 !== sha256)
      throw new AppError(
        "PDF_CHECKSUM_MISMATCH",
        "The canonical PDF does not match the requested digest",
        409,
      );
    const expiresAt = artifactRetentionExpiresAt(
      database.outputStages.retentionStart(
        job.id,
        job.completed_at ?? job.updated_at,
      ),
      options.retentionHours,
    );
    const document = database.previews.document(jobId);
    if (geometry && "direction" in geometry) {
      if (!database.artifacts.sourceMap(pdf))
        throw new AppError(
          "SYNCTEX_UNAVAILABLE",
          "No source map for this PDF",
          410,
        );
      if (geometry.direction === "source_to_pdf")
        geometry.path = validateSourceFilePath(
          geometry.path,
          options.sources.zipLimits(),
        );
    }
    if (
      geometry &&
      "page" in geometry &&
      document?.pdf_sha256 === pdf.sha256 &&
      geometry.page > document.page_count
    )
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "Preview page is outside the PDF",
        404,
      );
    if (
      geometry &&
      "pages" in geometry &&
      document?.pdf_sha256 === pdf.sha256 &&
      geometry.pages.some((page) => page > document.page_count)
    )
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "A contact sheet page is outside the PDF",
        404,
      );
    const row = options.request
      ? database.pdfInspections.request(pdf, expiresAt, nowIso(), geometry)
      : database.pdfInspections.forArtifact(pdf, geometry);
    return {
      jobId,
      revisionId: job.project_revision_id,
      pdfSha256: pdf.sha256,
      generation: pdf.storage_generation ?? null,
      inspectorVersion: PDF_INSPECTOR_VERSION,
      expiresAt,
      state: row?.status ?? ("not_requested" as const),
      errorCode: row?.error_code ?? null,
      report: row?.result_json
        ? (JSON.parse(row.result_json) as unknown)
        : null,
    };
  };
  return options.request ? database.transaction(lookup) : lookup();
}

export function compareJobPdfInspections(
  before: { jobId: string; pdfSha256: string },
  after: { jobId: string; pdfSha256: string },
  inspect: (target: {
    jobId: string;
    pdfSha256: string;
  }) => ReturnType<typeof inspectJobPdf>,
  readJob: (jobId: string) => JobRow,
) {
  const left = inspect(before);
  const right = inspect(after);
  const observations = (value: unknown) => {
    if (typeof value !== "object" || value === null || !("checks" in value))
      return {};
    return value.checks as Record<
      string,
      { text: string | null; truncated: boolean }
    >;
  };
  const leftChecks = observations(left.report),
    rightChecks = observations(right.report);
  const compare = (name: string) => {
    const a = leftChecks[name],
      b = rightChecks[name];
    if (
      !a ||
      !b ||
      a.text === null ||
      b.text === null ||
      a.truncated ||
      b.truncated
    )
      return "not_checked" as const;
    return a.text === b.text
      ? ("same_observation" as const)
      : ("changed_observation" as const);
  };
  const rasterVersion = compare("versions");
  const pageRasters = (checks: ReturnType<typeof observations>) => {
    const sample = checks["page-rasters"];
    if (sample?.text == null || sample.truncated) return [];
    return sample.text
      .trim()
      .split("\n")
      .filter((hash) => /^[a-f0-9]{64}$/.test(hash));
  };
  const leftPages = pageRasters(leftChecks),
    rightPages = pageRasters(rightChecks);
  const comparedPages =
    rasterVersion === "same_observation"
      ? Math.min(leftPages.length, rightPages.length)
      : 0;
  const changedPreviewPages = Array.from(
    { length: comparedPages },
    (_, i) => i + 1,
  ).filter((page) => leftPages[page - 1] !== rightPages[page - 1]);
  const leftJob = readJob(before.jobId);
  const rightJob = readJob(after.jobId);
  return {
    before: { ...before, revisionId: left.revisionId, state: left.state },
    after: { ...after, revisionId: right.revisionId, state: right.state },
    samePdfBytes: left.pdfSha256 === right.pdfSha256,
    extractedText: compare("extracted-text"),
    fontInventory: compare("font-info"),
    pageInfoAndMetadata: compare("page-info"),
    navigation: compare("navigation"),
    visual:
      comparedPages === 0
        ? ("not_checked" as const)
        : changedPreviewPages.length > 0
          ? ("changed_observation" as const)
          : ("same_observation" as const),
    visualCoverage: {
      comparedPages,
      changedPreviewPages,
      maxPageSidePixels: 512,
      pagePairing: "physical_page_number" as const,
    },
    sourceComparison:
      leftJob.source_id !== null && rightJob.source_id !== null
        ? leftJob.source_sha256 === rightJob.source_sha256 &&
          leftJob.entrypoint === rightJob.entrypoint
          ? ("same_observation" as const)
          : ("changed_observation" as const)
        : ("not_checked" as const),
    documentMeaning: "not_checked" as const,
    sameEngine: leftJob.engine === rightJob.engine,
    sameRuntime:
      leftJob.runtime_digest === null || rightJob.runtime_digest === null
        ? null
        : leftJob.runtime_digest === rightJob.runtime_digest,
  };
}
