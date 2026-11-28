import {
  projectPageSchema,
  projectDetailSchema,
  attachProjectRevisionResponseSchema,
  projectIdSchema,
  projectRevisionIdSchema,
  projectRevisionJobsPageSchema,
  projectDocumentConditionsSchema,
  projectReviewChecksSchema,
  renderEngineSchema,
  renderReproducibilitySchema,
  diagnosticCoverageSchema,
  pdfCropRequestSchema,
  pdfSyncQuerySchema,
  pdfSheetQuerySchema,
  documentProbeSchema,
  renderOutputsSchema,
  jobStagesSchema,
} from "./index.js";
import {
  authoringTopics,
  rendererMcpToolPolicies,
  type RendererMcpTool,
} from "./renderer-mcp.js";
import { z } from "zod";
import {
  rendererMcpEnglishText,
  type RendererMcpTranslate,
} from "./renderer-mcp-messages.js";

const jobId = z.string().regex(/^job_[a-f0-9]{32}$/);
const sourceId = z.string().regex(/^source_[a-f0-9]{32}$/);
const idempotencyKey = z
  .string()
  .min(16)
  .max(200)
  .optional()
  .describe(
    "Reuse this key with exactly the same inputs after a lost reply. Use a new key for an intentional new run. Keys are scoped per user and operation for 24 hours.",
  );
const chatGptFile = z
  .object({
    download_url: z.string().min(1).max(8192),
    file_id: z.string().min(1).max(256),
    mime_type: z.string().max(256).optional(),
    file_name: z.string().max(1024).optional(),
  })
  .strict();
const jobStatus = z.enum([
  "reserved",
  "uploading",
  "queued",
  "validating",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "deleting",
  "deleted",
  "expired",
]);
const artifactSchema = z
  .object({
    type: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    relativePath: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().positive().nullable(),
    resourceUri: z.string().regex(/^latex-renderer:\/\/jobs\//),
  })
  .strict();
const sourceSchema = z
  .object({
    id: sourceId,
    status: z.enum([
      "reserved",
      "uploading",
      "ready",
      "deleting",
      "deleted",
      "expired",
    ]),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    paths: z.array(z.string()),
    createdAt: z.string(),
    expiresAt: z.string(),
    revisionOf: sourceId.nullable(),
  })
  .strict();
const sourceUploadSchema = z
  .object({
    uploadId: sourceId,
    sourceId,
    expectedBytes: z.number().int().positive(),
    receivedBytes: z.number().int().nonnegative(),
    expiresAt: z.string(),
    maxChunkBytes: z.number().int().positive(),
  })
  .strict();
const sourceFileSchema = z
  .object({
    path: z.string().min(1).max(2048),
    text: z.string().max(1_048_576).optional(),
    base64: z.string().max(1_400_000).optional(),
  })
  .strict()
  .refine(
    (file) => (file.text === undefined) !== (file.base64 === undefined),
    "Specify exactly one of text or base64",
  );
const jobSchema = z
  .object({
    id: jobId,
    status: jobStatus,
    engine: renderEngineSchema,
    runtimeDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable(),
    previousRuntimeDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    rendererVersion: z.string(),
    sourceId: z.string().nullable(),
    projectRevisionId: projectRevisionIdSchema.nullable(),
    entrypoint: z.string(),
    outputs: z.array(z.enum(["pdf", "svg"])),
    createdAt: z.string(),
    updatedAt: z.string(),
    queuedAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    retentionExpiresAt: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    retryOf: z.string().nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    previewAvailable: z.boolean(),
    previewPages: z.array(z.number().int().positive()),
    artifacts: z.array(artifactSchema),
    webResultUrl: z.url(),
    stages: jobStagesSchema.optional(),
  })
  .strict();
export const rendererMcpRecoveryDetailsSchema = z.object({
    retryAfterSeconds: z.number().int().positive().optional(),
    expectedOffset: z.number().int().nonnegative().optional(),
    previewErrorCode: z.string().regex(/^[A-Z0-9_]{1,64}$/).optional(),
    retryable: z.boolean().optional(),
    currentVersion: z.number().int().nonnegative().nullable().optional(),
});
const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    ...rendererMcpRecoveryDetailsSchema.shape,
  })
  .strict();

function oauthToolMeta(tool: RendererMcpTool) {
  const { scope } = rendererMcpToolPolicies[tool];
  return {
    securitySchemes: [
      { type: "oauth2", scopes: scope === null ? [] : [scope] },
    ],
  };
}

function operationOutput<T extends z.ZodType, const Name extends string>(operation: Name, result: T) {
  return z
    .object({
      success: z.boolean(),
      operation: z.literal(operation),
      result: result.optional(),
      error: errorSchema.optional(),
    })
    .strict();
}

