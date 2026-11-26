import {
  projectDocumentConditionsSchema,
  projectReviewChecksSchema,
  type ProjectDocumentCondition,
  type ProjectReviewCheck,
} from "@latex-renderer/contracts";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import type { ProjectActor } from "./project-operations.js";
import { assertSourceWritable } from "./source-lifecycle.js";

export class ProjectDocumentState {
  constructor(private readonly db: RendererDatabase) {}

  clearDeletedProjectContent(projectId: string): void {
    this.db.raw.prepare(
      "UPDATE project_revision_changes SET description='' WHERE project_id=?",
    ).run(projectId);
    this.db.raw.prepare(
      `UPDATE project_pdf_reviews
         SET review_json=json_set(review_json, '$.checks', (
           SELECT json_group_array(json_remove(value, '$.note'))
           FROM json_each(project_pdf_reviews.review_json, '$.checks')
         ))
       WHERE project_id=?`,
    ).run(projectId);
    this.db.raw.prepare(
      `DELETE FROM project_document_conditions AS conditions
       WHERE conditions.project_id=?
         AND NOT EXISTS (SELECT 1 FROM project_revision_changes AS changes
           WHERE changes.project_id=conditions.project_id AND changes.conditions_version=conditions.version)
         AND NOT EXISTS (SELECT 1 FROM project_pdf_reviews AS reviews
           WHERE reviews.project_id=conditions.project_id AND reviews.conditions_version=conditions.version)`,
    ).run(projectId);
  }

  get(actor: ProjectActor, projectId: string, version?: number) {
    this.assertOwned(actor, projectId);
    const condition = this.conditions(projectId, version);
    if (version !== undefined && condition === null)
      throw new AppError(
        "DOCUMENT_CONDITIONS_NOT_FOUND",
        "Document conditions version does not exist",
        404,
      );
    return {
      projectId,
      conditions: condition,
      adoptedRevisionId: this.adoptedRevision(projectId),
    };
  }

  updateConditions(
    actor: ProjectActor,
    projectId: string,
    expectedVersion: number,
    input: ProjectDocumentCondition[],
  ) {
    const entries = projectDocumentConditionsSchema.parse(input);
    return this.db.transaction(() => {
      assertSourceWritable(this.db);
      this.assertOwned(actor, projectId);
      const current = this.conditions(projectId);
      const version = current?.version ?? 0;
      if (version !== expectedVersion)
        throw new AppError(
          "DOCUMENT_CONDITIONS_CONFLICT",
          "Document conditions have changed",
          409,
          { currentVersion: version },
        );
      if (JSON.stringify(current?.entries ?? []) === JSON.stringify(entries))
        return { projectId, version, entries, changed: false };
      const createdAt = nowIso();
      this.db.raw
        .prepare(
          "INSERT INTO project_document_conditions(project_id,version,conditions_json,created_at) VALUES (?,?,?,?)",
        )
        .run(projectId, version + 1, JSON.stringify(entries), createdAt);
      this.audit(actor, projectId, "conditions_updated", {
        version: version + 1,
      });
      return { projectId, version: version + 1, entries, changed: true };
    });
  }

  adopt(
    actor: ProjectActor,
    projectId: string,
    revisionId: string | null,
    expectedRevisionId: string | null,
  ) {
    return this.db.transaction(() => {
      assertSourceWritable(this.db);
      this.assertOwned(actor, projectId);
      const current = this.adoptedRevision(projectId);
      if (current !== expectedRevisionId)
        throw new AppError(
          "ADOPTED_REVISION_CONFLICT",
          "The Project's adopted revision has changed",
          409,
        );
      if (
        revisionId !== null &&
        this.db.projects.revisionOwned(revisionId, actor.userId)?.project_id !==
          projectId
      )
        throw new AppError(
          "PROJECT_REVISION_NOT_FOUND",
          "Project revision does not exist",
          404,
        );
      if (revisionId === current)
        return { projectId, adoptedRevisionId: current };
      if (revisionId === null)
        this.db.raw
          .prepare("DELETE FROM project_adopted_revisions WHERE project_id=?")
          .run(projectId);
      else
        this.db.raw
          .prepare(
            `INSERT INTO project_adopted_revisions(project_id,revision_id,updated_at) VALUES (?,?,?)
          ON CONFLICT(project_id) DO UPDATE SET revision_id=excluded.revision_id, updated_at=excluded.updated_at`,
          )
          .run(projectId, revisionId, nowIso());
      this.audit(actor, projectId, "revision_adopted", { revisionId });
      return { projectId, adoptedRevisionId: revisionId };
    });
  }

