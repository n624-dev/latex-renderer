import { afterEach, describe, expect, it } from "vitest";
import {
  ApiKeyService,
  type AccessIdentity,
  type AccessJwtVerifier,
} from "@latex-renderer/auth";
import { RendererDatabase, type UserRow } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator Access subject claim", () => {
  it("reports a claimable invitation and links only the verified JWT identity", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "OWNER@example.test" },
    });
    seedUser(database, {
      id: "owner",
      email: "owner@example.test",
      role: "owner",
    });

    const session = await app.request("/admin/api/v1/session", {
      headers: assertion("token"),
    });
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      identity: { subject: "subject-new", email: "OWNER@example.test" },
      linkage: {
        state: "claimable",
        claimable: true,
        user: { id: "owner", generation: 0 },
      },
    });

    const claim = await app.request("/admin/api/v1/session/claim-subject", {
      method: "POST",
      headers: mutationHeaders("token"),
      body: JSON.stringify({
        email: "attacker@example.test",
        subject: "attacker-subject",
      }),
    });
    expect(claim.status).toBe(200);
    await expect(claim.json()).resolves.toMatchObject({
      identity: { subject: "subject-new", email: "OWNER@example.test" },
      linkage: {
        state: "linked",
        claimable: false,
        user: { id: "owner", generation: 1 },
      },
      claimed: true,
    });
    expect(database.users.get("owner")).toMatchObject({
      access_subject: "subject-new",
      access_subject_generation: 1,
      security_version: 2,
    });
    expect(
      database.users.get("owner")?.access_subject_linked_at,
    ).not.toBeNull();
    expect(auditCount(database)).toBe(1);
  });

  it("returns 200 without relinking when the same identity retries", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-stable", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "admin",
      email: "admin@example.test",
      role: "admin",
    });

    const first = await claim(app, "token");
    const second = await claim(app, "token");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      claimed: false,
      linkage: { state: "linked" },
    });
    expect(database.users.get("admin")).toMatchObject({
      access_subject_generation: 1,
      security_version: 2,
    });
    expect(auditCount(database)).toBe(1);
  });

  it("rejects an identity whose email was not invited", async () => {
    const { app } = adminApp({
      token: { subject: "subject-new", email: "missing@example.test" },
    });
    await expectError(await claim(app, "token"), 403, "ADMIN_INVITE_REQUIRED");
  });

  it("rejects a disabled invitation", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "disabled@example.test" },
    });
    seedUser(database, {
      id: "disabled",
      email: "disabled@example.test",
      role: "admin",
      status: "disabled",
    });
    await expectError(await claim(app, "token"), 403, "ADMIN_ACCOUNT_DISABLED");
  });

  it("rejects an invitation without an administrator role", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "user@example.test" },
    });
    seedUser(database, {
      id: "user",
      email: "user@example.test",
      role: "user",
    });
    await expectError(await claim(app, "token"), 403, "ADMIN_ROLE_REQUIRED");
  });

  it("rejects a subject already linked to a different invitation", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-taken", email: "new@example.test" },
    });
    seedUser(database, { id: "new", email: "new@example.test", role: "admin" });
    seedUser(database, {
      id: "existing",
      email: "existing@example.test",
      role: "admin",
      subject: "subject-taken",
    });
    await expectError(
      await claim(app, "token"),
      409,
      "ACCESS_SUBJECT_CONFLICT",
    );
    expect(database.users.get("new")?.access_subject).toBeNull();
  });

  it("rejects an identity change for an already linked administrator", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "admin",
      email: "admin@example.test",
      role: "admin",
      subject: "subject-old",
    });
    await expectError(
      await claim(app, "token"),
      409,
      "ACCESS_IDENTITY_CHANGED",
    );
    expect(database.users.get("admin")?.access_subject).toBe("subject-old");
    expect(auditCount(database, "failure")).toBe(1);
    const failure = database.raw
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE action='user.access_subject_claimed' AND result='failure'",
      )
      .get() as { metadata_json: string };
    expect(JSON.parse(failure.metadata_json)).toEqual({
      code: "ACCESS_IDENTITY_CHANGED",
    });
    expect(failure.metadata_json).not.toContain("admin@example.test");
    expect(failure.metadata_json).not.toContain("subject-new");
  });

  it("serializes concurrent retries into one claim and one idempotent success", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "admin",
      email: "admin@example.test",
      role: "admin",
    });

    const responses = await Promise.all([
      claim(app, "token"),
      claim(app, "token"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const bodies = (await Promise.all(
      responses.map((response) => response.json()),
    )) as Array<{ claimed: boolean }>;
    expect(bodies.map((body) => body.claimed).sort()).toEqual([false, true]);
    expect(database.users.get("admin")).toMatchObject({
      access_subject: "subject-new",
      access_subject_generation: 1,
    });
    expect(auditCount(database)).toBe(1);
  });

  it("allows only one of two concurrent identity changes for the same email", async () => {
    const { app, database } = adminApp({
      first: { subject: "subject-first", email: "admin@example.test" },
      second: { subject: "subject-second", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "admin",
      email: "admin@example.test",
      role: "admin",
    });

    const responses = await Promise.all([
      claim(app, "first"),
      claim(app, "second"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(["subject-first", "subject-second"]).toContain(
      database.users.get("admin")?.access_subject,
    );
    expect(database.users.get("admin")?.access_subject_generation).toBe(1);
    expect(auditCount(database)).toBe(1);
  });

  it("requires CSRF protection on the claim mutation", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-new", email: "admin@example.test" },
    });
    seedUser(database, {
      id: "admin",
      email: "admin@example.test",
      role: "admin",
    });
    const response = await app.request("/admin/api/v1/session/claim-subject", {
      method: "POST",
      headers: assertion("token"),
    });
    await expectError(response, 403, "CSRF_TOKEN_REQUIRED");
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
  const access = {
    verify: (assertionValue: string) => {
      const identity = identities[assertionValue];
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
    email: string;
    role: UserRow["role"];
    status?: UserRow["status"];
    subject?: string;
  },
): void {
  const now = new Date().toISOString();
  database.raw
    .prepare(
      `INSERT INTO users
    (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,1,'test',?,?)`,
    )
    .run(
      input.id,
      input.subject ?? null,
      input.subject === undefined ? null : now,
      input.subject === undefined ? 0 : 1,
      input.email,
      input.id,
      input.role,
      input.status ?? "active",
      now,
      now,
    );
}

function assertion(token: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": token };
}

function mutationHeaders(token: string): Record<string, string> {
  return {
    ...assertion(token),
    "X-CSRF-Token": "1",
    "Content-Type": "application/json",
  };
}

function claim(
  app: ReturnType<typeof createAdminApp>,
  token: string,
): Promise<Response> {
  return Promise.resolve(
    app.request("/admin/api/v1/session/claim-subject", {
      method: "POST",
      headers: mutationHeaders(token),
      body: "{}",
    }),
  );
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
}

function auditCount(database: RendererDatabase, result = "success"): number {
  return (
    database.raw
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action='user.access_subject_claimed' AND result=?",
      )
      .get(result) as { count: number }
  ).count;
}
