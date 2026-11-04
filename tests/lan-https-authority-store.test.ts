import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LanHttpsAuthorityStore,
  lanHttpsManagementHostname,
} from "../deploy/lan-https/authority-store.mjs";
import {
  createLanHttpsProof,
  lanHttpsPublicIdentity,
} from "../deploy/lan-https/proof.mjs";

const defaults = {
  format: 1,
  registration: "open",
  serverOrigin: "https://akebi.example.test",
  lanDomain: "lan.example.test",
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function installation() {
  const key = generateKeyPairSync("ed25519");
  const exported = key.publicKey.export({ format: "jwk" });
  const publicKey = { kty: "OKP", crv: "Ed25519", x: exported.x };
  return {
    key,
    publicKey,
    id: lanHttpsPublicIdentity(publicKey).installationId,
  };
}
function fixture(policy = {}, database?: DatabaseSync) {
  const db = database ?? new DatabaseSync(":memory:");
  if (!database) cleanups.push(() => db.close());
  let now = 1_800_000_000_000;
  const store = new LanHttpsAuthorityStore({
    database: db,
    policy: { ...defaults, ...policy },
    now: () => now,
  });
  const request = (
    who: ReturnType<typeof installation>,
    path: string,
    value: object,
  ) => {
    const body = Buffer.from(JSON.stringify(value));
    const challenge = store.issueNonce(who.publicKey);
    const proof = createLanHttpsProof(who.key.privateKey, {
      audience: defaults.serverOrigin,
      nonce: challenge.nonce,
      path,
      body,
    });
    return { body, proof };
  };
  const enroll = (who: ReturnType<typeof installation>, extra = {}) => {
    const r = request(who, "/v1/enroll", {
      publicKey: who.publicKey,
      ...extra,
    });
    return store.enroll(r.body, r.proof);
  };
  const present = (
    who: ReturnType<typeof installation>,
    value = randomBytes(32).toString("base64url"),
    hostname = "192-168-1-50.lan.example.test",
  ) => {
    const r = request(who, "/v1/challenge/present", { hostname, value });
    return { ...store.presentChallenge(r.body, r.proof), value, request: r };
  };
  return {
    db,
    store,
    request,
    enroll,
    present,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("bounded persistent LAN authority state", () => {
  it("allows automatic enrollment with a signed server nonce, and makes successful proofs single-use", () => {
    const f = fixture();
    const who = installation();
    const r = f.request(who, "/v1/enroll", { publicKey: who.publicKey });
    expect(f.store.enroll(r.body, r.proof)).toEqual({
      installationId: who.id,
      created: true,
    });
    expect(() => f.store.enroll(r.body, r.proof)).toThrow(
      /authentication_rejected/,
    );
    expect(f.enroll(who)).toEqual({ installationId: who.id, created: false });
    expect(f.store.counts().installations).toBe(1);
    expect(f.store.counts().nonces).toBe(0);
  });
  it("enforces invite mode at the server and bounds code expiry and uses", () => {
    const f = fixture({ registration: "invite" });
    expect(() => f.enroll(installation(), { registration: "open" })).toThrow(
      /invalid_request/,
    );
    const one = installation();
    expect(() => f.enroll(one)).toThrow(/invitation_required/);
    const invitation = f.store.createInvite({ uses: 1, ttlMs: 1000 });
    expect(f.enroll(one, { invitationCode: invitation.code }).created).toBe(
      true,
    );
    expect(f.enroll(one).created).toBe(false);
    expect(() =>
      f.enroll(installation(), { invitationCode: invitation.code }),
    ).toThrow(/invitation_rejected/);
    const expired = f.store.createInvite({ ttlMs: 1 });
    f.advance(2);
    expect(() =>
      f.enroll(installation(), { invitationCode: expired.code }),
    ).toThrow(/invitation_rejected/);
    expect(f.store.counts().installations).toBe(1);
    for (const options of [
      { uses: 0 },
      { uses: 101 },
      { ttlMs: -1 },
      { ttlMs: Infinity },
    ])
      expect(() => f.store.createInvite(options)).toThrow(
        /invalid_invitation_limits/,
      );
    expect(() => fixture().store.createInvite()).toThrow(
      /invitations_disabled/,
    );
  });
  it("never stores a registration code or nonce in plaintext", () => {
    const f = fixture({ registration: "invite" });
    const invite = f.store.createInvite();
    const nonce = f.store.issueNonce(installation().publicKey);
    expect(
      JSON.stringify(f.db.prepare("SELECT * FROM authority_invites").all()),
    ).not.toContain(invite.code);
    expect(
      JSON.stringify(f.db.prepare("SELECT * FROM authority_nonces").all()),
    ).not.toContain(nonce.nonce);
  });
  it("expires a nonce using server time and reclaims bounded temporary records", () => {
    const f = fixture({
      limits: { nonceTtlMs: 100, maxNonces: 2, maxNoncesPerInstallation: 1 },
    });
    const who = installation();
    const r = f.request(who, "/v1/enroll", { publicKey: who.publicKey });
    expect(() => f.store.issueNonce(who.publicKey)).toThrow(/nonce_capacity/);
    f.store.issueNonce(installation().publicKey);
    expect(() => f.store.issueNonce(installation().publicKey)).toThrow(
      /nonce_capacity/,
    );
    f.advance(100);
    expect(() => f.store.enroll(r.body, r.proof)).toThrow(
      /authentication_rejected/,
    );
    expect(f.store.gc().nonces).toBe(0);
    expect(f.enroll(who).created).toBe(true);
  });
  it("refuses a signature from another key and a proof issued by another authority", () => {
    const f = fixture();
    const who = installation();
    const r = f.request(who, "/v1/enroll", { publicKey: who.publicKey });
    const bad = createLanHttpsProof(installation().key.privateKey, {
      audience: defaults.serverOrigin,
      nonce: r.proof.nonce,
      path: "/v1/enroll",
      body: r.body,
    });
    expect(() => f.store.enroll(r.body, bad)).toThrow(
      /authentication_rejected/,
    );
    const other = createLanHttpsProof(who.key.privateKey, {
      audience: "https://another.test",
      nonce: r.proof.nonce,
      path: "/v1/enroll",
      body: r.body,
    });
    expect(() => f.store.enroll(r.body, other)).toThrow(
      /authentication_rejected/,
    );
    expect(f.store.counts().installations).toBe(0);
    expect(f.store.enroll(r.body, r.proof).created).toBe(true);
  });
  it("preserves simultaneous TXT values from different installations for the same IP-derived name", () => {
    const f = fixture();
    const a = installation(),
      b = installation();
    f.enroll(a);
    f.enroll(b);
    const first = f.present(a),
      second = f.present(b);
    const name = "_acme-challenge.192-168-1-50.lan.example.test";
    expect(f.store.challengeValues(name)).toEqual(
      [first.value, second.value].sort(),
    );
    const foreign = f.request(a, "/v1/challenge/remove", { id: second.id });
    expect(f.store.removeChallenge(foreign.body, foreign.proof)).toEqual({
      removed: false,
    });
    const remove = f.request(a, "/v1/challenge/remove", { id: first.id });
    expect(f.store.removeChallenge(remove.body, remove.proof)).toEqual({
      removed: true,
    });
    expect(f.store.challengeValues(name)).toEqual([second.value]);
    const repeat = f.request(a, "/v1/challenge/remove", { id: first.id });
    expect(f.store.removeChallenge(repeat.body, repeat.proof)).toEqual({
      removed: false,
    });
    expect(f.store.challengeValues(name)).toEqual([second.value]);
  });
  it("does not extend challenge expiry on duplicate registration or delete an identical value owned by another installation", () => {
    const f = fixture({ limits: { challengeTtlMs: 1000 } });
    const a = installation(),
      b = installation();
    f.enroll(a);
    f.enroll(b);
    const first = f.present(a);
    f.advance(100);
    const again = f.present(a, first.value),
      same = f.present(b, first.value);
    expect(again.id).toBe(first.id);
    expect(again.expiresAt).toBe(first.expiresAt);
    const r = f.request(a, "/v1/challenge/remove", { id: first.id });
    f.store.removeChallenge(r.body, r.proof);
    expect(f.store.counts().challenges).toBe(1);
    expect(same.id).not.toBe(first.id);
    expect(
      f.store.challengeValues("_acme-challenge.192-168-1-50.lan.example.test"),
    ).toEqual([first.value]);
    f.advance(1000);
    expect(
      f.store.challengeValues("_acme-challenge.192-168-1-50.lan.example.test"),
    ).toEqual([]);
    expect(f.store.gc().challenges).toBe(0);
  });
  it("authorizes only canonical private IP names and the requesting installation's management name", () => {
    const f = fixture({ limits: { maxNoncesPerInstallation: 16 } });
    const a = installation(),
      b = installation();
    f.enroll(a);
    f.enroll(b);
    expect(
      lanHttpsManagementHostname(a.id, defaults.lanDomain).split(".")[0]
        ?.length,
    ).toBeLessThanOrEqual(63);
    expect(
      f.present(
        a,
        undefined,
        lanHttpsManagementHostname(a.id, defaults.lanDomain),
      ).id,
    ).toHaveLength(32);
    for (const hostname of [
      "example.test",
      "*.lan.example.test",
      "lan.example.test",
      "127-0-0-1.lan.example.test",
      "192-168-1-50.LAN.example.test",
      "192-168-1-50.lan.example.test.evil",
      lanHttpsManagementHostname(b.id, defaults.lanDomain),
    ])
      expect(() => f.present(a, undefined, hostname)).toThrow(
        /hostname_not_authorized/,
      );
    expect(f.store.counts().challenges).toBe(1);
  });
  it("bounds total registrations, nonces, invitations, and challenges without discarding active protection", () => {
    const f = fixture({
      registration: "invite",
      limits: {
        maxInstallations: 1,
        maxInvites: 1,
        maxChallenges: 1,
        maxChallengesPerInstallation: 1,
      },
    });
    const invite = f.store.createInvite({ uses: 2 });
    expect(() => f.store.createInvite()).toThrow(/invitation_capacity/);
    const a = installation();
    f.enroll(a, { invitationCode: invite.code });
    expect(() =>
      f.enroll(installation(), { invitationCode: invite.code }),
    ).toThrow(/installation_capacity/);
    f.present(a);
    expect(() => f.present(a)).toThrow(/challenge_capacity/);
    expect(f.store.counts().challenges).toBe(1);
    expect(f.db.prepare("PRAGMA max_page_count").get()?.max_page_count).toBe(
      16384,
    );
    expect(f.db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
      "memory",
    );
  });
  it("refuses revoked installations, including repeat enrollment, and removes their outstanding TXT", () => {
    const f = fixture();
    const a = installation();
    f.enroll(a);
    f.present(a);
    f.store.revokeInstallation(a.id);
    expect(f.store.counts().challenges).toBe(0);
    expect(() => f.enroll(a)).toThrow(/installation_rejected/);
    expect(() => f.present(a)).toThrow(/authentication_rejected/);
  });
  it("persists identities, invitation consumption and proof consumption across connections and restart", () => {
    const root = mkdtempSync(join(tmpdir(), "lan-authority-test-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, "authority.sqlite");
    const db = new DatabaseSync(path);
    const f = fixture({ registration: "invite" }, db);
    const invitation = f.store.createInvite();
    const a = installation();
    const r = f.request(a, "/v1/enroll", {
      publicKey: a.publicKey,
      invitationCode: invitation.code,
    });
    f.store.enroll(r.body, r.proof);
    const challenge = f.present(a);
    const db2 = new DatabaseSync(path);
    try {
      const second = fixture({ registration: "invite" }, db2);
      expect(() => second.store.enroll(r.body, r.proof)).toThrow(
        /authentication_rejected/,
      );
      expect(
        second.store.challengeValues(
          "_acme-challenge.192-168-1-50.lan.example.test",
        ),
      ).toEqual([challenge.value]);
    } finally {
      db2.close();
      db.close();
    }
    const reopened = new DatabaseSync(path);
    try {
      const restarted = fixture({ registration: "invite" }, reopened);
      expect(restarted.store.counts().installations).toBe(1);
      expect(() =>
        restarted.enroll(installation(), { invitationCode: invitation.code }),
      ).toThrow(/invitation_rejected/);
      expect(restarted.enroll(a).created).toBe(false);
    } finally {
      reopened.close();
    }
  });
  it("fails closed on another application's database, unknown schema and corruption without replacing data", () => {
    const db = new DatabaseSync(":memory:");
    cleanups.push(() => db.close());
    db.exec(
      "CREATE TABLE user_data(value); INSERT INTO user_data VALUES('retained');",
    );
    expect(() => fixture({}, db)).toThrow(/authority_database_not_empty/);
    expect(db.prepare("SELECT value FROM user_data").get()?.value).toBe(
      "retained",
    );
    db.exec("PRAGMA application_id=42; PRAGMA user_version=100;");
    expect(() => fixture({}, db)).toThrow(/authority_schema_unsupported/);
    const root = mkdtempSync(join(tmpdir(), "lan-authority-corrupt-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, "broken.sqlite");
    const bytes = Buffer.from("intentionally-invalid-db");
    writeFileSync(file, bytes);
    expect(() => {
      const corrupt = new DatabaseSync(file);
      try {
        fixture({}, corrupt);
      } finally {
        corrupt.close();
      }
    }).toThrow();
    expect(readFileSync(file)).toEqual(bytes);
  });
});
