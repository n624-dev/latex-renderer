import type { DatabaseSync } from "node:sqlite";
import type { RendererMcpScope } from "@latex-renderer/contracts";
import {
  decodeStoredScopes,
  isActiveAuthorization,
  type ConnectionAuthorization,
} from "./connections.js";
import {
  accessTokenLifetimeMs,
  authorizationLifetimeMs,
  type TokenExchangeStore,
  type IssuedGrant,
  type ConsentProof,
} from "./oauth-tokens.js";

const codeMatch = `SELECT authorization_id, scopes FROM oauth_codes
  WHERE hash = ? AND client_id = ? AND redirect_uri = ? AND resource = ?
    AND code_challenge = ? AND expires_at > ?`;

const consentMatch = `id = ? AND browser_hash = ? AND request_hash = ? AND expires_at > ?`;

interface AccessRow {
  authorization_id: string;
  scopes: string;
}

interface RefreshRow extends AccessRow {
  sequence: number;
  current_sequence: number;
  consumed_at: number | null;
}

export class SqliteOAuthTokens implements TokenExchangeStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly write: <T>(operation: () => T) => T,
    private readonly authorization: (
      id: string,
    ) => ConnectionAuthorization | undefined,
    private readonly revoke: (id: string, now: number) => boolean,
    private readonly approvePairing: (
      proof: ConsentProof,
      scopes: readonly RendererMcpScope[],
      now: number,
    ) => ConnectionAuthorization | undefined,
  ) {}

  beginConsent(
    proof: ConsentProof,
    expiresAt: number,
    now: number,
    capacity: number,
  ): boolean {
    return this.write(() => {
      this.db
        .prepare("DELETE FROM oauth_consents WHERE expires_at <= ?")
        .run(now);
      return (
        this.db
          .prepare(
            `
        INSERT INTO oauth_consents (id, browser_hash, request_hash, expires_at, client_id)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM oauth_consents) < ?
          AND (? NOT GLOB 'gateway_client_*' OR EXISTS (SELECT 1 FROM oauth_dcr_clients WHERE id = ?))
        ON CONFLICT DO NOTHING
      `,
          )
          .run(
            proof.id,
            proof.browserHash,
            proof.requestHash,
            expiresAt,
            proof.clientId,
            capacity,
            proof.clientId,
            proof.clientId,
          ).changes === 1
      );
    });
  }

  consumeConsent(proof: ConsentProof, now: number): boolean {
    return (
      this.db
        .prepare(`DELETE FROM oauth_consents WHERE ${consentMatch}`)
        .run(proof.id, proof.browserHash, proof.requestHash, now).changes === 1
    );
  }

  recordCode(
    input: Parameters<TokenExchangeStore["recordCode"]>[0],
  ): ConnectionAuthorization | undefined {
    return this.write(() => {
      const { id, browserHash, requestHash } = input.consent;
      if (
        this.db
          .prepare(`SELECT 1 FROM oauth_consents WHERE ${consentMatch}`)
          .get(id, browserHash, requestHash, input.now) === undefined
      )
        return undefined;
      const paired = input.authorizationId === null;
      if (
        !paired &&
        this.db
          .prepare("SELECT 1 FROM agent_pairings WHERE consent_id = ?")
          .get(id)
      )
        return undefined;
      const grant =
        input.authorizationId === null
          ? this.approvePairing(input.consent, input.approvedScopes, input.now)
          : this.#active(input.authorizationId, input.now);
      if (
        !grant ||
        grant.expiresAt - input.now > authorizationLifetimeMs ||
        input.approvedScopes.some((scope) => !grant.scopes.includes(scope)) ||
        this.db
          .prepare("SELECT 1 FROM oauth_families WHERE authorization_id = ?")
          .get(grant.id)
      )
        return undefined;
      this.db
        .prepare("DELETE FROM oauth_codes WHERE expires_at <= ?")
        .run(input.now);
      const { clientId, redirectUri, resource, codeChallenge } = input.request;
      const stored =
        this.db
          .prepare(
            `
        INSERT INTO oauth_codes (hash, authorization_id, client_id, redirect_uri, resource, code_challenge, scopes, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `,
          )
          .run(
            input.hash,
            grant.id,
            clientId,
            redirectUri,
            resource,
            codeChallenge,
            JSON.stringify([...new Set(input.approvedScopes)]),
            Math.min(input.expiresAt, grant.expiresAt),
          ).changes === 1;
      if (stored) {
        this.db.prepare("UPDATE authorizations SET oauth_client_id=? WHERE id=?")
          .run(clientId, grant.id);
        this.consumeConsent(input.consent, input.now);
      }
      else if (paired)
        throw new Error("Paired authorization could not be issued");
      return stored ? grant : undefined;
    });
  }

  exchangeCode(
    input: Parameters<TokenExchangeStore["exchangeCode"]>[0],
  ): IssuedGrant | undefined {
    return this.write(() => {
      const code = this.db
        .prepare(codeMatch)
        .get(
          input.codeHash,
          input.clientId,
          input.redirectUri,
          input.resource,
          input.codeChallenge,
          input.now,
        ) as unknown as AccessRow | undefined;
      const grant = code && this.#active(code.authorization_id, input.now);
      if (!code || !grant) return undefined;
      this.db
        .prepare("DELETE FROM oauth_codes WHERE hash = ?")
        .run(input.codeHash);
      this.db
        .prepare(
          "INSERT INTO oauth_families (authorization_id, client_id, resource) VALUES (?, ?, ?)",
        )
        .run(grant.id, input.clientId, input.resource);
      const scopes = decodeStoredScopes(code.scopes).filter((scope) =>
        grant.scopes.includes(scope),
      );
      return this.#storePair(input, { ...grant, scopes }, 0);
    });
  }

  refresh(
    input: Parameters<TokenExchangeStore["refresh"]>[0],
  ): IssuedGrant | undefined {
    return this.write(() => {
      const old = this.db
        .prepare(
          `
        SELECT t.authorization_id, t.sequence, t.scopes, t.consumed_at, f.current_sequence
        FROM oauth_tokens t JOIN oauth_families f USING (authorization_id)
        WHERE t.refresh_hash = ? AND f.client_id = ? AND f.resource = ?
      `,
        )
        .get(input.oldHash, input.clientId, input.resource) as unknown as
        RefreshRow | undefined;
      const grant = old && this.#active(old.authorization_id, input.now);
      if (!old || !grant) return undefined;
      const previousScopes = decodeStoredScopes(old.scopes).filter((scope) =>
        grant.scopes.includes(scope),
      );
      const scopes = input.requestedScopes ?? previousScopes;
      if (
        !scopes.length ||
        scopes.some((scope) => !previousScopes.includes(scope))
      )
        return undefined;
      if (old.consumed_at !== null) {
        if (input.now - old.consumed_at >= input.retryWindowMs) {
          this.revoke(grant.id, input.now);
          return undefined;
        }
        if (old.current_sequence !== old.sequence + 1) return undefined;
        const replay = this.db
          .prepare(
            `
          SELECT scopes, access_expires_at FROM oauth_tokens
          WHERE authorization_id = ? AND sequence = ?
            AND refresh_hash = ? AND access_hash = ? AND access_expires_at > ?
        `,
          )
          .get(
            grant.id,
            old.current_sequence,
            input.refreshHash,
            input.accessHash,
            input.now,
          ) as { scopes: string; access_expires_at: number } | undefined;
        if (!replay) return undefined;
        const grantedScopes = decodeStoredScopes(replay.scopes);
        return grantedScopes.length === scopes.length &&
          grantedScopes.every((scope) => scopes.includes(scope))
          ? { scopes: grantedScopes, accessExpiresAt: replay.access_expires_at }
          : undefined;
      }
      if (old.sequence !== old.current_sequence) return undefined;
      const sequence = old.sequence + 1;
      this.db
        .prepare(
          "UPDATE oauth_tokens SET consumed_at = ? WHERE refresh_hash = ?",
        )
        .run(input.now, input.oldHash);
      this.db
        .prepare(
          "UPDATE oauth_families SET current_sequence = ? WHERE authorization_id = ?",
        )
        .run(sequence, grant.id);
      return this.#storePair(input, { ...grant, scopes }, sequence);
    });
  }

  accessAuthorization(
    hash: string,
    resource: string,
    now: number,
  ): ConnectionAuthorization | undefined {
    const token = this.db
      .prepare(
        `
      SELECT t.authorization_id, t.scopes FROM oauth_tokens t JOIN oauth_families f USING (authorization_id)
      WHERE t.access_hash = ? AND t.access_expires_at > ? AND f.resource = ?
    `,
      )
      .get(hash, now, resource) as unknown as AccessRow | undefined;
    const grant = token && this.#active(token.authorization_id, now);
    if (!token || !grant) return undefined;
    return {
      ...grant,
      scopes: decodeStoredScopes(token.scopes).filter((scope) =>
        grant.scopes.includes(scope),
      ),
    };
  }

  #active(id: string, now: number): ConnectionAuthorization | undefined {
    const grant = this.authorization(id);
    return grant &&
      isActiveAuthorization(grant, now) &&
      this.db
        .prepare(
          "SELECT 1 FROM transports WHERE id = ? AND disabled_at IS NULL",
        )
        .get(grant.transportId)
      ? grant
      : undefined;
  }

  #storePair(
    hashes: { accessHash: string; refreshHash: string; now: number },
    grant: ConnectionAuthorization,
    sequence: number,
  ): IssuedGrant {
    const accessExpiresAt = Math.min(
      hashes.now + accessTokenLifetimeMs,
      grant.expiresAt,
    );
    this.db
      .prepare(
        `
      INSERT INTO oauth_tokens (refresh_hash, access_hash, authorization_id, sequence, scopes, access_expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        hashes.refreshHash,
        hashes.accessHash,
        grant.id,
        sequence,
        JSON.stringify(grant.scopes),
        accessExpiresAt,
      );
    return { scopes: grant.scopes, accessExpiresAt };
  }
}
