import { createHash, randomBytes } from "node:crypto";
import {
  lanHttpsAddress,
  normalizeLanHttpsDomain,
  validateLanHttpsAuthorityPolicy,
} from "../../packages/server-setup-core/src/lan-https.mjs";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import {
  lanHttpsBodyHash,
  lanHttpsPublicIdentity,
  verifyLanHttpsProof,
} from "./proof.mjs";
import {
  canonicalLanHttpsAcmePublicKey,
  createLanHttpsExternalAccountBinding,
} from "./eab.mjs";

export class LanHttpsAuthorityError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "LanHttpsAuthorityError";
    this.code = code;
    this.status = status;
  }
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, status = 400) => {
  throw new LanHttpsAuthorityError(code, status);
};

function objectBody(body, keys) {
  lanHttpsBodyHash(body);
  try {
    return profileRecord(
      JSON.parse(body.toString("utf8")),
      "LAN HTTPS request",
      keys,
    );
  } catch {
    return fail("invalid_request");
  }
}

export function lanHttpsManagementHostname(installationId, domain) {
  if (
    typeof installationId !== "string" ||
    !/^[0-9a-f]{64}$/.test(installationId)
  )
    fail("invalid_identity");
  // Base 36 preserves the complete 256-bit identity in one legal DNS label.
  const hostname = `i-${BigInt(`0x${installationId}`).toString(36)}.instances.${normalizeLanHttpsDomain(domain)}`;
  if (hostname.length + 16 > 253) fail("management_name_too_long");
  return hostname;
}

// This owns a dedicated authority database, NEVER the application database.
// Caller supplies an opened connection to a private, service-owned directory.
// No network listeners, CA calls or credential files are opened by this class.
export class LanHttpsAuthorityStore {
  #db;
  #policy;
  #clock;

