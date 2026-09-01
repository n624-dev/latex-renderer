import type { DatabaseSync } from "node:sqlite";
import {
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

export interface ServiceAccountRow {
  id: string;
  owner_user_id: string;
  name: string;
  client_type: "codex" | "claude-code" | "mcp" | "ci" | "generic";
  status: "active" | "disabled";
  security_version: number;
  created_at: string;
  updated_at: string;
}

export class ServiceAccountsRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 500): ServiceAccountRow[] {
    return this.db
      .prepare(
        `SELECT id,owner_user_id,name,client_type,status,security_version,created_at,updated_at
      FROM service_accounts ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as ServiceAccountRow[];
  }

  listPage(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
    } = {},
  ): Page<ServiceAccountRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      conditions: string[] = [],
      params: Array<string | number> = [],
      query = options.query?.trim().toLowerCase();
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(id),?)>0 OR instr(lower(name),?)>0 OR instr(lower(owner_user_id),?)>0 OR instr(lower(client_type),?)>0)",
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
        `SELECT id,owner_user_id,name,client_type,status,security_version,created_at,updated_at
         FROM service_accounts${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params) as unknown as ServiceAccountRow[];
    const filterConditions = conditions.filter(
        (condition) => !condition.startsWith("(created_at <"),
      ),
      filterParams = params.slice(
        0,
        params.length - 1 - (cursor === undefined ? 0 : 3),
      ),
      total = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM service_accounts${filterConditions.length ? ` WHERE ${filterConditions.join(" AND ")}` : ""}`,
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

  get(id: string): ServiceAccountRow | undefined {
    return this.db
      .prepare(
        `SELECT id,owner_user_id,name,client_type,status,security_version,created_at,updated_at
      FROM service_accounts WHERE id=?`,
      )
      .get(id) as unknown as ServiceAccountRow | undefined;
  }

  activeExists(id: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM service_accounts WHERE id=? AND status='active'",
        )
        .get(id) !== undefined
    );
  }

  countActiveForOwner(ownerUserId: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM service_accounts WHERE owner_user_id=? AND status='active'",
        )
        .get(ownerUserId) as { count: number }
    ).count;
  }

  insert(input: {
    id: string;
    ownerUserId: string;
    name: string;
    clientType: ServiceAccountRow["client_type"];
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
      VALUES (?,?,?,?,'active',1,?,?)`,
      )
      .run(
        input.id,
        input.ownerUserId,
        input.name,
        input.clientType,
        input.timestamp,
        input.timestamp,
      );
  }

  setStatus(
    id: string,
    status: ServiceAccountRow["status"],
    timestamp: string,
  ): number {
    return Number(
      this.db
        .prepare(
          "UPDATE service_accounts SET status=?,security_version=security_version+1,updated_at=? WHERE id=?",
        )
        .run(status, timestamp, id).changes,
    );
  }

  update(
    id: string,
    input: {
      name?: string | undefined;
      clientType?: ServiceAccountRow["client_type"] | undefined;
    },
    timestamp: string,
  ): number {
    return Number(
      this.db
        .prepare(
          "UPDATE service_accounts SET name=COALESCE(?,name),client_type=COALESCE(?,client_type),security_version=security_version+1,updated_at=? WHERE id=?",
        )
        .run(input.name ?? null, input.clientType ?? null, timestamp, id)
        .changes,
    );
  }
}
