import type { DatabaseSync } from "node:sqlite";

export class SecurityRepository {
  constructor(private readonly db: DatabaseSync) {}
  idempotency(
    actorType: string,
    actorId: string,
    operation: string,
    keyHash: string,
    now: string,
  ):
    | {
        resource_id: string | null;
        request_hash: string;
        response_code: number | null;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT resource_id,request_hash,response_code FROM idempotency_records WHERE actor_type=? AND actor_id=? AND operation=? AND key_hash=? AND expires_at>?`,
      )
      .get(actorType, actorId, operation, keyHash, now) as
      | {
          resource_id: string | null;
          request_hash: string;
          response_code: number | null;
        }
      | undefined;
  }
  insertIdempotency(input: {
    actorType: string;
    actorId: string;
    operation: string;
    keyHash: string;
    requestHash: string;
    resourceId: string;
    responseCode: number;
    expiresAt: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_records(actor_type,actor_id,operation,key_hash,request_hash,resource_id,response_code,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.actorType,
        input.actorId,
        input.operation,
        input.keyHash,
        input.requestHash,
        input.resourceId,
        input.responseCode,
        input.expiresAt,
        input.createdAt,
      );
  }
  insertNonce(nonce: string, jobId: string, expiresAt: string): void {
    this.db
      .prepare(
        "INSERT INTO used_nonces(nonce,job_id,state,expires_at) VALUES (?,?,'unused',?)",
      )
      .run(nonce, jobId, expiresAt);
  }
  latestUsableNonce(jobId: string, now: string): string | undefined {
    return (
      this.db
        .prepare(
          `SELECT nonce FROM used_nonces
    WHERE job_id=? AND state IN ('unused','released') AND expires_at>? ORDER BY expires_at DESC LIMIT 1`,
        )
        .get(jobId, now) as { nonce: string } | undefined
    )?.nonce;
  }
  insertSourceNonce(nonce: string, sourceId: string, expiresAt: string): void {
    this.db
      .prepare(
        "INSERT INTO source_upload_nonces(nonce,source_id,state,expires_at) VALUES (?,?,'unused',?)",
      )
      .run(nonce, sourceId, expiresAt);
  }
  latestUsableSourceNonce(sourceId: string, now: string): string | undefined {
    return (
      this.db
        .prepare(
          `SELECT nonce FROM source_upload_nonces WHERE source_id=? AND state IN ('unused','released') AND expires_at>? ORDER BY expires_at DESC LIMIT 1`,
        )
        .get(sourceId, now) as { nonce: string } | undefined
    )?.nonce;
  }
  revokeTicketKey(
    kid: string,
    reason: string,
    expiresAt: string,
    timestamp: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO revoked_tickets(selector_type,selector_value,reason,expires_at,created_at) VALUES ('kid',?,?,?,?) ON CONFLICT(selector_type,selector_value) DO UPDATE SET reason=excluded.reason,expires_at=excluded.expires_at,created_at=excluded.created_at`,
      )
      .run(kid, reason, expiresAt, timestamp);
  }
}
