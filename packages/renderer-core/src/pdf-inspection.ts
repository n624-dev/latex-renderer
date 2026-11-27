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
