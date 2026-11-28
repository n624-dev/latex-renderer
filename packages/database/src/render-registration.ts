import type { RenderEngine, RenderOutput } from "@latex-renderer/contracts";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import { ProjectOperations, type ProjectActor } from "./project-operations.js";
import {
  assertMinimumFreeStorage,
  assertRenderAdmission,
  type RenderAdmissionLimits,
} from "./render-admission.js";
import type { SourceRow } from "./repositories/sources.js";

export interface RenderRegistrationLimits extends RenderAdmissionLimits {
  rendererVersion: string;
  maxOutputBytes: number;
}

interface RenderRegistration {
  id: string;
  userId: string;
  serviceAccountId: string;
  apiKeyId: string;
  sourceId: string;
  outputs: readonly RenderOutput[];
  engine: RenderEngine;
  timestamp: string;
}

type RenderProject =
  | { projectId: string; revisionId: string; touch?: true }
  | {
      projectId: string;
      displayName: string;
      originalFilename: string;
      outputs: readonly RenderOutput[];
    };

export function assertRenderEntrypoint(
  db: RendererDatabase,
  source: SourceRow,
  entrypoint: string,
): void {
  if (!db.sources.paths(source).includes(entrypoint))
    throw new AppError(
      "ENTRYPOINT_MISSING",
      "Source does not contain the requested entrypoint",
      422,
    );
}

export function requireReadyRenderSource(
  db: RendererDatabase,
  input: {
    sourceId: string;
    userId: string;
    serviceAccountId?: string;
    entrypoint: string;
    timestamp: string;
  },
): void {
  const source = db.sources.getOwnedReady(
    input.sourceId,
    input.userId,
    input.timestamp,
    input.serviceAccountId,
  );
  if (source === undefined)
    throw new AppError(
      "SOURCE_NOT_READY",
      "Source does not exist or is not ready",
      409,
    );
  assertRenderEntrypoint(db, source, input.entrypoint);
}

/** The caller holds the transaction for registration and request bookkeeping. */
export function registerReadyRender(
  db: RendererDatabase,
  limits: RenderRegistrationLimits,
  input: RenderRegistration & {
    actor: ProjectActor;
    action: string;
    entrypoint: string;
    project?: RenderProject | undefined;
  },
): string | undefined {
  assertRenderAdmission(db, input, limits, limits.maxOutputBytes);
  requireReadyRenderSource(db, input);
  const { actor, project, sourceId, entrypoint, engine, outputs } = input;
  let projectRevisionId: string | undefined;
  if (project !== undefined) {
    if ("revisionId" in project) {
      if (
        project.touch &&
        !db.projects.getOwned(project.projectId, actor.userId)
      )
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      const revision = db.projects.revisionOwned(
        project.revisionId,
        actor.userId,
      );
      if (
        revision?.project_id !== project.projectId ||
        revision.source_id !== sourceId ||
        revision.entrypoint !== entrypoint ||
        revision.engine !== engine
      )
        throw new AppError(
          "PROJECT_REVISION_NOT_FOUND",
          "Project revision does not exist",
          404,
        );
      projectRevisionId = revision.id;
      if (project.touch) db.projects.touch(project.projectId, nowIso());
    } else {
      projectRevisionId = new ProjectOperations(db).attachRevisionInTransaction(
        actor,
        { ...project, sourceId, entrypoint, engine },
      ).id;
    }
  }
  const revision = projectRevisionId === undefined ? {} : { projectRevisionId };
  if (
    db.jobs.insertQueued({
      ...input,
      ...revision,
      rendererVersion: limits.rendererVersion,
      reservedOutputBytes: limits.maxOutputBytes,
    }) !== 1
  )
    throw new AppError(
      "SOURCE_NOT_READY",
      "Source changed while the Render Job was being created",
      409,
    );
  db.audit({
    actorType: actor.type,
    actorId: actor.id,
    action: input.action,
    targetType: "job",
    targetId: input.id,
    result: "success",
    metadata: { sourceId, entrypoint, outputs, engine, ...revision },
  });
  return projectRevisionId;
}

