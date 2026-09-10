import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export interface ArtifactRow {
  id: string;
  job_id: string;
  type: string;
  relative_path: string;
  size: number;
  sha256: string;
  created_at: string;
  storage_generation?: number | null;
}

/** Resolve the immutable generation selected by the artifact's DB transaction.
 * Null denotes the legacy output tree; never guess a generation from the disk. */
export function artifactStoragePath(
  root: string,
  row: Pick<ArtifactRow, "job_id" | "relative_path" | "storage_generation">,
): string {
  if (
    !/^job_[a-f0-9]{32}$/.test(row.job_id) ||
    row.relative_path.includes("\\") ||
    row.relative_path.includes("\0") ||
    row.relative_path
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid stored artifact path");
  const generation = row.storage_generation;
  if (generation == null)
    return join(root, "jobs", row.job_id, "output", row.relative_path);
  if (!Number.isSafeInteger(generation) || generation <= 0)
    throw new Error("Invalid artifact generation");
  return join(
    root,
    "jobs",
    row.job_id,
    "outputs",
    String(generation),
    row.relative_path,
  );
}

export class ArtifactsRepository {
  constructor(private readonly db: DatabaseSync) {}

  listDownloadable(jobId: string): ArtifactRow[] {
    return this.db
      .prepare(
        `SELECT a.id,a.job_id,a.type,a.relative_path,a.size,a.sha256,a.created_at,a.storage_generation FROM artifacts a
      JOIN jobs j ON j.id=a.job_id WHERE a.job_id=? AND j.status NOT IN ('deleting','deleted') ORDER BY a.relative_path`,
      )
      .all(jobId) as unknown as ArtifactRow[];
  }

  getDownloadable(
    jobId: string,
    relativePath: string,
  ): ArtifactRow | undefined {
    return this.db
      .prepare(
        `SELECT a.id,a.job_id,a.type,a.relative_path,a.size,a.sha256,a.created_at,a.storage_generation FROM artifacts a
      JOIN jobs j ON j.id=a.job_id WHERE a.job_id=? AND a.relative_path=? AND j.status NOT IN ('deleting','deleted')`,
      )
      .get(jobId, relativePath) as unknown as ArtifactRow | undefined;
  }

  createLease(input: {
    id: string;
    jobId: string;
    artifactId: string;
    expiresAt: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO artifact_download_leases(id,job_id,artifact_id,expires_at,created_at) VALUES (?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.jobId,
        input.artifactId,
        input.expiresAt,
        input.createdAt,
      );
  }

  deleteLease(id: string): void {
    this.db.prepare("DELETE FROM artifact_download_leases WHERE id=?").run(id);
  }

  insert(input: ArtifactRow): void {
    this.db
      .prepare(
        `INSERT INTO artifacts(id,job_id,type,relative_path,size,sha256,created_at,storage_generation) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.job_id,
        input.type,
        input.relative_path,
        input.size,
        input.sha256,
        input.created_at,
        input.storage_generation ?? null,
      );
  }
}
