import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import {
  diagnoseInternalPrincipals,
  repairInternalPrincipal,
  retireLegacyInternalAccountKey,
} from "../apps/admin-local/src/internal-principals.js";

const databases: RendererDatabase[] = [];
const timestamp = "2026-11-01T00:00:00.000Z";
const owner = "user_owner";
const admin = "local-admin";

function fixture() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  for (const userId of [owner, "user_other"]) {
    database.users.insertInvitation({
      id: userId,
      email: `${userId}@example.test`,
      role: "user",
      displayName: userId,
      createdBy: admin,
      timestamp,
    });
  }
  const principal = database.webPrincipals.ensure(owner);
  function credential(id: string, account: string) {
    database.apiKeys.insert({
      id,
      serviceAccountId: account,
      name: id,
      prefix: `lrk_${id.slice(4)}`,
      kind: "render",
      secretHash: "f".repeat(64),
      pepperId: "fixture",
      scopes: ["render:create"],
      createdAt: timestamp,
      createdBy: admin,
    });
  }
  function externalCredential(userId: string) {
    const id = `sa_external_${userId}`;
    database.serviceAccounts.insert({
      id,
      ownerUserId: userId,
      name: "External",
      clientType: "generic",
      timestamp,
    });
    const keyId = `key_external_${userId}`;
    credential(keyId, id);
    return keyId;
  }
  const disable = () => {
    database.raw
      .prepare("UPDATE service_accounts SET status='disabled' WHERE id=?")
      .run(principal.service_account_id);
    database.raw
      .prepare("UPDATE api_keys SET revoked_at=? WHERE id=?")
      .run(timestamp, principal.api_key_id);
  };
  return { database, principal, disable, credential, externalCredential };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("internal rendering identity recovery", () => {
  it("repairs only verified accounting identities without changing account or key IDs", () => {
    const { database, principal, disable, externalCredential } = fixture();
    const external = externalCredential(owner);
    database.apiKeys.revoke(external, timestamp);
    disable();
    expect(diagnoseInternalPrincipals(database)).toEqual({
      issues: [
        {
          channel: "web",
          userId: owner,
          accountId: principal.service_account_id,
          keyId: principal.api_key_id,
          userStatus: "active",
          accountStatus: "disabled",
          validMapping: true,
          revokedAt: timestamp,
          activeOtherKeys: 0,
        },
      ],
      legacyKeys: [],
    });
    expect(repairInternalPrincipal(database, principal.api_key_id, admin)).toBe(
      true,
    );
    expect(repairInternalPrincipal(database, principal.api_key_id, admin)).toBe(
      false,
    );
    expect(database.webPrincipals.get(owner)).toEqual(principal);
    expect(
      database.apiKeys.renderIdentity(principal.api_key_id, timestamp),
    ).toMatchObject({
      api_key_id: principal.api_key_id,
      service_account_id: principal.service_account_id,
      service_account_security_version: 2,
    });
    expect(database.apiKeys.get(external)?.revoked_at).toBe(timestamp);
    expect(() => repairInternalPrincipal(database, external, admin)).toThrow(
      "inconsistent",
    );
  });

  it("requires an explicitly confirmed replacement before retiring a legacy external key", () => {
    const { database, principal, disable, credential, externalCredential } =
      fixture();
    disable();
    const legacy = "key_legacy";
    credential(legacy, principal.service_account_id);
    const invalidReplacement = externalCredential("user_other");
    const replacement = externalCredential(owner);
    expect(diagnoseInternalPrincipals(database).legacyKeys).toMatchObject([
      { keyId: legacy, kind: "render", revokedAt: null },
    ]);
    expect(() =>
      repairInternalPrincipal(database, principal.api_key_id, admin),
    ).toThrow("Retire the legacy keys");
    expect(() =>
      retireLegacyInternalAccountKey(
        database,
        legacy,
        invalidReplacement,
        admin,
      ),
    ).toThrow("separate external account");
    expect(database.apiKeys.get(legacy)?.revoked_at).toBeNull();
    expect(
      retireLegacyInternalAccountKey(database, legacy, replacement, admin),
    ).toBe(true);
    expect(
      retireLegacyInternalAccountKey(database, legacy, replacement, admin),
    ).toBe(false);
    expect(repairInternalPrincipal(database, principal.api_key_id, admin)).toBe(
      true,
    );
    expect(database.apiKeys.get(legacy)?.revoked_at).toEqual(
      expect.any(String),
    );
    expect(database.apiKeys.get(replacement)?.revoked_at).toBeNull();
  });

  it("rejects disabled users and protects mappings to ordinary credentials", () => {
    const { database, principal, disable, credential } = fixture();
    disable();
    database.raw
      .prepare("UPDATE users SET status='disabled' WHERE id=?")
      .run(owner);
    expect(() =>
      repairInternalPrincipal(database, principal.api_key_id, admin),
    ).toThrow("owner is disabled");
    database.raw
      .prepare("UPDATE users SET status='active' WHERE id=?")
      .run(owner);
    const unrelated = "key_unrelated";
    credential(unrelated, principal.service_account_id);
    database.raw
      .prepare("UPDATE web_principals SET api_key_id=? WHERE user_id=?")
      .run(unrelated, owner);
    expect(diagnoseInternalPrincipals(database).issues[0]?.validMapping).toBe(
      false,
    );
    expect(() => repairInternalPrincipal(database, unrelated, admin)).toThrow(
      "inconsistent",
    );
  });
});
