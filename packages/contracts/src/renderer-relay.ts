import { z } from "zod";
import { rendererMcpScopes } from "./renderer-mcp.js";

export const rendererRelayVersion = 1;
export const rendererRelayOperationPath = "/mcp/relay/operation";
export const rendererRelayPublicIdentityPath = "/mcp/relay/identity";
export const rendererRelayRevokePath = "/mcp/relay/revoke";
export const rendererRelayAgentPaths = {
  control: "/agent/connect/control",
  files: "/agent/connect/files",
} as const;
export const rendererRelayAgentOperationPath = "/mcp/relay/local-operation";
export const rendererRelayAgentRevokePath = "/mcp/relay/local-revoke";
export const rendererRelayDownloadPath = "/mcp/relay/download";
export const rendererRelayAgentDownloadPath = "/mcp/relay/local-download";
export const rendererRelayDownloadTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("artifact"),
      jobId: z.string().regex(/^job_[a-f0-9]{32}$/),
      path: z
        .string()
        .regex(/^(?:result\.pdf|previews\/page-[1-9][0-9]*\.png)$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("source"),
      projectId: z.string().regex(/^project_[a-f0-9]{32}$/),
      revisionId: z.string().regex(/^revision_[a-f0-9]{32}$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const rendererRelayDownloadRequestSchema = z
  .object({
    version: z.literal(rendererRelayVersion),
    instanceId: z.string().regex(/^instance_[a-f0-9]{32}$/),
    grant: z.string().min(1).max(256),
    target: rendererRelayDownloadTargetSchema,
    offset: z.number().int().nonnegative(),
    limit: z
      .number()
      .int()
      .min(0)
      .max(512 * 1024),
  })
  .strict();
export const rendererRelayDownloadChunkSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    mimeType: z.enum(["application/pdf", "application/zip", "image/png"]),
    data: z.string().max(699_052),
  })
  .strict();
export type RendererRelayDownloadTarget = z.infer<
  typeof rendererRelayDownloadTargetSchema
>;
export type RendererRelayDownloadRequest = z.infer<
  typeof rendererRelayDownloadRequestSchema
>;
export type RendererRelayDownloadChunk = z.infer<
  typeof rendererRelayDownloadChunkSchema
>;
export const rendererRelayAgentIdSchema = z
  .string()
  .regex(/^transport_[a-f0-9]{32}$/);
export const rendererRelaySocketProofSchema = z
  .object({
    version: z.literal(rendererRelayVersion),
    instanceId: z.string().regex(/^instance_[a-f0-9]{32}$/),
    transportId: rendererRelayAgentIdSchema,
    generation: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .nullable(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
export type RendererRelaySocketProof = z.infer<
  typeof rendererRelaySocketProofSchema
>;
export function rendererRelaySocketMessage(
  origin: string,
  channel: "control" | "files",
  nonce: string,
  proof: Omit<RendererRelaySocketProof, "signature">,
): string {
  return JSON.stringify([
    "latex-renderer-agent-channel",
    proof.version,
    origin,
    channel,
    nonce,
    proof.instanceId,
    proof.transportId,
    proof.generation,
  ]);
}
export const rendererRelayScopeSchema = z.enum(rendererMcpScopes);
export const rendererRelayOperationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("tools/call"),
      name: z.string().max(128),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ method: z.literal("resources/read"), uri: z.string().max(2048) })
    .strict(),
]);
export const rendererRelayRequestSchema = z
  .object({
    version: z.literal(rendererRelayVersion),
    instanceId: z.string().regex(/^instance_[a-f0-9]{32}$/),
    grant: z.string().min(1).max(256),
    scopes: z.array(rendererRelayScopeSchema).min(1).max(4),
    operation: rendererRelayOperationSchema,
  })
  .strict();
export type RendererRelayOperation = z.infer<
  typeof rendererRelayOperationSchema
>;
export type RendererRelayRequest = z.infer<typeof rendererRelayRequestSchema>;
export const rendererRelayEnrollmentPaths = {
  begin: "/agent/enrollments",
  complete: "/agent/enrollments/complete",
} as const;

export const rendererRelayPublicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);
export const rendererRelayIdentitySchema = z
  .object({
    id: z.string().regex(/^instance_[a-f0-9]{32}$/),
    publicKey: rendererRelayPublicKeySchema,
  })
  .strict();

export const rendererRelayIdentityProofSchema = z
  .object({
    version: z.literal(rendererRelayVersion),
    instance: rendererRelayIdentitySchema,
    profile: z.string().min(1).max(256),
    grant: z.string().min(1).max(256),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export function rendererRelayIdentityMessage(
  origin: string,
  nonce: string,
  proof: Omit<z.infer<typeof rendererRelayIdentityProofSchema>, "signature">,
): string {
  return JSON.stringify([
    "latex-renderer-https-identity",
    proof.version,
    origin,
    nonce,
    proof.instance.id,
    proof.instance.publicKey,
    proof.profile,
    proof.grant,
  ]);
}

export const rendererRelayAgentEnrollmentSchema = z
  .object({
    version: z.literal(rendererRelayVersion),
    instance: rendererRelayIdentitySchema,
    agentPublicKey: rendererRelayPublicKeySchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    instanceSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
    agentSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export type RendererRelayAgentEnrollment = z.infer<
  typeof rendererRelayAgentEnrollmentSchema
>;

export function rendererRelayEnrollmentMessage(
  enrollment: Pick<
    RendererRelayAgentEnrollment,
    "instance" | "agentPublicKey" | "nonce"
  >,
  gatewayOrigin: string,
  purpose: "instance" | "agent",
): string {
  return JSON.stringify([
    "latex-renderer-agent-enrollment",
    rendererRelayVersion,
    gatewayOrigin,
    purpose,
    enrollment.instance.id,
    enrollment.instance.publicKey,
    enrollment.agentPublicKey,
    enrollment.nonce,
  ]);
}
