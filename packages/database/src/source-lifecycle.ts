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
    (SELECT COUNT(*) FROM project_revisions retained_revision
     JOIN projects retained_project ON retained_project.id=retained_revision.project_id
     WHERE retained_revision.source_id=${alias}.id AND retained_project.deleted_at IS NULL
       ${ownerScoped ? `AND retained_project.owner_user_id=${alias}.owner_user_id` : ""})
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
