import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator invitations", () => {
  it("lets an admin register an active unlinked administrator", async () => {
    const { app, database } = adminApp();
    const response = await createUser(app, "subject-admin", {
      email: "INVITED@example.test",
      displayName: "Invited Admin",
      role: "admin",
    });

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(database.users.get(id)).toMatchObject({
      email: "INVITED@example.test",
      display_name: "Invited Admin",
      role: "admin",
      status: "active",
      access_subject: null,
      access_subject_linked_at: null,
      access_subject_generation: 0,
      security_version: 1,
    });
    const audit = database.raw
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE action='user.invited' AND target_id=?",
      )
      .get(id) as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toEqual({
      role: "admin",
      accessSubjectState: "unlinked",
    });
  });

  it("allows only an owner to register another owner", async () => {
    const { app, database } = adminApp();
    const denied = await createUser(app, "subject-admin", {
      email: "denied-owner@example.test",
      displayName: "Denied Owner",
      role: "owner",
    });
    await expectError(denied, 403, "OWNER_REQUIRED");

    const allowed = await createUser(app, "subject-owner", {
      email: "new-owner@example.test",
      displayName: "New Owner",
      role: "owner",
    });
    expect(allowed.status).toBe(201);
    const { id } = (await allowed.json()) as { id: string };
    expect(database.users.get(id)).toMatchObject({
      role: "owner",
      access_subject: null,
    });
  });

  it("returns a conflict for a duplicate email, including a disabled user", async () => {
    const { app, database } = adminApp();
    seedUser(database, {
      id: "user_disabled",
      subject: null,
      email: "existing@example.test",
      role: "admin",
      status: "disabled",
    });

    const response = await createUser(app, "subject-owner", {
      email: "EXISTING@example.test",
      displayName: "Duplicate",
      role: "admin",
    });
    await expectError(response, 409, "USER_EMAIL_CONFLICT");
    expect(
      database.users
        .list()
        .filter((user) => user.email.toLowerCase() === "existing@example.test"),
    ).toHaveLength(1);
  });

  it("rejects legacy request-body accessSubject input", async () => {
    const { app } = adminApp();
    const response = await createUser(app, "subject-owner", {
      email: "legacy@example.test",
      displayName: "Legacy Input",
      role: "admin",
      accessSubject: "untrusted-subject",
    });
    await expectError(response, 400, "INVALID_REQUEST");
  });

  it("retains final-owner protection", async () => {
    const { app } = adminApp();
    const response = await app.request(
      "/admin/api/v1/users/user_owner/disable",
      {
        method: "POST",
        headers: mutationHeaders("subject-owner"),
      },
    );
    await expectError(response, 409, "LAST_OWNER");
  });

  it("removes Subject input from the Web UI and Admin CLI", () => {
    expect(adminScript).toContain(
      "本人の初回ログイン時に検証済みAccess identityを連携します",
    );
    expect(adminScript).not.toContain('name="accessSubject"');
    const cli = readFileSync("apps/admin-cli/src/index.ts", "utf8");
    expect(cli).not.toContain("--access-subject");
  });
});

function adminApp(): {
  app: ReturnType<typeof createAdminApp>;
  database: RendererDatabase;
} {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  seedUser(database, {
    id: "user_owner",
    subject: "subject-owner",
    email: "owner@example.test",
    role: "owner",
    status: "active",
  });
  seedUser(database, {
    id: "user_admin",
    subject: "subject-admin",
    email: "admin@example.test",
    role: "admin",
    status: "active",
  });
  const access = {
    verify: (assertion: string) =>
      Promise.resolve({ subject: assertion, payload: { sub: assertion } }),
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
    status: "active" | "disabled";
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
      input.subject,
      input.subject === null ? null : now,
      input.subject === null ? 0 : 1,
      input.email,
      input.id,
      input.role,
      input.status,
      now,
      now,
    );
}

function createUser(
  app: ReturnType<typeof createAdminApp>,
  subject: string,
  body: Record<string, unknown>,
): Response | Promise<Response> {
  return app.request("/admin/api/v1/users", {
    method: "POST",
    headers: mutationHeaders(subject),
    body: JSON.stringify(body),
  });
}

function mutationHeaders(subject: string): Record<string, string> {
  return {
    "Cf-Access-Jwt-Assertion": subject,
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
