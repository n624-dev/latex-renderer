import type { DatabaseSync } from "node:sqlite";
import {
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

export interface UserRow {
  id: string;
  access_subject: string | null;
  access_subject_linked_at: string | null;
  access_subject_generation: number;
  email: string | null;
  display_name: string;
  role: "owner" | "admin" | "user";
  status: "active" | "disabled";
  security_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export class UsersRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 500): UserRow[] {
    return this.db
      .prepare(
        `SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as UserRow[];
  }

  listPage(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
    } = {},
  ): Page<UserRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      conditions: string[] = [],
      params: Array<string | number> = [],
      query = options.query?.trim().toLowerCase();
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(id),?)>0 OR instr(lower(COALESCE(email,'')),?)>0 OR instr(lower(display_name),?)>0 OR instr(lower(COALESCE(access_subject,'')),?)>0)",
      );
      params.push(query, query, query, query);
    }
    if (cursor !== undefined) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const rows = this.db
      .prepare(
        `SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
         FROM users${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params) as unknown as UserRow[];
    const filterParams = params.slice(
        0,
        params.length - 1 - (cursor === undefined ? 0 : 3),
      ),
      total = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM users${conditions.filter((condition) => !condition.startsWith("(created_at <")).length ? ` WHERE ${conditions.filter((condition) => !condition.startsWith("(created_at <")).join(" AND ")}` : ""}`,
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

  get(id: string): UserRow | undefined {
    return this.db
      .prepare(
        `SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users WHERE id=?`,
      )
      .get(id) as unknown as UserRow | undefined;
  }

  activeExists(id: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM users WHERE id=? AND status='active'")
        .get(id) !== undefined
    );
  }

  countActiveOwners(): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role='owner' AND status='active'",
        )
        .get() as { count: number }
    ).count;
  }

  insertInvitation(input: {
    id: string;
    email?: string | null | undefined;
    displayName: string;
    role: UserRow["role"];
    createdBy: string;
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO users(id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES (?,NULL,NULL,0,?,?,?,'active',1,?,?,?)`,
      )
      .run(
        input.id,
        input.email ?? null,
        input.displayName,
        input.role,
        input.createdBy,
        input.timestamp,
        input.timestamp,
      );
  }

  touchLogin(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE users SET last_login_at=?,updated_at=? WHERE id=? AND status='active'",
        )
        .run(timestamp, timestamp, id).changes,
    );
  }

  incrementSecurityVersion(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE users SET security_version=security_version+1,updated_at=? WHERE id=?",
        )
        .run(timestamp, id).changes,
    );
  }

  setStatus(id: string, status: UserRow["status"], timestamp: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE users SET status=?,security_version=security_version+1,updated_at=? WHERE id=?",
        )
        .run(status, timestamp, id).changes,
    );
  }

  update(
    id: string,
    input: {
      email?: string | null | undefined;
      displayName?: string | undefined;
      role?: UserRow["role"] | undefined;
    },
    timestamp: string,
  ): number {
    return Number(
      this.db
        .prepare(
          "UPDATE users SET email=CASE WHEN ?=1 THEN ? ELSE email END,display_name=COALESCE(?,display_name),role=COALESCE(?,role),security_version=security_version+1,updated_at=? WHERE id=?",
        )
        .run(
          input.email !== undefined ? 1 : 0,
          input.email ?? null,
          input.displayName ?? null,
          input.role ?? null,
          timestamp,
          id,
        ).changes,
    );
  }
}
