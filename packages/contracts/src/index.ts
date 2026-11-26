import { z } from "zod";

export * from "./renderer-mcp.js";
export * from "./renderer-relay.js";

export const jobStatuses = [
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
] as const;
export const JobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const roleSchema = z.enum(["user", "admin", "owner"]);
export type Role = z.infer<typeof roleSchema>;

export const accountStatusSchema = z.enum(["active", "disabled"]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export function createLegacyRenderTicketRequestSchema(
  maxUploadBytes = 20 * 1024 * 1024,
) {
  return z
    .object({
      size: z.number().int().positive().max(maxUploadBytes),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
}
export const legacyRenderTicketRequestSchema =
  createLegacyRenderTicketRequestSchema();
export const renderEngineSchema = z.enum([
  "lualatex",
  "pdflatex",
  "xelatex",
  "uplatex",
  "platex",
]);
export type RenderEngine = z.infer<typeof renderEngineSchema>;
export const defaultRenderEngine = "lualatex" satisfies RenderEngine;
export const renderOutputSchema = z.enum(["pdf", "svg"]);
export type RenderOutput = z.infer<typeof renderOutputSchema>;
export const renderOutputsSchema = z
  .array(renderOutputSchema)
  .min(1)
  .max(2)
  .refine((outputs) => new Set(outputs).size === outputs.length, {
    message: "Render outputs must be unique",
  })
  .refine((outputs) => outputs.includes("pdf"), {
    message: "PDF output is required",
  })
  .default(["pdf"]);
export const renderReproducibilitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), date: z.iso.datetime() }).strict(),
  z.object({ mode: z.literal("latest") }).strict(),
]);
export type RenderReproducibility = z.infer<typeof renderReproducibilitySchema>;
export const sourceRenderTicketRequestSchema = z
  .object({
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    entrypoint: z.string().min(1).max(2048).optional(),
    outputs: renderOutputsSchema,
    engine: renderEngineSchema.optional(),
  })
  .strict();
export const svgRetryTicketRequestSchema = z
  .object({
    retrySvgJobId: z.string().regex(/^job_[a-f0-9]{32}$/),
  })
  .strict();
export function createRenderTicketRequestSchema(
  maxUploadBytes = 20 * 1024 * 1024,
) {
  return z.union([
    createLegacyRenderTicketRequestSchema(maxUploadBytes).extend({
      outputs: renderOutputsSchema,
      engine: renderEngineSchema.optional(),
    }),
    sourceRenderTicketRequestSchema,
    svgRetryTicketRequestSchema,
  ]);
}
export const renderTicketRequestSchema = createRenderTicketRequestSchema();
export type RenderTicketRequest = z.infer<typeof renderTicketRequestSchema>;

export const sourceTicketRequestSchema = legacyRenderTicketRequestSchema;
export const createSourceTicketRequestSchema =
  createLegacyRenderTicketRequestSchema;
export type SourceTicketRequest = z.infer<typeof sourceTicketRequestSchema>;
export const sourceTicketResponseSchema = z.object({
  sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
  uploadRequired: z.boolean(),
  uploadTicket: z.string().min(16).optional(),
  uploadUrl: z.url().optional(),
  expiresAt: z.iso.datetime(),
});
export type SourceTicketResponse = z.infer<typeof sourceTicketResponseSchema>;

