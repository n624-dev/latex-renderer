import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createAdminApp } from "../apps/admin-api/src/app.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("user Web application API", () => {
  it("uses a fixed secretless principal and owns Projects, revisions, Jobs, and renewed tickets", async () => {
    const fixture = setup(),
      headers = mutation("user"),
      me = await fixture.app.request("/app/api/v1/me", {
        headers: assertion("user"),
      });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      role: "user",
      isAdmin: false,
    });
    expect(
      (
        await fixture.app.request("/admin/api/v1/me", {
          headers: assertion("user"),
        })
      ).status,
    ).toBe(403);

    const createdProject = await fixture.app.request("/app/api/v1/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ displayName: "研究ノート" }),
    });
    expect(createdProject.status).toBe(201);
    const project = (await createdProject.json()) as { id: string };

    const sourceResponse = await fixture.app.request(
      "/app/api/v1/source-tickets",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "web-source-1234567890" },
        body: JSON.stringify({ size: 123, sha256: "a".repeat(64) }),
      },
    );
    expect(sourceResponse.status).toBe(201);
    const source = (await sourceResponse.json()) as { sourceId: string };
    const now = new Date().toISOString();
    fixture.database.raw
      .prepare(
        `UPDATE sources SET status='ready',paths_json=?,uploaded_at=?,expires_at=?
         WHERE id=?`,
      )
      .run(
        JSON.stringify(["chapters/report.tex"]),
        now,
        new Date(Date.now() - 1_000).toISOString(),
        source.sourceId,
      );

    const render = await fixture.app.request("/app/api/v1/render-tickets", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "web-render-1234567890" },
      body: JSON.stringify({
        sourceId: source.sourceId,
        entrypoint: "chapters/report.tex",
        projectId: project.id,
        displayName: "第1稿",
        originalFilename: "research.zip",
      }),
    });
    expect(render.status).toBe(201);
    const rendered = (await render.json()) as {
      jobId: string;
      jobTicket: string;
      revisionId: string;
    };
    expect(rendered).not.toHaveProperty("apiKeyId");
    expect(fixture.database.jobs.get(rendered.jobId)).toMatchObject({
      user_id: "user_one",
      status: "queued",
      project_revision_id: rendered.revisionId,
    });
    const principal = fixture.database.webPrincipals.get("user_one");
    expect(principal).toBeDefined();
    if (principal === undefined)
      throw new Error("Web principal was not provisioned");
    expect(
      fixture.database.raw
        .prepare("SELECT secret_hash,created_by FROM api_keys WHERE id=?")
        .get(principal.api_key_id),
    ).toEqual({ secret_hash: "0".repeat(64), created_by: "web-principal" });

    const detail = await fixture.app.request(
      `/app/api/v1/projects/${project.id}`,
      { headers: assertion("user") },
    );
    await expect(detail.json()).resolves.toMatchObject({
      displayName: "研究ノート",
      revisions: [
        {
          id: rendered.revisionId,
          revisionNumber: 1,
          originalFilename: "research.zip",
          jobs: [{ id: rendered.jobId }],
        },
      ],
    });
    expect(fixture.database.sources.referenceCount(source.sourceId)).toBe(2);
    expect(fixture.database.sources.markDeleting(source.sourceId, now)).toBe(0);

    const renewed = await fixture.app.request(
      `/app/api/v1/jobs/${rendered.jobId}/access-ticket`,
      { method: "POST", headers, body: "{}" },
    );
    expect(renewed.status).toBe(200);
    const renewedBody = (await renewed.json()) as { jobTicket: string };
    await expect(
      fixture.tickets.verify(renewedBody.jobTicket, "status", rendered.jobId),
    ).resolves.toMatchObject({ user_id: "user_one" });

    const rerender = await fixture.app.request(
      `/app/api/v1/projects/${project.id}/revisions/${rendered.revisionId}/render`,
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "web-rerender-123456789" },
        body: "{}",
      },
    );
    expect(rerender.status).toBe(201);
    const rerendered = (await rerender.json()) as { jobId: string };
    expect(fixture.database.jobs.get(rerendered.jobId)).toMatchObject({
      project_revision_id: rendered.revisionId,
      source_id: source.sourceId,
    });
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    fixture.database.raw
      .prepare(
        "UPDATE jobs SET status='succeeded',updated_at=?,completed_at=? WHERE id=?",
      )
      .run(old, old, rerendered.jobId);
    const expired = await fixture.app.request(
      `/app/api/v1/jobs/${rerendered.jobId}/access-ticket`,
      { method: "POST", headers, body: "{}" },
    );
    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toMatchObject({
      error: { code: "JOB_UNAVAILABLE" },
    });

    const hidden = await fixture.app.request(
      `/app/api/v1/jobs/${rendered.jobId}`,
      { headers: assertion("other") },
    );
    expect(hidden.status).toBe(404);

    fixture.database.apiKeys.revoke(principal.api_key_id, now);
    const revoked = await fixture.app.request(
      `/app/api/v1/jobs/${rendered.jobId}/access-ticket`,
      { method: "POST", headers, body: "{}" },
    );
    expect(revoked.status).toBe(403);
    await expect(revoked.json()).resolves.toMatchObject({
      error: { code: "JOB_IDENTITY_REVOKED" },
    });
  });

  it("shares the deployed package and font inventory with Remote MCP", async () => {
    const fixture = setup();
    const capabilities = await fixture.app.request("/app/api/v1/environment", {
      headers: assertion("user"),
    });
    expect(capabilities.status).toBe(200);
    await expect(capabilities.json()).resolves.toMatchObject({
      texliveVersion: "2026",
      engines: ["lualatex"],
      shellEscape: false,
      networkAccess: false,
    });
    const packages = await fixture.app.request(
      "/app/api/v1/environment/packages/search?query=tabular",
      { headers: assertion("user") },
    );
    await expect(packages.json()).resolves.toMatchObject({
      matches: ["tabularray"],
    });
    const fonts = await fixture.app.request(
      "/app/api/v1/environment/fonts/search?query=harano",
      { headers: assertion("user") },
    );
    await expect(fonts.json()).resolves.toMatchObject({
      matches: ["Harano Aji Mincho"],
    });
  });
});

