import type { DatabaseSync } from "node:sqlite";

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
    return this.db.prepare(`SELECT id,owner_user_id,name,client_type,status,security_version,created_at,updated_at
      FROM service_accounts ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as ServiceAccountRow[];
  }

  get(id: string): ServiceAccountRow | undefined {
    return this.db.prepare(`SELECT id,owner_user_id,name,client_type,status,security_version,created_at,updated_at
      FROM service_accounts WHERE id=?`).get(id) as unknown as ServiceAccountRow | undefined;
  }

  activeExists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM service_accounts WHERE id=? AND status='active'").get(id) !== undefined;
  }

  insert(input: { id: string; ownerUserId: string; name: string; clientType: ServiceAccountRow["client_type"]; timestamp: string }): void {
    this.db.prepare(`INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
      VALUES (?,?,?,?,'active',1,?,?)`).run(input.id,input.ownerUserId,input.name,input.clientType,input.timestamp,input.timestamp);
  }

  setStatus(id: string, status: ServiceAccountRow["status"], timestamp: string): number {
    return Number(this.db.prepare("UPDATE service_accounts SET status=?,security_version=security_version+1,updated_at=? WHERE id=?")
      .run(status,timestamp,id).changes);
  }

  update(id: string, input: { name?: string | undefined; clientType?: ServiceAccountRow["client_type"] | undefined }, timestamp: string): number {
    return Number(this.db.prepare("UPDATE service_accounts SET name=COALESCE(?,name),client_type=COALESCE(?,client_type),security_version=security_version+1,updated_at=? WHERE id=?")
      .run(input.name ?? null,input.clientType ?? null,timestamp,id).changes);
  }
}
