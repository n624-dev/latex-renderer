import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  isRendererMcpScope,
  type RendererRelayAgentEnrollment,
} from "@latex-renderer/contracts";
import type { AgentEnrollmentStore } from "./agent-enrollment.js";
import {
  decodeStoredScopes,
  type ConnectionAuthorization,
  type ConnectionProfile,
  type ConnectionStore,
  type ConnectionTransport,
  type InstanceIdentity,
  type NewAuthorization,
  type TransportEndpoint,
} from "./connections.js";
import {
  agentRevocationSchema,
  connectionApplicationId,
  connectionSchema,
  connectionRetentionSchema,
  connectionSchemaVersion,
} from "./sqlite-schema.js";
import { SqliteOAuthTokens } from "./sqlite-oauth-tokens.js";
import {
  authorizationLifetimeMs,
  type TokenExchangeStore,
} from "./oauth-tokens.js";
import {
  samePairingScopes,
  SqliteAgentPairing,
} from "./sqlite-agent-pairing.js";
import {
  dcrClientRetentionMs,
  expiredConnectionRetentionMs,
  type DcrClient,
  type DcrClientRegistration,
  type DcrClientStore,
} from "./oauth-clients.js";

interface ProfileRow {
  id: string;
  instance_id: string;
  local_profile_id: string;
  display_name: string | null;
}

interface TransportRow {
  id: string;
  instance_id: string;
  kind: "https" | "agent";
  mcp_url: string | null;
  agent_public_key: string | null;
  disabled_at: number | null;
}

interface AuthorizationRow {
  id: string;
  profile_id: string;
  instance_id: string;
  transport_id: string;
  local_grant_id: string;
  scopes: string;
  expires_at: number;
  reauth_required: number;
  revoked_at: number | null;
}

