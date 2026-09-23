import type { RenderOutput } from "@latex-renderer/contracts";
import {
  AppError,
  encodePageCursor,
  newId,
  nowIso,
} from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import type {
  ProjectRevisionRow,
  ProjectSummaryRow,
} from "./repositories/projects.js";
import type { RevisionJobSummary } from "./repositories/jobs.js";

export interface ProjectActor {
  userId: string;
  type: string;
  id: string;
}

/** The saved-document policy shared by browser, API-key and OAuth callers. */
export class ProjectOperations {
  constructor(private readonly database: RendererDatabase) {}

  list(
    actor: ProjectActor,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const page = this.database.projects.listOwnedPage(actor.userId, options);
    return {
      ...page,
      items: page.items.map((project) => this.listSummary(project)),
    };
  }

  get(
    actor: ProjectActor,
    id: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const project = this.database.projects.getOwned(id, actor.userId);
    if (project === undefined)
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
    const revisions = this.database.projects.revisionsPage(id, options),
      latestRevision = this.database.projects.latestRevision(id),
      revisionIds = [
        ...new Set([
          ...revisions.items.map((revision) => revision.id),
          ...(latestRevision === undefined ? [] : [latestRevision.id]),
        ]),
      ],
      jobsByRevision =
        this.database.jobs.listSummariesForRevisions(revisionIds),
      jobCounts = this.database.jobs.countForRevisions(revisionIds);
    return {
      id: project.id,
      displayName: project.display_name,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      revisionCount: this.database.projects.revisionCount(id),
      latestRevision: latestRevision
        ? this.revisionSummary(
            latestRevision,
            jobsByRevision.get(latestRevision.id) ?? [],
            jobCounts.get(latestRevision.id) ?? 0,
          )
        : null,
      revisionsNextCursor: revisions.nextCursor,
      revisionsHasMore: revisions.hasMore,
      revisions: revisions.items.map((revision) =>
        this.revisionSummary(
          revision,
          jobsByRevision.get(revision.id) ?? [],
          jobCounts.get(revision.id) ?? 0,
        ),
      ),
    };
  }

