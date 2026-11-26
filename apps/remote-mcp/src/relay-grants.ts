import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  isRendererMcpScope,
  type RendererMcpScope,
} from "@latex-renderer/contracts";

interface GrantRow {
  id: string;
  user_id: string;
  security_version: number;
  scopes_json: string;
  expires_at: number;
}

export class LocalRelayGrants {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(`CREATE TABLE IF NOT EXISTS local_relay_grants (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, security_version INTEGER NOT NULL,
        scopes_json TEXT NOT NULL, expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS local_relay_grants_owner ON local_relay_grants(user_id, expires_at);`);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }

  create(
    userId: string,
    securityVersion: number,
    scopes: readonly RendererMcpScope[],
    now: number,
  ): string {
    const id = `relay_grant_${randomUUID().replaceAll("-", "")}`;
    this.#db
      .prepare("DELETE FROM local_relay_grants WHERE expires_at <= ?")
      .run(now);
    this.#db
      .prepare("INSERT INTO local_relay_grants VALUES (?, ?, ?, ?, ?)")
      .run(
        id,
        userId,
        securityVersion,
        JSON.stringify([...new Set(scopes)]),
        now + 30 * 86_400_000,
      );
    return id;
  }

  lookup(id: string, now: number) {
    const row = this.#db
      .prepare(
        "SELECT * FROM local_relay_grants WHERE id = ? AND expires_at > ?",
      )
      .get(id, now) as unknown as GrantRow | undefined;
    return row && decode(row);
  }

  list(userId: string, now: number) {
    const rows = this.#db
      .prepare(
        "SELECT * FROM local_relay_grants WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC, id",
      )
      .all(userId, now) as unknown as GrantRow[];
    return rows.map(decode);
  }

  revoke(id: string, userId?: string): boolean {
    return (
      this.#db
        .prepare(
          "DELETE FROM local_relay_grants WHERE id = ? AND (? IS NULL OR user_id = ?)",
        )
        .run(id, userId ?? null, userId ?? null).changes === 1
    );
  }
}

function decode(row: GrantRow) {
  const scopes: unknown = JSON.parse(row.scopes_json);
  if (
    !Array.isArray(scopes) ||
    !scopes.every(
      (value): value is RendererMcpScope =>
        typeof value === "string" && isRendererMcpScope(value),
    )
  )
    throw new Error("Invalid local relay grant");
  return {
    id: row.id,
    userId: row.user_id,
    securityVersion: row.security_version,
    scopes,
    expiresAt: row.expires_at,
  };
}
