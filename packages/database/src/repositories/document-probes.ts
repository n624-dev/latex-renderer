import type { DocumentProbe } from "@latex-renderer/contracts";
import { AppError, newId, sha256Hex } from "@latex-renderer/shared";
import type { DatabaseSync } from "node:sqlite";

export interface DocumentProbeRow {
  id: string;
  runtime_image: string;
  fingerprint: string;
  input_json: string;
  status: "queued" | "running" | "ready" | "failed";
  expires_at: string;
  lease_owner: string | null;
  lease_until: string | null;
  result_code: string | null;
}

export class DocumentProbesRepository {
  constructor(private readonly db: DatabaseSync) {}

  request(
    userId: string,
    image: string,
    input: DocumentProbe,
    timestamp: string,
  ) {
    this.prune(timestamp);
    const serialized = JSON.stringify(input);
    const fingerprint = sha256Hex(serialized);
    const existing = this.db
      .prepare(
        "SELECT * FROM document_probes WHERE user_id=? AND runtime_image=? AND fingerprint=?",
      )
      .get(userId, image, fingerprint) as DocumentProbeRow | undefined;
    if (existing) return existing;
    const totals = this.db
      .prepare(
        `SELECT count(*) AS total, sum(user_id=?) AS owned,
       sum(status IN ('queued','running')) AS pending
       FROM document_probes`,
      )
      .get(userId) as {
      total: number;
      owned: number | null;
      pending: number | null;
    };
    if (
      totals.total >= 256 ||
      (totals.owned ?? 0) >= 16 ||
      (totals.pending ?? 0) >= 12
    )
      throw new AppError(
        "DOCUMENT_PROBE_BUSY",
        "Document probe capacity is in use",
        503,
      );
    const id = newId("probe");
    const expiresAt = new Date(
      Date.parse(timestamp) + 30 * 60_000,
    ).toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO document_probes(id,user_id,runtime_image,fingerprint,input_json,status,requested_at,expires_at)
       VALUES (?,?,?,?,?,'queued',?,?) RETURNING *`,
      )
      .get(id, userId, image, fingerprint, serialized, timestamp, expiresAt);
    if (row === undefined)
      throw new Error("Document probe request was not saved");
    return row as unknown as DocumentProbeRow;
  }

  claim(owner: string, timestamp: string) {
    return this.db
      .prepare(
        `UPDATE document_probes SET status='running',lease_owner=?,lease_until=?
       WHERE id=(SELECT id FROM document_probes WHERE status='queued' AND expires_at>?
       ORDER BY requested_at,id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM document_probes WHERE status='running')
       RETURNING *`,
      )
      .get(
        owner,
        new Date(Date.parse(timestamp) + 120_000).toISOString(),
        timestamp,
      ) as DocumentProbeRow | undefined;
  }

  running() {
    return this.db
      .prepare("SELECT * FROM document_probes WHERE status='running' LIMIT 1")
      .get() as DocumentProbeRow | undefined;
  }

  owns(id: string, owner: string, timestamp: string) {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM document_probes WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?",
        )
        .get(id, owner, timestamp) !== undefined
    );
  }

  claimRecovery(row: DocumentProbeRow, owner: string, timestamp: string) {
    return (
      this.db
        .prepare(
          `UPDATE document_probes SET lease_owner=?,lease_until=? WHERE id=? AND status='running'
       AND lease_owner=? AND lease_until<=?`,
        )
        .run(
          owner,
          new Date(Date.parse(timestamp) + 120_000).toISOString(),
          row.id,
          row.lease_owner,
          timestamp,
        ).changes === 1
    );
  }

  finish(id: string, owner: string, code: string, status: "ready" | "failed") {
    this.db
      .prepare(
        `UPDATE document_probes SET status=?,result_code=?,lease_owner=NULL,lease_until=NULL
       WHERE id=? AND lease_owner=? AND status='running'`,
      )
      .run(status, code, id, owner);
  }

  prune(timestamp: string) {
    this.db
      .prepare(
        "DELETE FROM document_probes WHERE status!='running' AND expires_at<=?",
      )
      .run(timestamp);
  }
}