export class SqliteConnectionStore
  implements ConnectionStore, DcrClientStore, AgentEnrollmentStore
{
  readonly #database: DatabaseSync;
  readonly oauth: TokenExchangeStore;
  readonly agentPairing: SqliteAgentPairing;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
    });
    try {
      // SQLite retries lock acquisition for up to five seconds per busy wait.
      this.#database.exec("PRAGMA busy_timeout=5000");
      this.#transaction(() => {
        const version = this.#database
          .prepare("PRAGMA user_version")
          .get()?.user_version;
        const kind = this.#database
          .prepare("PRAGMA application_id")
          .get()?.application_id;
        if (
          kind === connectionApplicationId &&
          version === connectionSchemaVersion
        )
          return;
        if (kind === connectionApplicationId && (version === 1 || version === 2)) {
          if (version === 1) this.#database.exec(agentRevocationSchema);
          this.#database.exec(connectionRetentionSchema);
          this.#database.exec(`PRAGMA user_version=${connectionSchemaVersion}`);
          return;
        }
        const empty =
          this.#database
            .prepare("SELECT 1 FROM sqlite_schema LIMIT 1")
            .get() === undefined;
        if (version !== 0 || kind !== 0 || !empty)
          throw new Error("Unsupported public MCP gateway database");
        this.#database.exec(connectionSchema);
        this.#database.exec(agentRevocationSchema);
        this.#database.exec(connectionRetentionSchema);
        this.#database.exec(
          `PRAGMA application_id=${connectionApplicationId}; PRAGMA user_version=${connectionSchemaVersion}`,
        );
      });
      this.#database.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON",
      );
      this.agentPairing = new SqliteAgentPairing(this.#database, (operation) =>
        this.#transaction(operation),
      );
      this.oauth = new SqliteOAuthTokens(
        this.#database,
        (operation) => this.#transaction(operation),
        (id) => this.authorization(id),
        (id, now) => this.#revoke(id, now),
        (proof, scopes, now) => {
          const approved = this.agentPairing.approvedGrant(proof, now);
          if (!approved || !samePairingScopes(approved.scopes, scopes))
            return undefined;
          const profile = this.#profileFor(
            approved.instanceId,
            approved.localProfileId,
          );
          return this.#createAuthorization(
            {
              profileId: profile.id,
              transportId: approved.transportId,
              localGrantId: approved.localGrantId,
              scopes: approved.scopes,
              expiresAt: now + authorizationLifetimeMs,
            },
            now,
          );
        },
      );
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  registerEnrollmentNonce(
    hash: string,
    expiresAt: number,
    now: number,
    capacity: number,
  ): boolean {
    return this.#transaction(() => {
      this.#database
        .prepare("DELETE FROM agent_enrollment_nonces WHERE expires_at <= ?")
        .run(now);
      return (
        this.#database
          .prepare(
            `
        INSERT INTO agent_enrollment_nonces (hash, expires_at)
        SELECT ?, ? WHERE (SELECT COUNT(*) FROM agent_enrollment_nonces) < ?
      `,
          )
          .run(hash, expiresAt, capacity).changes === 1
      );
    });
  }

  consumeAgentEnrollment(
    enrollment: RendererRelayAgentEnrollment,
    nonceHash: string,
    now: number,
    capacity: number,
  ): string | undefined {
    return this.#transaction(() => {
      const deleted = this.#database
        .prepare(
          `
        DELETE FROM agent_enrollment_nonces WHERE hash = ? AND expires_at > ?
      `,
        )
        .run(nonceHash, now).changes;
      if (deleted !== 1) return undefined;
      const existing = this.#database
        .prepare(
          `
        SELECT id FROM transports WHERE instance_id = ? AND agent_public_key = ? AND disabled_at IS NULL
      `,
        )
        .get(enrollment.instance.id, enrollment.agentPublicKey);
      if (typeof existing?.id === "string") {
        this.#putVerifiedInstance(enrollment.instance);
        return existing.id;
      }
      const previous = this.#database
        .prepare(
          "SELECT id FROM transports WHERE instance_id = ? AND kind = 'agent' AND disabled_at IS NULL",
        )
        .get(enrollment.instance.id);
      const limitReached = this.#database
        .prepare(
          `
        SELECT 1 WHERE (
          SELECT COUNT(*) FROM transports WHERE kind = 'agent' AND disabled_at IS NULL
        ) >= ?
      `,
        )
        .get(capacity);
      if (limitReached !== undefined && previous === undefined)
        return undefined;
      this.#putVerifiedInstance(enrollment.instance);
      const replacement = this.#addTransport(enrollment.instance.id, {
        kind: "agent",
        publicKey: enrollment.agentPublicKey,
      });
      if (typeof previous?.id === "string") {
        this.#database
          .prepare("UPDATE transports SET disabled_at = ? WHERE id = ?")
          .run(now, previous.id);
        this.#database
          .prepare(
            "UPDATE authorizations SET transport_id = ? WHERE transport_id = ? AND revoked_at IS NULL",
          )
          .run(replacement.id, previous.id);
        this.#database
          .prepare("DELETE FROM agent_pairings WHERE transport_id = ?")
          .run(previous.id);
        this.#database
          .prepare(
            "UPDATE agent_revocations SET transport_id = ? WHERE transport_id = ?",
          )
          .run(replacement.id, previous.id);
      }
      return replacement.id;
    });
  }

  putVerifiedInstance(instance: InstanceIdentity): void {
    this.#transaction(() => this.#putVerifiedInstance(instance));
  }

  #putVerifiedInstance(instance: InstanceIdentity): void {
    if (
      this.#database
        .prepare("SELECT 1 FROM transports WHERE agent_public_key = ?")
        .get(instance.publicKey)
    )
      throw new Error("An agent key cannot identify an instance");
    this.#database
      .prepare(
        `
      INSERT INTO instances (id, public_key) VALUES (?, ?)
      ON CONFLICT (id) DO NOTHING
    `,
      )
      .run(instance.id, instance.publicKey);
    const row = this.#database
      .prepare("SELECT public_key FROM instances WHERE id = ?")
      .get(instance.id);
    if (row?.public_key !== instance.publicKey)
      throw new Error("Instance identity does not match the registered key");
  }

  profileFor(
    instanceId: string,
    localProfileId: string,
    displayName?: string,
  ): ConnectionProfile {
    return this.#transaction(() =>
      this.#profileFor(instanceId, localProfileId, displayName),
    );
  }

  #profileFor(
    instanceId: string,
    localProfileId: string,
    displayName?: string,
  ): ConnectionProfile {
    this.#database
      .prepare(
        `
      INSERT INTO profiles (id, instance_id, local_profile_id, display_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (instance_id, local_profile_id) DO UPDATE
      SET display_name = COALESCE(excluded.display_name, profiles.display_name)
    `,
      )
      .run(newId("profile"), instanceId, localProfileId, displayName ?? null);
    const row = this.#database
      .prepare(
        `
      SELECT * FROM profiles WHERE instance_id = ? AND local_profile_id = ?
    `,
      )
      .get(instanceId, localProfileId) as unknown as ProfileRow;
    return decodeProfile(row);
  }

  profile(id: string): ConnectionProfile | undefined {
    const row = this.#database
      .prepare("SELECT * FROM profiles WHERE id = ?")
      .get(id) as unknown as ProfileRow | undefined;
    return row === undefined ? undefined : decodeProfile(row);
  }

  addTransport(
    instanceId: string,
    endpoint: TransportEndpoint,
  ): ConnectionTransport {
    return this.#transaction(() => this.#addTransport(instanceId, endpoint));
  }

  #addTransport(
    instanceId: string,
    endpoint: TransportEndpoint,
  ): ConnectionTransport {
    if (
      endpoint.kind === "agent" &&
      this.#database
        .prepare("SELECT 1 FROM instances WHERE public_key = ?")
        .get(endpoint.publicKey)
    )
      throw new Error("An instance key cannot authenticate an agent");
    const id = newId("transport");
    this.#database
      .prepare(
        `
      INSERT INTO transports (id, instance_id, kind, mcp_url, agent_public_key)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        instanceId,
        endpoint.kind,
        endpoint.kind === "https" ? endpoint.mcpUrl : null,
        endpoint.kind === "agent" ? endpoint.publicKey : null,
      );
    return { id, instanceId, endpoint, disabledAt: null };
  }

  transport(id: string): ConnectionTransport | undefined {
    const row = this.#database
      .prepare("SELECT * FROM transports WHERE id = ?")
      .get(id) as unknown as TransportRow | undefined;
    if (!row) return undefined;
    const { kind, mcp_url: mcpUrl, agent_public_key: publicKey } = row;
    if (kind === "https" ? mcpUrl === null : publicKey === null)
      throw new Error("Stored transport has no endpoint");
    return {
      id: row.id,
      instanceId: row.instance_id,
      endpoint:
        kind === "https"
          ? { kind, mcpUrl: mcpUrl as string }
          : { kind, publicKey: publicKey as string },
      disabledAt: row.disabled_at,
    };
  }

  disableTransport(id: string, now: number): boolean {
    return (
      this.#database
        .prepare(
          `
      UPDATE transports SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL
    `,
        )
        .run(now, id).changes === 1
    );
  }

  createAuthorization(
    input: NewAuthorization,
    now: number,
    sealHttpsCredentials?: (authorizationId: string) => string,
  ): ConnectionAuthorization {
    return this.#transaction(() =>
      this.#createAuthorization(input, now, sealHttpsCredentials),
    );
  }

  #createAuthorization(
    input: NewAuthorization,
    now: number,
    sealHttpsCredentials?: (authorizationId: string) => string,
  ): ConnectionAuthorization {
    const scopes = [...new Set(input.scopes)];
    if (
      !scopes.length ||
      !scopes.every(isRendererMcpScope) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= now
    )
      throw new Error("Invalid public MCP authorization scope or expiration");
    const profile = this.profile(input.profileId);
    const transport = this.transport(input.transportId);
    if (
      !profile ||
      !transport ||
      transport.disabledAt !== null ||
      profile.instanceId !== transport.instanceId
    )
      throw new Error(
        "Authorization does not match an enabled transport for the profile",
      );
    if (
      (transport.endpoint.kind === "https") !==
      (sealHttpsCredentials !== undefined)
    )
      throw new Error(
        "HTTPS credentials are only stored for HTTPS authorizations",
      );
    if (
      scopes.includes("mcp:delete") &&
      !this.hasBaseAccess(profile.instanceId, profile.localProfileId, now)
    )
      throw new Error(
        "Connect with read or render access before approving deletion",
      );
    const id = newId("authorization");
    this.#database
      .prepare(
        `
      INSERT INTO authorizations (id, instance_id, profile_id, transport_id, local_grant_id, scopes, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        profile.instanceId,
        input.profileId,
        input.transportId,
        input.localGrantId,
        JSON.stringify(scopes),
        input.expiresAt,
      );
    if (sealHttpsCredentials !== undefined) {
      this.#database
        .prepare(
          `
        INSERT INTO https_credentials (authorization_id, envelope, generation) VALUES (?, ?, 1)
      `,
        )
        .run(id, sealHttpsCredentials(id));
    }
    return {
      ...input,
      id,
      instanceId: profile.instanceId,
      scopes,
      reauthRequired: false,
      revokedAt: null,
    };
  }

  hasBaseAccess(
    instanceId: string,
    localProfileId: string,
    now: number,
  ): boolean {
    return (
      this.#database
        .prepare(
          `
      SELECT 1 FROM authorizations a
      JOIN profiles p ON p.id = a.profile_id
      JOIN transports t ON t.id = a.transport_id
      WHERE a.instance_id = ? AND p.local_profile_id = ? AND a.expires_at > ?
        AND a.revoked_at IS NULL AND a.reauth_required = 0 AND t.disabled_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(a.scopes) WHERE value IN ('mcp:read', 'mcp:render'))
      LIMIT 1
    `,
        )
        .get(instanceId, localProfileId, now) !== undefined
    );
  }

  authorization(id: string): ConnectionAuthorization | undefined {
    const row = this.#database
      .prepare("SELECT * FROM authorizations WHERE id = ?")
      .get(id) as unknown as AuthorizationRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      instanceId: row.instance_id,
      profileId: row.profile_id,
      transportId: row.transport_id,
      localGrantId: row.local_grant_id,
      scopes: decodeStoredScopes(row.scopes),
      expiresAt: row.expires_at,
      reauthRequired: row.reauth_required === 1,
      revokedAt: row.revoked_at,
    };
  }

  requireReauthentication(id: string): boolean {
    return (
      this.#database
        .prepare(
          `
      UPDATE authorizations SET reauth_required = 1
      WHERE id = ? AND revoked_at IS NULL AND reauth_required = 0
    `,
        )
        .run(id).changes === 1
    );
  }

  revokeAuthorization(id: string, now: number): boolean {
    return this.#transaction(() => this.#revoke(id, now));
  }

  disconnect(id: string, now: number, forget: boolean): boolean {
    return this.#transaction(() => {
      const authorization = this.authorization(id);
      if (!authorization) return false;
      const transport = this.transport(authorization.transportId);
      if (
        transport?.endpoint.kind === "agent" &&
        authorization.expiresAt > now
      ) {
        this.#database
          .prepare(`INSERT OR IGNORE INTO agent_revocations VALUES (?, ?, ?)`)
          .run(
            transport.id,
            authorization.localGrantId,
            authorization.expiresAt,
          );
      }
      this.#revoke(id, now);
      if (!forget) return true;
      this.#database.prepare("DELETE FROM authorizations WHERE id = ?").run(id);
      this.#database
        .prepare(
          `
        DELETE FROM profiles WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM authorizations WHERE profile_id = profiles.id)
      `,
        )
        .run(authorization.profileId);
      if (transport?.endpoint.kind === "https") {
        this.#database
          .prepare(
            `
          DELETE FROM transports WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM authorizations WHERE transport_id = transports.id)
        `,
          )
          .run(transport.id);
      }
      return true;
    });
  }

  pendingAgentRevocations(transportId: string, now: number): string[] {
    return this.#database
      .prepare(
        `
      SELECT local_grant_id FROM agent_revocations
      WHERE transport_id = ? AND expires_at > ? ORDER BY expires_at LIMIT 16
    `,
      )
      .all(transportId, now)
      .flatMap((row) =>
        typeof row.local_grant_id === "string" ? [row.local_grant_id] : [],
      );
  }

  acknowledgeAgentRevocation(transportId: string, grantId: string): void {
    this.#database
      .prepare(
        "DELETE FROM agent_revocations WHERE transport_id = ? AND local_grant_id = ?",
      )
      .run(transportId, grantId);
  }

  revokeAgentGrant(
    transportId: string,
    localGrantId: string,
    now: number,
  ): boolean {
    return this.#transaction(() => {
      this.#database
        .prepare(
          "DELETE FROM agent_pairings WHERE transport_id = ? AND local_grant_id = ?",
        )
        .run(transportId, localGrantId);
      const row = this.#database
        .prepare(
          "SELECT id FROM authorizations WHERE transport_id = ? AND local_grant_id = ?",
        )
        .get(transportId, localGrantId);
      this.acknowledgeAgentRevocation(transportId, localGrantId);
      return typeof row?.id === "string" && this.#revoke(row.id, now);
    });
  }

  #revoke(id: string, now: number): boolean {
    const updated =
      this.#database
        .prepare(
          `
      UPDATE authorizations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
    `,
        )
        .run(now, id).changes === 1;
    this.#database.prepare(
      `UPDATE oauth_dcr_clients SET last_authorization_end = MAX(last_authorization_end, (
          SELECT MIN(expires_at, COALESCE(revoked_at, expires_at)) FROM authorizations WHERE id = ?
        ))
        WHERE id = (SELECT oauth_client_id FROM authorizations WHERE id = ?)`,
    ).run(id, id);
    this.#database
      .prepare("DELETE FROM https_credentials WHERE authorization_id = ?")
      .run(id);
    this.#database
      .prepare("DELETE FROM oauth_codes WHERE authorization_id = ?")
      .run(id);
    this.#database
      .prepare("DELETE FROM oauth_families WHERE authorization_id = ?")
      .run(id);
    return updated;
  }

  invalidateRestoredAuthorizations(now: number): number {
    return this.#transaction(() => {
      const invalidated = this.#database
        .prepare(
          `
        UPDATE authorizations SET revoked_at = ? WHERE revoked_at IS NULL
      `,
        )
        .run(now).changes;
      this.#database
        .prepare(
          "UPDATE transports SET disabled_at = ? WHERE kind = 'agent' AND disabled_at IS NULL",
        )
        .run(now);
      this.#database.exec(
        "DELETE FROM https_credentials; DELETE FROM oauth_consents; DELETE FROM oauth_codes; DELETE FROM oauth_families; DELETE FROM agent_enrollment_nonces; DELETE FROM agent_pairing_attempts; DELETE FROM agent_revocations",
      );
      return Number(invalidated);
    });
  }

  pruneExpiredCredentials(now: number) {
    return this.#transaction(() => {
      const expired = "SELECT id FROM authorizations WHERE expires_at <= ?";
      let expiredRecordsRemoved = 0;
      for (const statement of [
        "DELETE FROM oauth_codes WHERE expires_at <= ?",
        `DELETE FROM oauth_families WHERE authorization_id IN (${expired})`,
        `DELETE FROM https_credentials WHERE authorization_id IN (${expired})`,
        "DELETE FROM oauth_consents WHERE expires_at <= ?",
        "DELETE FROM client_assertions WHERE expires_at <= ?",
        "DELETE FROM agent_enrollment_nonces WHERE expires_at <= ?",
        "DELETE FROM agent_pairing_attempts WHERE window_end <= ?",
        "DELETE FROM agent_revocations WHERE expires_at <= ?",
      ]) {
        expiredRecordsRemoved += Number(
          this.#database.prepare(statement).run(now).changes,
        );
      }
      const removed = this.#database
        .prepare(
          `DELETE FROM authorizations WHERE id IN (
          SELECT id FROM authorizations WHERE expires_at <= ? ORDER BY expires_at, id LIMIT 200
        ) RETURNING profile_id, transport_id`,
        )
        .all(now - expiredConnectionRetentionMs) as {
        profile_id: string;
        transport_id: string;
      }[];
      const clearProfile = this.#database.prepare(
        `UPDATE profiles SET display_name=NULL WHERE id=?
          AND NOT EXISTS (SELECT 1 FROM authorizations WHERE profile_id=profiles.id)`,
      );
      const removeTransport = this.#database.prepare(
        `DELETE FROM transports WHERE id=? AND kind='https'
          AND NOT EXISTS (SELECT 1 FROM authorizations WHERE transport_id=transports.id)`,
      );
      for (const row of removed) {
        clearProfile.run(row.profile_id);
        removeTransport.run(row.transport_id);
      }
      const dcrRegistrationsReclaimed = this.#pruneDcrClients(now);
      const { count } = this.#database
        .prepare("SELECT COUNT(*) AS count FROM oauth_dcr_clients")
        .get() as { count: number };
      return {
        expiredRecordsRemoved,
        expiredConnectionsRemoved: removed.length,
        dcrRegistrationsReclaimed,
        dcrRegistrationsUsed: count,
      };
    });
  }

  #pruneDcrClients(now: number): number {
    const cutoff = now - dcrClientRetentionMs;
    const { changes } = this.#database
      .prepare(
        `DELETE FROM oauth_dcr_clients AS client
        WHERE client.created_at <= ? AND client.last_authorization_end <= ?
          AND NOT EXISTS (
            SELECT 1 FROM authorizations
            WHERE oauth_client_id = client.id
              AND MIN(expires_at, COALESCE(revoked_at, expires_at)) > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM oauth_consents WHERE client_id = client.id AND expires_at > ?
          )`,
      )
      .run(cutoff, cutoff, cutoff, now);
    return Number(changes);
  }

  claimClientAssertion(hash: string, expiresAt: number, now: number): boolean {
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now
    )
      return false;
    return this.#transaction(() => {
      this.#database
        .prepare("DELETE FROM client_assertions WHERE expires_at <= ?")
        .run(now);
      return (
        this.#database
          .prepare(
            `
        INSERT INTO client_assertions (hash, expires_at) VALUES (?, ?)
        ON CONFLICT DO NOTHING
      `,
          )
          .run(hash, expiresAt).changes === 1
      );
    });
  }

  registerDcrClient(
    registration: DcrClientRegistration,
    capacity: number,
    now: number,
  ): DcrClient | undefined {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(now))
      throw new Error("A DCR client capacity is required");
    const id = newId("gateway_client");
    const inserted = this.#transaction(() => {
      this.#pruneDcrClients(now);
      return this.#database
        .prepare(
          `
      INSERT INTO oauth_dcr_clients (id, display_name, redirect_uris, created_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM oauth_dcr_clients) < ?
    `,
        )
        .run(
          id,
          registration.clientName,
          JSON.stringify(registration.redirectUris),
          now,
          capacity,
        ).changes === 1;
    });
    return inserted ? { id, ...registration } : undefined;
  }

  dcrClient(id: string): DcrClient | undefined {
    const row = this.#database
      .prepare(
        "SELECT display_name, redirect_uris FROM oauth_dcr_clients WHERE id = ?",
      )
      .get(id) as { display_name: string; redirect_uris: string } | undefined;
    if (!row) return undefined;
    const redirectUris: unknown = JSON.parse(row.redirect_uris);
    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.length ||
      !redirectUris.every((uri): uri is string => typeof uri === "string")
    )
      throw new Error("Registered OAuth callbacks are invalid");
    return { id, clientName: row.display_name, redirectUris };
  }

  httpsCredentials(
    id: string,
    now: number,
  ): { envelope: string; generation: number } | undefined {
    return this.#database
      .prepare(
        `
      SELECT c.envelope, c.generation FROM https_credentials c
      JOIN authorizations a ON a.id = c.authorization_id
      JOIN transports t ON t.id = a.transport_id
      WHERE a.id = ? AND a.revoked_at IS NULL AND a.reauth_required = 0
        AND a.expires_at > ? AND t.kind = 'https' AND t.disabled_at IS NULL
    `,
      )
      .get(id, now) as { envelope: string; generation: number } | undefined;
  }

  replaceHttpsCredentials(
    id: string,
    envelope: string,
    expectedGeneration: number,
    now: number,
  ): boolean {
    return (
      this.#database
        .prepare(
          `
      UPDATE https_credentials SET envelope = ?, generation = generation + 1
      WHERE authorization_id = ? AND generation = ? AND EXISTS (
        SELECT 1 FROM authorizations a JOIN transports t ON t.id = a.transport_id
        WHERE a.id = https_credentials.authorization_id AND a.expires_at > ?
          AND a.revoked_at IS NULL AND a.reauth_required = 0
          AND t.kind = 'https' AND t.disabled_at IS NULL
      )
    `,
        )
        .run(envelope, id, expectedGeneration, now).changes === 1
    );
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function decodeProfile(row: ProfileRow): ConnectionProfile {
  return {
    id: row.id,
    instanceId: row.instance_id,
    localProfileId: row.local_profile_id,
    displayName: row.display_name,
  };
}