export const authoringGuideToolDefinition = {
      _meta: oauthToolMeta("get_authoring_guide"),
      title: "Get the LaTeX authoring guide",
      description:
        "Read the published LaTeX Renderer authoring guide by topic. Start with overview; choose remote or local for tool-specific steps, then use layout and quality for the final PDF.",
      inputSchema: z
        .object({ topic: z.enum(authoringTopics).default("overview") })
        .strict(),
      outputSchema: operationOutput(
        "get_authoring_guide",
        z
          .object({
            version: z.string(),
            topic: z.enum(authoringTopics),
            body: z.string(),
            topics: z.array(z.enum(authoringTopics)),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };

function rendererMcpRenderToolDefinitions(
  translate: RendererMcpTranslate,
  maxSourceUploadBytes: number,
) {
  const targetPdf = z
    .object({ jobId, pdfSha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict();
  const reportPart = z
    .object({
      status: z.enum(["observed", "not_checked"]),
      text: z.string().nullable(),
      truncated: z.boolean(),
    })
    .strict();
  const reportSchema = z
    .object({
      jobId,
      revisionId: projectRevisionIdSchema.nullable(),
      pdfSha256: z.string(),
      generation: z.number().int().nullable(),
      inspectorVersion: z.number().int().positive(),
      expiresAt: z.string(),
      state: z.enum(["not_requested", "queued", "running", "ready", "failed"]),
      errorCode: z.string().nullable(),
      report: z
        .object({
          version: z.number().int(),
          runtimeImage: z.string(),
          checks: z.record(z.string(), reportPart),
          coverage: z
            .object({
              totalPages: z.number().int().positive().nullable(),
              pageDetailsThrough: z
                .number()
                .int()
                .positive()
                .max(100)
                .nullable(),
              sampledPages: z.number().int().min(0).max(12),
              maxSampleSidePixels: z.literal(512),
            })
            .strict()
            .optional(),
          visual: z.literal("not_checked"),
          sourceComparison: z.literal("not_checked"),
        })
        .strict()
        .nullable(),
    })
    .strict();
  const cropRect = z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .strict();
  const cropResponse = z
    .object({
      page: z.number().int().positive(),
      normalizedCrop: pdfCropRequestSchema,
      cropPixels: cropRect,
      displayPagePoints: z
        .object({ width: z.number(), height: z.number() })
        .strict(),
      rotation: z.number(),
      dpi: z.number(),
      pixelWidth: z.number(),
      pixelHeight: z.number(),
      mimeType: z.literal("image/jpeg"),
      sha256: z.string(),
    })
    .strict()
    .nullable();
  const attachedTarget = z
    .object({
      uploadId: z.string().regex(/^pdfupload_[a-f0-9]{32}$/),
      pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
  const attachedReport = attachedTarget.extend({
    expiresAt: reportSchema.shape.expiresAt,
    state: reportSchema.shape.state,
    errorCode: reportSchema.shape.errorCode,
    report: reportSchema.shape.report,
  });
  const inspectionComparison = z.enum([
    "not_checked",
    "same_observation",
    "changed_observation",
  ]);
  const comparedPdf = targetPdf.extend({
    revisionId: projectRevisionIdSchema.nullable(),
    state: reportSchema.shape.state,
  });
  const requirementName = z.string().trim().min(1).max(160);
  const documentRequirement = z.union([
    z
      .object({
        kind: z.enum(["package", "class", "distribution"]),
        name: requirementName,
      })
      .strict(),
    z
      .object({
        kind: z.literal("font"),
        name: requirementName,
        style: requirementName.optional(),
        characters: z.string().max(100).optional(),
        math: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("feature"),
        name: z.enum(["network", "shell_escape"]),
      })
      .strict(),
  ]);
  return {
    get_authoring_guide: authoringGuideToolDefinition,
    list_authoring_profiles: {
      _meta: oauthToolMeta("list_authoring_profiles"),
      title: "Read verified authoring profile availability",
      description:
        "Check whether this Runtime passed the Japanese tagged PDF fixture. The result describes the fixture and validation scope, not PDF/UA conformance for a user document.",
      inputSchema: z.object({}).strict(),
      outputSchema: operationOutput(
        "list_authoring_profiles",
        z
          .object({
            profiles: z.array(
              z
                .object({
                  id: z.string(),
                  runtimeDigest: z.string().nullable(),
                  fixtureSha256: z.string(),
                  engine: renderEngineSchema,
                  documentClass: z.string(),
                  state: z.enum(["verified_tagged_fixture", "not_checked"]),
                  guideTopic: z.string(),
                  templateTopic: z.string(),
                  readingOrder: z.literal("not_checked"),
                  pdfUa: z.literal("not_checked"),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_profile: {
      title: translate("getConnectedProfile"),
      description: translate("returnTheStableOpaqueIdentityOf"),
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ id: z.string().min(1) }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ...oauthToolMeta("get_profile"), "openai/profile": true },
    },
    verify_attachment_delivery_origin: {
      _meta: {
        ...oauthToolMeta("verify_attachment_delivery_origin"),
        "openai/fileParams": ["file"],
      },
      title: "Verify attachment delivery origin",
      description:
        "For the configured operator only. Reports the HTTPS origin of a file attached in ChatGPT without downloading it. Use only when the operator requests a delivery check.",
      inputSchema: z.object({ file: chatGptFile }).strict(),
      outputSchema: operationOutput(
        "verify_attachment_delivery_origin",
        z.object({ origin: z.string() }).strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    import_source_attachment: {
      _meta: {
        ...oauthToolMeta("import_source_attachment"),
        "openai/fileParams": ["file"],
      },
      title: "Import a supplied TeX ZIP attachment",
      description:
        "Import a ZIP the user attached in ChatGPT. After import, pass the returned Source ID to create_render. Reuse the same idempotency key for an identical request after a lost reply.",
      inputSchema: z
        .object({
          idempotencyKey: idempotencyKey.unwrap(),
          file: chatGptFile,
        })
        .strict(),
      outputSchema: operationOutput(
        "import_source_attachment",
        z.object({ source: sourceSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    create_source: {
      _meta: oauthToolMeta("create_source"),
      title: translate("createAMultiFileLatexSource"),
      description: translate("createAnImmutableSourceFromSmall"),
      inputSchema: z
        .object({ files: z.array(sourceFileSchema).min(1).max(100) })
        .strict(),
      outputSchema: operationOutput(
        "create_source",
        z.object({ source: sourceSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    begin_source_upload: {
      _meta: oauthToolMeta("begin_source_upload"),
      title: translate("beginAChunkedSourceZipUpload"),
      description: translate("reserveAnOwnerScopedUploadFor", {
        value: maxSourceUploadBytes,
      }),
      inputSchema: z
        .object({
          expectedBytes: z.number().int().min(1).max(maxSourceUploadBytes),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      outputSchema: operationOutput(
        "begin_source_upload",
        z.object({ upload: sourceUploadSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    upload_source_chunk: {
      _meta: oauthToolMeta("upload_source_chunk"),
      title: translate("appendASourceZipChunk"),
      description: translate("appendOneSequentialBase64ChunkOf"),
      inputSchema: z
        .object({
          uploadId: sourceId,
          offset: z.number().int().nonnegative(),
          base64: z.string().min(4).max(700_000),
        })
        .strict(),
      outputSchema: operationOutput(
        "upload_source_chunk",
        z.object({ upload: sourceUploadSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    get_source_upload_status: {
      _meta: oauthToolMeta("get_source_upload_status"),
      title: "Get Source upload status",
      description:
        "After an interrupted upload, check the owner-scoped upload ID and resume at receivedBytes. This read does not extend the upload deadline.",
      inputSchema: z.object({ uploadId: sourceId }).strict(),
      outputSchema: operationOutput(
        "get_source_upload_status",
        z
          .object({
            upload: sourceUploadSchema.extend({
              status: sourceSchema.shape.status,
            }),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    finalize_source_upload: {
      _meta: oauthToolMeta("finalize_source_upload"),
      title: translate("validateAndFinalizeASourceZip"),
      description: translate("verifySizeAndSha256Apply"),
      inputSchema: z.object({ uploadId: sourceId }).strict(),
      outputSchema: operationOutput(
        "finalize_source_upload",
        z.object({ source: sourceSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    update_source_file: {
      _meta: oauthToolMeta("update_source_file"),
      title: translate("createASourceRevisionWithOne"),
      description: translate("copyAnOwnedImmutableSourceInto"),
      inputSchema: z.object({ sourceId, file: sourceFileSchema }).strict(),
      outputSchema: operationOutput(
        "update_source_file",
        z.object({ source: sourceSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    delete_source_file: {
      _meta: oauthToolMeta("delete_source_file"),
      title: translate("createASourceRevisionWithoutOne"),
      description: translate("copyAnOwnedImmutableSourceInto2"),
      inputSchema: z
        .object({ sourceId, path: z.string().min(1).max(2048) })
        .strict(),
      outputSchema: operationOutput(
        "delete_source_file",
        z.object({ source: sourceSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    create_source_ref: {
      _meta: oauthToolMeta("create_source_ref"),
      title: translate("createAShortLivedSourceHandoff"),
      description: translate("createAnOwnerScoped15Minute"),
      inputSchema: z.object({ sourceId }).strict(),
      outputSchema: operationOutput(
        "create_source_ref",
        z.object({ sourceRef: z.string(), expiresAt: z.string() }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    create_render: {
      _meta: oauthToolMeta("create_render"),
      title: translate("createRemoteLatexRender"),
      description: translate("createOneRenderFromSmallInline"),
      inputSchema: z
        .object({
          inlineSource: z
            .string()
            .min(1)
            .max(65_536)
            .optional()
            .describe(
              "Inline UTF-8 TeX, at most 65,536 bytes. For larger or multi-file input, use create_source or chunked upload.",
            ),
          sourceId: sourceId.optional(),
          sourceRef: z
            .string()
            .regex(/^source_ref_[a-f0-9]{32}$/)
            .optional(),
          entrypoint: z
            .string()
            .min(1)
            .max(2048)
            .optional()
            .describe("Relative TeX path. Defaults to main.tex."),
          engine: renderEngineSchema.optional(),
          outputs: renderOutputsSchema
            .unwrap()
            .optional()
            .describe("PDF is required; no duplicates. Defaults to PDF only."),
          idempotencyKey,
          reproducibility: renderReproducibilitySchema
            .optional()
            .describe(
              "LuaLaTeX only. Fixed uses the supplied UTC date. Latest uses this Job’s acceptance time.",
            ),
        })
        .strict()
        .refine(
          (input) =>
            [input.inlineSource, input.sourceId, input.sourceRef].filter(
              (value) => value !== undefined,
            ).length === 1,
          "Specify exactly one of inlineSource, sourceId, or sourceRef",
        ),
      outputSchema: operationOutput(
        "create_render",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    retry_render: {
      _meta: oauthToolMeta("retry_render"),
      title: translate("retryARenderWithTheSame"),
      description: translate("createANewQueuedJobUsing"),
      inputSchema: z.object({ jobId, idempotencyKey }).strict(),
      outputSchema: operationOutput(
        "retry_render",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    retry_svg_render: {
      _meta: oauthToolMeta("retry_svg_render"),
      title: translate("retrySvgWithoutRecompilingThePdf"),
      description: translate("retryAFailedSvgStageOn"),
      inputSchema: z
        .object({ jobId, idempotencyKey: z.string().min(16).max(200) })
        .strict(),
      outputSchema: operationOutput(
        "retry_svg_render",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_status: {
      _meta: oauthToolMeta("get_render_status"),
      title: translate("getRemoteRenderStatus"),
      description: translate("readTheStatusAndSafeMetadata"),
      inputSchema: z.object({ jobId: jobId }).strict(),
      outputSchema: operationOutput(
        "get_render_status",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    request_render_quality_report: {
      _meta: oauthToolMeta("request_render_quality_report"),
      title: "Request a PDF quality inspection",
      description:
        "Request bounded machine inspection for the exact canonical PDF. The Worker checks structure, page information, fonts, text extraction and outlines without recompiling TeX. Poll get_render_quality_report with the same PDF digest.",
      inputSchema: targetPdf,
      outputSchema: operationOutput(
        "request_render_quality_report",
        reportSchema,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_quality_report: {
      _meta: oauthToolMeta("get_render_quality_report"),
      title: "Read the PDF quality inspection",
      description:
        "Read the requested PDF inspection and scope. Machine observations do not mark visual or content checks complete.",
      inputSchema: targetPdf,
      outputSchema: operationOutput("get_render_quality_report", reportSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_preview_crop: {
      _meta: oauthToolMeta("get_render_preview_crop"),
      title: "Request or read an enlarged page region",
      description:
        "Use the physical page number and 0–1 fractions measured from the displayed page’s top left. Repeat the same rectangle to check its status. The Worker renders only the requested region, with bounded resolution.",
      inputSchema: targetPdf.extend({ crop: pdfCropRequestSchema }),
      outputSchema: operationOutput(
        "get_render_preview_crop",
        z
          .object({
            ...reportSchema.omit({ report: true }).shape,
            crop: cropResponse,
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    request_attached_pdf_inspection: {
      _meta: {
        ...oauthToolMeta("request_attached_pdf_inspection"),
        "openai/fileParams": ["file"],
      },
      title: "Inspect an attached PDF",
      description:
        "Inspect the exact PDF the user attached. Reuse the request key after an interrupted reply. Use the returned upload ID and PDF digest to poll the report or zoom in. The PDF, report and preview expire one hour after acceptance.",
      inputSchema: z
        .object({
          idempotencyKey: idempotencyKey.unwrap(),
          file: chatGptFile,
        })
        .strict(),
      outputSchema: operationOutput(
        "request_attached_pdf_inspection",
        attachedReport,
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    get_attached_pdf_inspection: {
      _meta: oauthToolMeta("get_attached_pdf_inspection"),
      title: "Read the attached PDF report or zoom in",
      description:
        "Use the exact upload ID and PDF digest. Omit crop for quality observations, or supply a physical page and a rectangle of 0–1 fractions from the displayed page’s top left. Repeat the same request if the crop is preparing. A machine report does not check the meaning or correctness of the content.",
      inputSchema: attachedTarget.extend({
        crop: pdfCropRequestSchema.optional(),
      }),
      outputSchema: operationOutput(
        "get_attached_pdf_inspection",
        attachedReport.extend({ crop: cropResponse }),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    locate_render_source: {
      _meta: oauthToolMeta("locate_render_source"),
      title: "Find correspondence between a PDF and its TeX source",
      description:
        "Query the exact PDF digest for candidate source lines or page positions. PDF coordinates are unrotated points from the top left of the page, before a viewer applies cropping or rotation. Repeat the same request until ready; older PDFs without a retained source map report unavailable.",
      inputSchema: targetPdf.extend({ query: pdfSyncQuerySchema }),
      outputSchema: operationOutput(
        "locate_render_source",
        reportSchema.omit({ report: true }).extend({
          matches: z
            .object({
              evidence: z.literal("canonical_synctex"),
              state: z.enum(["candidate", "unknown"]),
              coordinateSystem: z.literal("unrotated_page_points_top_left"),
              sources: z.array(
                z
                  .object({
                    path: z.string(),
                    line: z.number().int().positive(),
                    column: z.number().int().positive().nullable(),
                  })
                  .strict(),
              ),
              locations: z.array(
                z
                  .object({
                    page: z.number().int().positive(),
                    x: z.number(),
                    y: z.number(),
                  })
                  .strict(),
              ),
              truncated: z.boolean(),
            })
            .strict()
            .nullable(),
        }),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_preview_sheet: {
      _meta: oauthToolMeta("get_render_preview_sheet"),
      title: "Request a contact sheet for selected PDF pages",
      description:
        "Request up to four physical pages from the exact PDF. Repeat the same ordered page list to poll. The image reads left to right in rows in returned page order. Use full-size pages or crops for detailed checks.",
      inputSchema: targetPdf.extend({ sheet: pdfSheetQuerySchema }),
      outputSchema: operationOutput(
        "get_render_preview_sheet",
        reportSchema.omit({ report: true }).extend({
          sheet: z
            .object({
              pages: z.array(z.number().int().positive()),
              columns: z.number().int().min(1).max(2),
              mimeType: z.literal("image/jpeg"),
              sha256: z.string(),
            })
            .strict()
            .nullable(),
        }),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    compare_render_quality: {
      _meta: oauthToolMeta("compare_render_quality"),
      title: "Compare recorded observations for two exact PDFs",
      description:
        "Compare recorded observations for two exact PDFs. Request each report first. Image sampling compares corresponding physical pages at 512 pixels on the longest side and cannot determine whether text or mathematics has the same meaning.",
      inputSchema: z.object({ before: targetPdf, after: targetPdf }).strict(),
      outputSchema: operationOutput(
        "compare_render_quality",
        z
          .object({
            before: comparedPdf,
            after: comparedPdf,
            samePdfBytes: z.boolean(),
            extractedText: inspectionComparison,
            fontInventory: inspectionComparison,
            pageInfoAndMetadata: inspectionComparison,
            navigation: inspectionComparison,
            visual: inspectionComparison,
            visualCoverage: z
              .object({
                comparedPages: z.number().int().nonnegative(),
                changedPreviewPages: z.array(z.number().int().positive()),
                maxPageSidePixels: z.literal(512),
                pagePairing: z.literal("physical_page_number"),
              })
              .strict(),
            sourceComparison: inspectionComparison,
            documentMeaning: z.literal("not_checked"),
            sameEngine: z.boolean(),
            sameRuntime: z.boolean().nullable(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_manifest: {
      _meta: oauthToolMeta("get_render_manifest"),
      title: "Get a render's input, Runtime and artifact identities",
      description:
        "Read the manifest for one Job. Worker phase durations are wall-clock milliseconds. An optional last cgroup sample contains cumulative container counters, which can omit work after the sample and are not per-phase totals. The digest identifies the recorded PDF.",
      inputSchema: z.object({ jobId }).strict(),
      outputSchema: operationOutput(
        "get_render_manifest",
        z
          .object({
            schemaVersion: z.literal(1),
            jobId,
            status: jobStatus,
            projectRevisionId: projectRevisionIdSchema.nullable(),
            sourceId: z.string().nullable(),
            inputSha256: z.string(),
            inputKind: z.enum(["source_zip", "draft_manifest", "unknown"]),
            entrypoint: z.string(),
            engine: renderEngineSchema,
            runtimeDigest: z.string().nullable(),
            outputs: z.array(z.enum(["pdf", "svg"])),
            pdfSha256: z.string().nullable(),
            artifacts: z.array(artifactSchema),
            stages: jobStagesSchema.nullable(),
            recordedTiming: z
              .object({
                createdAt: z.string(),
                queuedAt: z.string().nullable(),
                startedAt: z.string().nullable(),
                finishedAt: z.string().nullable(),
              })
              .strict(),
            workerObservations: z.array(
              z
                .object({
                  stage: z.enum(["pdf", "svg"]),
                  generation: z.number().int().positive(),
                  rendererMs: z.number().int().nonnegative().nullable(),
                  validationMs: z.number().int().nonnegative().nullable(),
                  publicationMs: z.number().int().nonnegative().nullable(),
                  sourcePrepareMs: z.number().int().nonnegative().nullable(),
                  workCacheUsed: z.boolean().nullable(),
                  containerSample: z
                    .object({
                      sampledAt: z.string(),
                      memoryPeakBytes: z
                        .number()
                        .int()
                        .nonnegative()
                        .nullable(),
                      cpuUsageUs: z.number().int().nonnegative().nullable(),
                      ioReadBytes: z.number().int().nonnegative().nullable(),
                      ioWriteBytes: z.number().int().nonnegative().nullable(),
                      oomKills: z.number().int().nonnegative().nullable(),
                    })
                    .strict()
                    .nullable(),
                })
                .strict(),
            ),
            pdfSvgMatch: z.literal("not_checked"),
            reproducibility: z
              .object({
                mode: z.enum(["fixed", "latest"]),
                epochSeconds: z.number().int().nonnegative(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_diagnostics: {
      _meta: oauthToolMeta("get_render_diagnostics"),
      title: translate("getStructuredRenderDiagnostics"),
      description: translate("returnOwnedJobErrorsWarningsAnd"),
      inputSchema: z
        .object({
          jobId,
          stage: z.enum(["pdf", "svg"]).optional(),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(25).optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "get_render_diagnostics",
        z
          .object({
            diagnostics: z
              .object({
                jobId,
                status: jobStatus,
                engine: renderEngineSchema,
                diagnostics: z.array(
                  z
                    .object({
                      severity: z.enum(["error", "warning"]),
                      type: z.string(),
                      file: z.string().nullable(),
                      line: z.number().int().nullable(),
                      column: z.number().int().nullable(),
                      message: z.string(),
                      logLine: z.number().int().positive().optional(),
                      messageTruncated: z.boolean().optional(),
                      tool: z.string().optional(),
                    })
                    .strict(),
                ),
                logExcerpt: z.string(),
                coverage: z
                  .object({
                    parser: diagnosticCoverageSchema.nullable(),
                    storedItems: z.number().int().nonnegative(),
                    offset: z.number().int().nonnegative(),
                    nextOffset: z.number().int().nonnegative().nullable(),
                    storedListOmitted: z.number().int().nonnegative(),
                    logStatus: z.enum(["absent", "available", "unavailable"]),
                    logExcerptTruncated: z.boolean(),
                  })
                  .strict(),
                rawLogResourceUri: z.string().nullable(),
                retryable: z.boolean(),
                stage: z.enum(["pdf", "svg"]).optional(),
              })
              .strict(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    read_render_log: {
      _meta: oauthToolMeta("read_render_log"),
      title: "Read a compile log range",
      description:
        "Read the tail of an owned PDF or SVG compile log, or specify a byte offset or physical start line. Pass sha256 and nextByte to continue reading the same log.",
      inputSchema: z
        .object({
          jobId,
          stage: z.enum(["pdf", "svg"]).default("pdf"),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          startByte: z.number().int().nonnegative().optional(),
          startLine: z.number().int().positive().optional(),
        })
        .strict()
        .refine(
          ({ startByte, startLine }) =>
            startByte === undefined || startLine === undefined,
          "Choose one range unit",
        ),
      outputSchema: operationOutput(
        "read_render_log",
        z
          .object({
            log: z
              .object({
                jobId,
                stage: z.enum(["pdf", "svg"]),
                sha256: z.string(),
                startByte: z.number().int().nonnegative(),
                endByte: z.number().int().nonnegative(),
                totalBytes: z.number().int().nonnegative(),
                startLine: z.number().int().positive().nullable(),
                nextByte: z.number().int().nonnegative().nullable(),
                text: z.string(),
              })
              .strict(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_preview_pages: {
      _meta: oauthToolMeta("get_render_preview_pages"),
      title: "Get preview status and links for selected pages",
      description:
        "Request or retrieve up to eight selected physical PDF pages, numbered from 1. Returns the state of each page without waiting. Use get_render_preview for the actual image if the client cannot fetch resources.",
      inputSchema: targetPdf.extend({
        pages: z.array(z.number().int().min(1).max(100)).min(1).max(8),
      }),
      outputSchema: operationOutput(
        "get_render_preview_pages",
        z
          .object({
            jobId,
            projectRevisionId: projectRevisionIdSchema.nullable(),
            pdfSha256: z.string(),
            pageCount: z.number().int().positive().nullable(),
            pages: z.array(
              z
                .object({
                  page: z.number().int().positive(),
                  state: z.enum([
                    "ready",
                    "pending",
                    "busy",
                    "failed",
                    "unavailable",
                  ]),
                  sha256: z.string().nullable(),
                  resourceUri: z.string().nullable(),
                  errorCode: z.string().nullable(),
                  retryable: z.boolean(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_preview: {
      _meta: oauthToolMeta("get_render_preview"),
      title: translate("getARenderedPdfPagePreview"),
      description: translate("returnOneOwnedPdfPageAs"),
      inputSchema: z
        .object({
          jobId,
          page: z.number().int().min(1).max(100).default(1),
        })
        .strict(),
      outputSchema: operationOutput(
        "get_render_preview",
        z.object({ preview: artifactSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_render_artifacts: {
      _meta: oauthToolMeta("get_render_artifacts"),
      title: translate("getRemoteRenderArtifacts"),
      description: translate("returnArtifactMetadataAndOwnerScoped"),
      inputSchema: z.object({ jobId: jobId }).strict(),
      outputSchema: operationOutput(
        "get_render_artifacts",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    get_renderer_capabilities: {
      _meta: oauthToolMeta("get_renderer_capabilities"),
      title: translate("getRendererCapabilitiesAndLimits"),
      description: translate("returnSupportedEngineTexLiveVersion"),
      inputSchema: z.object({}).strict(),
      outputSchema: operationOutput(
        "get_renderer_capabilities",
        z
          .object({
            capabilities: z
              .object({
                rendererVersion: z.string(),
                serverVersion: z.string(),
                contractVersion: z.literal(2),
                guideVersion: z.string(),
                attachmentImport: z.boolean(),
                runtimeDigest: z.string().nullable(),
                engineVerification: z.enum(["verified", "unknown"]),
                maxInlineArtifactBytes: z.number().int().positive(),
                texliveVersion: z.string(),
                engines: z.array(renderEngineSchema),
                engineOutputs: z
                  .array(
                    z
                      .object({
                        engine: renderEngineSchema,
                        pdf: z.boolean(),
                        svg: z.boolean(),
                        placement: z.boolean(),
                      })
                      .strict(),
                  )
                  .optional(),
                shellEscape: z.literal(false),
                networkAccess: z.literal(false),
                maxCompileSeconds: z.number().int().positive(),
                maxPdfPages: z.number().int().positive(),
                outputs: z.array(z.enum(["pdf", "svg"])),
                sourceLimits: z
                  .object({
                    inlineBytes: z.number().int().positive(),
                    directBytes: z.number().int().positive(),
                    directFiles: z.number().int().positive(),
                    directFileBytes: z.number().int().positive(),
                    uploadBytes: z.number().int().positive(),
                    files: z.number().int().positive(),
                    fileBytes: z.number().int().positive(),
                    chunkBytes: z.number().int().positive(),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    check_document_requirements: {
      _meta: oauthToolMeta("check_document_requirements"),
      title: "Check explicit document requirements against the Runtime",
      description:
        "Check class, package, distribution, font family, face and character coverage for the selected engine and Runtime. Explicitly request inspectEntrypoint to list candidate declarations in the saved entrypoint. Candidates and inventory coverage do not establish that the document compiles.",
      inputSchema: z
        .object({
          engine: renderEngineSchema,
          requirements: z.array(documentRequirement).max(32).default([]),
          revision: z
            .object({
              projectId: projectIdSchema,
              revisionId: projectRevisionIdSchema,
              inspectEntrypoint: z.boolean().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .refine(
          ({ requirements, revision }) =>
            requirements.length > 0 || revision?.inspectEntrypoint === true,
          "Provide explicit requirements or request entrypoint inspection",
        ),
      outputSchema: operationOutput(
        "check_document_requirements",
        z
          .object({
            version: z.literal(1),
            runtimeDigest: z.string().nullable(),
            engine: renderEngineSchema,
            engineState: z.enum(["verified", "not_checked"]),
            inventoryVersion: z.number().int().positive().nullable(),
            requirementFingerprint: z.string(),
            revision: z
              .object({
                projectId: projectIdSchema,
                revisionId: projectRevisionIdSchema,
                sourceId,
                sourceSha256: z.string(),
              })
              .strict()
              .nullable(),
            sourceCandidates: z
              .object({
                path: z.string(),
                sha256: z.string(),
                coverage: z.literal("literal_entrypoint_declarations"),
                items: z.array(
                  z
                    .object({
                      kind: z.enum(["class", "package", "font"]),
                      name: z.string(),
                      line: z.number().int().positive(),
                    })
                    .strict(),
                ),
                truncated: z.boolean(),
              })
              .strict()
              .nullable(),
            items: z.array(
              z
                .object({
                  kind: z.enum([
                    "package",
                    "class",
                    "distribution",
                    "font",
                    "feature",
                  ]),
                  name: z.string(),
                  state: z.enum([
                    "installed",
                    "not_found",
                    "missing_style",
                    "missing_glyphs",
                    "unsupported_by_sandbox",
                    "not_checked",
                  ]),
                  evidence: z.string(),
                  canonicalName: z.string().nullable().optional(),
                  style: z.string().optional(),
                  characters: z.string().optional(),
                  math: z.boolean().optional(),
                  missingCodePoints: z.array(z.string()).optional(),
                  styles: z.array(z.string()).optional(),
                  loadable: z.literal("not_checked").optional(),
                  mathSupport: z.literal("not_checked").nullable().optional(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    probe_document_requirements: {
      _meta: oauthToolMeta("probe_document_requirements"),
      title: "Test loading a class, packages and fonts in the active Runtime",
      description:
        "Request a small synthetic document in the selected engine. No Project, source upload, or render history is created. Repeat the same input for results. A successful probe covers this combination and sample only.",
      inputSchema: documentProbeSchema,
      outputSchema: operationOutput(
        "probe_document_requirements",
        z
          .object({
            probeId: z.string(),
            requestFingerprint: z.string(),
            runtimeDigest: z.string(),
            input: documentProbeSchema,
            scope: z.literal("isolated_synthetic_document"),
            state: z.enum(["queued", "running", "ready", "failed"]),
            code: z.string().nullable(),
            expiresAt: z.string(),
          })
          .strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    cancel_render: {
      _meta: oauthToolMeta("cancel_render"),
      title: translate("cancelRemoteRender"),
      description: translate("cancelAnOwnedActiveRemoteMcp"),
      inputSchema: z.object({ jobId: jobId }).strict(),
      outputSchema: operationOutput(
        "cancel_render",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    delete_render: {
      _meta: oauthToolMeta("delete_render"),
      title: translate("deleteRemoteRender"),
      description: translate("scheduleDeletionOfAnOwnedTerminal"),
      inputSchema: z.object({ jobId: jobId }).strict(),
      outputSchema: operationOutput(
        "delete_render",
        z.object({ jobId, accepted: z.literal(true) }).strict(),
      ),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  };
}

function rendererMcpEnvironmentToolDefinitions(
  translate: RendererMcpTranslate,
) {
  const namesInput = z
      .object({ names: z.array(z.string().min(1).max(200)).min(1).max(50) })
      .strict(),
    checks = z.array(
      z.object({ name: z.string(), available: z.boolean() }).strict(),
    ),
    searchInput = z
      .object({
        query: z.string().min(1).max(100),
        cursor: z.string().regex(/^\d+$/).optional(),
      })
      .strict(),
    searchResult = z
      .object({
        query: z.string(),
        matches: z.array(z.string()).max(50),
        nextCursor: z.string().nullable(),
      })
      .strict(),
    annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } as const;
  return {
    check_packages: {
      _meta: oauthToolMeta("check_packages"),
      title: translate("checkLatexPackageAvailability"),
      description: translate("checkUpTo50ExactPackage"),
      inputSchema: namesInput,
      outputSchema: operationOutput(
        "check_packages",
        z.object({ packages: checks }).strict(),
      ),
      annotations,
    },
    search_packages: {
      _meta: oauthToolMeta("search_packages"),
      title: translate("searchAvailableLatexPackages"),
      description: translate("searchPackageAndImportNamesIn"),
      inputSchema: searchInput,
      outputSchema: operationOutput(
        "search_packages",
        z.object({ search: searchResult }).strict(),
      ),
      annotations,
    },
    check_fonts: {
      _meta: oauthToolMeta("check_fonts"),
      title: translate("checkFontAvailability"),
      description: translate("checkUpTo50ExactInstalled"),
      inputSchema: namesInput,
      outputSchema: operationOutput(
        "check_fonts",
        z.object({ fonts: checks }).strict(),
      ),
      annotations,
    },
    search_fonts: {
      _meta: oauthToolMeta("search_fonts"),
      title: translate("searchInstalledFonts"),
      description: translate("searchInstalledFontFamilyNamesIn"),
      inputSchema: searchInput,
      outputSchema: operationOutput(
        "search_fonts",
        z.object({ search: searchResult }).strict(),
      ),
      annotations,
    },
  };
}

const savedRevisionFileIdentity = {
  projectId: projectIdSchema,
  revisionId: projectRevisionIdSchema,
  sourceId,
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
};

export const savedRevisionFilesPageSchema = z.object({
  ...savedRevisionFileIdentity,
  items: z.array(z.object({
    path: z.string(),
    size: z.number().int().nonnegative(),
    kind: z.enum(["text", "binary"]),
  }).strict()),
  totalFiles: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
}).strict();

export const savedRevisionFileTextSchema = z.object({
  ...savedRevisionFileIdentity,
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  text: z.string(),
  unit: z.literal("utf16"),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  totalUnits: z.number().int().nonnegative(),
}).strict();

export const savedRevisionFileTools = {
    list_project_revision_files: {
      _meta: oauthToolMeta("list_project_revision_files"),
      title: "List files in a saved Project revision",
      description:
        "List the exact saved revision's files, sizes in bytes, and kinds. Supply projectId and revisionId from get_project. Continue with nextOffset; use get_project_revision_file to read text.",
      inputSchema: z
        .object({
          projectId: projectIdSchema,
          revisionId: projectRevisionIdSchema,
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(25).optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "list_project_revision_files",
        savedRevisionFilesPageSchema,
      ),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    get_project_revision_file: {
      _meta: oauthToolMeta("get_project_revision_file"),
      title: "Read text from a saved Project revision",
      description:
        "Read UTF-8 text from the exact saved revision without opening a draft. Use the path returned by list_project_revision_files. Offset is in UTF-16 code units; follow nextOffset until null before replacing a file.",
      inputSchema: z
        .object({
          projectId: projectIdSchema,
          revisionId: projectRevisionIdSchema,
          offset: z.number().int().nonnegative().optional(),
          path: z.string().min(1).max(2048),
        })
        .strict(),
      outputSchema: operationOutput(
        "get_project_revision_file",
        savedRevisionFileTextSchema,
      ),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
};

function rendererMcpProjectToolDefinitions(translate: RendererMcpTranslate) {
  const projectId = projectIdSchema,
    revisionId = projectRevisionIdSchema,
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
      ),
    pageInput = z
      .object({
        cursor: z.string().max(2048).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    readOnly = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } as const,
    mutate = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    } as const;
  const version = z.number().int().positive();
  const conditions = z
    .object({
      version,
      entries: projectDocumentConditionsSchema,
      createdAt: z.string(),
    })
    .strict();
  const adoptedRevisionId = revisionId.nullable();
  const reviewInput = z
    .object({
      revisionId,
      jobId,
      pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
      conditionsVersion: version.nullable(),
      checks: projectReviewChecksSchema,
      guideVersion: z.string().max(128).nullable(),
    })
    .strict();
  const review = reviewInput.extend({
    id: z.string(),
    projectId,
    runtimeDigest: z.string().nullable(),
    createdAt: z.string(),
  });
  const bytes = z.number().int().nonnegative();
  const cleanupSelection = z
    .object({ projectId, revisionIds: z.array(revisionId).min(1).max(50) })
    .strict();
  const cleanupHash = z.string().regex(/^[a-f0-9]{64}$/);
  const draftVersion = z.number().int().positive();
  const path = z.string().min(1).max(2048);
  const draftSchema = z
    .object({
      projectId,
      baseRevisionId: revisionId.nullable(),
      version: draftVersion,
      entrypoint: path,
      engine: renderEngineSchema,
      outputs: z.array(z.enum(["pdf", "svg"])),
      files: z.array(z.object({ path, sourceId, sourcePath: path }).strict()),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .strict();
  const sharedDraftContentSchema = z
    .object({
      projectId,
      path,
      version: draftVersion,
      sha256: z.string(),
      text: z.string(),
      unit: z.literal("utf16"),
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative().nullable(),
      totalUnits: z.number().int().nonnegative(),
    })
    .strict();
  const revisionFileIdentity = {
    projectId,
    revisionId,
    sourceId,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  };
  return {
    list_projects: {
      _meta: oauthToolMeta("list_projects"),
      title: translate("listSavedProjects"),
      description: translate("listOwnerScopedSavedProjectsShared"),
      inputSchema: pageInput,
      outputSchema: operationOutput(
        "list_projects",
        z.object({ page: projectPageSchema }).strict(),
      ),
      annotations: readOnly,
    },
    get_project: {
      _meta: oauthToolMeta("get_project"),
      title: translate("getSavedProject"),
      description: translate("readSavedProjectRevisionsImmutableSource"),
      inputSchema: pageInput.extend({ projectId }),
      outputSchema: operationOutput(
        "get_project",
        z.object({ project: projectDetailSchema }).strict(),
      ),
      annotations: readOnly,
    },
    get_project_document_state: {
      _meta: oauthToolMeta("get_project_document_state"),
      title: "Read document conditions and adopted version",
      description:
        "Get this Project's editing conditions and the adopted revision. Specify conditionsVersion to read what applied to an older review, or history.revisionId to read the saved changes for one revision.",
      inputSchema: z
        .object({
          projectId,
          conditionsVersion: version.optional(),
          history: z
            .object({
              revisionId,
              offset: z.number().int().nonnegative().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "get_project_document_state",
        z
          .object({
            projectId,
            conditions: conditions.nullable(),
            adoptedRevisionId,
            revisionChanges: z
              .object({
                revisionId,
                items: z.array(
                  z
                    .object({
                      id: z.string(),
                      parentRevisionId: revisionId.nullable(),
                      draftVersion: version,
                      conditionsVersion: version.nullable(),
                      description: z.string(),
                      createdAt: z.string(),
                    })
                    .strict(),
                ),
                nextOffset: z.number().int().nonnegative().nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      ),
      annotations: readOnly,
    },
    update_project_document_conditions: {
      _meta: oauthToolMeta("update_project_document_conditions"),
      title: "Update a Project's document conditions",
      description:
        "Replace the set of authoring conditions, using expectedVersion from get_project_document_state, or 0 when unset. Preserve unchanged conditions and record the evidence for each.",
      inputSchema: z
        .object({
          projectId,
          expectedVersion: z.number().int().nonnegative(),
          entries: projectDocumentConditionsSchema,
        })
        .strict(),
      outputSchema: operationOutput(
        "update_project_document_conditions",
        z
          .object({
            projectId,
            version: z.number().int().nonnegative(),
            entries: projectDocumentConditionsSchema,
            changed: z.boolean(),
          })
          .strict(),
      ),
      annotations: mutate,
    },
    adopt_project_revision: {
      _meta: oauthToolMeta("adopt_project_revision"),
      title: "Choose the adopted revision",
      description:
        "Set or clear the explicitly adopted revision after the user makes that choice. Pass the currently adopted revision or null as expectedRevisionId.",
      inputSchema: z
        .object({
          projectId,
          revisionId: adoptedRevisionId,
          expectedRevisionId: adoptedRevisionId,
        })
        .strict(),
      outputSchema: operationOutput(
        "adopt_project_revision",
        z.object({ projectId, adoptedRevisionId }).strict(),
      ),
      annotations: mutate,
    },
    record_project_pdf_review: {
      _meta: oauthToolMeta("record_project_pdf_review"),
      title: "Record checks for the exact reviewed PDF",
      description:
        "Record observed machine checks, pages viewed, and comparisons with the supplied material. Supply the exact project, saved revision, Job, PDF hash and version of the conditions. Record any unperformed checks explicitly.",
      inputSchema: reviewInput.extend({ projectId }),
      outputSchema: operationOutput(
        "record_project_pdf_review",
        z.object({ review }).strict(),
      ),
      annotations: mutate,
    },
    list_project_pdf_reviews: {
      _meta: oauthToolMeta("list_project_pdf_reviews"),
      title: "List recorded PDF reviews",
      description:
        "List the recorded checks for a Project. Each entry refers to one exact saved revision, Job, and PDF hash. Use nextOffset for older entries.",
      inputSchema: z
        .object({
          projectId,
          offset: z.number().int().nonnegative().optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "list_project_pdf_reviews",
        z
          .object({
            projectId,
            items: z.array(review),
            nextOffset: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      ),
      annotations: readOnly,
    },
    get_project_storage_usage: {
      _meta: oauthToolMeta("get_project_storage_usage"),
      title: "Get Project storage use",
      description:
        "Read the logical ZIP, Job and reservation bytes attributed to this Project and the account's visible usage. Shared archives may be attributed to multiple Projects. Physical disk usage is unmeasured.",
      inputSchema: z.object({ projectId }).strict(),
      outputSchema: operationOutput(
        "get_project_storage_usage",
        z
          .object({
            projectId,
            measuredAt: z.string(),
            project: z
              .object({
                sourceCount: bytes,
                sourceBytes: bytes,
                outputBytes: bytes,
                reservedOutputBytes: bytes,
              })
              .strict(),
            user: z
              .object({
                sourceBytes: bytes,
                jobAndReservationBytes: bytes,
                previewReservationBytes: bytes,
                sourceTreeBytes: z.null(),
                draftCacheBytes: bytes,
                totalBytes: bytes,
                quotaBytes: bytes,
              })
              .strict(),
            physicalBytes: z.null(),
          })
          .strict(),
      ),
      annotations: readOnly,
    },
    protect_project_revision: {
      _meta: oauthToolMeta("protect_project_revision"),
      title: "Set protection for a saved revision",
      description:
        "Set or clear explicit protection for one saved revision. The adopted, reviewed, latest and draft-origin rules still apply.",
      inputSchema: z
        .object({ projectId, revisionId, protected: z.boolean() })
        .strict(),
      outputSchema: operationOutput(
        "protect_project_revision",
        z.object({ projectId, revisionId, protected: z.boolean() }).strict(),
      ),
      annotations: mutate,
    },
    plan_project_revision_cleanup: {
      _meta: oauthToolMeta("plan_project_revision_cleanup"),
      title: "Plan cleanup of selected saved revisions",
      description:
        "Read the reasons the selected revisions are kept and estimate which Source bytes can become eligible for cleanup. No files or revisions are deleted.",
      inputSchema: cleanupSelection,
      outputSchema: operationOutput(
        "plan_project_revision_cleanup",
        z
          .object({
            projectId,
            planHash: cleanupHash,
            estimatedSourceBytes: bytes,
            entries: z.array(
              z
                .object({
                  revisionId,
                  sourceId,
                  reasons: z.array(z.string()),
                  sourceBytes: bytes,
                  references: bytes,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      annotations: readOnly,
    },
    apply_project_revision_cleanup: {
      _meta: oauthToolMeta("apply_project_revision_cleanup"),
      title: "Remove explicitly selected saved revisions",
      description:
        "After the owner confirms the exact selection, apply its current planHash. Any changed or protected revision causes the entire selection to be refused. Existing Source cleanup handles later reclamation.",
      inputSchema: cleanupSelection.extend({ planHash: cleanupHash }),
      outputSchema: operationOutput(
        "apply_project_revision_cleanup",
        z
          .object({
            projectId,
            removed: z.array(revisionId),
            estimatedSourceBytes: bytes,
          })
          .strict(),
      ),
      annotations: { ...mutate, destructiveHint: true },
    },
    get_project_draft: {
      _meta: oauthToolMeta("get_project_draft"),
      title: "Get the shared Project draft",
      description:
        "Get the draft shared with the Web editor, its version, configuration and file list. Returns null if there is no draft.",
      inputSchema: z.object({ projectId }).strict(),
      outputSchema: operationOutput(
        "get_project_draft",
        z.object({ draft: draftSchema.nullable() }).strict(),
      ),
      annotations: readOnly,
    },
    open_project_draft: {
      _meta: oauthToolMeta("open_project_draft"),
      title: "Open or replace the shared Project draft",
      description:
        "Continue an existing draft, or start from the latest saved revision. To start from an older revision, specify revisionId. Only supply replaceVersion after the user explicitly chooses to replace the existing draft at that version.",
      inputSchema: z
        .object({
          projectId,
          revisionId: revisionId.optional(),
          replaceVersion: draftVersion.optional(),
        })
        .strict()
        .refine(
          (input) =>
            input.replaceVersion === undefined ||
            input.revisionId !== undefined,
          "Replacing a draft requires a saved revision",
        ),
      outputSchema: operationOutput(
        "open_project_draft",
        z.object({ draft: draftSchema }).strict(),
      ),
      annotations: { ...mutate, destructiveHint: true },
    },
    get_project_draft_file: {
      _meta: oauthToolMeta("get_project_draft_file"),
      title: "Read text from the shared Project draft",
      description:
        "Read UTF-8 text from the specified draft version. Continue with nextOffset, in UTF-16 code units. Reopen the draft after a version conflict.",
      inputSchema: z
        .object({
          projectId,
          version: draftVersion,
          path,
          offset: z.number().int().nonnegative().optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "get_project_draft_file",
        sharedDraftContentSchema,
      ),
      annotations: readOnly,
    },
    apply_project_changes: {
      _meta: oauthToolMeta("apply_project_changes"),
      title: "Apply changes to the shared Project draft",
      description:
        "Apply the full batch to the exact draft version, including any entrypoint, engine, and output changes. Use text or base64 to add or replace a file, remove:true to delete one, or patch text using the file digest and exact old text. Include the same idempotencyKey and inputs after a lost reply.",
      inputSchema: z
        .object({
          projectId,
          version: draftVersion,
          idempotencyKey: idempotencyKey.unwrap(),
          entrypoint: path.optional(),
          engine: renderEngineSchema.optional(),
          outputs: renderOutputsSchema.unwrap().optional(),
          files: z
            .array(
              z.union([
                z.object({ path, remove: z.literal(true) }).strict(),
                sourceFileSchema,
                z
                  .object({
                    path,
                    patch: z
                      .object({
                        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
                        original: z.string().min(1).max(1_048_576),
                        replacement: z.string().max(1_048_576),
                        expectedMatches: z
                          .number()
                          .int()
                          .min(1)
                          .max(100)
                          .default(1),
                      })
                      .strict(),
                  })
                  .strict(),
              ]),
            )
            .max(200),
        })
        .strict(),
      outputSchema: operationOutput(
        "apply_project_changes",
        z
          .object({
            projectId,
            baseVersion: draftVersion,
            version: draftVersion,
            changedPaths: z.array(path),
          })
          .strict(),
      ),
      annotations: { ...mutate, destructiveHint: true, idempotentHint: true },
    },
    render_project_draft: {
      _meta: oauthToolMeta("render_project_draft"),
      title: "Render a shared draft preview",
      description:
        "Render a fixed shared draft version as a PDF preview. The draft stays editable and no saved revision is created. Check the returned Job with get_render_status.",
      inputSchema: z.object({ projectId, version: draftVersion }).strict(),
      outputSchema: operationOutput(
        "render_project_draft",
        z
          .object({
            jobId,
            version: draftVersion,
            reused: z.boolean(),
          })
          .strict(),
      ),
      annotations: mutate,
    },
    save_project_draft: {
      _meta: oauthToolMeta("save_project_draft"),
      title: "Save a draft as a Project revision",
      description:
        "Save the specified shared draft version with its build settings. Use render_project_revision for final output from the returned revision.",
      inputSchema: z
        .object({
          projectId,
          version: draftVersion,
          displayName,
          description: z.string().trim().max(1000).optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "save_project_draft",
        z
          .object({
            revision: attachProjectRevisionResponseSchema,
          })
          .strict(),
      ),
      annotations: mutate,
    },
    get_project_revision_downloads: {
      _meta: oauthToolMeta("get_project_revision_downloads"),
      title: "Get downloads for the exact saved revision",
      description:
        "Get the owner-only login link for the exact saved TeX ZIP and optionally the matching Job PDF. A PDF resource URI is included only when it fits the MCP inline limit.",
      inputSchema: z
        .object({ projectId, revisionId, jobId: jobId.optional() })
        .strict(),
      outputSchema: operationOutput(
        "get_project_revision_downloads",
        z
          .object({
            ...revisionFileIdentity,
            sourceZip: z
              .object({
                size: z.number().int().nonnegative(),
                sha256: z.string(),
                filename: z.string(),
                mimeType: z.literal("application/zip"),
                availability: z.literal("available"),
                downloadUrl: z.url(),
              })
              .strict(),
            pdf: z
              .union([
                z
                  .object({
                    jobId,
                    availability: z.enum(["unavailable", "expired", "pending"]),
                    status: jobStatus,
                  })
                  .strict(),
                z
                  .object({
                    jobId,
                    availability: z.literal("available"),
                    status: jobStatus,
                    size: z.number().int().nonnegative(),
                    sha256: z.string(),
                    filename: z.string(),
                    mimeType: z.string(),
                    expiresAt: z.string(),
                    inlineMaxBytes: z.number().int().positive(),
                    manifestResourceUri: z.string(),
                    downloadUrl: z.url(),
                    resourceUri: z.string().nullable(),
                  })
                  .strict(),
              ])
              .nullable(),
          })
          .strict(),
      ),
      annotations: readOnly,
    },
    ...savedRevisionFileTools,
    get_project_revision_jobs: {
      _meta: oauthToolMeta("get_project_revision_jobs"),
      title: translate("listProjectRevisionJobs"),
      description: translate("pageThroughTheCompleteJobHistory"),
      inputSchema: pageInput.extend({ projectId, revisionId }),
      outputSchema: operationOutput(
        "get_project_revision_jobs",
        z.object({ page: projectRevisionJobsPageSchema }).strict(),
      ),
      annotations: readOnly,
    },
    create_project: {
      _meta: oauthToolMeta("create_project"),
      title: translate("createSavedProject"),
      description: translate("createAUserOwnedSavedProject"),
      inputSchema: z.object({ displayName }).strict(),
      outputSchema: operationOutput(
        "create_project",
        z.object({ project: z.object({ id: projectId }).strict() }).strict(),
      ),
      annotations: mutate,
    },
    rename_project: {
      _meta: oauthToolMeta("rename_project"),
      title: translate("renameSavedProject"),
      description: translate("changeTheDisplayNameWithoutRewriting"),
      inputSchema: z.object({ projectId, displayName }).strict(),
      outputSchema: operationOutput(
        "rename_project",
        z
          .object({
            project: z.object({ id: projectId, displayName }).strict(),
          })
          .strict(),
      ),
      annotations: mutate,
    },
    delete_project: {
      _meta: oauthToolMeta("delete_project"),
      title: translate("deleteSavedProject"),
      description: translate("hideASavedProjectAfterExplicit"),
      inputSchema: z.object({ projectId }).strict(),
      outputSchema: operationOutput(
        "delete_project",
        z
          .object({
            project: z
              .object({ id: projectId, deleted: z.literal(true) })
              .strict(),
          })
          .strict(),
      ),
      annotations: { ...mutate, destructiveHint: true },
    },
    attach_project_revision: {
      _meta: oauthToolMeta("attach_project_revision"),
      title: translate("saveSourceAsProjectRevision"),
      description: translate("attachAnOwnedReadyImmutableSource"),
      inputSchema: z
        .object({
          projectId,
          sourceId,
          entrypoint: z.string().min(1).max(240).default("main.tex"),
          displayName,
          originalFilename,
          outputs: renderOutputsSchema,
          engine: renderEngineSchema.optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "attach_project_revision",
        z.object({ revision: attachProjectRevisionResponseSchema }).strict(),
      ),
      annotations: mutate,
    },
    update_project_file: {
      _meta: oauthToolMeta("update_project_file"),
      title: translate("editSavedProjectFile"),
      description: translate("copyAnExactSavedRevisionReplace"),
      inputSchema: z
        .object({ projectId, revisionId, file: sourceFileSchema })
        .strict(),
      outputSchema: operationOutput(
        "update_project_file",
        z
          .object({
            source: sourceSchema,
            revision: attachProjectRevisionResponseSchema,
          })
          .strict(),
      ),
      annotations: mutate,
    },
    delete_project_file: {
      _meta: oauthToolMeta("delete_project_file"),
      title: translate("removeSavedProjectFile"),
      description: translate("copyAnExactSavedRevisionRemove"),
      inputSchema: z
        .object({ projectId, revisionId, path: z.string().min(1).max(2048) })
        .strict(),
      outputSchema: operationOutput(
        "delete_project_file",
        z
          .object({
            source: sourceSchema,
            revision: attachProjectRevisionResponseSchema,
          })
          .strict(),
      ),
      annotations: { ...mutate, destructiveHint: true },
    },
    render_project_revision: {
      _meta: oauthToolMeta("render_project_revision"),
      title: translate("renderSavedProjectRevision"),
      description: translate("queueAJobBoundToThe"),
      inputSchema: z
        .object({
          projectId,
          revisionId,
          outputs: renderOutputsSchema
            .unwrap()
            .optional()
            .describe(
              "Optional override. PDF is required and duplicates are rejected. Omit to use the saved outputs.",
            ),
          idempotencyKey,
          reproducibility: renderReproducibilitySchema.optional(),
        })
        .strict(),
      outputSchema: operationOutput(
        "render_project_revision",
        z.object({ job: jobSchema }).strict(),
      ),
      annotations: mutate,
    },
  };
}

export function rendererMcpResourceDefinitions(
  translate: RendererMcpTranslate = rendererMcpEnglishText,
) {
  return {
    "remote-mcp-guide": {
      title: translate("latexRendererRemoteMcpGuide"),
      description: translate("safeRemoteMcpSourceAndJob"),
      mimeType: "text/markdown",
    },
    "rendered-pdf": {
      title: translate("renderedPdf"),
      description: translate("ownedRenderedPdfOutput"),
      mimeType: "application/pdf",
    },
    "render-manifest": {
      title: "Render manifest for the exact PDF",
      description:
        "Input, Runtime, artifact digests and Worker observations for an owned PDF.",
      mimeType: "application/json",
    },
    "compile-log": {
      title: translate("compileLog"),
      description: translate("sanitizedUntrustedLatexCompileLogTerminal"),
      mimeType: "text/plain",
    },
    "render-preview": {
      title: translate("pdfPagePreview"),
      description: translate("ownedPdfPageRenderedAsPng"),
      mimeType: "image/png",
    },
    "render-metadata-artifact": {
      title: translate("renderMetadataOrSvgArtifact"),
      description: translate("ownedJsonMetadataOrValidatedSvg"),
    },
  };
}

export const rendererAuthoringRequestBytes = 8 * 1024 * 1024;

export const rendererApiAuthoringRoutes = {
  get_project_document_state: {
    method: "GET",
    resource: "project",
    suffix: "/document-state",
  },
  update_project_document_conditions: {
    method: "PATCH",
    resource: "project",
    suffix: "/document-state/conditions",
  },
  adopt_project_revision: {
    method: "POST",
    resource: "project",
    suffix: "/document-state/adoption",
  },
  list_project_pdf_reviews: {
    method: "GET",
    resource: "project",
    suffix: "/pdf-reviews",
  },
  record_project_pdf_review: {
    method: "POST",
    resource: "project",
    suffix: "/pdf-reviews",
  },
  get_project_storage_usage: {
    method: "GET",
    resource: "project",
    suffix: "/storage-usage",
  },
  protect_project_revision: {
    method: "POST",
    resource: "project",
    suffix: "/revision-protection",
  },
  plan_project_revision_cleanup: {
    method: "POST",
    resource: "project",
    suffix: "/revision-cleanup/plan",
  },
  apply_project_revision_cleanup: {
    method: "POST",
    resource: "project",
    suffix: "/revision-cleanup/apply",
  },
  get_project_draft: { method: "GET", resource: "project", suffix: "/draft" },
  get_project_draft_file: { method: "GET", resource: "project", suffix: "/draft/file" },
  open_project_draft: { method: "POST", resource: "project", suffix: "/draft/open" },
  apply_project_changes: { method: "POST", resource: "project", suffix: "/draft/changes" },
  render_project_draft: { method: "POST", resource: "project", suffix: "/draft/preview" },
  save_project_draft: { method: "POST", resource: "project", suffix: "/draft/save" },
  get_render_quality_report: { method: "GET", resource: "job", suffix: "/pdf-inspection" },
  request_render_quality_report: { method: "POST", resource: "job", suffix: "/pdf-inspection" },
} as const;

export type RendererApiAuthoringTool = keyof typeof rendererApiAuthoringRoutes;

export function rendererApiAuthoringTools() {
  const {
    get_project_document_state,
    update_project_document_conditions,
    adopt_project_revision,
    list_project_pdf_reviews,
    record_project_pdf_review,
    get_project_storage_usage,
    protect_project_revision,
    plan_project_revision_cleanup,
    apply_project_revision_cleanup,
    get_project_draft,
    get_project_draft_file,
    open_project_draft,
    apply_project_changes,
    render_project_draft,
    save_project_draft,
  } = rendererMcpProjectToolDefinitions(rendererMcpEnglishText);
  const { get_render_quality_report, request_render_quality_report } =
    rendererMcpRenderToolDefinitions(rendererMcpEnglishText, 1);
  return {
    get_project_document_state,
    update_project_document_conditions,
    adopt_project_revision,
    list_project_pdf_reviews,
    record_project_pdf_review,
    get_project_storage_usage,
    protect_project_revision,
    plan_project_revision_cleanup,
    apply_project_revision_cleanup,
    get_project_draft,
    get_project_draft_file,
    open_project_draft,
    apply_project_changes,
    render_project_draft,
    save_project_draft,
    get_render_quality_report,
    request_render_quality_report,
  } satisfies Record<RendererApiAuthoringTool, unknown>;
}

export function rendererMcpToolDefinitions(
  maxSourceUploadBytes: number,
  translate: RendererMcpTranslate = rendererMcpEnglishText,
) {
  return {
    ...rendererMcpRenderToolDefinitions(translate, maxSourceUploadBytes),
    ...rendererMcpEnvironmentToolDefinitions(translate),
    ...rendererMcpProjectToolDefinitions(translate),
  } satisfies Record<RendererMcpTool, unknown>;
}
