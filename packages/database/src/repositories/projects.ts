import type { DatabaseSync } from "node:sqlite";
import type { RenderOutput } from "@latex-renderer/contracts";
import {
  AppError,
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

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
  outputs_json: string;
  created_at: string;
}

export interface ProjectSummaryRow extends ProjectRow {
  revision_count: number;
  latest_revision_id: string | null;
  latest_revision_number: number | null;
  latest_revision_display_name: string | null;
  latest_revision_original_filename: string | null;
  latest_revision_entrypoint: string | null;
  latest_revision_created_at: string | null;
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

  /** Return a stable, keyset-paginated project summary page. */
  listOwnedPage(
    ownerUserId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<ProjectSummaryRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["updatedAt", "id"]),
      condition = cursor
        ? " AND (p.updated_at < ? OR (p.updated_at = ? AND p.id < ?))"
        : "",
      params: Array<string | number> = cursor
        ? [
            ownerUserId,
            cursor.updatedAt,
            cursor.updatedAt,
            cursor.id,
            limit + 1,
          ]
        : [ownerUserId, limit + 1],
      rows = this.db
        .prepare(
          `SELECT p.id,p.owner_user_id,p.display_name,p.created_at,p.updated_at,p.deleted_at,
             COUNT(r.id) AS revision_count,
             (SELECT r2.id FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_id,
             (SELECT r2.revision_number FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_number,
             (SELECT r2.display_name FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_display_name,
             (SELECT r2.original_filename FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_original_filename,
             (SELECT r2.entrypoint FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_entrypoint,
             (SELECT r2.created_at FROM project_revisions r2 WHERE r2.project_id=p.id
               ORDER BY r2.revision_number DESC,r2.id DESC LIMIT 1) AS latest_revision_created_at
           FROM projects p LEFT JOIN project_revisions r ON r.project_id=p.id
           WHERE p.owner_user_id=? AND p.deleted_at IS NULL${condition}
           GROUP BY p.id
           ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`,
        )
        .all(...params) as unknown as ProjectSummaryRow[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({ updatedAt: last.updated_at, id: last.id })
          : null,
    };
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

  revisionsPage(
    projectId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<ProjectRevisionRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["revisionNumber", "id"]),
      revisionNumber =
        cursor === undefined
          ? undefined
          : (() => {
              if (!/^\d+$/.test(cursor.revisionNumber))
                throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
              const parsed = Number(cursor.revisionNumber);
              if (!Number.isSafeInteger(parsed) || parsed < 1)
                throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
              return parsed;
            })(),
      condition = cursor
        ? " AND (revision_number < ? OR (revision_number = ? AND id < ?))"
        : "",
      params: Array<string | number> = cursor
        ? [
            projectId,
            revisionNumber as number,
            revisionNumber as number,
            cursor.id,
            limit + 1,
          ]
        : [projectId, limit + 1],
      rows = this.db
        .prepare(
          `SELECT * FROM project_revisions WHERE project_id=?${condition}
           ORDER BY revision_number DESC,id DESC LIMIT ?`,
        )
        .all(...params) as unknown as ProjectRevisionRow[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodePageCursor({
              revisionNumber: String(last.revision_number),
              id: last.id,
            })
          : null,
    };
  }

  revisionCount(projectId: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM project_revisions WHERE project_id=?",
        )
        .get(projectId) as { count: number }
    ).count;
  }

  latestRevision(projectId: string): ProjectRevisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM project_revisions WHERE project_id=?
         ORDER BY revision_number DESC,id DESC LIMIT 1`,
      )
      .get(projectId) as unknown as ProjectRevisionRow | undefined;
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
    outputs?: readonly RenderOutput[];
    timestamp: string;
  }): ProjectRevisionRow {
    const outputs = input.outputs ?? ["pdf"];
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
        (id,project_id,source_id,revision_number,display_name,original_filename,entrypoint,outputs_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.sourceId,
        revisionNumber,
        input.displayName,
        input.originalFilename,
        input.entrypoint,
        JSON.stringify(outputs),
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
      outputs_json: JSON.stringify(outputs),
      created_at: input.timestamp,
    };
  }

  renderOutputs(
    revision: Pick<ProjectRevisionRow, "outputs_json">,
  ): RenderOutput[] {
    let value: unknown;
    try {
      value = JSON.parse(revision.outputs_json);
    } catch {
      throw new AppError(
        "PROJECT_REVISION_OUTPUTS_INVALID",
        "Project revision output settings are invalid",
        500,
      );
    }
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 2 ||
      value.some((item) => item !== "pdf" && item !== "svg") ||
      new Set(value).size !== value.length ||
      !value.includes("pdf")
    )
      throw new AppError(
        "PROJECT_REVISION_OUTPUTS_INVALID",
        "Project revision output settings are invalid",
        500,
      );
    return value as RenderOutput[];
  }

  touch(id: string, timestamp: string): void {
    this.db
      .prepare("UPDATE projects SET updated_at=? WHERE id=?")
      .run(timestamp, id);
  }
}
