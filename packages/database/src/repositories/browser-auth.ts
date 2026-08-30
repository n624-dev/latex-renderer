import type { DatabaseSync } from "node:sqlite";

export type ExternalIdentityProvider = "cloudflare-access" | "oidc";
export type BrowserAuthMode = ExternalIdentityProvider | "password";

export interface UserIdentityRow {
  id: string;
  user_id: string;
  provider: ExternalIdentityProvider;
  issuer: string;
  subject: string;
  preferred_username: string | null;
  email_at_provider: string | null;
  linked_at: string;
  last_seen_at: string;
}

export interface LocalCredentialRow {
  user_id: string;
  login_name: string;
  password_hash: string;
  password_updated_at: string;
}

export interface WebSessionRow {
  token_hash: string;
  user_id: string;
  auth_mode: BrowserAuthMode;
  identity_id: string | null;
  user_security_version: number;
  csrf_hash: string;
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

export interface AuthLoginAttemptRow {
  key_hash: string;
  failure_count: number;
  window_started_at: string;
  blocked_until: string | null;
  updated_at: string;
}

export class BrowserAuthRepository {
  constructor(private readonly db: DatabaseSync) {}

  findIdentity(
    provider: ExternalIdentityProvider,
    issuer: string,
    subject: string,
  ): UserIdentityRow | undefined {
    return this.db
      .prepare(
        `SELECT id,user_id,provider,issuer,subject,preferred_username,email_at_provider,linked_at,last_seen_at
         FROM user_identities WHERE provider=? AND issuer=? AND subject=?`,
      )
      .get(provider, issuer, subject) as unknown as UserIdentityRow | undefined;
  }

  identitiesForUser(userId: string): UserIdentityRow[] {
    return this.db
      .prepare(
        `SELECT id,user_id,provider,issuer,subject,preferred_username,email_at_provider,linked_at,last_seen_at
         FROM user_identities WHERE user_id=? ORDER BY linked_at,id`,
      )
      .all(userId) as unknown as UserIdentityRow[];
  }

  insertIdentity(input: UserIdentityRow): void {
    this.db
      .prepare(
        `INSERT INTO user_identities
         (id,user_id,provider,issuer,subject,preferred_username,email_at_provider,linked_at,last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.user_id,
        input.provider,
        input.issuer,
        input.subject,
        input.preferred_username,
        input.email_at_provider,
        input.linked_at,
        input.last_seen_at,
      );
  }

  touchIdentity(
    id: string,
    input: {
      preferredUsername?: string | undefined;
      email?: string | undefined;
      timestamp: string;
    },
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE user_identities
           SET preferred_username=?,email_at_provider=?,last_seen_at=? WHERE id=?`,
        )
        .run(
          input.preferredUsername ?? null,
          input.email ?? null,
          input.timestamp,
          id,
        ).changes,
    );
  }

  deleteIdentity(userId: string, identityId: string): number {
    return Number(
      this.db
        .prepare("DELETE FROM user_identities WHERE id=? AND user_id=?")
        .run(identityId, userId).changes,
    );
  }

  migrateLegacyCloudflareIdentities(
    issuer: string,
    timestamp: string,
    idForUser: (userId: string) => string,
  ): number {
    const rows = this.db
      .prepare(
        `SELECT id,access_subject,email,COALESCE(access_subject_linked_at,created_at) AS linked_at
         FROM users WHERE access_subject IS NOT NULL ORDER BY id`,
      )
      .all() as unknown as Array<{
      id: string;
      access_subject: string;
      email: string | null;
      linked_at: string;
    }>;
    let created = 0;
    for (const row of rows) {
      const existing = this.findIdentity(
        "cloudflare-access",
        issuer,
        row.access_subject,
      );
      if (existing !== undefined) {
        if (existing.user_id !== row.id)
          throw new Error(
            "Legacy Cloudflare Access subject conflicts with an existing external identity",
          );
      } else {
        this.insertIdentity({
          id: idForUser(row.id),
          user_id: row.id,
          provider: "cloudflare-access",
          issuer,
          subject: row.access_subject,
          preferred_username: null,
          email_at_provider: row.email,
          linked_at: row.linked_at,
          last_seen_at: timestamp,
        });
        created += 1;
      }
      const cleared = this.db
        .prepare(
          `UPDATE users SET access_subject=NULL,access_subject_linked_at=NULL,
             access_subject_generation=access_subject_generation+1,updated_at=?
           WHERE id=? AND access_subject=?`,
        )
        .run(timestamp, row.id, row.access_subject);
      if (cleared.changes !== 1)
        throw new Error(
          "Legacy Cloudflare Access subject changed during migration",
        );
    }
    return created;
  }