export const ticketResponseSchema = z.object({
  jobId: z.string().min(8).max(128),
  uploadTicket: z.string().min(16),
  jobTicket: z.string().min(16),
  uploadUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;
export const sourceRenderResponseSchema = z.object({
  jobId: z.string().min(8).max(128),
  jobTicket: z.string().min(16),
  expiresAt: z.iso.datetime(),
});
export type SourceRenderResponse = z.infer<typeof sourceRenderResponseSchema>;

export const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/);
export const projectRevisionIdSchema = z
  .string()
  .regex(/^revision_[a-f0-9]{32}$/);
export const projectDraftOpenRequestSchema = z.object({
  revisionId: projectRevisionIdSchema.optional(),
}).strict();
export function createProjectDraftUpdateRequestSchema(maxChanges = 1000) {
  const path = z.string().min(1).max(2048);
  return z.object({
    version: z.number().int().positive(),
    entrypoint: path.optional(),
    engine: renderEngineSchema.optional(),
    outputs: renderOutputsSchema.unwrap().optional(),
    files: z.array(z.union([
      z.object({ path, remove: z.literal(true) }).strict(),
      z.object({ path, sourceId: z.string().regex(/^source_[a-f0-9]{32}$/), sourcePath: path }).strict(),
    ])).max(maxChanges),
  }).strict();
}
export const pdfCropRequestSchema = z
  .object({
    page: z.number().int().min(1).max(100),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.001).max(1),
    height: z.number().min(0.001).max(1),
  })
  .strict()
  .refine(({ x, y, width, height }) => x + width <= 1 && y + height <= 1, {
    message: "The crop must fit in the displayed page",
  });
export type PdfCropRequest = z.infer<typeof pdfCropRequestSchema>;
export const pdfSyncQuerySchema = z.discriminatedUnion("direction", [
  z
    .object({
      direction: z.literal("pdf_to_source"),
      page: z.number().int().min(1).max(100),
      x: z.number().min(0).max(12000),
      y: z.number().min(0).max(12000),
    })
    .strict(),
  z
    .object({
      direction: z.literal("source_to_pdf"),
      path: z.string().min(1).max(200),
      line: z.number().int().min(1).max(1000000),
    })
    .strict(),
]);
export type PdfSyncQuery = z.infer<typeof pdfSyncQuerySchema>;
export const pdfSheetQuerySchema = z
  .object({
    pages: z
      .array(z.number().int().min(1).max(100))
      .min(1)
      .max(4)
      .refine(
        (pages) => new Set(pages).size === pages.length,
        "Select distinct page numbers",
      ),
  })
  .strict();
export type PdfSheetQuery = z.infer<typeof pdfSheetQuerySchema>;
export const pdfInspectionInputSchema = z.union([
  pdfCropRequestSchema,
  pdfSyncQuerySchema,
  pdfSheetQuerySchema,
]);
export type PdfInspectionInput = z.infer<typeof pdfInspectionInputSchema>;
const probeTeXName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/);
const probeFontName = z
  .string()
  .regex(/^[\p{L}\p{N} ._+-]{1,100}$/u)
  .refine((name) => name.trim() === name && name.length > 0);
export const documentProbeSchema = z
  .object({
    engine: renderEngineSchema,
    documentClass: probeTeXName.default("article"),
    packages: z.array(probeTeXName).max(12).default([]),
    font: probeFontName.optional(),
    mathFont: probeFontName.optional(),
    japanese: z.boolean().default(false),
  })
  .strict()
  .refine(
    (input) =>
      (!input.font && !input.mathFont && !input.japanese) ||
      input.engine === "lualatex" ||
      (input.engine === "xelatex" && !input.japanese),
    "Named font probes require LuaLaTeX or XeLaTeX; the Japanese font sample uses LuaLaTeX",
  );
export type DocumentProbe = z.infer<typeof documentProbeSchema>;
export const projectDocumentConditionsSchema = z
  .array(
    z
      .object({
        kind: z.enum([
          "purpose",
          "format",
          "required",
          "excluded",
          "change",
          "preserve",
          "unresolved",
        ]),
        basis: z.enum(["user_specified", "existing_document", "unconfirmed"]),
        text: z.string().trim().min(1).max(1000),
      })
      .strict(),
  )
  .max(50);