  constructor({ database, policy, now = Date.now }) {
    this.#db = database;
    this.#policy = validateLanHttpsAuthorityPolicy(policy);
    this.#clock = now;
    lanHttpsManagementHostname("f".repeat(64), this.#policy.lanDomain);
    this.#db.exec(
      "PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;",
    );
    const check = this.#db.prepare("PRAGMA quick_check").get();
    if (check?.quick_check !== "ok") fail("authority_state_invalid", 503);
    const application = this.#db
      .prepare("PRAGMA application_id")
      .get()?.application_id;
    const version = this.#db.prepare("PRAGMA user_version").get()?.user_version;
    if (application === 0 && version === 0) {
      if (
        this.#db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1",
          )
          .get()
      )
        fail("authority_database_not_empty", 503);
      this.#db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE authority_installations (
          id TEXT PRIMARY KEY, public_key TEXT NOT NULL,
          created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
        );
        CREATE TABLE authority_nonces (
          digest TEXT PRIMARY KEY, installation_id TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE INDEX authority_nonce_expiry ON authority_nonces(expires_at);
        CREATE INDEX authority_nonce_owner ON authority_nonces(installation_id);
        CREATE TABLE authority_acme_accounts (
          installation_id TEXT NOT NULL REFERENCES authority_installations(id),
          issuer_id TEXT NOT NULL, public_key TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(installation_id,issuer_id)
        );
        CREATE TABLE authority_invites (
          digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL,
          remaining INTEGER NOT NULL CHECK(remaining >= 0)
        );
        CREATE TABLE authority_challenges (
          id TEXT PRIMARY KEY,
          installation_id TEXT NOT NULL REFERENCES authority_installations(id),
          name TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL,
          UNIQUE(installation_id,name,value)
        );
        CREATE INDEX authority_challenge_expiry ON authority_challenges(expires_at);
        CREATE INDEX authority_challenge_name ON authority_challenges(name);
        PRAGMA application_id=1279348273;
        PRAGMA user_version=1;
        COMMIT;`);
    } else if (application !== 1279348273 || version !== 1) {
      fail("authority_schema_unsupported", 503);
    }
    // Bound the database itself as well as logical records; no growing WAL.
    if (this.#db.prepare("PRAGMA page_size").get()?.page_size !== 4096)
      fail("authority_page_size_unsupported", 503);
    this.#db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA journal_size_limit=131072;",
    );
    if (
      this.#db.prepare("PRAGMA max_page_count=16384").get()?.max_page_count !==
      16384
    )
      fail("authority_database_too_large", 503);
    this.#db
      .prepare(
        "SELECT id,public_key,revoked FROM authority_installations LIMIT 1",
      )
      .all();
  }

  get policy() {
    return this.#policy;
  }

  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0)
      fail("authority_clock_invalid", 503);
    return now;
  }

  #transaction(action) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const now = this.#now();
      this.#prune(now);
      const result = action(now);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #prune(now) {
    this.#db
      .prepare("DELETE FROM authority_nonces WHERE expires_at<=?")
      .run(now);
    this.#db
      .prepare(
        "DELETE FROM authority_invites WHERE expires_at<=? OR remaining=0",
      )
      .run(now);
    this.#db
      .prepare("DELETE FROM authority_challenges WHERE expires_at<=?")
      .run(now);
  }

  gc() {
    return this.#transaction(() => this.counts());
  }

  counts() {
    const count = (table) =>
      Number(
        this.#db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
      );
    return Object.freeze({
      installations: count("authority_installations"),
      nonces: count("authority_nonces"),
      invites: count("authority_invites"),
      challenges: count("authority_challenges"),
    });
  }

  issueNonce(publicKey) {
    const identity = lanHttpsPublicIdentity(publicKey);
    return this.#transaction((now) => {
      const limits = this.#policy.limits;
      if (
        this.counts().nonces >= limits.maxNonces ||
        Number(
          this.#db
            .prepare(
              "SELECT count(*) AS count FROM authority_nonces WHERE installation_id=?",
            )
            .get(identity.installationId).count,
        ) >= limits.maxNoncesPerInstallation
      )
        fail("nonce_capacity", 429);
      const nonce = randomBytes(32).toString("base64url");
      const expiresAt = now + limits.nonceTtlMs;
      this.#db
        .prepare("INSERT INTO authority_nonces VALUES(?,?,?)")
        .run(hash(nonce), identity.installationId, expiresAt);
      return Object.freeze({
        installationId: identity.installationId,
        nonce,
        expiresAt,
      });
    });
  }

  #consume(publicKey, proof, path, body, now) {
    let identity;
    try {
      identity = verifyLanHttpsProof(publicKey, proof, {
        audience: this.#policy.serverOrigin,
        nonce: proof?.nonce,
        path,
        body,
      });
    } catch {
      fail("authentication_rejected", 401);
    }
    const removed = this.#db
      .prepare(
        "DELETE FROM authority_nonces WHERE digest=? AND installation_id=? AND expires_at>?",
      )
      .run(hash(proof.nonce), identity.installationId, now);
    if (Number(removed.changes) !== 1) fail("authentication_rejected", 401);
    return identity;
  }

  enroll(body, proof) {
    const input = objectBody(body, ["publicKey", "invitationCode"]);
    const identity = lanHttpsPublicIdentity(input.publicKey);
    return this.#transaction((now) => {
      this.#consume(identity.publicKey, proof, "/v1/enroll", body, now);
      const existing = this.#db
        .prepare(
          "SELECT public_key,revoked FROM authority_installations WHERE id=?",
        )
        .get(identity.installationId);
      if (existing) {
        if (
          existing.revoked ||
          existing.public_key !== JSON.stringify(identity.publicKey)
        )
          fail("installation_rejected", 403);
        this.#db
          .prepare("UPDATE authority_installations SET last_seen=? WHERE id=?")
          .run(now, identity.installationId);
        return Object.freeze({
          installationId: identity.installationId,
          created: false,
        });
      }
      if (this.counts().installations >= this.#policy.limits.maxInstallations)
        fail("installation_capacity", 429);
      if (this.#policy.registration === "invite") {
        const code = input.invitationCode;
        if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code))
          fail("invitation_required", 403);
        const used = this.#db
          .prepare(
            "UPDATE authority_invites SET remaining=remaining-1 WHERE digest=? AND expires_at>? AND remaining>0",
          )
          .run(hash(code), now);
        if (Number(used.changes) !== 1) fail("invitation_rejected", 403);
      } else if (Object.hasOwn(input, "invitationCode")) {
        fail("invitation_not_required");
      }
      this.#db
        .prepare(
          "INSERT INTO authority_installations(id,public_key,created_at,last_seen) VALUES(?,?,?,?)",
        )
        .run(
          identity.installationId,
          JSON.stringify(identity.publicKey),
          now,
          now,
        );
      return Object.freeze({
        installationId: identity.installationId,
        created: true,
      });
    });
  }

  // Administrative local operation. Never expose this on the public API.
  createInvite({ uses = 1, ttlMs = 86_400_000 } = {}) {
    if (this.#policy.registration !== "invite") fail("invitations_disabled");
    if (
      !Number.isSafeInteger(uses) ||
      uses < 1 ||
      uses > 100 ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 31 * 86_400_000
    )
      fail("invalid_invitation_limits");
    return this.#transaction((now) => {
      if (this.counts().invites >= this.#policy.limits.maxInvites)
        fail("invitation_capacity", 429);
      const code = randomBytes(32).toString("base64url");
      this.#db
        .prepare("INSERT INTO authority_invites VALUES(?,?,?)")
        .run(hash(code), now + ttlMs, uses);
      return Object.freeze({ code, expiresAt: now + ttlMs, uses });
    });
  }

  bindAcmeAccount(body, proof, issuer) {
    const input = objectBody(body, ["issuer", "publicKey"]);
    // Issuer configuration is selected by the authority from its private
    // configuration. Never accept endpoint, KID, HMAC or policy from a client.
    if (
      typeof issuer?.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(issuer.id) ||
      input.issuer !== issuer.id
    )
      fail("issuer_not_configured");
    const key = canonicalLanHttpsAcmePublicKey(input.publicKey);
    const serialized = JSON.stringify(key);
    return this.#authenticated(proof, "/v1/acme/bind", body, (id, now) => {
      const existing = this.#db
        .prepare(
          "SELECT public_key FROM authority_acme_accounts WHERE installation_id=? AND issuer_id=?",
        )
        .get(id, issuer.id);
      if (existing && existing.public_key !== serialized)
        fail("acme_account_key_already_bound", 409);
      if (!existing) {
        if (
          Number(
            this.#db
              .prepare(
                "SELECT count(*) AS count FROM authority_acme_accounts WHERE installation_id=?",
              )
              .get(id).count,
          ) >= 4
        )
          fail("acme_issuer_capacity", 429);
        this.#db
          .prepare("INSERT INTO authority_acme_accounts VALUES(?,?,?,?)")
          .run(id, issuer.id, serialized, now);
      }
      return Object.freeze({
        issuer: issuer.id,
        externalAccountBinding: createLanHttpsExternalAccountBinding(
          key,
          issuer,
        ),
      });
    });
  }

  #authenticated(proof, path, body, action) {
    return this.#transaction((now) => {
      if (!proof || typeof proof.installationId !== "string")
        fail("authentication_rejected", 401);
      const row = this.#db
        .prepare(
          "SELECT public_key,revoked FROM authority_installations WHERE id=?",
        )
        .get(proof.installationId);
      if (!row || row.revoked) fail("authentication_rejected", 401);
      const identity = this.#consume(
        JSON.parse(row.public_key),
        proof,
        path,
        body,
        now,
      );
      const result = action(identity.installationId, now);
      this.#db
        .prepare("UPDATE authority_installations SET last_seen=? WHERE id=?")
        .run(now, identity.installationId);
      return result;
    });
  }

  presentChallenge(body, proof) {
    const input = objectBody(body, ["hostname", "value"]);
    if (
      typeof input.hostname !== "string" ||
      typeof input.value !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.value) ||
      Buffer.from(input.value, "base64url").toString("base64url") !==
        input.value
    )
      fail("invalid_challenge");
    return this.#authenticated(
      proof,
      "/v1/challenge/present",
      body,
      (id, now) => {
        const hostname = input.hostname;
        if (
          hostname !== lanHttpsManagementHostname(id, this.#policy.lanDomain)
        ) {
          try {
            lanHttpsAddress(hostname, this.#policy.lanDomain);
          } catch {
            fail("hostname_not_authorized", 403);
          }
        }
        if (hostname !== hostname.toLowerCase() || hostname.length + 16 > 253)
          fail("hostname_not_authorized", 403);
        const name = `_acme-challenge.${hostname}`;
        const existing = this.#db
          .prepare(
            "SELECT id,expires_at AS expiresAt FROM authority_challenges WHERE installation_id=? AND name=? AND value=?",
          )
          .get(id, name, input.value);
        if (existing) return Object.freeze({ ...existing });
        const limits = this.#policy.limits;
        if (
          this.counts().challenges >= limits.maxChallenges ||
          Number(
            this.#db
              .prepare(
                "SELECT count(*) AS count FROM authority_challenges WHERE installation_id=?",
              )
              .get(id).count,
          ) >= limits.maxChallengesPerInstallation
        )
          fail("challenge_capacity", 429);
        const challengeId = randomBytes(16).toString("hex");
        const expiresAt = now + limits.challengeTtlMs;
        this.#db
          .prepare("INSERT INTO authority_challenges VALUES(?,?,?,?,?)")
          .run(challengeId, id, name, input.value, expiresAt);
        return Object.freeze({ id: challengeId, expiresAt });
      },
    );
  }

  removeChallenge(body, proof) {
    const input = objectBody(body, ["id"]);
    if (typeof input.id !== "string" || !/^[0-9a-f]{32}$/.test(input.id))
      fail("invalid_challenge");
    return this.#authenticated(proof, "/v1/challenge/remove", body, (id) => {
      const result = this.#db
        .prepare(
          "DELETE FROM authority_challenges WHERE id=? AND installation_id=?",
        )
        .run(input.id, id);
      return Object.freeze({ removed: Number(result.changes) === 1 });
    });
  }

  challengeValues(name) {
    if (
      typeof name !== "string" ||
      name.length > 253 ||
      !name.startsWith("_acme-challenge.")
    )
      return Object.freeze([]);
    return Object.freeze(
      this.#db
        .prepare(
          "SELECT DISTINCT value FROM authority_challenges WHERE name=? AND expires_at>? ORDER BY value",
        )
        .all(name, this.#now())
        .map((row) => row.value),
    );
  }

  // Administrative local operation; revoked identities cannot enroll again.
  revokeInstallation(id) {
    if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id))
      fail("invalid_identity");
    return this.#transaction(() => {
      this.#db
        .prepare("UPDATE authority_installations SET revoked=1 WHERE id=?")
        .run(id);
      this.#db
        .prepare("DELETE FROM authority_nonces WHERE installation_id=?")
        .run(id);
      this.#db
        .prepare("DELETE FROM authority_challenges WHERE installation_id=?")
        .run(id);
    });
  }
}