function setup() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const timestamp = new Date().toISOString();
  for (const [id, subject, email] of [
    ["user_one", "subject-user", "user@example.test"],
    ["user_two", "subject-other", "other@example.test"],
  ] as const)
    database.raw
      .prepare(
        `INSERT INTO users
         (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
         VALUES (?,?,?,1,?,?,'user','active',1,'test',?,?)`,
      )
      .run(id, subject, timestamp, email, id, timestamp, timestamp);
  database.transaction(() => database.webPrincipals.ensureAll());
  const root = mkdtempSync(join(tmpdir(), "latex-renderer-app-api-"));
  roots.push(root);
  const environmentRoot = join(root, "environment");
  mkdirSync(environmentRoot);
  writeFileSync(
    join(environmentRoot, "packages.txt"),
    "amsmath\ntabularray\ntikz\n",
  );
  writeFileSync(
    join(environmentRoot, "fonts.txt"),
    "Harano Aji Mincho\nLatin Modern Roman\n",
  );
  const tickets = new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 7) },
      [],
    ),
    access = {
      verify: (token: string) => {
        const other = token === "other";
        return Promise.resolve({
          subject: other ? "subject-other" : "subject-user",
          email: other ? "other@example.test" : "user@example.test",
          payload: { sub: other ? "subject-other" : "subject-user" },
        });
      },
    } as unknown as AccessJwtVerifier,
    app = createAdminApp({
      database,
      apiKeys: new ApiKeyService(
        database,
        new Map([["v1", Buffer.alloc(32, 1)]]),
        "v1",
      ),
      access,
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: root,
      environmentRoot,
      rendererVersion: "test",
      maxQueueLength: 20,
      maxUserStorageBytes: 1024 * 1024,
      minFreeStorageBytes: 1,
      activeTicketKid: "v1",
      verificationTicketKids: [],
      renderTickets: {
        tickets,
        rendererPublicUrl: "https://latex.example.com",
      },
    });
  return { app, database, tickets };
}

function assertion(token: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": token };
}

function mutation(token: string): Record<string, string> {
  return {
    ...assertion(token),
    "X-CSRF-Token": "1",
    "Content-Type": "application/json",
  };
}