export const projectReviewChecksSchema = z
  .array(
    z
      .object({
        type: z.enum(["machine", "visual", "source_comparison"]),
        status: z.enum([
          "passed",
          "needs_attention",
          "not_checked",
          "unavailable",
          "accepted_issue",
        ]),
        pages: z.array(z.number().int().min(1).max(100)).max(100).optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(100);
export type ProjectDocumentCondition = z.infer<
  typeof projectDocumentConditionsSchema
>[number];
export type ProjectReviewCheck = z.infer<
  typeof projectReviewChecksSchema
>[number];
export const projectJobSummarySchema = z
  .object({
    id: z.string().regex(/^job_[a-f0-9]{32}$/),
    status: JobStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    retryOfJobId: z.string().nullable(),
    errorCode: z.string().nullable(),
    outputs: z.array(renderOutputSchema),
    engine: renderEngineSchema.optional(),
  })
  .loose();
export const projectRevisionJobsPageSchema = z.object({
  items: z.array(projectJobSummarySchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export const projectRevisionSummarySchema = z
  .object({
    id: projectRevisionIdSchema,
    revisionNumber: z.number().int().positive(),
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    displayName: z.string(),
    originalFilename: z.string(),
    entrypoint: z.string(),
    outputs: z.array(renderOutputSchema),
    engine: renderEngineSchema.optional(),
    createdAt: z.string(),
    jobs: z.array(projectJobSummarySchema),
    jobCount: z.number().int().nonnegative(),
    jobsHasMore: z.boolean(),
    jobsNextCursor: z.string().nullable(),
  })
  .loose();
export const projectSummarySchema = z
  .object({
    id: projectIdSchema,
    displayName: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revisionCount: z.number().int().nonnegative(),
    latestRevision: z
      .object({
        id: projectRevisionIdSchema,
        revisionNumber: z.number().int().positive(),
        entrypoint: z.string(),
        engine: renderEngineSchema.optional(),
        displayName: z.string(),
        originalFilename: z.string(),
        createdAt: z.string(),
      })
      .loose()
      .nullable(),
  })
  .loose();
export const projectPageSchema = z.object({
  items: z.array(projectSummarySchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export const projectDetailSchema = projectSummarySchema
  .extend({
    revisions: z.array(projectRevisionSummarySchema),
    revisionsHasMore: z.boolean(),
    revisionsNextCursor: z.string().nullable(),
    latestRevision: projectRevisionSummarySchema.nullable(),
  })
  .loose();
export const attachProjectRevisionResponseSchema = z.object({
  id: projectRevisionIdSchema,
  projectId: projectIdSchema,
  sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
  revisionNumber: z.number().int().positive(),
  entrypoint: z.string(),
  outputs: z.array(renderOutputSchema),
  engine: renderEngineSchema.optional(),
});
export type ProjectPage = z.infer<typeof projectPageSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type AttachProjectRevisionResponse = z.infer<
  typeof attachProjectRevisionResponseSchema
>;

export const jobArtifactSchema = z.object({
  type: z.string().min(1),
  relativePath: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  downloadUrl: z.string().startsWith("/api/v1/jobs/"),
});
export type JobArtifact = z.infer<typeof jobArtifactSchema>;

export const renderStageStatusSchema = z.enum([
  "not_requested",
  "queued",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "skipped",
]);
export const renderStageSchema = z.object({
  status: renderStageStatusSchema,
  completedAt: z.iso.datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export const jobStagesSchema = z.object({
  pdf: renderStageSchema.extend({
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  }),
  svg: renderStageSchema.extend({ attempt: z.number().int().min(1).max(8) }),
});
export type JobStages = z.infer<typeof jobStagesSchema>;

export const jobResponseSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  sourceSize: z.number().int().nonnegative(),
  sourceSha256: z.string(),
  sourceId: z.string().nullable().optional(),
  entrypoint: z.string().optional(),
  outputs: z.array(renderOutputSchema).optional(),
  engine: renderEngineSchema.optional(),
  runtimeDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  previousRuntimeDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retentionExpiresAt: z.iso.datetime().nullable().default(null),
  artifacts: z.array(jobArtifactSchema).default([]),
  previews: z.array(jobArtifactSchema).default([]),
  previewPageCount: z.number().int().min(1).max(100).optional(),
  stages: jobStagesSchema.optional(),
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

export interface JobRetryResponse {
  id: string;
  retryOfJobId: string;
}

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export const createUserSchema = z
  .object({
    email: z.email().max(320).nullable().optional(),
    displayName: z.string().min(1).max(200),
    role: roleSchema,
    authentication: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("external"),
          subject: z.string().min(1).max(500),
          preferredUsername: z.string().min(1).max(500).optional(),
          emailAtProvider: z.email().max(320).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("password"),
          loginName: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
          password: z.string().min(12).max(1024),
        })
        .strict(),
    ]),
  })
  .strict();

export const createServiceAccountSchema = z
  .object({
    ownerUserId: z.string(),
    name: z.string().min(1).max(100),
    clientType: z.enum(["codex", "claude-code", "mcp", "ci", "generic"]),
  })
  .strict();

export const renderApiScopes = ["render:create", "render:read:own"] as const;
export const adminApiScopes = [
  "admin:users:read",
  "admin:users:write",
  "admin:service-accounts:read",
  "admin:service-accounts:write",
  "admin:api-keys:read",
  "admin:api-keys:write",
  "admin:jobs:read",
  "admin:jobs:write",
  "admin:system:read",
  "admin:system:write",
  "admin:update:read",
  "admin:update:write",
  "admin:tex-environment:read",
  "admin:tex-environment:write",
  "admin:audit:read",
  "admin:*",
] as const;
export const adminApiScopeLabels: Readonly<
  Record<(typeof adminApiScopes)[number], string>
> = {
  "admin:users:read": "Read users",
  "admin:users:write": "Change users",
  "admin:service-accounts:read": "Read service accounts",
  "admin:service-accounts:write": "Change service accounts",
  "admin:api-keys:read": "Read API keys",
  "admin:api-keys:write": "Issue, rotate, and revoke API keys",
  "admin:jobs:read": "Read jobs",
  "admin:jobs:write": "Operate jobs",
  "admin:system:read": "Read system status and settings",
  "admin:system:write": "Change system settings",
  "admin:update:read": "Read application update state",
  "admin:update:write": "Request application update operations (owner only)",
  "admin:tex-environment:read": "Read TeX environment state",
  "admin:tex-environment:write":
    "Request TeX environment operations (owner only for runtime mutations)",
  "admin:audit:read": "Read audit logs",
  "admin:*": "All administration operations (owner-only key issuance)",
};
export const adminMutationReasonSchema = z.string().trim().min(1).max(500);
export type AdminMutationReason = z.infer<typeof adminMutationReasonSchema>;
export const apiKeyScopeSchema = z.enum([
  ...renderApiScopes,
  ...adminApiScopes,
]);

export const createApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z
      .array(apiKeyScopeSchema)
      .min(1)
      .max(32)
      .refine(
        (scopes) => new Set(scopes).size === scopes.length,
        "API key scopes must be unique",
      )
      .refine(
        (scopes) =>
          scopes.every((scope) => scope.startsWith("render:")) ||
          scopes.every((scope) => scope.startsWith("admin:")),
        "Render and admin scopes cannot be mixed",
      ),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const maintenanceModeSchema = z.enum([
  "normal",
  "reject-new-jobs",
  "read-only",
  "lockdown",
]);
export type MaintenanceMode = z.infer<typeof maintenanceModeSchema>;

const logDiagnosticLocation = {
  logLine: z.number().int().positive().optional(),
  messageTruncated: z.boolean().optional(),
  tool: z.string().optional(),
};

export const diagnosticCoverageSchema = z.object({
  scannedLines: z.number().int().nonnegative(),
  errorsOmitted: z.number().int().nonnegative(),
  warningsOmitted: z.number().int().nonnegative(),
  messagesTruncated: z.number().int().nonnegative(),
});

export const structuredErrorsSchema = z.object({
  success: z.boolean(),
  exitCode: z.number().int().nullable(),
  coverage: diagnosticCoverageSchema.optional(),
  errors: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nullable(),
      message: z.string(),
      ...logDiagnosticLocation,
    }),
  ),
  warnings: z.array(
    z.object({
      type: z.string(),
      file: z.string().nullable(),
      line: z.number().int().nullable(),
      message: z.string(),
      ...logDiagnosticLocation,
    }),
  ),
});
export type StructuredErrors = z.infer<typeof structuredErrorsSchema>;