/** The caller holds the write transaction. */
export function registerReservedRender(
  db: RendererDatabase,
  limits: RenderRegistrationLimits,
  input: RenderRegistration & {
    actor: { type: string; id: string };
    operation: string;
    keyHash: string;
    requestHash: string;
    sourceSize: number;
    sourceSha256: string;
    nonce: string;
    expiresAt: string;
    auditMetadata?: Readonly<Record<string, unknown>>;
  },
): void {
  const {
    maxQueueLength,
    maxUserStorageBytes,
    maxOutputBytes,
    rendererVersion,
  } = limits;
  const {
    id,
    actor,
    sourceId,
    sourceSize,
    sourceSha256,
    timestamp,
    expiresAt,
  } = input;
  // Legacy reservations defer the filesystem check to the upload.
  assertRenderAdmission(
    db,
    input,
    { maxQueueLength, maxUserStorageBytes },
    sourceSize + maxOutputBytes,
  );
  db.sources.insertReserved({
    id: sourceId,
    ownerUserId: input.userId,
    serviceAccountId: input.serviceAccountId,
    size: sourceSize,
    sha256: sourceSha256,
    storageKey: `sources/${sourceId}/source.zip`,
    timestamp,
    expiresAt,
    dedupeEligible: false,
  });
  db.jobs.insertReserved({
    ...input,
    rendererVersion,
    reservedOutputBytes: maxOutputBytes,
  });
  db.security.insertNonce(input.nonce, id, expiresAt);
  db.security.insertIdempotency({
    actorType: actor.type,
    actorId: actor.id,
    operation: input.operation,
    keyHash: input.keyHash,
    requestHash: input.requestHash,
    resourceId: id,
    responseCode: 201,
    expiresAt,
    createdAt: timestamp,
  });
  db.audit({
    actorType: actor.type,
    actorId: actor.id,
    action: "render.reserved",
    targetType: "job",
    targetId: id,
    result: "success",
    metadata: { sourceSize, sourceSha256, ...input.auditMetadata },
  });
}

/** The caller checks access to the original Job within the write transaction. */
export function registerWholeRenderRetry(
  db: RendererDatabase,
  limits: RenderRegistrationLimits,
  input: {
    originalId: string;
    timestamp: string;
    notRetryable: string;
    sourceUnavailable: (sourceId: string | null) => AppError;
    checkSourceBeforeAdmission?: true;
  },
): string {
  const source = db.jobs.findRetrySource(input.originalId);
  if (source === undefined)
    throw new AppError("JOB_NOT_RETRYABLE", input.notRetryable, 409);
  const {
    storageRoot,
    minFreeStorageBytes,
    readFreeStorageBytes,
    ...admission
  } = limits;
  assertMinimumFreeStorage(
    storageRoot,
    minFreeStorageBytes,
    readFreeStorageBytes,
  );
  const sourceId = source.source_id;
  if (sourceId === null) throw input.sourceUnavailable(null);
  const requireReadySource = () => {
    if (!db.sources.getOwnedReady(sourceId, source.user_id, input.timestamp))
      throw input.sourceUnavailable(sourceId);
  };
  if (input.checkSourceBeforeAdmission) requireReadySource();
  assertRenderAdmission(
    db,
    { userId: source.user_id, serviceAccountId: source.service_account_id },
    admission,
    limits.maxOutputBytes,
  );
  if (!input.checkSourceBeforeAdmission) requireReadySource();
  const id = newId("job");
  db.jobs.insertRetry({
    id,
    source,
    timestamp: input.timestamp,
    rendererVersion: limits.rendererVersion,
    reservedOutputBytes: limits.maxOutputBytes,
  });
  return id;
}
