import type { DatabaseSync } from "node:sqlite";
import type { RendererMcpScope } from "@latex-renderer/contracts";
import type { VerifiedAgentChannel } from "./agent-channels.js";
import {
  pairingLifetimeMs,
  type AgentPairingStore,
  type ClaimedPairing,
  type LocalPairingApproval,
  type PairingAttemptLimits,
  type PairingPreview,
} from "./agent-pairing.js";
import { decodeStoredScopes } from "./connections.js";
import type {
  ConsentProof,
  OAuthAuthorizationRequest,
} from "./oauth-tokens.js";

interface ApprovedPairing extends PairingPreview {
  transportId: string;
  localGrantId: string;
}

export class SqliteAgentPairing implements AgentPairingStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly write: <T>(operation: () => T) => T,
  ) {}

  start(
    proof: ConsentProof,
    codeHash: string,
    request: OAuthAuthorizationRequest,
    now: number,
    expiresAt: number,
  ): "created" | "collision" | "unavailable" {
    return this.write(() => {
      const consent = this.db
        .prepare(
          `
        SELECT expires_at FROM oauth_consents WHERE id = ? AND browser_hash = ? AND request_hash = ? AND expires_at > ?
      `,
        )
        .get(proof.id, proof.browserHash, proof.requestHash, now);
      if (typeof consent?.expires_at !== "number") return "unavailable";
      this.db
        .prepare("DELETE FROM agent_pairings WHERE expires_at <= ?")
        .run(now);
      if (
        this.db
          .prepare("SELECT 1 FROM agent_pairings WHERE consent_id = ?")
          .get(proof.id)
      )
        return "unavailable";
      const inserted = this.db
        .prepare(
          `
        INSERT INTO agent_pairings (consent_id, code_hash, client_id, scopes, expires_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (code_hash) DO NOTHING
      `,
        )
        .run(
          proof.id,
          codeHash,
          request.clientId,
          JSON.stringify(request.scopes),
          Math.min(expiresAt, consent.expires_at),
        );
      return inserted.changes === 1 ? "created" : "collision";
    });
  }

  claim(
    agent: VerifiedAgentChannel,
    codeHash: string,
    profileId: string,
    nonce: string,
    now: number,
    limits: PairingAttemptLimits,
  ): ClaimedPairing | undefined {
    return this.write(() => {
      if (!this.#activeAgent(agent) || !this.#takeAttempt(agent, now, limits))
        return undefined;
      const row = this.db
        .prepare(
          `
        UPDATE agent_pairings SET transport_id = ?, local_profile_id = ?, nonce = ?
        WHERE code_hash = ? AND expires_at > ? AND transport_id IS NULL
        RETURNING consent_id, client_id, scopes, expires_at
      `,
        )
        .get(agent.transportId, profileId, nonce, codeHash, now) as
        | {
            consent_id: string;
            client_id: string;
            scopes: string;
            expires_at: number;
          }
        | undefined;
      if (!row) return undefined;
      return {
        id: row.consent_id,
        nonce,
        clientId: row.client_id,
        scopes: decodeStoredScopes(row.scopes),
        expiresAt: row.expires_at,
      };
    });
  }

  approve(
    agent: VerifiedAgentChannel,
    approval: LocalPairingApproval,
    now: number,
  ): boolean {
    return this.write(() => {
      if (!this.#activeAgent(agent)) return false;
      const binding = [
        approval.id,
        agent.transportId,
        approval.localProfileId,
        approval.nonce,
        now,
      ] as const;
      const condition =
        "consent_id = ? AND transport_id = ? AND local_profile_id = ? AND nonce = ? AND expires_at > ? AND local_grant_id IS NULL";
      const row = this.db
        .prepare(`SELECT scopes FROM agent_pairings WHERE ${condition}`)
        .get(...binding);
      if (typeof row?.scopes !== "string") return false;
      const requested = decodeStoredScopes(row.scopes);
      if (approval.scopes.some((scope) => !requested.includes(scope)))
        return false;
      return (
        this.db
          .prepare(
            `UPDATE agent_pairings SET local_grant_id = ?, approved_scopes = ? WHERE ${condition}`,
          )
          .run(
            approval.localGrantId,
            JSON.stringify([...new Set(approval.scopes)]),
            ...binding,
          ).changes === 1
      );
    });
  }

  approved(proof: ConsentProof, now: number): PairingPreview | undefined {
    const approved = this.approvedGrant(proof, now);
    if (!approved) return undefined;
    const { instanceId, localProfileId, scopes } = approved;
    return { instanceId, localProfileId, scopes };
  }

  approvedGrant(proof: ConsentProof, now: number): ApprovedPairing | undefined {
    const row = this.db
      .prepare(
        `
      SELECT t.instance_id, p.transport_id, p.local_profile_id, p.local_grant_id, p.approved_scopes
      FROM agent_pairings p JOIN oauth_consents c ON c.id = p.consent_id
      JOIN transports t ON t.id = p.transport_id
      WHERE c.id = ? AND c.browser_hash = ? AND c.request_hash = ? AND c.expires_at > ?
        AND p.expires_at > ? AND p.local_grant_id IS NOT NULL AND t.kind = 'agent' AND t.disabled_at IS NULL
    `,
      )
      .get(proof.id, proof.browserHash, proof.requestHash, now, now) as
      | {
          instance_id: string;
          transport_id: string;
          local_profile_id: string;
          local_grant_id: string;
          approved_scopes: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      instanceId: row.instance_id,
      transportId: row.transport_id,
      localProfileId: row.local_profile_id,
      localGrantId: row.local_grant_id,
      scopes: decodeStoredScopes(row.approved_scopes),
    };
  }

  #activeAgent(agent: VerifiedAgentChannel): boolean {
    return (
      this.db
        .prepare(
          `
      SELECT 1 FROM transports WHERE id = ? AND instance_id = ? AND agent_public_key = ?
        AND kind = 'agent' AND disabled_at IS NULL
    `,
        )
        .get(agent.transportId, agent.instanceId, agent.publicKey) !== undefined
    );
  }

  #takeAttempt(
    agent: VerifiedAgentChannel,
    now: number,
    limits: PairingAttemptLimits,
  ): boolean {
    const windowEnd =
      (Math.floor(now / pairingLifetimeMs) + 1) * pairingLifetimeMs;
    this.db
      .prepare("DELETE FROM agent_pairing_attempts WHERE window_end <= ?")
      .run(now);
    const counters = [
      ["all", limits.total],
      [`instance:${agent.instanceId}`, limits.perInstance],
      [`transport:${agent.transportId}`, limits.perTransport],
    ] as const;
    const lookup = this.db.prepare(
      "SELECT count FROM agent_pairing_attempts WHERE bucket = ? AND window_end = ?",
    );
    if (
      counters.some(
        ([bucket, limit]) =>
          Number(lookup.get(bucket, windowEnd)?.count ?? 0) >= limit,
      )
    )
      return false;
    const increment = this.db.prepare(`
      INSERT INTO agent_pairing_attempts (bucket, window_end, count) VALUES (?, ?, 1)
      ON CONFLICT (bucket, window_end) DO UPDATE SET count = count + 1
    `);
    for (const [bucket] of counters) increment.run(bucket, windowEnd);
    return true;
  }
}

export function samePairingScopes(
  approved: readonly RendererMcpScope[],
  requested: readonly RendererMcpScope[],
): boolean {
  const distinct = new Set(requested);
  return (
    distinct.size === approved.length &&
    approved.every((scope) => distinct.has(scope))
  );
}
