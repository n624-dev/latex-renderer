import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("administrator Web render jobs", () => {
  it("lists safe targets and creates an idempotent job without exposing an API key secret", async () => {
    const database = new RendererDatabase(":memory:");
    databases.push(database);
    database.migrate();
    const now = new Date().toISOString();
    database.raw
      .prepare(
        `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES ('user_owner','subject','owner@example.test','Owner','owner','active',1,'test',?,?)`,
      )
      .run(now, now);
    database.raw
      .prepare(
        `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
      VALUES ('sa_web','user_owner','Web render','generic','active',1,?,?)`,
      )
      .run(now, now);
    database.raw
      .prepare(
        `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
      VALUES ('key_web','sa_web','Browser jobs','lrk_public','secret-hash','v1','["render:create"]',?,'test')`,
      )
      .run(now);
    const tickets = new TicketService(
        database,
        "latex-renderer",
        "latex-render",
        { kid: "v1", secret: Buffer.alloc(32, 9) },
        [],
      ),
      access = {
        verify: () =>
          Promise.resolve({ subject: "subject", payload: { sub: "subject" } }),
      } as unknown as AccessJwtVerifier;
    const app = createAdminApp({
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
      storageRoot: "/tmp",
      rendererVersion: "test",
      maxQueueLength: 5,
      maxUserStorageBytes: 1024,
      minFreeStorageBytes: 1,
      activeTicketKid: "v1",
      verificationTicketKids: [],
      renderTickets: {
        tickets,
        rendererPublicUrl: "https://latex.example.com",
      },
    });
    const accessHeaders = { "Cf-Access-Jwt-Assertion": "test" };
    const targets = await app.request("/admin/api/v1/jobs/render-targets", {
      headers: accessHeaders,
    });
    expect(targets.status).toBe(200);
    const targetsBody = await targets.text();
    expect(JSON.parse(targetsBody)).toEqual({
      items: [
        {
          apiKeyId: "key_web",
          apiKeyName: "Browser jobs",
          serviceAccountId: "sa_web",
          serviceAccountName: "Web render",
          userId: "user_owner",
          userLabel: "owner@example.test",
        },
      ],
    });
    expect(targetsBody).not.toContain("secret-hash");
    const request = {
      method: "POST",
      headers: {
        ...accessHeaders,
        "X-CSRF-Token": "1",
        "Content-Type": "application/json",
        "Idempotency-Key": "admin-web-render-123456",
      },
      body: JSON.stringify({
        apiKeyId: "key_web",
        size: 10,
        sha256: "a".repeat(64),
      }),
    } as const;
    const created = await app.request(
      "/admin/api/v1/jobs/render-tickets",
      request,
    );
    expect(created.status).toBe(201);
    const value = (await created.json()) as {
      jobId: string;
      uploadTicket: string;
      jobTicket: string;
      uploadUrl: string;
    };
    expect(value.uploadUrl).toBe(
      `https://latex.example.com/api/v1/jobs/${value.jobId}/source`,
    );
    expect(database.jobs.get(value.jobId)).toMatchObject({
      user_id: "user_owner",
      service_account_id: "sa_web",
      api_key_id: "key_web",
      status: "reserved",
    });
    await expect(
      tickets.verify(value.uploadTicket, "upload", value.jobId),
    ).resolves.toMatchObject({
      api_key_id: "key_web",
      size: 10,
      sha256: "a".repeat(64),
    });
    const repeated = await app.request("/admin/api/v1/jobs/render-tickets", {
      ...request,
      body: JSON.stringify({
        apiKeyId: "key_web",
        size: 10,
        sha256: "a".repeat(64),
        outputs: ["pdf"],
      }),
    });
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      jobId: value.jobId,
    });
    expect(database.jobs.list()).toHaveLength(1);

    const sourceResponse = await app.request(
      "/admin/api/v1/jobs/source-tickets",
      {
        method: "POST",
        headers: {
          ...accessHeaders,
          "X-CSRF-Token": "1",
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-web-source-123456",
        },
        body: JSON.stringify({
          apiKeyId: "key_web",
          size: 12,
          sha256: "b".repeat(64),
        }),
      },
    );
    expect(sourceResponse.status).toBe(201);
    const sourceTicket = (await sourceResponse.json()) as {
      sourceId: string;
      uploadRequired: boolean;
      uploadTicket: string;
    };
    expect(sourceTicket.uploadRequired).toBe(true);
    await expect(
      tickets.verifySourceUpload(
        sourceTicket.uploadTicket,
        sourceTicket.sourceId,
      ),
    ).resolves.toMatchObject({ source_id: sourceTicket.sourceId, size: 12 });
    database.raw
      .prepare(
        "UPDATE sources SET status='ready',paths_json=?,uploaded_at=?,expires_at=? WHERE id=?",
      )
      .run(
        JSON.stringify(["reports/a.tex"]),
        now,
        new Date(Date.now() + 3_600_000).toISOString(),
        sourceTicket.sourceId,
      );
    const sourceRefResponse = await app.request(
      "/admin/api/v1/jobs/source-refs",
      {
        method: "POST",
        headers: {
          ...accessHeaders,
          "X-CSRF-Token": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKeyId: "key_web",
          sourceId: sourceTicket.sourceId,
        }),
      },
    );
    expect(sourceRefResponse.status).toBe(201);
    const sourceRef = (await sourceRefResponse.json()) as {
      sourceRef: string;
      expiresAt: string;
    };
    expect(sourceRef.sourceRef).toMatch(/^source_ref_[a-f0-9]{32}$/);
    expect(
      database.remoteMcp.sourceRef(sourceRef.sourceRef, "user_owner", now),
    ).toMatchObject({ source_id: sourceTicket.sourceId });
    expect(
      database.remoteMcp.sourceRef(sourceRef.sourceRef, "another_user", now),
    ).toBeUndefined();
    const sourceJob = await app.request("/admin/api/v1/jobs/render-tickets", {
      method: "POST",
      headers: {
        ...accessHeaders,
        "X-CSRF-Token": "1",
        "Content-Type": "application/json",
        "Idempotency-Key": "admin-source-job-123456",
      },
      body: JSON.stringify({
        apiKeyId: "key_web",
        sourceId: sourceTicket.sourceId,
        entrypoint: "reports/a.tex",
      }),
    });
    expect(sourceJob.status).toBe(201);
    const sourceJobValue = (await sourceJob.json()) as {
      jobId: string;
      jobTicket: string;
    };
    expect(sourceJobValue).not.toHaveProperty("uploadTicket");
    expect(database.jobs.get(sourceJobValue.jobId)).toMatchObject({
      status: "queued",
      source_id: sourceTicket.sourceId,
      entrypoint: "reports/a.tex",
    });
  });
});
