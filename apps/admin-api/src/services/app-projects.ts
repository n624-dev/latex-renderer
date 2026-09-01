import {
  AppError,
  encodePageCursor,
  newId,
  nowIso,
} from "@latex-renderer/shared";
import type {
  ProjectRevisionRow,
  ProjectSummaryRow,
  RevisionJobSummary,
} from "@latex-renderer/database";
import type { AdminDependencies, AppActor } from "../types.js";

export class AppProjectsService {
  constructor(private readonly deps: AdminDependencies) {}

  list(
    actor: AppActor,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const page = this.deps.database.projects.listOwnedPage(
      actor.userId,
      options,
    );
    return {
      ...page,
      items: page.items.map((project) => this.listSummary(project)),
    };
  }

  get(
    actor: AppActor,
    id: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const project = this.deps.database.projects.getOwned(id, actor.userId);
    if (project === undefined)
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
    const revisions = this.deps.database.projects.revisionsPage(id, options),
      revisionIds = revisions.items.map((revision) => revision.id),
      jobsByRevision =
        this.deps.database.jobs.listSummariesForRevisions(revisionIds),
      jobCounts = this.deps.database.jobs.countForRevisions(revisionIds),
      latestRevision = this.deps.database.projects.latestRevision(id);
    return {
      id: project.id,
      displayName: project.display_name,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      revisionCount: this.deps.database.projects.revisionCount(id),
      latestRevision: latestRevision
        ? this.revisionSummary(latestRevision, [], 0)
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
    actor: AppActor,
    projectId: string,
    revisionId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const project = this.deps.database.projects.getOwned(
        projectId,
        actor.userId,
      ),
      revision = this.deps.database.projects.revisionOwned(
        revisionId,
        actor.userId,
      );
    if (project === undefined || revision?.project_id !== project.id)
      throw new AppError(
        "PROJECT_REVISION_NOT_FOUND",
        "Project revision does not exist",
        404,
      );
    return this.deps.database.jobs.listForRevisionPage(revisionId, options);
  }

  create(actor: AppActor, displayName: string): { id: string } {
    const id = newId("project"),
      timestamp = nowIso();
    this.deps.database.transaction(() => {
      this.deps.database.projects.insert({
        id,
        ownerUserId: actor.userId,
        displayName,
        timestamp,
      });
      this.deps.database.audit({
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

  rename(actor: AppActor, id: string, displayName: string): void {
    this.deps.database.transaction(() => {
      if (
        this.deps.database.projects.rename(
          id,
          actor.userId,
          displayName,
          nowIso(),
        ) !== 1
      )
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "project.renamed",
        targetType: "project",
        targetId: id,
        result: "success",
      });
    });
  }

  delete(actor: AppActor, id: string): void {
    this.deps.database.transaction(() => {
      if (
        this.deps.database.projects.softDelete(id, actor.userId, nowIso()) !== 1
      )
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      this.deps.database.audit({
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

  revision(actor: AppActor, projectId: string, revisionId: string) {
    const project = this.deps.database.projects.getOwned(
        projectId,
        actor.userId,
      ),
      revision = this.deps.database.projects.revisionOwned(
        revisionId,
        actor.userId,
      );
    if (project === undefined || revision?.project_id !== project.id)
      throw new AppError(
        "PROJECT_REVISION_NOT_FOUND",
        "Project revision does not exist",
        404,
      );
    const source = this.deps.database.sources.getOwnedReady(
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

  renderOutputs(revision: Pick<ProjectRevisionRow, "outputs_json">) {
    return this.deps.database.projects.renderOutputs(revision);
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
      displayName: revision.display_name,
      originalFilename: revision.original_filename,
      entrypoint: revision.entrypoint,
      createdAt: revision.created_at,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        retryOfJobId: job.retry_of_job_id,
        errorCode: job.error_code,
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
