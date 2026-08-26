import type { DatabaseSync } from "node:sqlite";

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

  list(limit = 500): SourceRow[] {
    return this.db
      .prepare(
        `SELECT * FROM sources WHERE status!='deleted'
      ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as SourceRow[];
  }

  markDeleting(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE sources SET status='deleting',updated_at=? WHERE id=? AND status IN ('ready','expired')
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

  storageUsageForUser(ownerUserId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(size),0) AS bytes FROM sources
      WHERE owner_user_id=? AND status NOT IN ('deleted','expired')`,
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
