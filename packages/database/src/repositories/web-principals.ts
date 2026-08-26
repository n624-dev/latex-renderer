import type { DatabaseSync } from "node:sqlite";
import { newId, nowIso } from "@latex-renderer/shared";

export interface WebPrincipalRow {
  user_id: string;
  service_account_id: string;
  api_key_id: string;
  created_at: string;
}

export class WebPrincipalsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(userId: string): WebPrincipalRow | undefined {
    return this.db
      .prepare("SELECT * FROM web_principals WHERE user_id=?")
      .get(userId) as unknown as WebPrincipalRow | undefined;
  }

  ensure(userId: string): WebPrincipalRow {
    const existing = this.get(userId);
    if (existing !== undefined) return existing;
    const timestamp = nowIso(),
      principal: WebPrincipalRow = {
        user_id: userId,
        service_account_id: newId("sa"),
        api_key_id: newId("key"),
        created_at: timestamp,
      };
    this.db
      .prepare(
        `INSERT INTO service_accounts
        (id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
        VALUES (?,?,?,'generic','active',1,?,?)`,
      )
      .run(principal.service_account_id, userId, "Web", timestamp, timestamp);
    this.db
      .prepare(
        `INSERT INTO api_keys
        (id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,'web-principal')`,
      )
      .run(
        principal.api_key_id,
        principal.service_account_id,
        "Web rendering principal",
        `web_${principal.api_key_id.slice(4)}`,
        "0".repeat(64),
        "web-principal",
        JSON.stringify(["render:create", "render:read:own"]),
        timestamp,
      );
    this.db
      .prepare(
        `INSERT INTO web_principals(user_id,service_account_id,api_key_id,created_at)
         VALUES (?,?,?,?)`,
      )
      .run(
        principal.user_id,
        principal.service_account_id,
        principal.api_key_id,
        principal.created_at,
      );
    return principal;
  }

  ensureAll(): number {
    const users = this.db
      .prepare("SELECT id FROM users ORDER BY created_at")
      .all() as Array<{ id: string }>;
    let created = 0;
    for (const user of users) {
      if (this.get(user.id) !== undefined) continue;
      this.ensure(user.id);
      created += 1;
    }
    return created;
  }
}
