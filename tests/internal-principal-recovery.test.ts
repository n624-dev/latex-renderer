import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { ApiKeyService } from "@latex-renderer/auth";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { AdminApiKeysService } from "../apps/admin-api/src/services/api-keys.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";
import {
  diagnoseInternalPrincipals,
  repairInternalPrincipal,
  retireLegacyInternalAccountKey,
} from "../apps/admin-local/src/internal-principals.js";

const databases: RendererDatabase[] = [];
const timestamp = "2026-11-01T00:00:00.000Z";
const owner = "user_owner";
const admin = "local-admin";

function fixture(channel: "web" | "mcp" = "web") {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  for (const userId of [owner, "user_other"]) {
    database.users.insertInvitation({
      id: userId,
      email: `${userId}@example.test`,
      role: userId === owner ? "owner" : "user",
      displayName: userId,
      createdBy: admin,
      timestamp,
    });
  }
  const principal =
    channel === "web"
      ? database.webPrincipals.ensure(owner)
      : {
          user_id: owner,
          service_account_id: "sa_internal_mcp",
          api_key_id: "key_internal_mcp",
          created_at: timestamp,
        };
  if (channel === "mcp") {
    database.serviceAccounts.insert({
      id: principal.service_account_id,
      ownerUserId: owner,
      name: "Remote MCP",
      clientType: "mcp",
      timestamp,
    });
    database.apiKeys.insert({
      id: principal.api_key_id,
      serviceAccountId: principal.service_account_id,
      name: "Remote MCP accounting principal",
      prefix: "oauth_internal_mcp",
      kind: "render",
      secretHash: "0".repeat(64),
      pepperId: "oauth-principal",
      scopes: ["oauth:mcp"],
      createdAt: timestamp,
      createdBy: "remote_mcp",
    });
    database.remoteMcp.insertPrincipal(principal);
  }
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
  it.each(["web", "mcp"] as const)(
    "keeps the %s principal out of browser-authenticated and bearer management requests",
    async (channel) => {
      const { database, principal } = fixture(channel);
      database.raw
        .prepare("UPDATE users SET access_subject=? WHERE id=?")
        .run("fixture-owner", owner);
      database.serviceAccounts.insert({
        id: "sa_external",
        ownerUserId: owner,
        name: "CLI",
        clientType: "generic",
        timestamp,
      });
      const apiKeys = new ApiKeyService(
        database,
        new Map([["fixture", Buffer.alloc(32, 8)]]),
        "fixture",
      );
      const keys = new AdminApiKeysService({ database, apiKeys });
      const adminKey = keys.create(
        { type: "user", id: owner, userId: owner, role: "owner" },
        "sa_external",
        { name: "Management fixture", scopes: ["admin:*"] },
      );
      const app = createAdminApp({
        database,
        apiKeys,
        deploymentMode: "cloudflare",
        browserAuth: legacyTestBrowserAuth(database, {
          verify: () =>
            Promise.resolve({
              provider: "cloudflare-access",
              issuer: "https://team.cloudflareaccess.com",
              subject: "fixture-owner",
              payload: { sub: "fixture-owner" },
            }),
        }),
        publicOrigin: "https://latex.example.com",
        allowedOrigins: new Set(),
        writeEnabled: true,
        storageRoot: "/nonexistent",
        rendererVersion: "fixture",
        maxOutputBytes: 1,
        maxQueueLength: 20,
        maxUserStorageBytes: 1024,
        minFreeStorageBytes: 0,
        activeTicketKid: "fixture",
        verificationTicketKids: [],
      });
      const browser = {
        "Cf-Access-Jwt-Assertion": "test",
        "X-CSRF-Token": "1",
      };
      const bearer = { Authorization: `Bearer ${adminKey.apiKey}` };
      const call = (
        path: string,
        authentication: Record<string, string>,
        method = "GET",
        body: Record<string, unknown> = {},
      ) =>
        app.request(`/admin/api/v1${path}`, {
          method,
          headers: { ...authentication, "Content-Type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        });
      const accountPath = `/service-accounts/${principal.service_account_id}`;
      const keyPath = `/api-keys/${principal.api_key_id}`;
      const input = { name: "Render fixture", scopes: ["render:create"] };
      const subject = () =>
        database.apiKeys.activeIdentity(
          principal.api_key_id,
          new Date().toISOString(),
        );
      const before = subject();
      expect(before).toMatchObject({
        api_key_id: principal.api_key_id,
        service_account_id: principal.service_account_id,
      });
      for (const auth of [browser, bearer]) {
        for (const [collection, id] of [
          ["/service-accounts", principal.service_account_id],
          ["/api-keys", principal.api_key_id],
        ] as const) {
          const listed = await call(collection, auth);
          expect(listed.status).toBe(200);
          const { items } = (await listed.json()) as {
            items: Array<{ id: string }>;
          };
          expect(items.length).toBeGreaterThan(0);
          expect(items.map((item) => item.id)).not.toContain(id);
        }
        for (const path of [accountPath, keyPath])
          expect((await call(path, auth)).status).toBe(404);
      }
      const external = await call(
        "/service-accounts/sa_external/api-keys",
        browser,
        "POST",
        input,
      );
      expect(external.status).toBe(201);
      const { id } = (await external.json()) as { id: string };
      const externalRotated = await call(
        `/api-keys/${id}/rotate`,
        bearer,
        "POST",
      );
      expect(externalRotated.status).toBe(201);
      const { id: successorId } = (await externalRotated.json()) as {
        id: string;
      };
      const results = await Promise.all([
        ...[browser, bearer].flatMap((auth) => [
          call(`${accountPath}/api-keys`, auth, "POST", input),
          call(`${keyPath}/rotate`, auth, "POST"),
          call(`${keyPath}/revoke`, auth, "POST"),
          call(`${accountPath}/disable`, auth, "POST"),
        ]),
        call(`/api-keys/${successorId}/revoke`, bearer, "POST"),
        call("/service-accounts/sa_external/disable", browser, "POST"),
      ]);
      expect(results.map((response) => response.status)).toEqual([
        404, 404, 404, 404, 404, 404, 404, 404, 200, 200,
      ]);
      expect(subject()).toEqual(before);
      expect(diagnoseInternalPrincipals(database)).toEqual({
        issues: [],
        legacyKeys: [],
      });
    },
  );

  it.each(["web", "mcp"] as const)(
    "preserves accepted and running %s Jobs, leases, and audit attribution during repair",
    (channel) => {
      const { database, principal, disable } = fixture(channel);
      const sourceId = `source_${"e".repeat(32)}`;
      database.sources.insertReserved({
        id: sourceId,
        ownerUserId: owner,
        size: 1,
        sha256: "e".repeat(64),
        storageKey: `sources/${sourceId}/source.zip`,
        timestamp,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      database.raw
        .prepare("UPDATE sources SET status='ready',uploaded_at=? WHERE id=?")
        .run(timestamp, sourceId);
      const ids = ["a", "b"].map((letter) => `job_${letter.repeat(32)}`);
      for (const id of ids) {
        expect(
          database.jobs.insertQueued({
            id,
            userId: owner,
            serviceAccountId: principal.service_account_id,
            apiKeyId: principal.api_key_id,
            rendererVersion: "fixture",
            sourceId,
            entrypoint: "main.tex",
            timestamp,
            reservedOutputBytes: 1,
          }),
        ).toBe(1);
        database.audit({
          actorType: "user",
          actorId: owner,
          action: "fixture.job.accepted",
          targetType: "job",
          targetId: id,
          result: "success",
        });
      }
      const running = database.worker.claimNext(
        "fixture-worker",
        timestamp,
        "2099-01-01T00:00:00.000Z",
      );
      if (running === undefined) throw new Error("Missing claimed fixture Job");
      expect(
        database.worker.transitionOwned(
          running.id,
          "fixture-worker",
          1,
          ["validating"],
          "running",
          timestamp,
        ),
      ).toBe(1);
      const jobs = () => ids.map((id) => database.jobs.getVisible(id));
      const historicalAudit = () =>
        database.raw
          .prepare(
            "SELECT * FROM audit_logs WHERE target_type='job' ORDER BY target_id",
          )
          .all();
      const before = jobs();
      expect(before.map((job) => job?.status).sort()).toEqual([
        "queued",
        "running",
      ]);
      const auditBefore = historicalAudit();
      disable();
      for (const id of ids)
        expect(database.worker.subjectState(id)).toBeUndefined();
      expect(diagnoseInternalPrincipals(database).issues).toMatchObject([
        {
          channel,
          accountId: principal.service_account_id,
          keyId: principal.api_key_id,
        },
      ]);
      expect(
        repairInternalPrincipal(database, principal.api_key_id, admin),
      ).toBe(true);
      expect(jobs()).toEqual(before);
      expect(historicalAudit()).toEqual(auditBefore);
      for (const id of ids)
        expect(database.worker.subjectState(id)).toMatchObject({
          user_status: "active",
          sa_status: "active",
          revoked_at: null,
        });
      expect(
        database.raw
          .prepare(
            "SELECT actor_type, actor_id, target_id, metadata_json FROM audit_logs WHERE action='internal_principal.repaired'",
          )
          .all(),
      ).toEqual([
        {
          actor_type: "local",
          actor_id: admin,
          target_id: principal.api_key_id,
          metadata_json: JSON.stringify({
            channel,
            serviceAccountId: principal.service_account_id,
          }),
        },
      ]);
    },
  );

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
