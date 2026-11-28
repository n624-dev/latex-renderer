import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService } from "@latex-renderer/auth";
import {
  ProjectDraftOperations,
  ProjectOperations,
  RendererDatabase,
} from "@latex-renderer/database";
import { projectSourceRows } from "../deploy/scripts/backup-boundary.mjs";
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

  it.each(["pdflatex", "xelatex", "platex", "uplatex"])("shares Source bytes and preserves %s in the revision, job and worker", async (engine) => {
    const f = fixture(),
      token = f.tokens[0];
    const response = await f.request(token, "POST", "/projects", {
      displayName: "Engine settings",
    });
    const { id } = (await response.json()) as { id: string };
    const path = `/projects/${id}/revisions`;
    const input = {
      sourceId: f.sourceId,
      entrypoint: "main.tex",
      displayName: "Example",
      originalFilename: "main.tex",
    };
    const attach = async (settings: Record<string, unknown>) => {
      const result = await f.request(token, "POST", path, {
        ...input,
        ...settings,
      });
      expect(result.status).toBe(201);
      return (await result.json()) as {
        id: string;
        engine: string;
        outputs: string[];
      };
    };
    const legacy = await attach({});
    const selected = await attach({ engine });
    const withSvg = await attach({
      engine,
      outputs: ["svg", "pdf"],
    });
    expect(legacy.engine).toBe("lualatex");
    expect((await attach({ engine: "lualatex" })).id).toBe(legacy.id);
    expect(selected.engine).toBe(engine);
    expect(withSvg.outputs).toEqual(["pdf", "svg"]);
    expect(new Set([legacy.id, selected.id, withSvg.id]).size).toBe(3);
    expect(
      (await attach({ engine, outputs: ["pdf", "svg"] })).id,
    ).toBe(withSvg.id);
    expect(
      f.database.projects.revisions(id).map((revision) => revision.source_id),
    ).toEqual(Array(3).fill(f.sourceId));

    const rendered = await f.request(
      token,
      "POST",
      `${path}/${selected.id}/render`,
      {},
      "engine-render-123456789",
    );
    expect(rendered.status).toBe(201);
    const { jobId } = (await rendered.json()) as { jobId: string };
    expect(f.database.jobs.get(jobId)).toMatchObject({
      engine,
      project_revision_id: selected.id,
    });
    expect(
      f.database.worker.claimNext(
        "worker-test",
        new Date().toISOString(),
        new Date(Date.now() + 60000).toISOString(),
      )?.engine,
    ).toBe(engine);
  });

  it("keeps a versioned Draft owner-scoped and retains only its referenced Sources", () => {
    const f = fixture(),
      user = { userId: "user_one", type: "user", id: "user_one" },
      outsider = { userId: "user_two", type: "user", id: "user_two" },
      projects = new ProjectOperations(f.database),
      drafts = new ProjectDraftOperations(f.database),
      project = projects.create(user, "Editable project");
    const saved = projects.attachRevision(user, {
      projectId: project.id,
      sourceId: f.sourceId,
      entrypoint: "main.tex",
      displayName: "Saved input",
      originalFilename: "main.tex",
      outputs: ["pdf"],
      engine: "xelatex",
    });
    expect(drafts.get(user, project.id)).toBeNull();
    expect(drafts.open(user, project.id)).toMatchObject({
      version: 1,
      engine: "xelatex",
      files: [{ sourceId: saved.source_id, path: "main.tex" }],
    });
    expect(() => drafts.get(outsider, project.id)).toThrow(
      /Project does not exist/,
    );
    const patchId = `source_${"c".repeat(32)}`,
      now = new Date().toISOString();
    f.database.sources.insertReserved({
      id: patchId,
      ownerUserId: user.userId,
      size: 12,
      sha256: "c".repeat(64),
      storageKey: `sources/${patchId}/source.zip`,
      timestamp: now,
      expiresAt: new Date(Date.now() + 100_000).toISOString(),
    });
    f.database.raw
      .prepare(
        "UPDATE sources SET status='ready',paths_json='[\"figure.png\"]' WHERE id=?",
      )
      .run(patchId);
    const patch = {
      version: 1,
      files: [
        {
          path: "figures/figure.png",
          sourceId: patchId,
          sourcePath: "figure.png",
        },
      ],
    };
    expect(drafts.update(user, project.id, patch)).toMatchObject({
      version: 2,
    });
    expect(() => drafts.update(user, project.id, patch)).toThrow(
      /draft has changed/,
    );
    expect(() =>
      drafts.update(user, project.id, {
        version: 2,
        files: [{ path: "main.tex", remove: true }],
      }),
    ).toThrow(/entrypoint/);
    expect(drafts.open(user, project.id).version).toBe(2);
    expect(projects.get(user, project.id).revisionCount).toBe(1);
    f.database.raw
      .prepare(
        "UPDATE sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(patchId);
    expect(
      f.database.sources.getOwnedReady(patchId, user.userId, now)?.id,
    ).toBe(patchId);
    expect(f.database.sources.blockingReferenceCount(patchId)).toBe(1);
    expect(
      projectSourceRows(f.database.raw).map((row: { id: string }) => row.id),
    ).toContain(patchId);
    projects.delete(user, project.id);
    expect(f.database.sources.blockingReferenceCount(patchId)).toBe(0);
    expect(
      f.database.sources.getOwnedReady(patchId, user.userId, now),
    ).toBeUndefined();
  });

  it("freezes draft inputs and replaces only the waiting preview for a Project", () => {
    const f = fixture(),
      db = f.database;
    const actor = { userId: "user_one", type: "user", id: "user_one" };
    const projects = new ProjectOperations(db),
      drafts = new ProjectDraftOperations(db);
    const project = projects.create(actor, "Live preview");
    const revision = projects.attachRevision(actor, {
      projectId: project.id,
      sourceId: f.sourceId,
      entrypoint: "main.tex",
      displayName: "Start",
      originalFilename: "main.tex",
      outputs: ["pdf"],
    });
    drafts.open(actor, project.id, revision.id);
    const principal = db.raw
      .prepare("SELECT id FROM api_keys WHERE service_account_id=?")
      .get("service_0");
    if (typeof principal?.id !== "string")
      throw new Error("Fixture key missing");
    const options = {
      serviceAccountId: "service_0",
      apiKeyId: principal.id,
      rendererVersion: "test",
      maxOutputBytes: 100,
      runtime: "sha256:" + "1".repeat(64),
      maxQueueLength: 100,
      maxUserStorageBytes: 1024 ** 3,
    };
    const first = drafts.queuePreview(actor, project.id, 1, options);
    expect(drafts.queuePreview(actor, project.id, 1, options)).toMatchObject({
      jobId: first.jobId,
      reused: true,
    });
    const now = new Date().toISOString(),
      deadline = new Date(Date.now() + 60_000).toISOString();
    const claimed = db.worker.claimNext("fixture-worker", now, deadline);
    if (!claimed) throw new Error("Fixture preview claim missing");
    expect(claimed.id).toBe(first.jobId);
    expect(
      db.worker.transitionOwned(
        first.jobId,
        "fixture-worker",
        claimed.lease_generation,
        ["validating"],
        "running",
        now,
      ),
    ).toBe(1);
    db.drafts.requestOutdatedPreviewStop(
      first.jobId,
      "fixture-worker",
      claimed.lease_generation,
      now,
    );
    expect(db.jobs.get(first.jobId)?.cancel_requested_at).toBeNull();
    const replacement = "source_" + "e".repeat(32);
    db.sources.insertReserved({
      id: replacement,
      ownerUserId: actor.userId,
      size: 12,
      sha256: "a".repeat(64),
      storageKey: `sources/${replacement}/source.zip`,
      timestamp: now,
      expiresAt: deadline,
    });
    db.raw
      .prepare(
        "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
      )
      .run(replacement);
    drafts.update(actor, project.id, {
      version: 1,
      files: [
        { path: "main.tex", sourceId: replacement, sourcePath: "main.tex" },
      ],
    });
    const waiting = drafts.queuePreview(actor, project.id, 2, options);
    expect(
      db.worker.claimNext("another-worker", now, deadline),
    ).toBeUndefined();
    expect(db.drafts.renderInput(first.jobId)?.files[0]?.source_id).toBe(
      f.sourceId,
    );
    expect(db.drafts.renderInput(waiting.jobId)?.files[0]?.source_id).toBe(
      replacement,
    );
    drafts.update(actor, project.id, {
      version: 2,
      engine: "xelatex",
      files: [],
    });
    expect(() =>
      drafts.queuePreview(actor, project.id, 3, {
        ...options,
        maxUserStorageBytes: 1,
      }),
    ).toThrow("User storage quota is exhausted");
    expect(db.jobs.get(waiting.jobId)?.status).toBe("queued");
    const latest = drafts.queuePreview(actor, project.id, 3, options);
    expect(db.jobs.get(waiting.jobId)).toMatchObject({
      status: "canceled",
      error_code: "DRAFT_SUPERSEDED",
    });
    expect(db.drafts.renderInput(waiting.jobId)?.files).toEqual([]);
    db.drafts.requestOutdatedPreviewStop(
      first.jobId,
      "another-worker",
      claimed.lease_generation,
      now,
    );
    expect(db.jobs.get(first.jobId)?.cancel_requested_at).toBeNull();
    db.drafts.requestOutdatedPreviewStop(
      first.jobId,
      "fixture-worker",
      claimed.lease_generation,
      now,
    );
    expect(db.jobs.get(first.jobId)).toMatchObject({
      status: "running",
      error_code: "DRAFT_SUPERSEDED",
      cancel_requested_at: now,
    });
    db.raw
      .prepare("UPDATE jobs SET status='canceled' WHERE id=?")
      .run(first.jobId);
    expect(
      db.worker.claimNext("another-worker", now, deadline),
    ).toBeUndefined();
    expect(db.drafts.renderInput(first.jobId)?.files).toHaveLength(1);
    db.raw
      .prepare("UPDATE jobs SET lease_owner=NULL WHERE id=?")
      .run(first.jobId);
    expect(db.drafts.renderInput(first.jobId)?.files).toEqual([]);
    expect(db.worker.claimNext("another-worker", now, deadline)).toMatchObject({
      id: latest.jobId,
      engine: "xelatex",
    });
    db.raw
      .prepare(
        `UPDATE jobs SET status='succeeded',render_status='succeeded',
      lease_owner=NULL,runtime_digest=?,completed_at=? WHERE id=?`,
      )
      .run(options.runtime, now, latest.jobId);
    db.artifacts.insert({
      id: "example-pdf-artifact",
      job_id: latest.jobId,
      type: "pdf",
      relative_path: "result.pdf",
      size: 1024,
      sha256: "d".repeat(64),
      created_at: now,
    });
    drafts.update(actor, project.id, {
      version: 3,
      engine: "pdflatex",
      files: [],
    });
    drafts.update(actor, project.id, {
      version: 4,
      engine: "xelatex",
      files: [],
    });
    expect(drafts.queuePreview(actor, project.id, 5, options)).toEqual({
      jobId: latest.jobId,
      version: 5,
      reused: true,
    });
    expect(
      drafts.queuePreview(actor, project.id, 5, {
        ...options,
        runtime: "sha256:" + "2".repeat(64),
      }),
    ).toMatchObject({
      reused: false,
    });
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
