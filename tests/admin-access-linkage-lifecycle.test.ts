import { afterEach, describe, expect, it } from "vitest";
import {
  ApiKeyService,
  type AccessIdentity,
  type AccessJwtVerifier,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator external identity lifecycle", () => {
  it("lets an owner explicitly unlink an identity and revokes user security state", async () => {
    const { app, database } = adminApp({
      owner: { subject: "subject-owner", email: "owner@example.test" },
    });
    seedUser(database, "target", "target@example.test", "admin");
    seedIdentity(database, "target", "identity_target", "subject-target");

    const response = await app.request(
      "/admin/api/v1/users/target/identities/identity_target/unlink",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({
          reason:
            "Account replaced; JWT eyJheader.payload.signature; key lrk_supersecret; OTP 123456",
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "target",
      identityId: "identity_target",
    });
    expect(database.browserAuth.identitiesForUser("target")).toEqual([]);
    expect(database.users.get("target")?.security_version).toBe(2);

    const audit = database.raw
      .prepare(
        "SELECT result,metadata_json FROM audit_logs WHERE action='user.identity_unlinked'",
      )
      .get() as { result: string; metadata_json: string };
    expect(audit.result).toBe("success");
    expect(JSON.parse(audit.metadata_json)).toEqual({
      reason:
        "Account replaced; JWT [REDACTED_JWT]; key [REDACTED_API_TOKEN]; OTP [REDACTED_OTP]",
      identityId: "identity_target",
      provider: "cloudflare-access",
      issuer: "https://team.cloudflareaccess.com",
    });
    expect(audit.metadata_json).not.toContain("subject-target");
    expect(audit.metadata_json).not.toContain("supersecret");
    expect(audit.metadata_json).not.toContain("123456");
  });

  it("rejects unlink by an admin and preserves the identity", async () => {
    const { app, database } = adminApp({
      admin: { subject: "subject-admin", email: "admin@example.test" },
    });
    seedUser(database, "target", "target@example.test", "admin");
    seedIdentity(database, "target", "identity_target", "subject-target");

    const response = await app.request(
      "/admin/api/v1/users/target/identities/identity_target/unlink",
      {
        method: "POST",
        headers: mutationHeaders("admin"),
        body: JSON.stringify({ reason: "Admin must not unlink" }),
      },
    );
    await expectError(response, 403, "OWNER_REQUIRED");
    expect(database.browserAuth.identitiesForUser("target")).toHaveLength(1);
  });

  it("requires a reason and rejects a nonexistent identity", async () => {
    const { app, database } = adminApp({
      owner: { subject: "subject-owner", email: "owner@example.test" },
    });
    seedUser(database, "target", null, "admin");

    const missingReason = await app.request(
      "/admin/api/v1/users/target/identities/identity_missing/unlink",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({ reason: "" }),
      },
    );
    await expectError(missingReason, 400, "INVALID_REQUEST");

    const missingIdentity = await app.request(
      "/admin/api/v1/users/target/identities/identity_missing/unlink",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({ reason: "Account recovery" }),
      },
    );
    await expectError(missingIdentity, 404, "IDENTITY_NOT_FOUND");
  });

  it("shows explicit provider-neutral identity controls in the UI", () => {
    expect(adminScript).toContain("issuer＋subject");
    expect(adminScript).toContain("外部identityのsubject");
    expect(adminScript).toContain("メールによる自動再連携は行いません");
    expect(adminScript).toContain("me.role==='owner'&&x.identities?.length");
    expect(adminScript).toContain("identityを解除");
    expect(adminScript).toContain('name="reason"');
    expect(adminScript).toContain('name="confirm" required');
    expect(adminScript).toContain("秘密値は入力しないでください");
    expect(adminScript).toContain("/identities/");
    expect(adminScript).toContain("/unlink");
    expect(adminScript).toContain("fetch('/auth/logout'");
    expect(adminScript).not.toContain("/session/claim-subject");
  });
});

function adminApp(
  identities: Record<string, Pick<AccessIdentity, "subject" | "email">>,
): {
  app: ReturnType<typeof createAdminApp>;
  database: RendererDatabase;
} {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  seedUser(database, "owner", "owner@example.test", "owner", "subject-owner");
  seedUser(database, "admin", "admin@example.test", "admin", "subject-admin");
  const access = {
    verify: (assertion: string) => {
      const identity = identities[assertion];
      if (identity === undefined) throw new Error("Unexpected test assertion");
      return Promise.resolve({
        provider: "cloudflare-access" as const,
        issuer: "https://team.cloudflareaccess.com",
        ...identity,
        payload: { sub: identity.subject, email: identity.email },
      });
    },
  } as unknown as AccessJwtVerifier;
  return {
    database,
    app: createAdminApp({
      database,
      apiKeys: new ApiKeyService(
        database,
        new Map([["v1", Buffer.alloc(32, 1)]]),
        "v1",
      ),
      browserAuth: legacyTestBrowserAuth(database, access),
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: "/nonexistent",
      rendererVersion: "sha256:" + "0".repeat(64),
      maxOutputBytes: 1,
      maxQueueLength: 100,
      maxUserStorageBytes: 1024,
      minFreeStorageBytes: 1,
      activeTicketKid: "v1",
      verificationTicketKids: [],
    }),
  };
}

function seedUser(
  database: RendererDatabase,
  id: string,
  email: string | null,
  role: "owner" | "admin" | "user",
  subject: string | null = null,
): void {
  const now = new Date().toISOString();
  database.raw
    .prepare(
      `INSERT INTO users
       (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'active',1,'test',?,?)`,
    )
    .run(
      id,
      subject,
      subject === null ? null : now,
      subject === null ? 0 : 1,
      email,
      id,
      role,
      now,
      now,
    );
}

function seedIdentity(
  database: RendererDatabase,
  userId: string,
  id: string,
  subject: string,
): void {
  const now = new Date().toISOString();
  database.browserAuth.insertIdentity({
    id,
    user_id: userId,
    provider: "cloudflare-access",
    issuer: "https://team.cloudflareaccess.com",
    subject,
    preferred_username: null,
    email_at_provider: null,
    linked_at: now,
    last_seen_at: now,
  });
}

function mutationHeaders(assertion: string): Record<string, string> {
  return {
    "Cf-Access-Jwt-Assertion": assertion,
    "X-CSRF-Token": "1",
    "Content-Type": "application/json",
  };
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}
