import {
  registerWholeRenderRetry,
  type JobRow,
  type ProjectActor,
  type RendererDatabase,
  type RenderRegistrationLimits,
} from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";
import {
  findOperationRequest,
  operationRequest,
  recordOperationRequest,
} from "./operation-requests.js";

export function retryRenderJob(
  database: RendererDatabase,
  actor: ProjectActor,
  jobId: string,
  idempotencyKey: string | undefined,
  options: {
    readJob: (jobId: string) => JobRow;
    limits: RenderRegistrationLimits;
  },
): JobRow {
  const request = operationRequest(
    actor.type === "oauth" ? "remote_mcp.retry_render" : "render.retry",
    idempotencyKey,
    { jobId },
  );
  return database.transaction(() => {
    const timestamp = nowIso();
    const replay = findOperationRequest(database, actor, request, timestamp);
    if (replay !== undefined) return options.readJob(replay);
    const previous = options.readJob(jobId);
    const retryId = registerWholeRenderRetry(database, options.limits, {
      originalId: previous.id,
      timestamp,
      notRetryable: "Only a terminal Job can be retried",
      sourceUnavailable: (sourceId) =>
        new AppError(
          "SOURCE_NOT_READY",
          sourceId === null
            ? "The previous Job has no reusable Source"
            : "The previous Job Source is not ready",
          409,
        ),
    });
    database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action:
        actor.type === "oauth" ? "remote_mcp.render.retried" : "render.retried",
      targetType: "job",
      targetId: retryId,
      result: "success",
      metadata: { retryOf: previous.id, sourceId: previous.source_id },
    });
    recordOperationRequest(database, actor, request, retryId, timestamp);
    return options.readJob(retryId);
  });
}
