import type { DatabaseSync } from "node:sqlite";

export interface ProjectRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectRevisionRow {
  id: string;
  project_id: string;
  source_id: string;
  revision_number: number;
  display_name: string;
  original_filename: string;
  entrypoint: string;
  created_at: string;
}

export class ProjectsRepository {
  constructor(private readonly db: DatabaseSync) {}

  listOwned(ownerUserId: string, limit = 200): ProjectRow[] {
    return this.db
      .prepare(
        `SELECT * FROM projects WHERE owner_user_id=? AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(ownerUserId, limit) as unknown as ProjectRow[];
  }

  getOwned(id: string, ownerUserId: string): ProjectRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM projects WHERE id=? AND owner_user_id=? AND deleted_at IS NULL",
      )
      .get(id, ownerUserId) as unknown as ProjectRow | undefined;
  }

  insert(input: {
    id: string;
    ownerUserId: string;
    displayName: string;
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO projects(id,owner_user_id,display_name,created_at,updated_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.ownerUserId,
        input.displayName,
        input.timestamp,
        input.timestamp,
      );
  }

  rename(
    id: string,
    ownerUserId: string,
    displayName: string,
    timestamp: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE projects SET display_name=?,updated_at=?
           WHERE id=? AND owner_user_id=? AND deleted_at IS NULL`,
        )
        .run(displayName, timestamp, id, ownerUserId).changes,
    );
  }

  softDelete(id: string, ownerUserId: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE projects SET deleted_at=?,updated_at=?
           WHERE id=? AND owner_user_id=? AND deleted_at IS NULL`,
        )
        .run(timestamp, timestamp, id, ownerUserId).changes,
    );
  }

  revisions(projectId: string): ProjectRevisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM project_revisions WHERE project_id=?
         ORDER BY revision_number DESC`,
      )
      .all(projectId) as unknown as ProjectRevisionRow[];
  }

  revisionOwned(
    revisionId: string,
    ownerUserId: string,
  ): ProjectRevisionRow | undefined {
    return this.db
      .prepare(
        `SELECT r.* FROM project_revisions r
         JOIN projects p ON p.id=r.project_id
         WHERE r.id=? AND p.owner_user_id=? AND p.deleted_at IS NULL`,
      )
      .get(revisionId, ownerUserId) as unknown as
      ProjectRevisionRow | undefined;
  }

  revisionForSource(
    projectId: string,
    sourceId: string,
    entrypoint: string,
  ): ProjectRevisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM project_revisions
         WHERE project_id=? AND source_id=? AND entrypoint=?`,
      )
      .get(projectId, sourceId, entrypoint) as unknown as
      ProjectRevisionRow | undefined;
  }

  insertRevision(input: {
    id: string;
    projectId: string;
    sourceId: string;
    displayName: string;
    originalFilename: string;
    entrypoint: string;
    timestamp: string;
  }): ProjectRevisionRow {
    const revisionNumber = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(revision_number),0)+1 AS value FROM project_revisions WHERE project_id=?",
        )
        .get(input.projectId) as { value: number }
    ).value;
    this.db
      .prepare(
        `INSERT INTO project_revisions
        (id,project_id,source_id,revision_number,display_name,original_filename,entrypoint,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.sourceId,
        revisionNumber,
        input.displayName,
        input.originalFilename,
        input.entrypoint,
        input.timestamp,
      );
    return {
      id: input.id,
      project_id: input.projectId,
      source_id: input.sourceId,
      revision_number: revisionNumber,
      display_name: input.displayName,
      original_filename: input.originalFilename,
      entrypoint: input.entrypoint,
      created_at: input.timestamp,
    };
  }

  touch(id: string, timestamp: string): void {
    this.db
      .prepare("UPDATE projects SET updated_at=? WHERE id=?")
      .run(timestamp, id);
  }
}
