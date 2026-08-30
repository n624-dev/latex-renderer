import type { DatabaseSync } from "node:sqlite";

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
