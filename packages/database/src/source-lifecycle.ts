import { AppError, newId } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";

/** Source preparation remains available in reject-new-jobs, but not in
 * read-only/lockdown or unknown modes. Recheck before durable publication. */
export function assertSourceWritable(
  database: Pick<RendererDatabase, "settings">,
): void {
  const mode = database.settings.value<string>("maintenance_mode", "normal");
  if (mode !== "normal" && mode !== "reject-new-jobs")
    throw new AppError(
      "MAINTENANCE",
      "Source writes are temporarily unavailable",
      503,
    );
}

export function createSourceReference(
  db: RendererDatabase,
  userId: string,
  sourceId: string,
) {
  return db.transaction(() => {
    assertSourceWritable(db);
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const source = db.sources.getOwnedReady(sourceId, userId, timestamp);
    if (source === undefined)
      throw new AppError("SOURCE_NOT_READY", "Source is not ready", 409);
    const deadline = now + 15 * 60_000;
    const expiresAt = new Date(
      db.sources.isRetained(source.id)
        ? deadline
        : Math.min(deadline, Date.parse(source.expires_at)),
    ).toISOString();
    const sourceRef = newId("source_ref");
    db.sources.insertSourceRef({
      id: sourceRef,
      source_id: sourceId,
      owner_user_id: userId,
      created_at: timestamp,
      expires_at: expiresAt,
      revoked_at: null,
    });
    db.audit({
      actorType: "user",
      actorId: userId,
      action: "source_ref.created",
      targetType: "source",
      targetId: sourceId,
      result: "success",
      metadata: { expiresAt },
    });
    return { sourceRef, expiresAt };
  });
}

/** SQL fragments accept only internal aliases, never request input. */
export function sourceReferenceCountSql(
  alias: "s" | "sources",
  ownerScoped = false,
): string {
  if (!["s", "sources"].includes(alias))
    throw new Error("Invalid Source SQL alias");
  // Cleanup conservatively protects even malformed cross-owner references.
  // Reuse may only be extended by the Source owner's own Jobs/Projects.
  return `(
    (SELECT COUNT(*) FROM jobs retained_job
     WHERE retained_job.source_id=${alias}.id
       AND retained_job.status NOT IN ('deleted','expired')
       ${ownerScoped ? `AND retained_job.user_id=${alias}.owner_user_id` : ""}) +
    ${projectSourceReferenceCountSql(alias, ownerScoped)}
    + (SELECT COUNT(DISTINCT df.job_id) FROM job_draft_input_files df
      JOIN jobs pinned_job ON pinned_job.id=df.job_id
      WHERE df.source_id=${alias}.id
      AND (pinned_job.status IN ('queued','validating','running') OR pinned_job.lease_owner IS NOT NULL)
      ${ownerScoped ? `AND pinned_job.user_id=${alias}.owner_user_id` : ""})
  )`;
}

export function projectSourceReferenceCountSql(
  alias: "s" | "sources",
  ownerScoped = false,
): string {
  if (!["s", "sources"].includes(alias))
    throw new Error("Invalid Source SQL alias");
  return `(
    (SELECT COUNT(*) FROM project_revisions retained_revision
     JOIN projects retained_project ON retained_project.id=retained_revision.project_id
     WHERE retained_revision.source_id=${alias}.id AND retained_project.deleted_at IS NULL
       ${ownerScoped ? `AND retained_project.owner_user_id=${alias}.owner_user_id` : ""}) +
    (SELECT COUNT(DISTINCT draft_file.project_id) FROM project_draft_files draft_file
     JOIN projects draft_project ON draft_project.id=draft_file.project_id
     WHERE draft_file.source_id=${alias}.id AND draft_project.deleted_at IS NULL
       ${ownerScoped ? `AND draft_project.owner_user_id=${alias}.owner_user_id` : ""})
  )`;
}

/** One timestamp parameter; neither references nor expiry revive a non-ready row. */
export function readySourceSql(alias: "s" | "sources"): string {
  return `${alias}.status='ready' AND
    (${alias}.expires_at>? OR ${sourceReferenceCountSql(alias, true)}>0)`;
}

/** A completed Source request is remembered for 24h, not its orphan deadline. */
export function sourceRequestExpiresAt(timestamp: string): string {
  return new Date(Date.parse(timestamp) + 86_400_000).toISOString();
}