  getCredentialByLogin(loginName: string): LocalCredentialRow | undefined {
    return this.db
      .prepare(
        `SELECT user_id,login_name,password_hash,password_updated_at
         FROM local_credentials WHERE login_name=? COLLATE NOCASE`,
      )
      .get(loginName) as unknown as LocalCredentialRow | undefined;
  }

  getCredentialForUser(userId: string): LocalCredentialRow | undefined {
    return this.db
      .prepare(
        `SELECT user_id,login_name,password_hash,password_updated_at
         FROM local_credentials WHERE user_id=?`,
      )
      .get(userId) as unknown as LocalCredentialRow | undefined;
  }

  upsertCredential(input: LocalCredentialRow): void {
    this.db
      .prepare(
        `INSERT INTO local_credentials(user_id,login_name,password_hash,password_updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET login_name=excluded.login_name,
           password_hash=excluded.password_hash,password_updated_at=excluded.password_updated_at`,
      )
      .run(
        input.user_id,
        input.login_name,
        input.password_hash,
        input.password_updated_at,
      );
  }

  insertSession(input: WebSessionRow): void {
    this.db
      .prepare(
        `INSERT INTO web_sessions
         (token_hash,user_id,auth_mode,identity_id,user_security_version,csrf_hash,
          created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.token_hash,
        input.user_id,
        input.auth_mode,
        input.identity_id,
        input.user_security_version,
        input.csrf_hash,
        input.created_at,
        input.last_seen_at,
        input.idle_expires_at,
        input.absolute_expires_at,
        input.revoked_at,
      );
  }

  getSession(tokenHash: string): WebSessionRow | undefined {
    return this.db
      .prepare(
        `SELECT token_hash,user_id,auth_mode,identity_id,user_security_version,csrf_hash,
                created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at
         FROM web_sessions WHERE token_hash=?`,
      )
      .get(tokenHash) as unknown as WebSessionRow | undefined;
  }

  touchSession(
    tokenHash: string,
    timestamp: string,
    idleExpiresAt: string,
  ): number {
    return Number(
      this.db
        .prepare(
          `UPDATE web_sessions SET last_seen_at=?,idle_expires_at=?
           WHERE token_hash=? AND revoked_at IS NULL`,
        )
        .run(timestamp, idleExpiresAt, tokenHash).changes,
    );
  }

  revokeSession(tokenHash: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE web_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?",
        )
        .run(timestamp, tokenHash).changes,
    );
  }

  revokeUserSessions(userId: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          "UPDATE web_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        )
        .run(timestamp, userId).changes,
    );
  }

  deleteExpiredSessions(timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `DELETE FROM web_sessions
           WHERE absolute_expires_at<=? OR idle_expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<=?)`,
        )
        .run(timestamp, timestamp, timestamp).changes,
    );
  }

  getLoginAttempt(keyHash: string): AuthLoginAttemptRow | undefined {
    return this.db
      .prepare(
        `SELECT key_hash,failure_count,window_started_at,blocked_until,updated_at
         FROM auth_login_attempts WHERE key_hash=?`,
      )
      .get(keyHash) as unknown as AuthLoginAttemptRow | undefined;
  }

  putLoginAttempt(input: AuthLoginAttemptRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_login_attempts
         (key_hash,failure_count,window_started_at,blocked_until,updated_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(key_hash) DO UPDATE SET failure_count=excluded.failure_count,
           window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until,
           updated_at=excluded.updated_at`,
      )
      .run(
        input.key_hash,
        input.failure_count,
        input.window_started_at,
        input.blocked_until,
        input.updated_at,
      );
  }

  clearLoginAttempts(keyHashes: readonly string[]): void {
    const statement = this.db.prepare(
      "DELETE FROM auth_login_attempts WHERE key_hash=?",
    );
    for (const hash of keyHashes) statement.run(hash);
  }

  pruneLoginAttempts(before: string, maximumRows: number): number {
    const expired = this.db
      .prepare("DELETE FROM auth_login_attempts WHERE updated_at<?")
      .run(before).changes;
    const overflow = this.db
      .prepare(
        `DELETE FROM auth_login_attempts WHERE key_hash IN (
           SELECT key_hash FROM auth_login_attempts
           ORDER BY updated_at DESC,key_hash DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(maximumRows).changes;
    return Number(expired) + Number(overflow);
  }
}
