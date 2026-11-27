import type { ProjectActor, RendererDatabase } from "@latex-renderer/database";
import { AppError, sha256Hex } from "@latex-renderer/shared";

type RequestActor = Pick<ProjectActor, "type" | "id">;

export type OperationRequest = {
  keyHash: string;
  requestHash: string;
  operation:
    | "remote_mcp.create_render"
    | "remote_mcp.retry_render"
    | "remote_mcp.render_project_revision"
    | "remote_mcp.apply_project_changes"
    | "remote_mcp.import_source_attachment";
};

export function operationRequest(
  operation: OperationRequest["operation"],
  key: string | undefined,
  input: object,
): OperationRequest | undefined {
  if (key === undefined) return undefined;
  if (key.length < 16 || key.length > 200)
    throw new AppError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key must contain 16 to 200 characters",
      400,
    );
  return {
    operation,
    keyHash: sha256Hex(key),
    requestHash: sha256Hex(JSON.stringify(input)),
  };
}

export function findOperationRequest(
  database: RendererDatabase,
  actor: RequestActor,
  request: OperationRequest | undefined,
  timestamp: string,
): string | undefined {
  if (!request) return undefined;
  const record = database.security.idempotency(
    actor.type,
    actor.id,
    request.operation,
    request.keyHash,
    timestamp,
  );
  if (!record) return undefined;
  if (record.request_hash !== request.requestHash)
    throw new AppError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was reused with different inputs",
      409,
    );
  if (!record.resource_id)
    throw new AppError(
      "REQUEST_UNAVAILABLE",
      "The accepted request is unavailable",
      409,
    );
  return record.resource_id;
}

export function recordOperationRequest(
  database: RendererDatabase,
  actor: RequestActor,
  request: OperationRequest | undefined,
  resourceId: string,
  timestamp: string,
): void {
  if (!request) return;
  database.security.insertIdempotency({
    actorType: actor.type,
    actorId: actor.id,
    ...request,
    resourceId,
    responseCode: 202,
    createdAt: timestamp,
    expiresAt: new Date(Date.parse(timestamp) + 86_400_000).toISOString(),
  });
}
