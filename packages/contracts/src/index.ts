import { z } from "zod";

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
export const sourceRenderTicketRequestSchema = z
  .object({
    sourceId: z.string().regex(/^source_[a-f0-9]{32}$/),
    entrypoint: z.string().min(1).max(2048).optional(),
    outputs: renderOutputsSchema,
  })
  .strict();
export function createRenderTicketRequestSchema(
  maxUploadBytes = 20 * 1024 * 1024,
) {
  return z.union([
    createLegacyRenderTicketRequestSchema(maxUploadBytes).extend({
      outputs: renderOutputsSchema,
    }),
    sourceRenderTicketRequestSchema,
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

export const jobArtifactSchema = z.object({
  type: z.string().min(1),
  relativePath: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  downloadUrl: z.string().startsWith("/api/v1/jobs/"),
});
export type JobArtifact = z.infer<typeof jobArtifactSchema>;

export const jobResponseSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  sourceSize: z.number().int().nonnegative(),
  sourceSha256: z.string(),
  sourceId: z.string().nullable().optional(),
  entrypoint: z.string().optional(),
  outputs: z.array(renderOutputSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retentionExpiresAt: z.iso.datetime().nullable().default(null),
  artifacts: z.array(jobArtifactSchema).default([]),
  previews: z.array(jobArtifactSchema).default([]),
});
export type JobResponse = z.infer<typeof jobResponseSchema>;

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
          loginName: z
            .string()
            .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
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
  "admin:tex-environment:write": "Request TeX environment operations (owner only for runtime mutations)",
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

export const structuredErrorsSchema = z.object({
  success: z.boolean(),
  exitCode: z.number().int().nullable(),
  errors: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nullable(),
      message: z.string(),
    }),
  ),
  warnings: z.array(
    z.object({
      type: z.string(),
      file: z.string().nullable(),
      line: z.number().int().nullable(),
      message: z.string(),
    }),
  ),
});
export type StructuredErrors = z.infer<typeof structuredErrorsSchema>;
