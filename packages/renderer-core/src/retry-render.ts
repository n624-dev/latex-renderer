import type {
  JobRow,
  ProjectActor,
  RendererDatabase,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
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
    admit: (previous: JobRow) => void;
    rendererVersion: string;
    maxOutputBytes: number;
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
    if (
      ![
        "succeeded",
        "failed",
        "timeout",
        "canceled",
        "rejected",
        "expired",
      ].includes(previous.status)
    )
      throw new AppError(
        "JOB_NOT_RETRYABLE",
        "Only a terminal Job can be retried",
        409,
      );
    if (previous.source_id === null)
      throw new AppError(
        "SOURCE_NOT_READY",
        "The previous Job has no reusable Source",
        409,
      );
    const sourceId = previous.source_id;
    const retryId = newId("job");
    options.admit(previous);
    const currentSource = database.sources.getOwnedReady(
      sourceId,
      actor.userId,
      timestamp,
    );
    if (currentSource === undefined)
      throw new AppError(
        "SOURCE_NOT_READY",
        "The previous Job Source is not ready",
        409,
      );
    database.jobs.insertRetry({
      id: retryId,
      source: previous,
      rendererVersion: options.rendererVersion,
      timestamp,
      reservedOutputBytes: options.maxOutputBytes,
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
