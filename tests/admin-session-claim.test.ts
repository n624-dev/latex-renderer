import { afterEach, describe, expect, it } from "vitest";
import {
  ApiKeyService,
  type AccessIdentity,
  type AccessJwtVerifier,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("provider-neutral administrator session", () => {
  it("returns only the explicitly linked user and session CSRF data", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-owner", email: "attribute@example.test" },
    });
    seedUser(database, "owner", "owner@example.test", "owner", "subject-owner");

    const response = await app.request("/admin/api/v1/session", {
      headers: assertion("token"),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      authMode: "cloudflare-access",
      csrfToken: "1",
      user: {
        id: "owner",
        email: "owner@example.test",
        displayName: "owner",
        role: "owner",
        status: "active",
      },
    });
  });

  it("does not select users by duplicate email attributes", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-second", email: "same@example.test" },
    });
    seedUser(database, "first", "same@example.test", "admin", "subject-first");
    seedUser(database, "second", "same@example.test", "admin", "subject-second");

    const response = await app.request("/admin/api/v1/session", {
      headers: assertion("token"),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "second", email: "same@example.test" },
    });
  });

  it("keeps the removed email-based subject claim route unavailable", async () => {
    const { app, database } = adminApp({
      token: { subject: "subject-owner", email: "owner@example.test" },
    });
    seedUser(database, "owner", "owner@example.test", "owner", "subject-owner");

    const response = await app.request(
      "/admin/api/v1/session/claim-subject",
      {
        method: "POST",
        headers: {
          ...assertion("token"),
          "Content-Type": "application/json",
          "X-CSRF-Token": "1",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(404);
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
    verify: (value: string) => {
      const identity = identities[value];
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
  subject: string,
): void {
  const timestamp = new Date().toISOString();
  database.raw
    .prepare(
      `INSERT INTO users
       (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES (?,?,?,1,?,?,?,'active',1,'test',?,?)`,
    )
    .run(id, subject, timestamp, email, id, role, timestamp, timestamp);
}

function assertion(value: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": value };
}
