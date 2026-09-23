import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService } from "@latex-renderer/auth";
import { ProjectOperations, RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createInternalApp } from "../apps/internal-api/src/app.js";
import { gatewayRoute } from "../packages/gateway-core/src/index.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const now = new Date().toISOString(),
    later = new Date(Date.now() + 3_600_000).toISOString();
  for (const userId of ["user_one", "user_two"])
    database.users.insertInvitation({
      id: userId,
      displayName: userId,
      role: "user",
      createdBy: "test",
      timestamp: now,
    });
  const apiKeys = new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 7)]]),
      "v1",
    ),
    tokens: string[] = [];
  for (const [index, userId] of [
    "user_one",
    "user_one",
    "user_two",
  ].entries()) {
    const accountId = `service_${index}`,
      generated = apiKeys.create("render");
    database.serviceAccounts.insert({
      id: accountId,
      ownerUserId: userId,
      name: accountId,
      clientType: "generic",
      timestamp: now,
    });
    database.apiKeys.insert({
      id: generated.id,
      serviceAccountId: accountId,
      name: accountId,
      prefix: generated.prefix,
      kind: generated.kind,
      secretHash: generated.secretHash,
      pepperId: generated.pepperId,
      scopes: ["render:create", "render:read:own"],
      createdAt: now,
      createdBy: "test",
    });
    tokens.push(generated.token);
  }
  const sourceId = `source_${"a".repeat(32)}`;
  database.sources.insertReserved({
    id: sourceId,
    ownerUserId: "user_one",
    size: 10,
    sha256: "b".repeat(64),
    storageKey: `sources/${sourceId}/source.zip`,
    timestamp: now,
    expiresAt: later,
  });
  database.raw
    .prepare(
      "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
    )
    .run(sourceId);
  const tickets = new TicketService(
    database,
    "latex-renderer",
    "latex-render",
    { kid: "v1", secret: Buffer.alloc(32, 9) },
    [],
  );
  const app = createInternalApp({
    database,
    apiKeys,
    tickets,
    rendererPublicUrl: "https://renderer.example.test",
    rendererVersion: "test",
    maxOutputBytes: 10,
    maxQueueLength: 20,
    maxUserStorageBytes: 1_000_000,
  });
  const request = (
    token: string,
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) =>
    app.request(`/internal/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key === undefined ? {} : { "Idempotency-Key": key }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  if (tokens.length !== 3) throw new Error("Expected three API keys");
  return {
    database,
    sourceId,
    tokens: tokens as [string, string, string],
    request,
  };
}

describe("shared saved Project operations", () => {
  it("shares one owner history across service accounts and preserves another owner's 404", async () => {
    const f = fixture(),
      token = f.tokens[0],
      otherKey = f.tokens[1],
      outsider = f.tokens[2];
    const created = await f.request(token, "POST", "/projects", {
      displayName: "Draft",
    });
    expect(created.status).toBe(201);
    const { id: projectId } = (await created.json()) as { id: string };
    const revisionInput = {
      sourceId: f.sourceId,
      entrypoint: "main.tex",
      displayName: "First",
      originalFilename: "main.tex",
      outputs: ["pdf"],
    };
    const attached = await f.request(
      otherKey,
      "POST",
      `/projects/${projectId}/revisions`,
      revisionInput,
    );
    expect(attached.status).toBe(201);
    const revision = (await attached.json()) as {
      id: string;
      revisionNumber: number;
    };
    expect(revision.revisionNumber).toBe(1);
    const duplicate = await f.request(
      token,
      "POST",
      `/projects/${projectId}/revisions`,
      revisionInput,
    );
    expect(((await duplicate.json()) as { id: string }).id).toBe(revision.id);
    expect(f.database.projects.revisionCount(projectId)).toBe(1);
    const rendered = await f.request(
      otherKey,
      "POST",
      `/projects/${projectId}/revisions/${revision.id}/render`,
      {},
      "project-render-123456789",
    );
    expect(rendered.status).toBe(201);
    const job = (await rendered.json()) as {
      jobId: string;
      revisionId: string;
    };
    expect(job.revisionId).toBe(revision.id);
    expect(f.database.jobs.get(job.jobId)?.project_revision_id).toBe(
      revision.id,
    );
    const detail = await f.request(token, "GET", `/projects/${projectId}`);
    expect(await detail.json()).toMatchObject({
      revisionCount: 1,
      latestRevision: { id: revision.id, jobCount: 1 },
      revisions: [
        { id: revision.id, sourceId: f.sourceId, jobs: [{ id: job.jobId }] },
      ],
    });
    const jobs = await f.request(
      token,
      "GET",
      `/projects/${projectId}/revisions/${revision.id}/jobs`,
    );
    const jobsPage = (await jobs.json()) as {
      items: Array<{ id: string; createdAt: string; outputs: string[] }>;
    };
    expect(jobsPage.items[0]).toMatchObject({
      id: job.jobId,
      outputs: ["pdf"],
    });
    expect(jobsPage.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      (await f.request(outsider, "GET", `/projects/${projectId}`)).status,
    ).toBe(404);
    expect(
      (
        await f.request(outsider, "PATCH", `/projects/${projectId}`, {
          displayName: "stolen",
        })
      ).status,
    ).toBe(404);
  });

  it("allows metadata changes in reject-new-jobs mode but rejects rendering", async () => {
    const f = fixture(),
      token = f.tokens[0];
    f.database.settings.upsert(
      "maintenance_mode",
      "reject-new-jobs",
      "test",
      new Date().toISOString(),
    );
    const created = await f.request(token, "POST", "/projects", {
      displayName: "Draft",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const attached = await f.request(
      token,
      "POST",
      `/projects/${id}/revisions`,
      {
        sourceId: f.sourceId,
        entrypoint: "main.tex",
        displayName: "First",
        originalFilename: "main.tex",
        outputs: ["pdf"],
      },
    );
    expect(attached.status).toBe(201);
    const revision = (await attached.json()) as { id: string };
    expect(
      (
        await f.request(token, "PATCH", `/projects/${id}`, {
          displayName: "Renamed",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          token,
          "POST",
          `/projects/${id}/revisions/${revision.id}/render`,
          {},
          "maintenance-render-123456",
        )
      ).status,
    ).toBe(503);
    expect((await f.request(token, "DELETE", `/projects/${id}`)).status).toBe(
      200,
    );
    expect(f.database.projects.getOwned(id, "user_one")).toBeUndefined();
  });

  it("keeps Project metadata read-only in read-only and lockdown modes", () => {
    const f = fixture(),
      operations = new ProjectOperations(f.database),
      actor = { userId: "user_one", type: "test", id: "test" };
    for (const mode of ["read-only", "lockdown"] as const) {
      f.database.settings.upsert(
        "maintenance_mode",
        mode,
        "test",
        new Date().toISOString(),
      );
      expect(() => operations.create(actor, "Blocked")).toThrow();
      expect(operations.list(actor).items).toEqual([]);
    }
  });

  it("rejects a saved revision whose output defaults cannot render", () => {
    const f = fixture(),
      operations = new ProjectOperations(f.database),
      actor = { userId: "user_one", type: "test", id: "test" },
      project = operations.create(actor, "Draft");
    expect(() =>
      operations.attachRevision(actor, {
        projectId: project.id,
        sourceId: f.sourceId,
        entrypoint: "main.tex",
        displayName: "Draft",
        originalFilename: "main.tex",
        outputs: ["svg"],
      }),
    ).toThrow("Render outputs are invalid");
    expect(f.database.projects.revisionCount(project.id)).toBe(0);
  });

  it("routes only exact Project API paths to the private gateway", () => {
    const projectId = `project_${"a".repeat(32)}`,
      revisionId = `revision_${"b".repeat(32)}`;
    expect(gatewayRoute("/api/v1/projects", "GET")).toMatchObject({
      upstreamPath: "/internal/v1/projects",
    });
    expect(
      gatewayRoute(
        `/api/v1/projects/${projectId}/revisions/${revisionId}/render`,
        "POST",
      ),
    ).toMatchObject({
      upstreamPath: `/internal/v1/projects/${projectId}/revisions/${revisionId}/render`,
      idempotencyRequired: true,
    });
    expect(
      gatewayRoute(
        `/api/v1/projects/${projectId}/revisions/${revisionId}/render`,
        "GET",
      ),
    ).toBe("method-not-allowed");
    expect(gatewayRoute("/api/v1/projects/../../admin", "GET")).toBeUndefined();
  });
});
