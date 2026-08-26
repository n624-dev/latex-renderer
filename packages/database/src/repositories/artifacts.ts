import type { DatabaseSync } from "node:sqlite";

export interface ArtifactRow { id:string; job_id:string; type:string; relative_path:string; size:number; sha256:string; created_at:string }

export class ArtifactsRepository {
  constructor(private readonly db: DatabaseSync) {}

  listDownloadable(jobId: string): ArtifactRow[] {
    return this.db.prepare(`SELECT a.id,a.job_id,a.type,a.relative_path,a.size,a.sha256,a.created_at FROM artifacts a
      JOIN jobs j ON j.id=a.job_id WHERE a.job_id=? AND j.status NOT IN ('deleting','deleted') ORDER BY a.relative_path`)
      .all(jobId) as unknown as ArtifactRow[];
  }

  getDownloadable(jobId: string, relativePath: string): ArtifactRow | undefined {
    return this.db.prepare(`SELECT a.id,a.job_id,a.type,a.relative_path,a.size,a.sha256,a.created_at FROM artifacts a
      JOIN jobs j ON j.id=a.job_id WHERE a.job_id=? AND a.relative_path=? AND j.status NOT IN ('deleting','deleted')`)
      .get(jobId,relativePath) as unknown as ArtifactRow | undefined;
  }

  createLease(input: {id:string;jobId:string;artifactId:string;expiresAt:string;createdAt:string}): void {
    this.db.prepare(`INSERT INTO artifact_download_leases(id,job_id,artifact_id,expires_at,created_at) VALUES (?,?,?,?,?)`)
      .run(input.id,input.jobId,input.artifactId,input.expiresAt,input.createdAt);
  }

  deleteLease(id: string): void {
    this.db.prepare("DELETE FROM artifact_download_leases WHERE id=?").run(id);
  }

  insert(input: ArtifactRow): void {
    this.db.prepare(`INSERT INTO artifacts(id,job_id,type,relative_path,size,sha256,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(input.id,input.job_id,input.type,input.relative_path,input.size,input.sha256,input.created_at);
  }
}
