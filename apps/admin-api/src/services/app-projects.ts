import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { AdminDependencies, AppActor } from "../types.js";

export class AppProjectsService {
  constructor(private readonly deps: AdminDependencies) {}

  list(actor: AppActor) {
    return this.deps.database.projects
      .listOwned(actor.userId)
      .map((project) => this.summary(actor, project.id));
  }

  get(actor: AppActor, id: string) {
    return this.summary(actor, id, true);
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
    const source = this.deps.database.sources.getOwned(
      revision.source_id,
      actor.userId,
    );
    if (source?.status !== "ready")
      throw new AppError(
        "SOURCE_EXPIRED",
        "The original source is unavailable",
        410,
      );
    return { project, revision, source };
  }

  attachRevision(
    actor: AppActor,
    input: {
      projectId: string;
      sourceId: string;
      jobId: string;
      displayName: string;
      originalFilename: string;
      entrypoint: string;
    },
  ) {
    return this.deps.database.transaction(() => {
      const project = this.deps.database.projects.getOwned(
          input.projectId,
          actor.userId,
        ),
        source = this.deps.database.sources.getOwned(
          input.sourceId,
          actor.userId,
        ),
        job = this.deps.database.jobs.get(input.jobId);
      if (project === undefined)
        throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
      if (source?.status !== "ready")
        throw new AppError("SOURCE_NOT_READY", "Source is not ready", 409);
      if (
        job === undefined ||
        job.user_id !== actor.userId ||
        job.source_id !== source.id ||
        job.entrypoint !== input.entrypoint
      )
        throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
      let revision = this.deps.database.projects.revisionForSource(
        project.id,
        source.id,
        input.entrypoint,
      );
      if (revision === undefined) {
        revision = this.deps.database.projects.insertRevision({
          id: newId("revision"),
          projectId: project.id,
          sourceId: source.id,
          displayName: input.displayName,
          originalFilename: input.originalFilename,
          entrypoint: input.entrypoint,
          timestamp: nowIso(),
        });
        this.deps.database.audit({
          actorType: actor.type,
          actorId: actor.id,
          action: "project.revision_created",
          targetType: "project_revision",
          targetId: revision.id,
          result: "success",
          metadata: { projectId: project.id, sourceId: source.id },
        });
      }
      this.deps.database.jobs.attachProjectRevision(job.id, revision.id);
      this.deps.database.projects.touch(project.id, nowIso());
      return revision;
    });
  }

  private summary(actor: AppActor, id: string, includeDetails = false) {
    const project = this.deps.database.projects.getOwned(id, actor.userId);
    if (project === undefined)
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
    const revisions = this.deps.database.projects
      .revisions(id)
      .map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revision_number,
        displayName: revision.display_name,
        originalFilename: revision.original_filename,
        entrypoint: revision.entrypoint,
        createdAt: revision.created_at,
        ...(includeDetails
          ? {
              jobs: this.deps.database.jobs
                .forRevision(revision.id)
                .map((job) => ({
                  id: job.id,
                  status: job.status,
                  createdAt: job.created_at,
                  updatedAt: job.updated_at,
                  retryOfJobId: job.retry_of_job_id,
                  errorCode: job.error_code,
                })),
            }
          : {}),
      }));
    return {
      id: project.id,
      displayName: project.display_name,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      revisionCount: revisions.length,
      latestRevision: revisions[0] ?? null,
      ...(includeDetails ? { revisions } : {}),
    };
  }
}
