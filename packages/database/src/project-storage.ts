import { AppError, nowIso, sha256Hex } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import type { ProjectActor } from "./project-operations.js";
import {
  assertSourceWritable,
  sourceReferenceCountSql,
} from "./source-lifecycle.js";

export class ProjectStorage {
  constructor(private readonly db: RendererDatabase) {}

  usage(actor: ProjectActor, projectId: string, defaultMaxBytes: number) {
    this.assertOwned(actor, projectId);
    const sources = this.db.raw
      .prepare(
        `WITH refs(id) AS (
      SELECT source_id FROM project_revisions WHERE project_id=?
      UNION SELECT source_id FROM project_draft_files WHERE project_id=?
    ) SELECT COUNT(*) AS count, COALESCE(SUM(s.size),0) AS bytes
      FROM refs JOIN sources s ON s.id=refs.id
      WHERE s.owner_user_id=? AND s.status!='deleted'`,
      )
      .get(projectId, projectId, actor.userId) as {
      count: number;
      bytes: number;
    };
    const jobs = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(j.output_size,0)),0) AS outputBytes,
      COALESCE(SUM(CASE WHEN j.status IN ('reserved','uploading','queued','validating','running')
         THEN MAX(j.reserved_output_bytes-COALESCE(j.output_size,0),0) ELSE 0 END),0) AS reservedOutputBytes
      FROM jobs j
      WHERE j.user_id=? AND j.status NOT IN ('deleted','expired')
        AND (j.project_revision_id IN (SELECT id FROM project_revisions WHERE project_id=?)
          OR j.id IN (SELECT job_id FROM job_draft_inputs WHERE project_id=?))`,
      )
      .get(actor.userId, projectId, projectId) as {
      outputBytes: number;
      reservedOutputBytes: number;
    };
    return {
      projectId,
      measuredAt: nowIso(),
      project: {
        sourceCount: sources.count,
        sourceBytes: sources.bytes,
        ...jobs,
      },
      user: {
        ...this.db.jobs.storageBreakdownForUser(actor.userId, true),
        sourceTreeBytes: null,
        quotaBytes: this.db.settings.value(
          "max_user_storage_bytes",
          defaultMaxBytes,
        ),
      },
      physicalBytes: null,
    };
  }

  protect(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    protectedRevision: boolean,
  ) {
    return this.db.transaction(() => {
      assertSourceWritable(this.db);
      this.assertOwned(actor, projectId);
      if (
        this.db.projects.revisionOwned(revisionId, actor.userId)?.project_id !==
        projectId
      )
        throw new AppError(
          "PROJECT_REVISION_NOT_FOUND",
          "Project revision does not exist",
          404,
        );
      if (protectedRevision)
        this.db.raw
          .prepare(
            "INSERT OR IGNORE INTO project_protected_revisions(project_id,revision_id) VALUES (?,?)",
          )
          .run(projectId, revisionId);
      else
        this.db.raw
          .prepare(
            "DELETE FROM project_protected_revisions WHERE project_id=? AND revision_id=?",
          )
          .run(projectId, revisionId);
      this.audit(actor, projectId, "revision_protection_changed", {
        revisionId,
        protected: protectedRevision,
      });
      return { projectId, revisionId, protected: protectedRevision };
    });
  }

  cleanupPlan(actor: ProjectActor, projectId: string, requested: string[]) {
    this.assertOwned(actor, projectId);
    if (
      requested.length < 1 ||
      requested.length > 50 ||
      new Set(requested).size !== requested.length
    )
      throw new AppError(
        "INVALID_REVISION_SELECTION",
        "Select 1 to 50 distinct revisions",
        400,
      );
    const current = this.db.projects.latestRevision(projectId);
    const draft = this.db.drafts.getOwned(projectId, actor.userId);
    const draftSources = new Set(
      draft === undefined
        ? []
        : this.db.drafts.files(projectId).map((file) => file.source_id),
    );
    const entries = [...requested].sort().map((revisionId) => {
      const revision = this.db.projects.revisionOwned(revisionId, actor.userId);
      if (revision?.project_id !== projectId)
        throw new AppError(
          "PROJECT_REVISION_NOT_FOUND",
          "Project revision does not exist",
          404,
        );
      const markers = this.db.raw
        .prepare(
          `SELECT
        EXISTS(SELECT 1 FROM project_adopted_revisions WHERE project_id=? AND revision_id=?) AS adopted,
        EXISTS(SELECT 1 FROM project_protected_revisions WHERE project_id=? AND revision_id=?) AS protected,
        EXISTS(SELECT 1 FROM project_pdf_reviews WHERE project_id=? AND revision_id=?) AS reviewed,
        EXISTS(SELECT 1 FROM jobs WHERE project_revision_id=? AND status NOT IN ('expired','deleted')) AS job
      `,
        )
        .get(
          projectId,
          revisionId,
          projectId,
          revisionId,
          projectId,
          revisionId,
          revisionId,
        ) as {
        adopted: number;
        protected: number;
        reviewed: number;
        job: number;
      };
      const reasons = [
        ...(current?.id === revisionId ? ["latest"] : []),
        ...(markers.adopted ? ["adopted"] : []),
        ...(markers.protected ? ["protected"] : []),
        ...(markers.reviewed ? ["reviewed"] : []),
        ...(markers.job ? ["linked_job"] : []),
        ...(draft?.base_revision_id === revisionId ||
        (draft &&
          draft.base_revision_id == null &&
          draftSources.has(revision.source_id))
          ? ["draft_origin"]
          : []),
      ];
      const source = this.db.raw
        .prepare(
          `SELECT s.size, ${sourceReferenceCountSql("s")} AS referenceCount
        FROM sources s WHERE s.id=? AND s.owner_user_id=? AND s.status!='deleted'`,
        )
        .get(revision.source_id, actor.userId) as
        { size: number; referenceCount: number } | undefined;
      return {
        revisionId,
        sourceId: revision.source_id,
        reasons,
        sourceBytes: source?.size ?? 0,
        references: source?.referenceCount ?? 0,
      };
    });
    const removable = entries.filter(({ reasons }) => reasons.length === 0);
    const removing = new Map<string, number>();
    for (const item of removable)
      removing.set(item.sourceId, (removing.get(item.sourceId) ?? 0) + 1);
    let estimatedSourceBytes = 0;
    for (const [sourceId, count] of removing) {
      const row = removable.find((item) => item.sourceId === sourceId);
      if (row?.references === count) estimatedSourceBytes += row.sourceBytes;
    }
    const plan = { projectId, entries, estimatedSourceBytes };
    return { ...plan, planHash: sha256Hex(JSON.stringify(plan)) };
  }

  applyCleanup(
    actor: ProjectActor,
    projectId: string,
    revisions: string[],
    expectedHash: string,
  ) {
    return this.db.transaction(() => {
      assertSourceWritable(this.db);
      const plan = this.cleanupPlan(actor, projectId, revisions);
      if (plan.planHash !== expectedHash)
        throw new AppError(
          "REVISION_CLEANUP_CHANGED",
          "Retention changed; request a new cleanup plan",
          409,
        );
      if (plan.entries.some(({ reasons }) => reasons.length > 0))
        throw new AppError(
          "REVISION_CLEANUP_PROTECTED",
          "The selection contains a protected revision",
          409,
        );
      for (const item of plan.entries)
        this.db.raw
          .prepare("DELETE FROM project_revisions WHERE project_id=? AND id=?")
          .run(projectId, item.revisionId);
      this.db.projects.touch(projectId, nowIso());
      const removed = plan.entries.map(({ revisionId }) => revisionId);
      this.audit(actor, projectId, "revisions_removed", { revisions: removed });
      return {
        projectId,
        removed,
        estimatedSourceBytes: plan.estimatedSourceBytes,
      };
    });
  }

  private assertOwned(actor: ProjectActor, projectId: string) {
    if (!this.db.projects.getOwned(projectId, actor.userId))
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
  }

  private audit(
    actor: ProjectActor,
    projectId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    this.db.audit({
      actorType: actor.type,
      actorId: actor.id,
      action: `project.${action}`,
      targetType: "project",
      targetId: projectId,
      result: "success",
      metadata,
    });
  }
}
