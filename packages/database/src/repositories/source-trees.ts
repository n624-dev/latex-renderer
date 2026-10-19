import type { DatabaseSync } from "node:sqlite";
import { JobsRepository } from "./jobs.js";

export interface SourceTreeRow {
  id: string;
  identity: string;
  source_id: string;
  owner_user_id: string;
  status: "building" | "ready" | "invalid" | "deleting";
  reserved_bytes: number;
  manifest_json: string;
  created_at: string;
  expires_at: string;
  last_used_at: string;
}
export interface SourceTreeReader {
  tree_id: string;
  job_id: string;
  generation: number;
}
/** Short transactions only. Filesystem work and daemon checks belong outside. */
export class SourceTreesRepository {
  constructor(private readonly db: DatabaseSync) {}
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  acquire(
    identity: string,
    owner: string,
    job: string,
    generation: number,
    now: string,
  ): SourceTreeRow | undefined {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT * FROM source_trees WHERE identity=? AND owner_user_id=? AND status='ready' AND expires_at>?",
        )
        .get(identity, owner, now) as unknown as SourceTreeRow | undefined;
      if (!row || !this.ownedJob(row, job, generation)) return;
      this.db
        .prepare("INSERT OR IGNORE INTO source_tree_readers VALUES (?,?,?)")
        .run(row.id, job, generation);
      this.db
        .prepare("UPDATE source_trees SET last_used_at=? WHERE id=?")
        .run(now, row.id);
      return row;
    });
  }
  reserve(
    row: SourceTreeRow,
    job: string,
    generation: number,
    globalBytes: number,
    userBytes: number,
    userStorageBytes: number,
  ): boolean {
    return this.transaction(() => {
      if (!this.ownedJob(row, job, generation)) return false;
      const usage = this.db
        .prepare(
          "SELECT COUNT(*) AS count,COALESCE(SUM(reserved_bytes),0) AS bytes,COALESCE(SUM(CASE WHEN owner_user_id=? THEN reserved_bytes ELSE 0 END),0) AS owned FROM source_trees",
        )
        .get(row.owner_user_id) as {
        count: number;
        bytes: number;
        owned: number;
      };
      if (
        usage.count >= 64 ||
        usage.bytes + row.reserved_bytes > globalBytes ||
        usage.owned + row.reserved_bytes > userBytes ||
        new JobsRepository(this.db).storageUsageForUser(row.owner_user_id) +
          row.reserved_bytes >
          userStorageBytes ||
        this.db
          .prepare("SELECT 1 FROM source_trees WHERE identity=?")
          .get(row.identity)
      )
        return false;
      this.db
        .prepare("INSERT INTO source_trees VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(
          row.id,
          row.identity,
          row.source_id,
          row.owner_user_id,
          row.status,
          row.reserved_bytes,
          row.manifest_json,
          row.created_at,
          row.expires_at,
          row.last_used_at,
        );
      this.db
        .prepare("INSERT INTO source_tree_readers VALUES (?,?,?)")
        .run(row.id, job, generation);
      return true;
    });
  }
  publish(id: string): void {
    this.db
      .prepare(
        "UPDATE source_trees SET status='ready' WHERE id=? AND status='building'",
      )
      .run(id);
  }
  invalidate(id: string): void {
    this.db
      .prepare(
        "UPDATE source_trees SET status='invalid' WHERE id=? AND status!='deleting'",
      )
      .run(id);
  }
  release(pin: SourceTreeReader): void {
    this.db
      .prepare(
        "DELETE FROM source_tree_readers WHERE tree_id=? AND job_id=? AND generation=?",
      )
      .run(pin.tree_id, pin.job_id, pin.generation);
  }
  readers(): SourceTreeReader[] {
    return this.db
      .prepare("SELECT * FROM source_tree_readers ORDER BY tree_id LIMIT 128")
      .all() as unknown as SourceTreeReader[];
  }
  private ownedJob(
    row: SourceTreeRow,
    job: string,
    generation: number,
  ): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM jobs j JOIN sources s ON s.id=j.source_id
      WHERE j.id=? AND j.lease_generation=? AND j.lease_owner IS NOT NULL AND j.status IN ('validating','running')
      AND j.source_id=? AND j.user_id=? AND s.owner_user_id=j.user_id AND s.status='ready'
      AND s.sha256=j.source_sha256 AND s.size=j.source_size`,
        )
        .get(job, generation, row.source_id, row.owner_user_id) !== undefined
    );
  }
}
