import type { DatabaseSync } from "node:sqlite";
import {
  AppError,
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

export type SourceStatus =
  "reserved" | "uploading" | "ready" | "deleting" | "deleted" | "expired";

export interface SourceRow {
  id: string;
  owner_user_id: string;
  size: number;
  sha256: string;
  storage_key: string;
  status: SourceStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  uploaded_at: string | null;
  paths_json: string | null;
  dedupe_eligible: number;
  deleted_at: string | null;
  upload_received_bytes: number;
  upload_lease_owner: string | null;
  upload_lease_expires_at: string | null;
  deletion_status:
    "retained" | "pending" | "deleting" | "retry" | "failed" | "deleted";
  deletion_attempts: number;
  deletion_error: string | null;
  deletion_next_attempt_at: string | null;
}

export interface SourceListRow extends SourceRow {
  job_count: number;
  blocking_reference_count: number;
  latest_job_id: string | null;
  latest_job_status: string | null;
  latest_job_created_at: string | null;
}

export class SourcesRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): SourceRow | undefined {
    return this.db
      .prepare("SELECT * FROM sources WHERE id=?")
      .get(id) as unknown as SourceRow | undefined;
  }

  getOwned(id: string, ownerUserId: string): SourceRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM sources WHERE id=? AND owner_user_id=? AND status NOT IN ('deleted','expired')",
      )
      .get(id, ownerUserId) as unknown as SourceRow | undefined;
  }

  getOwnedReady(
    id: string,
    ownerUserId: string,
    timestamp: string,
  ): SourceRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM sources WHERE id=? AND owner_user_id=? AND status='ready' AND expires_at>?",
      )
      .get(id, ownerUserId, timestamp) as unknown as SourceRow | undefined;
  }

  getReady(id: string, timestamp: string): SourceRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM sources WHERE id=? AND status='ready' AND expires_at>?",
      )
      .get(id, timestamp) as unknown as SourceRow | undefined;
  }

  list(limit = 500): SourceRow[] {
    return this.db
      .prepare(
        `SELECT * FROM sources WHERE status!='deleted'
      ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as SourceRow[];
  }

  /** Admin Source page; filters and related-job counts are evaluated in SQL. */
  listPage(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
      status?: string | undefined;
    } = {},
  ): Page<SourceListRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      query = options.query?.trim().toLowerCase(),
      conditions = ["s.status!='deleted'"],
      params: Array<string | number> = [];
    if (options.status !== undefined && options.status !== "") {
      conditions.push("s.status=?");
      params.push(options.status);
    }
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(s.id),?)>0 OR instr(lower(s.owner_user_id),?)>0 OR instr(lower(s.sha256),?)>0)",
      );
      params.push(query, query, query);
    }
    if (cursor !== undefined) {
      conditions.push("(s.created_at < ? OR (s.created_at = ? AND s.id < ?))");
      const { createdAt, id } = cursor;
      params.push(createdAt, createdAt, id);
    }
    params.push(limit + 1);
    const rows = this.db
      .prepare(
        `SELECT s.id,s.owner_user_id,s.size,s.sha256,s.storage_key,s.status,s.created_at,s.updated_at,
           s.expires_at,s.uploaded_at,s.paths_json,s.dedupe_eligible,s.deleted_at,
           s.upload_received_bytes,s.upload_lease_owner,s.upload_lease_expires_at,
           COUNT(j.id) AS job_count,
           COUNT(CASE WHEN j.status NOT IN ('deleted','expired') THEN j.id END)
             + (SELECT COUNT(*) FROM project_revisions r3 JOIN projects p3 ON p3.id=r3.project_id
                WHERE r3.source_id=s.id AND p3.deleted_at IS NULL) AS blocking_reference_count,
           (SELECT j2.id FROM jobs j2 WHERE j2.source_id=s.id AND j2.deleted_at IS NULL
             ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1) AS latest_job_id,
           (SELECT j2.status FROM jobs j2 WHERE j2.source_id=s.id AND j2.deleted_at IS NULL
             ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1) AS latest_job_status,
           (SELECT j2.created_at FROM jobs j2 WHERE j2.source_id=s.id AND j2.deleted_at IS NULL
             ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1) AS latest_job_created_at
         FROM sources s
         LEFT JOIN jobs j ON j.source_id=s.id AND j.deleted_at IS NULL
         WHERE ${conditions.join(" AND ")}
         GROUP BY s.id
         ORDER BY s.created_at DESC,s.id DESC LIMIT ?`,
      )
      .all(...params) as unknown as SourceListRow[];
    const filterConditions = conditions.filter(
        (condition) => !condition.startsWith("(s.created_at <"),
      ),
      filterParams = params.slice(
        0,
        params.length - 1 - (cursor === undefined ? 0 : 3),
      ),
      total = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM sources s${filterConditions.length ? ` WHERE ${filterConditions.join(" AND ")}` : ""}`,
          )
          .get(...filterParams) as { count: number }
      ).count;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ createdAt: last.created_at, id: last.id })
          : null,
      total,
    };
  }

  markDeleting(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET status='deleting',deletion_status='pending',deletion_attempts=0,
           deletion_error=NULL,deletion_next_attempt_at=NULL,updated_at=?
           WHERE id=? AND status IN ('ready','expired')
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))
        AND NOT EXISTS (
          SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
          WHERE r.source_id=? AND p.deleted_at IS NULL
        )`,
        )
        .run(timestamp, id, id, id).changes,
    );
  }

  findReady(
    ownerUserId: string,
    sha256: string,
    size: number,
    now: string,
  ): SourceRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM sources WHERE owner_user_id=? AND sha256=? AND size=?
      AND status='ready' AND expires_at>? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(ownerUserId, sha256, size, now) as unknown as SourceRow | undefined;
  }

  insertReserved(input: {
    id: string;
    ownerUserId: string;
    size: number;
    sha256: string;
    storageKey: string;
    timestamp: string;
    expiresAt: string;
    dedupeEligible?: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sources(id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at,dedupe_eligible)
      VALUES (?,?,?,?,?,'reserved',?,?,?,?)`,
      )
      .run(
        input.id,
        input.ownerUserId,
        input.size,
        input.sha256,
        input.storageKey,
        input.timestamp,
        input.timestamp,
        input.expiresAt,
        input.dedupeEligible === false ? 0 : 1,
      );
  }

  transition(
    id: string,
    from: readonly SourceStatus[],
    to: SourceStatus,
    timestamp: string,
    updates: Readonly<Record<string, string | null>> = {},
  ): void {
    const fields = [
      "status=?",
      "updated_at=?",
      ...Object.keys(updates).map((key) => `${key}=?`),
    ];
    const values = [to, timestamp, ...Object.values(updates), id, ...from];
    const result = this.db
      .prepare(
        `UPDATE sources SET ${fields.join(",")} WHERE id=? AND status IN (${from.map(() => "?").join(",")})`,
      )
      .run(...values);
    if (result.changes !== 1)
      throw new Error("Source state changed concurrently");
  }

  transitionBeforeExpiry(
    id: string,
    from: readonly SourceStatus[],
    to: SourceStatus,
    timestamp: string,
    updates: Readonly<Record<string, string | null>> = {},
  ): void {
    const fields = [
      "status=?",
      "updated_at=?",
      ...Object.keys(updates).map((key) => `${key}=?`),
    ];
    const values = [
      to,
      timestamp,
      ...Object.values(updates),
      id,
      ...from,
      timestamp,
    ];
    const result = this.db
      .prepare(
        `UPDATE sources SET ${fields.join(",")} WHERE id=?
         AND status IN (${from.map(() => "?").join(",")}) AND expires_at>?`,
      )
      .run(...values);
    if (result.changes !== 1)
      throw new AppError(
        "SOURCE_EXPIRED",
        "Source expired or changed state concurrently",
        409,
      );
  }

  discardReservation(id: string): number {
    return Number(
      this.db
        .prepare(
          `DELETE FROM sources WHERE id=? AND status IN ('reserved','uploading')
           AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=?)`,
        )
        .run(id, id).changes,
    );
  }

  /**
   * Claim the single-writer lease for a chunk upload.  The conditional UPDATE
   * is the inter-process lock: only one instance can own an unexpired lease,
   * while a crashed instance is replaceable after its short lease expires.
   */
  claimUploadLease(
    id: string,
    ownerUserId: string,
    leaseOwner: string,
    timestamp: string,
    leaseExpiresAt: string,
  ): SourceRow | undefined {
    const result = this.db
      .prepare(
        `UPDATE sources
         SET upload_lease_owner=?,upload_lease_expires_at=?
         WHERE id=? AND owner_user_id=? AND status='uploading'
           AND expires_at>?
           AND (upload_lease_owner IS NULL OR upload_lease_expires_at IS NULL
                OR upload_lease_expires_at<=? OR upload_lease_owner=?)`,
      )
      .run(
        leaseOwner,
        leaseExpiresAt,
        id,
        ownerUserId,
        timestamp,
        timestamp,
        leaseOwner,
      );
    if (Number(result.changes) !== 1) return undefined;
    // The UPDATE and SELECT cannot be one SQLite statement on every supported
    // deployment. Do not hand a caller a row reclaimed between them.
    const claimed = this.get(id);
    return claimed?.upload_lease_owner === leaseOwner &&
      claimed.upload_lease_expires_at === leaseExpiresAt
      ? claimed
      : undefined;
  }

  releaseUploadLease(id: string, leaseOwner: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET upload_lease_owner=NULL,upload_lease_expires_at=NULL
           WHERE id=? AND upload_lease_owner=?`,
        )
        .run(id, leaseOwner).changes,
    );
  }

  extendUploadLease(
    id: string,
    leaseOwner: string,
    timestamp: string,
    leaseExpiresAt: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET upload_lease_expires_at=?
           WHERE id=? AND status='uploading' AND upload_lease_owner=?
             AND upload_lease_expires_at>? AND expires_at>?`,
        )
        .run(leaseExpiresAt, id, leaseOwner, timestamp, timestamp).changes,
    );
  }

  /**
   * Commit a filesystem append only if the lease and expected offset still
   * match.  This CAS is the durable ordering point for the next chunk.
   */
  commitUploadOffset(
    id: string,
    leaseOwner: string,
    expectedOffset: number,
    nextOffset: number,
    timestamp: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET upload_received_bytes=?,updated_at=?
           WHERE id=? AND status='uploading' AND upload_lease_owner=?
             AND upload_lease_expires_at>? AND expires_at>?
             AND upload_received_bytes=? AND ?<=size`,
        )
        .run(
          nextOffset,
          timestamp,
          id,
          leaseOwner,
          timestamp,
          timestamp,
          expectedOffset,
          nextOffset,
        ).changes,
    );
  }

  /** Complete an upload only when the durable byte count is exact and lease is held. */
  completeUpload(
    id: string,
    leaseOwner: string,
    timestamp: string,
    expiresAt: string,
    pathsJson: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET status='ready',updated_at=?,uploaded_at=?,expires_at=?,
             paths_json=?,upload_received_bytes=size,
             upload_lease_owner=NULL,upload_lease_expires_at=NULL
           WHERE id=? AND status='uploading' AND upload_lease_owner=?
             AND upload_lease_expires_at>? AND upload_received_bytes=size
             AND expires_at>?`,
        )
        .run(
          timestamp,
          timestamp,
          expiresAt,
          pathsJson,
          id,
          leaseOwner,
          timestamp,
          timestamp,
        ).changes,
    );
  }

  referenceCount(id: string): number {
    return (
      this.db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM jobs WHERE source_id=? AND status!='deleted') +
            (SELECT COUNT(*) FROM project_revisions r JOIN projects p ON p.id=r.project_id
             WHERE r.source_id=? AND p.deleted_at IS NULL) AS count`,
        )
        .get(id, id) as { count: number }
    ).count;
  }

  /** References that prevent a ready/expired Source from being deleted. */
  blockingReferenceCount(id: string): number {
    return (
      this.db
        .prepare(
          `SELECT
              (SELECT COUNT(*) FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired')) +
              (SELECT COUNT(*) FROM project_revisions r JOIN projects p ON p.id=r.project_id
               WHERE r.source_id=? AND p.deleted_at IS NULL) AS count`,
        )
        .get(id, id) as { count: number }
    ).count;
  }

  storageUsageForUser(ownerUserId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(size),0) AS bytes FROM sources
      WHERE owner_user_id=? AND status!='deleted'`,
        )
        .get(ownerUserId) as { bytes: number }
    ).bytes;
  }

  paths(row: SourceRow): readonly string[] {
    if (row.paths_json === null) return [];
    const value = JSON.parse(row.paths_json) as unknown;
    return Array.isArray(value) &&
      value.every((item) => typeof item === "string")
      ? value
      : [];
  }
}
