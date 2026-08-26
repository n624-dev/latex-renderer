import type { DatabaseSync } from "node:sqlite";

export interface RemoteMcpClientRow {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  created_at: string;
  last_used_at: string | null;
}

export interface RemoteMcpAuthorizationCodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes_json: string;
  resource: string;
  code_challenge: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface RemoteMcpTokenRow {
  token_hash: string;
  family_id: string;
  token_type: "access" | "refresh";
  sequence: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  client_id: string;
  user_id: string;
  user_security_version: number;
  scopes_json: string;
  resource: string;
  family_expires_at: string;
  family_revoked_at: string | null;
}

export interface RemoteMcpPrincipalRow {
  user_id: string;
  service_account_id: string;
  api_key_id: string;
  created_at: string;
}

export interface SourceRefRow {
  id: string;
  source_id: string;
  owner_user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export class RemoteMcpRepository {
  constructor(private readonly db: DatabaseSync) {}

  client(id: string): RemoteMcpClientRow | undefined {
    return this.db
      .prepare("SELECT * FROM remote_mcp_clients WHERE client_id=?")
      .get(id) as unknown as RemoteMcpClientRow | undefined;
  }

  insertClient(input: {
    id: string;
    name: string;
    redirectUris: readonly string[];
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_clients(client_id,client_name,redirect_uris_json,created_at)
         VALUES (?,?,?,?)`,
      )
      .run(
        input.id,
        input.name,
        JSON.stringify(input.redirectUris),
        input.timestamp,
      );
  }

  touchClient(id: string, timestamp: string): void {
    this.db
      .prepare("UPDATE remote_mcp_clients SET last_used_at=? WHERE client_id=?")
      .run(timestamp, id);
  }

  insertAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    scopes: readonly string[];
    resource: string;
    codeChallenge: string;
    timestamp: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_authorization_codes
         (code_hash,client_id,user_id,redirect_uri,scopes_json,resource,code_challenge,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.codeHash,
        input.clientId,
        input.userId,
        input.redirectUri,
        JSON.stringify(input.scopes),
        input.resource,
        input.codeChallenge,
        input.timestamp,
        input.expiresAt,
      );
  }

  authorizationCode(
    codeHash: string,
  ): RemoteMcpAuthorizationCodeRow | undefined {
    return this.db
      .prepare("SELECT * FROM remote_mcp_authorization_codes WHERE code_hash=?")
      .get(codeHash) as unknown as RemoteMcpAuthorizationCodeRow | undefined;
  }

  consumeAuthorizationCode(codeHash: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE remote_mcp_authorization_codes SET used_at=?
           WHERE code_hash=? AND used_at IS NULL AND expires_at>?`,
        )
        .run(timestamp, codeHash, timestamp).changes,
    );
  }

  insertTokenFamily(input: {
    id: string;
    clientId: string;
    userId: string;
    userSecurityVersion: number;
    scopes: readonly string[];
    resource: string;
    timestamp: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_token_families
         (id,client_id,user_id,user_security_version,scopes_json,resource,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.clientId,
        input.userId,
        input.userSecurityVersion,
        JSON.stringify(input.scopes),
        input.resource,
        input.timestamp,
        input.expiresAt,
      );
  }

  insertToken(input: {
    tokenHash: string;
    familyId: string;
    type: "access" | "refresh";
    sequence: number;
    timestamp: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_tokens
         (token_hash,family_id,token_type,sequence,created_at,expires_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        input.tokenHash,
        input.familyId,
        input.type,
        input.sequence,
        input.timestamp,
        input.expiresAt,
      );
  }

  token(hash: string): RemoteMcpTokenRow | undefined {
    return this.db
      .prepare(
        `SELECT t.*,f.client_id,f.user_id,f.user_security_version,f.scopes_json,f.resource,
                f.expires_at AS family_expires_at,f.revoked_at AS family_revoked_at
         FROM remote_mcp_tokens t JOIN remote_mcp_token_families f ON f.id=t.family_id
         WHERE t.token_hash=?`,
      )
      .get(hash) as unknown as RemoteMcpTokenRow | undefined;
  }

  consumeRefresh(hash: string, timestamp: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE remote_mcp_tokens SET used_at=?
           WHERE token_hash=? AND token_type='refresh' AND used_at IS NULL
             AND revoked_at IS NULL AND expires_at>?`,
        )
        .run(timestamp, hash, timestamp).changes,
    );
  }

  revokeFamily(id: string, timestamp: string): void {
    this.db
      .prepare(
        "UPDATE remote_mcp_token_families SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
      )
      .run(timestamp, id);
    this.db
      .prepare(
        "UPDATE remote_mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?",
      )
      .run(timestamp, id);
  }

  principal(userId: string): RemoteMcpPrincipalRow | undefined {
    return this.db
      .prepare("SELECT * FROM remote_mcp_principals WHERE user_id=?")
      .get(userId) as unknown as RemoteMcpPrincipalRow | undefined;
  }

  insertPrincipal(input: RemoteMcpPrincipalRow): void {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_principals(user_id,service_account_id,api_key_id,created_at)
         VALUES (?,?,?,?)`,
      )
      .run(
        input.user_id,
        input.service_account_id,
        input.api_key_id,
        input.created_at,
      );
  }

  sourceRef(id: string, ownerUserId: string, now: string): SourceRefRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM source_refs WHERE id=? AND owner_user_id=?
         AND revoked_at IS NULL AND expires_at>?`,
      )
      .get(id, ownerUserId, now) as unknown as SourceRefRow | undefined;
  }

  insertSourceRef(input: SourceRefRow): void {
    this.db
      .prepare(
        `INSERT INTO source_refs(id,source_id,owner_user_id,created_at,expires_at,revoked_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.source_id,
        input.owner_user_id,
        input.created_at,
        input.expires_at,
        input.revoked_at,
      );
  }

  incrementRateLimit(
    userId: string,
    toolName: string,
    windowStart: string,
  ): number {
    this.db
      .prepare(
        `INSERT INTO remote_mcp_rate_limits(user_id,tool_name,window_start,request_count)
         VALUES (?,?,?,1)
         ON CONFLICT(user_id,tool_name,window_start)
         DO UPDATE SET request_count=request_count+1`,
      )
      .run(userId, toolName, windowStart);
    return (
      this.db
        .prepare(
          `SELECT request_count AS count FROM remote_mcp_rate_limits
           WHERE user_id=? AND tool_name=? AND window_start=?`,
        )
        .get(userId, toolName, windowStart) as { count: number }
    ).count;
  }

  cleanup(before: string): void {
    this.db
      .prepare("DELETE FROM remote_mcp_authorization_codes WHERE expires_at<=?")
      .run(before);
    this.db
      .prepare("DELETE FROM remote_mcp_rate_limits WHERE window_start<?")
      .run(before);
  }
}
