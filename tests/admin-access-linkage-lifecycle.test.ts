import { afterEach, describe, expect, it } from "vitest";
import {
  ApiKeyService,
  type AccessIdentity,
  type AccessJwtVerifier,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator Access linkage lifecycle", () => {
  it("lets an owner unlink a subject and the verified user reclaim it", async () => {
    const { app, database } = adminApp({
      owner: { subject: "subject-owner", email: "owner@example.test" },
      reclaimed: {
        subject: "subject-target-new",
        email: "target@example.test",
      },
    });
    seedUser(database, {
      id: "target",
      subject: "subject-target-old",
      email: "target@example.test",
      role: "admin",
    });

    const unlink = await app.request(
      "/admin/api/v1/users/target/unlink-access-subject",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({
          reason:
            "Account replaced; JWT eyJheader.payload.signature; key lrk_supersecret; OTP 123456",
        }),
      },
    );
    expect(unlink.status).toBe(200);
    await expect(unlink.json()).resolves.toEqual({
      id: "target",
      generation: 2,
    });
    expect(database.users.get("target")).toMatchObject({
      access_subject: null,
      access_subject_linked_at: null,
      access_subject_generation: 2,
      security_version: 2,
    });

    const unlinkAudit = database.raw
      .prepare(
        "SELECT result,metadata_json FROM audit_logs WHERE action='user.access_subject_unlinked'",
      )
      .get() as { result: string; metadata_json: string };
    expect(unlinkAudit.result).toBe("success");
    expect(JSON.parse(unlinkAudit.metadata_json)).toEqual({
      reason:
        "Account replaced; JWT [REDACTED_JWT]; key [REDACTED_API_TOKEN]; OTP [REDACTED_OTP]",
      accessSubjectGeneration: 2,
    });
    expect(unlinkAudit.metadata_json).not.toContain("subject-target-old");
    expect(unlinkAudit.metadata_json).not.toContain("supersecret");
    expect(unlinkAudit.metadata_json).not.toContain("123456");

    const reclaim = await app.request("/admin/api/v1/session/claim-subject", {
      method: "POST",
      headers: mutationHeaders("reclaimed"),
      body: "{}",
    });
    expect(reclaim.status).toBe(200);
    await expect(reclaim.json()).resolves.toMatchObject({
      claimed: true,
      linkage: { state: "linked" },
    });
    expect(database.users.get("target")).toMatchObject({
      access_subject: "subject-target-new",
      access_subject_generation: 3,
      security_version: 3,
    });
  });

  it("rejects unlink by an admin and preserves the existing identity", async () => {
    const { app, database } = adminApp({
      admin: { subject: "subject-admin", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "target",
      subject: "subject-target",
      email: "target@example.test",
      role: "admin",
    });

    const response = await app.request(
      "/admin/api/v1/users/target/unlink-access-subject",
      {
        method: "POST",
        headers: mutationHeaders("admin"),
        body: JSON.stringify({ reason: "Admin must not unlink" }),
      },
    );
    await expectError(response, 403, "OWNER_REQUIRED");
    expect(database.users.get("target")?.access_subject).toBe("subject-target");
    expect(auditCount(database, "user.access_subject_unlinked")).toBe(0);
  });

  it("requires a reason and rejects an already unlinked user", async () => {
    const { app, database } = adminApp({
      owner: { subject: "subject-owner", email: "owner@example.test" },
    });
    seedUser(database, {
      id: "pending",
      subject: null,
      email: "pending@example.test",
      role: "admin",
    });

    const missingReason = await app.request(
      "/admin/api/v1/users/pending/unlink-access-subject",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({ reason: "" }),
      },
    );
    await expectError(missingReason, 400, "INVALID_REQUEST");

    const pending = await app.request(
      "/admin/api/v1/users/pending/unlink-access-subject",
      {
        method: "POST",
        headers: mutationHeaders("owner"),
        body: JSON.stringify({ reason: "Retry" }),
      },
    );
    await expectError(pending, 409, "ACCESS_SUBJECT_NOT_LINKED");
  });

  it("exposes pending/linked guidance and owner-only unlink controls in the UI", () => {
    expect(adminScript).toContain("初回ログイン待ち");
    expect(adminScript).toContain("連携済み");
    expect(adminScript).toContain("連携日時");
    expect(adminScript).toContain("Cloudflare AccessユーザーID");
    expect(adminScript).toContain("me.role==='owner'&&x.access_subject");
    expect(adminScript).toContain("Access連携を解除");
    expect(adminScript).toContain('name="reason"');
    expect(adminScript).toContain('name="confirm" required');
    expect(adminScript).toContain("秘密値は入力しないでください");
    expect(adminScript).toContain("/session/claim-subject");
    expect(adminScript).toContain(
      "別のCloudflare Access identityがすでに連携されています",
    );
    expect(adminScript).toContain("location.assign('/cdn-cgi/access/logout')");
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
  seedUser(database, {
    id: "owner",
    subject: "subject-owner",
    email: "owner@example.test",
    role: "owner",
  });
  seedUser(database, {
    id: "admin",
    subject: "subject-admin",
    email: "admin@example.test",
    role: "admin",
  });
  const access = {
    verify: (assertion: string) => {
      const identity = identities[assertion];
      if (identity === undefined) throw new Error("Unexpected test assertion");
      return Promise.resolve({
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
      access,
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: "/nonexistent",
      rendererVersion: "sha256:" + "0".repeat(64),
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
  input: {
    id: string;
    subject: string | null;
    email: string;
    role: "owner" | "admin" | "user";
  },
): void {
  const now = new Date().toISOString();
  database.raw
    .prepare(
      `INSERT INTO users
    (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'active',1,'test',?,?)`,
    )
    .run(
      input.id,
      input.subject,
      input.subject === null ? null : now,
      input.subject === null ? 0 : 1,
      input.email,
      input.id,
      input.role,
      now,
      now,
    );
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

function auditCount(database: RendererDatabase, action: string): number {
  return (
    database.raw
      .prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action=?")
      .get(action) as { count: number }
  ).count;
}
