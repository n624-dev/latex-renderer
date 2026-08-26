import type { DatabaseSync } from "node:sqlite";

export interface UserRow {
  id: string;
  access_subject: string | null;
  access_subject_linked_at: string | null;
  access_subject_generation: number;
  email: string;
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
    return this.db.prepare(`SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users ORDER BY created_at DESC LIMIT ?`).all(limit) as unknown as UserRow[];
  }

  get(id: string): UserRow | undefined {
    return this.db.prepare(`SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users WHERE id=?`).get(id) as unknown as UserRow | undefined;
  }

  findByAccessSubject(subject: string): UserRow | undefined {
    return this.db.prepare(`SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users WHERE access_subject=?`).get(subject) as unknown as UserRow | undefined;
  }

  findByEmail(email: string): UserRow | undefined {
    return this.db.prepare(`SELECT id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_at,updated_at,last_login_at
      FROM users WHERE email=? COLLATE NOCASE`).get(email) as unknown as UserRow | undefined;
  }

  claimAccessSubject(id: string, subject: string, timestamp: string): number {
    return Number(this.db.prepare(`UPDATE users
      SET access_subject=?,access_subject_linked_at=?,access_subject_generation=access_subject_generation+1,
        security_version=security_version+1,updated_at=?,last_login_at=?
      WHERE id=? AND access_subject IS NULL AND status='active' AND role IN ('owner','admin')`)
      .run(subject,timestamp,timestamp,timestamp,id).changes);
  }

  unlinkAccessSubject(id: string, timestamp: string): number {
    return Number(this.db.prepare(`UPDATE users
      SET access_subject=NULL,access_subject_linked_at=NULL,
        access_subject_generation=access_subject_generation+1,
        security_version=security_version+1,updated_at=?
      WHERE id=? AND access_subject IS NOT NULL`)
      .run(timestamp,id).changes);
  }

  activeExists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id) !== undefined;
  }

  countActiveOwners(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner' AND status='active'").get() as { count: number }).count;
  }

  insertInvitation(input: { id: string; email: string; displayName: string; role: UserRow["role"]; createdBy: string; timestamp: string }): void {
    this.db.prepare(`INSERT INTO users(id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES (?,NULL,NULL,0,?,?,?,'active',1,?,?,?)`).run(input.id,input.email,input.displayName,input.role,input.createdBy,input.timestamp,input.timestamp);
  }

  setStatus(id: string, status: UserRow["status"], timestamp: string): number {
    return Number(this.db.prepare("UPDATE users SET status=?,security_version=security_version+1,updated_at=? WHERE id=?")
      .run(status,timestamp,id).changes);
  }

  update(id: string, input: { displayName?: string | undefined; role?: UserRow["role"] | undefined }, timestamp: string): number {
    return Number(this.db.prepare("UPDATE users SET display_name=COALESCE(?,display_name),role=COALESCE(?,role),security_version=security_version+1,updated_at=? WHERE id=?")
      .run(input.displayName ?? null,input.role ?? null,timestamp,id).changes);
  }
}
