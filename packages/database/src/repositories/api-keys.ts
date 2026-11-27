import type { DatabaseSync } from "node:sqlite";
import { separateFromInternalPrincipals, userServiceAccountSql } from "../user-visible.js";
import { jobCredentialId, sameJobCredential } from "../job-credentials.js";
import {
  decodePageCursor,
  encodePageCursor,
  type Page,
} from "@latex-renderer/shared";

const external = separateFromInternalPrincipals("id", "api_key_id");

export interface ApiKeyRow {
  id: string;
  service_account_id: string;
  name: string;
  prefix: string;
  kind: "render" | "admin";
  scopes_json: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string;
}

export interface RenderIdentityRow {
  api_key_id: string;
  api_key_name: string;
  service_account_id: string;
  service_account_name: string;
  service_account_security_version: number;
  user_id: string;
  user_email: string | null;
  user_display_name: string;
  user_security_version: number;
}

export class ApiKeysRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(limit = 1000): ApiKeyRow[] {
    return this.db
      .prepare(
        `SELECT id,service_account_id,name,prefix,kind,scopes_json,expires_at,last_used_at,revoked_at,created_at,created_by
      FROM api_keys WHERE ${userServiceAccountSql("service_account_id")} AND ${external} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as ApiKeyRow[];
  }

  listPage(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
    } = {},
  ): Page<ApiKeyRow> {
    const limit = options.limit ?? 50,
      cursor = decodePageCursor(options.cursor, ["createdAt", "id"]),
      conditions: string[] = [userServiceAccountSql("service_account_id"), external],
      params: Array<string | number> = [],
      query = options.query?.trim().toLowerCase();
    if (query !== undefined && query !== "") {
      conditions.push(
        "(instr(lower(id),?)>0 OR instr(lower(name),?)>0 OR instr(lower(prefix),?)>0 OR instr(lower(service_account_id),?)>0)",
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
        `SELECT id,service_account_id,name,prefix,kind,scopes_json,expires_at,last_used_at,revoked_at,created_at,created_by
         FROM api_keys${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params) as unknown as ApiKeyRow[];
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
            `SELECT COUNT(*) AS count FROM api_keys${filterConditions.length ? ` WHERE ${filterConditions.join(" AND ")}` : ""}`,
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

  get(id: string): ApiKeyRow | undefined {
    return this.db
      .prepare(
        `SELECT id,service_account_id,name,prefix,kind,scopes_json,expires_at,last_used_at,revoked_at,created_at,created_by
      FROM api_keys WHERE id=? AND ${userServiceAccountSql("service_account_id")} AND ${external}`,
      )
      .get(id) as unknown as ApiKeyRow | undefined;
  }

  listRenderIdentities(now: string): RenderIdentityRow[] {
    const rows = this.db
      .prepare(
        `SELECT k.id AS api_key_id,k.name AS api_key_name,k.scopes_json,
      s.id AS service_account_id,s.name AS service_account_name,s.security_version AS service_account_security_version,
      u.id AS user_id,u.email AS user_email,u.display_name AS user_display_name,
      u.security_version AS user_security_version
      FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id
      JOIN users u ON u.id=s.owner_user_id
      WHERE k.kind='render' AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>?)
        AND s.status='active' AND s.purpose='user' AND u.status='active'
      ORDER BY s.name,k.name,k.id`,
      )
      .all(now) as unknown as Array<
      RenderIdentityRow & { scopes_json: string }
    >;
    return rows
      .filter((row) => {
        try {
          const scopes = JSON.parse(row.scopes_json) as unknown;
          return (
            Array.isArray(scopes) &&
            scopes.every((scope) => typeof scope === "string") &&
            scopes.includes("render:create")
          );
        } catch {
          return false;
        }
      })
      .map((row) => ({
        api_key_id: row.api_key_id,
        api_key_name: row.api_key_name,
        service_account_id: row.service_account_id,
        service_account_name: row.service_account_name,
        service_account_security_version: row.service_account_security_version,
        user_id: row.user_id,
        user_email: row.user_email,
        user_display_name: row.user_display_name,
        user_security_version: row.user_security_version,
      }));
  }

  renderIdentity(id: string, now: string): RenderIdentityRow | undefined {
    const row = this.db
      .prepare(
        `SELECT k.id AS api_key_id,k.name AS api_key_name,k.scopes_json,
        s.id AS service_account_id,s.name AS service_account_name,s.security_version AS service_account_security_version,
        u.id AS user_id,u.email AS user_email,u.display_name AS user_display_name,
        u.security_version AS user_security_version
        FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id
        JOIN users u ON u.id=s.owner_user_id
        WHERE k.id=? AND k.kind='render' AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>?)
          AND s.status='active' AND s.purpose='user' AND u.status='active' LIMIT 1`,
      )
      .get(id, now) as unknown as
      (RenderIdentityRow & { scopes_json: string }) | undefined;
    if (row === undefined) return undefined;
    const { scopes_json, ...identity } = row;
    try {
      const scopes = JSON.parse(scopes_json) as unknown;
      if (
        !Array.isArray(scopes) ||
        !scopes.every((scope) => typeof scope === "string") ||
        !scopes.includes("render:create")
      )
        return undefined;
    } catch {
      return undefined;
    }
    return identity;
  }

  activeIdentity(id: string, now: string): RenderIdentityRow | undefined {
    return this.findActiveIdentity(id, now, false);
  }

  activeJobIdentity(id: string, now: string): RenderIdentityRow | undefined {
    return this.findActiveIdentity(id, now, true);
  }

  renderJobIdentity(id: string, now: string): RenderIdentityRow | undefined {
    const active = this.activeJobIdentity(id, now);
    return active && this.renderIdentity(active.api_key_id, now);
  }

  private findActiveIdentity(id: string, now: string, followRotation: boolean): RenderIdentityRow | undefined {
    const credential = followRotation
      ? `EXISTS (SELECT 1 FROM api_keys owner WHERE owner.id=? AND ${sameJobCredential("owner", "k")})`
      : "k.id=?";
    return this.db
      .prepare(
        `SELECT k.id AS api_key_id,k.name AS api_key_name,
        s.id AS service_account_id,s.name AS service_account_name,
        s.security_version AS service_account_security_version,
        u.id AS user_id,u.email AS user_email,u.display_name AS user_display_name,
        u.security_version AS user_security_version
        FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id
        JOIN users u ON u.id=s.owner_user_id
        WHERE ${credential} AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>?)
          AND s.status='active' AND s.purpose='user' AND u.status='active'`,
      )
      .get(id, now) as unknown as RenderIdentityRow | undefined;
  }

  jobOwnerId(id: string): string | undefined {
    return this.db.prepare(`SELECT ${jobCredentialId("k")} AS owner FROM api_keys k WHERE k.id=?`)
      .get(id)?.owner as string | undefined;
  }

  matchesJobOwner(originalId: string, currentId: string): boolean {
    return this.db.prepare(`
      SELECT 1 FROM api_keys owner JOIN api_keys k ON ${sameJobCredential("owner", "k")}
      WHERE owner.id=? AND k.id=? AND k.revoked_at IS NULL
    `).get(originalId, currentId) !== undefined;
  }

  recordRotation(previous: string, successor: string): boolean {
    return this.db.prepare(`
      UPDATE api_keys AS k SET rotation_root_id=(
        SELECT ${jobCredentialId("owner")} FROM api_keys owner WHERE owner.id=?
      )
      WHERE k.id=? AND k.rotation_root_id IS NULL AND k.revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM api_keys owner WHERE owner.id=? AND owner.revoked_at IS NOT NULL
            AND owner.service_account_id=k.service_account_id AND owner.kind=k.kind
        )
    `).run(previous, successor, previous).changes === 1;
  }

  insert(input: {
    id: string;
    serviceAccountId: string;
    name: string;
    prefix: string;
    kind: "render" | "admin";
    secretHash: string;
    pepperId: string;
    scopes: readonly string[];
    expiresAt?: string | null | undefined;
    createdAt: string;
    createdBy: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO api_keys(id,service_account_id,name,prefix,kind,secret_hash,pepper_id,scopes_json,expires_at,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.serviceAccountId,
        input.name,
        input.prefix,
        input.kind,
        input.secretHash,
        input.pepperId,
        JSON.stringify(input.scopes),
        input.expiresAt ?? null,
        input.createdAt,
        input.createdBy,
      );
  }

  revoke(id: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND ${external}`,
        )
        .run(timestamp, id).changes,
    );
  }

  revokeForServiceAccount(serviceAccountId: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE service_account_id=? AND ${external}`,
        )
        .run(timestamp, serviceAccountId).changes,
    );
  }

  revokeAll(timestamp: string): number {
    return Number(
      this.db
        .prepare(`UPDATE api_keys SET revoked_at=? WHERE revoked_at IS NULL AND ${external}`)
        .run(timestamp).changes,
    );
  }
}