  recordRevisionChange(
    actor: ProjectActor,
    input: {
      projectId: string;
      revisionId: string;
      parentRevisionId: string | null;
      draftVersion: number;
      description: string;
    },
  ): void {
    if (!this.db.raw.isTransaction)
      throw new Error("Revision change history requires a write transaction");
    const version = this.conditions(input.projectId)?.version ?? null;
    if (input.parentRevisionId === input.revisionId) return;
    const previous = this.db.raw
      .prepare(
        "SELECT 1 FROM project_revision_changes WHERE project_id=? AND revision_id=? AND parent_revision_id IS ? AND draft_version=? AND conditions_version IS ? AND description=?",
      )
      .get(
        input.projectId,
        input.revisionId,
        input.parentRevisionId,
        input.draftVersion,
        version,
        input.description,
      );
    if (previous !== undefined) return;
    this.db.raw
      .prepare(
        `INSERT INTO project_revision_changes
      (id,project_id,revision_id,parent_revision_id,draft_version,conditions_version,description,created_at)
      VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        newId("change"),
        input.projectId,
        input.revisionId,
        input.parentRevisionId,
        input.draftVersion,
        version,
        input.description,
        nowIso(),
      );
    this.audit(actor, input.projectId, "revision_change_recorded", {
      revisionId: input.revisionId,
      parentRevisionId: input.parentRevisionId,
    });
  }

  revisionChanges(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    offset: number,
  ) {
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
    const limit = 20;
    const rows = this.db.raw
      .prepare(
        `SELECT id,parent_revision_id AS parentRevisionId,draft_version AS draftVersion,
       conditions_version AS conditionsVersion,description,created_at AS createdAt
       FROM project_revision_changes WHERE project_id=? AND revision_id=?
       ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, revisionId, limit + 1, offset) as {
      id: string;
      parentRevisionId: string | null;
      draftVersion: number;
      conditionsVersion: number | null;
      description: string;
      createdAt: string;
    }[];
    return {
      revisionId,
      items: rows.slice(0, limit),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }

  private adoptedRevision(projectId: string): string | null {
    const row = this.db.raw
      .prepare(
        "SELECT revision_id FROM project_adopted_revisions WHERE project_id=?",
      )
      .get(projectId) as { revision_id: string } | undefined;
    return row?.revision_id ?? null;
  }

  private conditions(projectId: string, version?: number) {
    const row = this.db.raw
      .prepare(
        `SELECT version, conditions_json, created_at
       FROM project_document_conditions WHERE project_id=? AND (? IS NULL OR version=?)
       ORDER BY version DESC LIMIT 1`,
      )
      .get(projectId, version ?? null, version ?? null) as
      | { version: number; conditions_json: string; created_at: string }
      | undefined;
    if (row === undefined) return null;
    return {
      version: row.version,
      entries: projectDocumentConditionsSchema.parse(
        JSON.parse(row.conditions_json),
      ),
      createdAt: row.created_at,
    };
  }

  recordReview(
    actor: ProjectActor,
    projectId: string,
    input: {
      revisionId: string;
      jobId: string;
      pdfSha256: string;
      conditionsVersion: number | null;
      checks: ProjectReviewCheck[];
      guideVersion: string | null;
    },
    retentionHours: number,
  ) {
    const checks = projectReviewChecksSchema.parse(input.checks);
    return this.db.transaction(() => {
      assertSourceWritable(this.db);
      this.assertOwned(actor, projectId);
      const revision = this.db.projects.revisionOwned(
        input.revisionId,
        actor.userId,
      );
      const job = this.db.jobs.getVisible(input.jobId);
      if (
        revision?.project_id !== projectId ||
        job?.user_id !== actor.userId ||
        job.project_revision_id !== revision.id ||
        job.source_id !== revision.source_id
      )
        throw new AppError(
          "REVIEW_TARGET_MISMATCH",
          "The Job does not match the selected revision",
          409,
        );
      const pdf = this.db.artifacts.getDownloadable(input.jobId, "result.pdf", {
        retentionHours,
      });
      if (pdf === undefined || pdf.sha256 !== input.pdfSha256)
        throw new AppError(
          "REVIEW_PDF_MISMATCH",
          "The specified PDF is unavailable or no longer matches its digest",
          409,
        );
      if (
        input.conditionsVersion !== null &&
        this.conditions(projectId, input.conditionsVersion) === null
      )
        throw new AppError(
          "DOCUMENT_CONDITIONS_NOT_FOUND",
          "Document conditions version does not exist",
          404,
        );
      const id = newId("review");
      const createdAt = nowIso();
      this.db.raw
        .prepare(
          `INSERT INTO project_pdf_reviews
        (id,project_id,revision_id,job_id,pdf_sha256,runtime_digest,conditions_version,review_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          projectId,
          revision.id,
          job.id,
          pdf.sha256,
          job.runtime_digest,
          input.conditionsVersion,
          JSON.stringify({ checks, guideVersion: input.guideVersion }),
          createdAt,
        );
      this.audit(actor, projectId, "pdf_review_recorded", {
        reviewId: id,
        revisionId: revision.id,
        jobId: job.id,
      });
      return {
        id,
        projectId,
        ...input,
        checks,
        runtimeDigest: job.runtime_digest,
        createdAt,
      };
    });
  }

  reviews(actor: ProjectActor, projectId: string, after = 0, limit = 20) {
    this.assertOwned(actor, projectId);
    const rows = this.db.raw
      .prepare(
        `SELECT id,revision_id,job_id,pdf_sha256,runtime_digest,conditions_version,review_json,created_at
       FROM project_pdf_reviews WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, limit + 1, after) as {
      id: string;
      revision_id: string;
      job_id: string;
      pdf_sha256: string;
      runtime_digest: string | null;
      conditions_version: number | null;
      review_json: string;
      created_at: string;
    }[];
    return {
      projectId,
      items: rows.slice(0, limit).map((row) => {
        const { checks, guideVersion } = JSON.parse(row.review_json) as {
          checks: unknown;
          guideVersion: string | null;
        };
        return {
          id: row.id,
          projectId,
          revisionId: row.revision_id,
          jobId: row.job_id,
          pdfSha256: row.pdf_sha256,
          runtimeDigest: row.runtime_digest,
          conditionsVersion: row.conditions_version,
          guideVersion,
          checks: projectReviewChecksSchema.parse(checks),
          createdAt: row.created_at,
        };
      }),
      nextOffset: rows.length > limit ? after + limit : null,
    };
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