  jobs(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const project = this.database.projects.getOwned(projectId, actor.userId),
      revision = this.database.projects.revisionOwned(revisionId, actor.userId);
    if (project === undefined || revision?.project_id !== project.id)
      throw new AppError(
        "PROJECT_REVISION_NOT_FOUND",
        "Project revision does not exist",
        404,
      );
    const page = this.database.jobs.listForRevisionPage(revisionId, options);
    return {
      ...page,
      items: page.items.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        retryOfJobId: job.retry_of_job_id,
        errorCode: job.error_code,
        outputs: this.database.jobs.outputs(job),
      })),
    };
  }

  create(actor: ProjectActor, displayName: string): { id: string } {
    const id = newId("project"),
      timestamp = nowIso();
    this.database.transaction(() => {
      this.assertWritable();
      this.database.projects.insert({
        id,
        ownerUserId: actor.userId,
        displayName,
        timestamp,
      });
      this.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.created",
        targetType: "project",
        targetId: id,
        result: "success",
      });
    });
    return { id };
  }

  rename(actor: ProjectActor, id: string, displayName: string): void {
    this.database.transaction(() => {
      this.assertWritable();
      if (
        this.database.projects.rename(
          id,
          actor.userId,
          displayName,
          nowIso(),
        ) !== 1
      )
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      this.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.renamed",
        targetType: "project",
        targetId: id,
        result: "success",
      });
    });
  }

  delete(actor: ProjectActor, id: string): void {
    this.database.transaction(() => {
      this.assertWritable();
      if (this.database.projects.softDelete(id, actor.userId, nowIso()) !== 1)
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      this.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.deleted",
        targetType: "project",
        targetId: id,
        result: "success",
        metadata: {
          lifecycle:
            "metadata-only; Sources and Jobs retain their existing retention policy",
        },
      });
    });
  }

  revision(actor: ProjectActor, projectId: string, revisionId: string) {
    const project = this.database.projects.getOwned(projectId, actor.userId),
      revision = this.database.projects.revisionOwned(revisionId, actor.userId);
    if (project === undefined || revision?.project_id !== project.id)
      throw new AppError(
        "PROJECT_REVISION_NOT_FOUND",
        "Project revision does not exist",
        404,
      );
    const source = this.database.sources.getOwnedReady(
      revision.source_id,
      actor.userId,
      nowIso(),
    );
    if (source === undefined)
      throw new AppError(
        "SOURCE_EXPIRED",
        "The original source is unavailable",
        410,
      );
    return { project, revision, source };
  }

  /** Caller holds the database write transaction; Job insertion can then be atomic. */
  attachRevisionInTransaction(
    actor: ProjectActor,
    input: {
      projectId: string;
      sourceId: string;
      entrypoint: string;
      displayName: string;
      originalFilename: string;
      outputs: readonly RenderOutput[];
    },
  ): ProjectRevisionRow {
    this.assertWritable();
    if (
      input.outputs.length < 1 ||
      input.outputs.length > 2 ||
      !input.outputs.includes("pdf") ||
      new Set(input.outputs).size !== input.outputs.length
    )
      throw new AppError("INVALID_OUTPUTS", "Render outputs are invalid", 400);
    const project = this.database.projects.getOwned(
      input.projectId,
      actor.userId,
    );
    if (project === undefined)
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
    const source = this.database.sources.getOwnedReady(
      input.sourceId,
      actor.userId,
      nowIso(),
    );
    if (source === undefined)
      throw new AppError(
        "SOURCE_NOT_READY",
        "Source does not exist or is not ready",
        409,
      );
    if (!this.database.sources.paths(source).includes(input.entrypoint))
      throw new AppError(
        "ENTRYPOINT_MISSING",
        "Source does not contain the requested entrypoint",
        422,
      );
    let revision = this.database.projects.revisionForSource(
      input.projectId,
      input.sourceId,
      input.entrypoint,
    );
    if (revision === undefined) {
      revision = this.database.projects.insertRevision({
        id: newId("revision"),
        projectId: input.projectId,
        sourceId: input.sourceId,
        displayName: input.displayName,
        originalFilename: input.originalFilename,
        entrypoint: input.entrypoint,
        outputs: input.outputs,
        timestamp: nowIso(),
      });
      this.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.revision_created",
        targetType: "project_revision",
        targetId: revision.id,
        result: "success",
        metadata: { projectId: input.projectId, sourceId: input.sourceId },
      });
    }
    this.database.projects.touch(project.id, nowIso());
    return revision;
  }

  attachRevision(
    actor: ProjectActor,
    input: {
      projectId: string;
      sourceId: string;
      entrypoint: string;
      displayName: string;
      originalFilename: string;
      outputs: readonly RenderOutput[];
    },
  ) {
    return this.database.transaction(() =>
      this.attachRevisionInTransaction(actor, input),
    );
  }

  renderOutputs(revision: Pick<ProjectRevisionRow, "outputs_json">) {
    return this.database.projects.renderOutputs(revision);
  }

  private assertWritable(): void {
    const mode = this.database.settings.value<
      "normal" | "reject-new-jobs" | "read-only" | "lockdown"
    >("maintenance_mode", "normal");
    if (mode === "read-only" || mode === "lockdown")
      throw new AppError(
        "MAINTENANCE",
        "Saved Projects cannot be changed during maintenance",
        503,
      );
  }

  private listSummary(project: ProjectSummaryRow) {
    return {
      id: project.id,
      displayName: project.display_name,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      revisionCount: project.revision_count,
      latestRevision:
        project.latest_revision_id === null
          ? null
          : {
              id: project.latest_revision_id,
              revisionNumber: project.latest_revision_number,
              displayName: project.latest_revision_display_name,
              originalFilename: project.latest_revision_original_filename,
              entrypoint: project.latest_revision_entrypoint,
              createdAt: project.latest_revision_created_at,
            },
    };
  }

  private revisionSummary(
    revision: ProjectRevisionRow,
    jobs: RevisionJobSummary[],
    jobCount: number,
  ) {
    const lastJob = jobs.at(-1);
    return {
      id: revision.id,
      revisionNumber: revision.revision_number,
      sourceId: revision.source_id,
      displayName: revision.display_name,
      originalFilename: revision.original_filename,
      entrypoint: revision.entrypoint,
      outputs: this.database.projects.renderOutputs(revision),
      createdAt: revision.created_at,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        retryOfJobId: job.retry_of_job_id,
        errorCode: job.error_code,
        outputs: this.database.jobs.outputs(job),
      })),
      jobCount,
      jobsHasMore: jobCount > jobs.length,
      jobsNextCursor:
        jobCount > jobs.length && lastJob !== undefined
          ? encodePageCursor({ createdAt: lastJob.created_at, id: lastJob.id })
          : null,
    };
  }
}
