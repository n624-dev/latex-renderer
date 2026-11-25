import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import {
  artifactStoragePath,
  ProjectOperations,
  RendererDatabase,
} from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("user Web application API", () => {
  it("serves single PDF ranges only to the owning user", async () => {
    const { app, database, root } = setup();
    const post = (path: string, body: string) =>
      app.request("/app/api/v1" + path, {
        method: "POST",
        headers: mutation("user"),
        body,
      });
    const created = await post("/projects", '{"displayName":"Range test"}');
    const { id } = (await created.json()) as { id: string };
    const base = `/projects/${id}/draft`;
    expect((await post(base, "{}")).status).toBe(200);
    const queued = await post(base + "/preview", '{"version":1}');
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };
    const content = Buffer.from("%PDF-test");
    const now = new Date().toISOString();
    database.raw
      .prepare("UPDATE jobs SET status='succeeded',completed_at=? WHERE id=?")
      .run(now, jobId);
    const row = {
      id: "artifact_range",
      job_id: jobId,
      type: "pdf",
      relative_path: "result.pdf",
      storage_generation: 2,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      created_at: now,
    };
    database.artifacts.insert(row);
    const path = artifactStoragePath(root, row);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    const url = `/app/api/v1/jobs/${jobId}/artifacts/result.pdf?disposition=inline`;
    const request = (range: string, ifRange?: string) =>
      app.request(url, {
        headers: {
          ...assertion("user"),
          Range: range,
          ...(ifRange ? { "If-Range": ifRange } : {}),
        },
      });

    expect(
      (await app.request(url, { headers: { Range: "bytes=0-1" } })).status,
    ).toBe(401);
    const other = await app.request(url, {
      headers: { ...assertion("other"), Range: "bytes=0-1" },
    });
    expect(other.status).toBe(404);
    expect(other.headers.has("Content-Range")).toBe(false);
    const partial = await request("bytes=0-3");
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Accept-Ranges")).toBe("bytes");
    expect(partial.headers.get("Content-Range")).toBe("bytes 0-3/9");
    expect(partial.headers.get("Content-Length")).toBe("4");
    expect(partial.headers.get("Cache-Control")).toContain("no-store");
    expect(partial.headers.has("Content-Digest")).toBe(false);
    expect(partial.headers.get("Repr-Digest")).toBe(
      `sha-256=:${Buffer.from(row.sha256, "hex").toString("base64")}:`,
    );
    expect(await partial.text()).toBe("%PDF");

    const suffix = await request("bytes=-4", partial.headers.get("ETag") ?? "");
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("test");
    const tail = await request("bytes=5-");
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("test");
    const unsatisfied = await request("bytes=9-");
    expect(unsatisfied.status).toBe(416);
    expect(unsatisfied.headers.get("Content-Range")).toBe("bytes */9");
    expect(await unsatisfied.text()).toBe("");
    for (const full of [
      await request("bytes=0-1,4-5"),
      await request("bytes=0-1", '"stale"'),
    ]) {
      expect(full.status).toBe(200);
      expect(full.headers.has("Content-Digest")).toBe(true);
      expect(await full.text()).toBe(content.toString());
    }
  });

  it("opens a blank draft, replaces it only at the confirmed version, and keeps previews in the editor", async () => {
    const { app, database } = setup();
    const post = (
      path: string,
      data: unknown,
      user: "user" | "other" = "user",
    ) =>
      app.request(path, {
        method: "POST",
        headers: mutation(user),
        body: JSON.stringify(data),
      });
    const read = (path: string, user: "user" | "other" = "user") =>
      app.request(path, { headers: assertion(user) });
    const create = await post("/app/api/v1/projects", {
      displayName: "Empty draft",
    });
    const { id } = (await create.json()) as { id: string };
    const base = `/app/api/v1/projects/${id}/draft`;
    const opened = await post(base, {});
    expect(opened.status).toBe(200);
    await expect(opened.json()).resolves.toMatchObject({
      version: 1,
      entrypoint: "main.tex",
      files: [{ path: "main.tex" }],
    });
    await expect(
      (await read(base + "/file?path=main.tex&version=1")).json(),
    ).resolves.toMatchObject({ text: "" });
    const original = await post(base + "/revisions", {
      version: 1,
      displayName: "First",
    });
    expect(original.status).toBe(200);
    const { revisionId } = (await original.json()) as { revisionId: string };
    const edited = await app.request(base + "/file", {
      method: "PUT",
      headers: mutation("user"),
      body: '{"version":1,"path":"main.tex","text":"Edited"}',
    });
    expect(edited.status).toBe(200);
    const queued = await post(base + "/preview", { version: 2 });
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };
    await expect(
      (await read(`/app/api/v1/jobs/${jobId}`)).json(),
    ).resolves.toMatchObject({ id: jobId, engine: "lualatex" });
    await expect((await read(base + "/preview")).json()).resolves.toEqual({
      latest: { jobId, version: 2, status: "queued" },
      successful: null,
    });
    expect((await read(base + "/preview", "other")).status).toBe(404);
    await expect(
      (await read("/app/api/v1/jobs")).json(),
    ).resolves.toMatchObject({ items: [] });
    expect(
      (await post(base + "/replace", { revisionId, version: 1 })).status,
    ).toBe(409);
    expect(
      (await post(base + "/replace", { revisionId, version: 2 }, "other"))
        .status,
    ).toBe(404);
    expect(database.jobs.get(jobId)?.status).toBe("queued");
    const replaced = await post(base + "/replace", { revisionId, version: 2 });
    expect(replaced.status).toBe(200);
    await expect(replaced.json()).resolves.toMatchObject({
      version: 3,
      entrypoint: "main.tex",
    });
    await expect(
      (await read(base + "/file?path=main.tex&version=3")).json(),
    ).resolves.toMatchObject({ text: "" });
    expect(database.jobs.get(jobId)?.error_code).toBe("DRAFT_SUPERSEDED");
    expect(database.projects.revisionCount(id)).toBe(1);
    expect(database.drafts.renderInput(jobId)?.files).toHaveLength(0);
  });

  it("authorizes and streams Draft attachment content without raising the JSON body limit", async () => {
    const { app, database } = setup(),
      headers = mutation("user");
    const created = await app.request("/app/api/v1/projects", {
      method: "POST",
      headers,
      body: '{"displayName":"Draft files"}',
    });
    const { id } = (await created.json()) as { id: string };
    const reserved = await app.request("/app/api/v1/source-tickets", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "draft-test-source-012345" },
      body: JSON.stringify({ size: 123, sha256: "1".repeat(64) }),
    });
    const { sourceId } = (await reserved.json()) as { sourceId: string };
    database.raw
      .prepare(
        "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
      )
      .run(sourceId);
    const actor = { type: "user", userId: "user_one", id: "user_one" };
    new ProjectOperations(database).attachRevision(actor, {
      projectId: id,
      sourceId,
      entrypoint: "main.tex",
      originalFilename: "main.tex",
      displayName: "Original",
      outputs: ["pdf"],
    });
    const base = `/app/api/v1/projects/${id}/draft`;
    expect(
      (await app.request(base, { method: "POST", headers, body: "{}" })).status,
    ).toBe(200);
    const text = "% Japanese draft test\n".repeat(4000);
    const upload = (user: "user" | "other") =>
      app.request(
        `${base}/file/content?path=chapter.tex&version=1&size=${Buffer.byteLength(text)}`,
        {
          method: "PUT",
          headers: {
            ...mutation(user),
            "Content-Type": "text/plain; charset=utf-8",
          },
          body: text,
        },
      );
    expect((await upload("other")).status).toBe(404);
    expect((await upload("user")).status).toBe(200);
    await expect(
      (
        await app.request(`${base}/file?path=chapter.tex&version=2`, {
          headers: assertion("user"),
        })
      ).json(),
    ).resolves.toMatchObject({ text });
    expect(
      (
        await app.request(`${base}/file`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ version: 2, path: "chapter.tex", text }),
        })
      ).status,
    ).toBe(413);
    expect((await upload("user")).status).toBe(409);
  });

  it("serves the saved display locale only to the corresponding account", async () => {
    const { app } = setup();
    expect(
      (
        await app.request("/app/api/v1/me/locale", {
          method: "PATCH",
          headers: mutation("user"),
          body: '{"locale":"de"}',
        })
      ).status,
    ).toBe(200);
    for (const [user, displayLocale] of [
      ["user", "de"],
      ["other", null],
    ] as const) {
      const response = await app.request("/app/api/v1/me", {
        headers: assertion(user),
      });
      await expect(response.json()).resolves.toMatchObject({ displayLocale });
    }
    expect(
      (
        await app.request("/app/api/v1/me/locale", {
          method: "PATCH",
          headers: mutation("user"),
          body: '{"locale":"xx"}',
        })
      ).status,
    ).toBe(400);
  });

  it("shares Sources across output-specific revisions and retains revision identity on rerender", async () => {
    const { app, database } = setup(),
      headers = mutation("user");
    const project = (await (
      await app.request("/app/api/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ displayName: "Outputs" }),
      })
    ).json()) as { id: string };
    const source = (await (
      await app.request("/app/api/v1/source-tickets", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "outputs-source-123456" },
        body: JSON.stringify({ size: 123, sha256: "b".repeat(64) }),
      })
    ).json()) as { sourceId: string };
    database.raw
      .prepare(
        `UPDATE sources SET status='ready',paths_json='["main.tex"]' WHERE id=?`,
      )
      .run(source.sourceId);
    const render = async (key: string, outputs: string[]) =>
      app.request("/app/api/v1/render-tickets", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": key },
        body: JSON.stringify({
          sourceId: source.sourceId,
          entrypoint: "main.tex",
          projectId: project.id,
          displayName: "Original",
          originalFilename: "main.tex",
          outputs,
        }),
      });
    const firstResponse = await render("outputs-first-123456", ["pdf"]);
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as {
      jobId: string;
      revisionId: string;
    };
    database.raw
      .prepare(
        "UPDATE sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(source.sourceId);
    const secondResponse = await render("outputs-second-123456", [
      "pdf",
      "svg",
    ]);
    expect(secondResponse.status).toBe(201);
    const second = (await secondResponse.json()) as {
      jobId: string;
      revisionId: string;
    };
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(database.jobs.get(first.jobId)?.outputs_json).toBe('["pdf"]');
    expect(database.jobs.get(second.jobId)?.outputs_json).toBe('["pdf","svg"]');
    expect(database.projects.revisionCount(project.id)).toBe(2);
    for (let retry = 0; retry < 2; retry++) {
      const reused = await app.request("/app/api/v1/source-tickets", {
        method: "POST",
        headers: {
          ...headers,
          "Idempotency-Key": "retained-source-reuse-123456",
        },
        body: JSON.stringify({ size: 123, sha256: "b".repeat(64) }),
      });
      expect(reused.status).toBe(200);
      expect(await reused.json()).toMatchObject({
        sourceId: source.sourceId,
        uploadRequired: false,
      });
    }
    const url = `/app/api/v1/projects/${project.id}/revisions/${first.revisionId}/render`;
    for (const [index, body, expected] of [
      [0, {}, '["pdf"]'],
      [1, { outputs: ["pdf", "svg"] }, '["pdf","svg"]'],
      [2, undefined, '["pdf"]'],
    ] as const) {
      const response = await app.request(url, {
        method: "POST",
        headers: {
          ...headers,
          "Idempotency-Key": `outputs-rerender-123456-${index}`,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      const job = (await response.json()) as { jobId: string };
      expect(database.jobs.get(job.jobId)).toMatchObject({
        project_revision_id: first.revisionId,
        outputs_json: expected,
      });
    }
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": "invalid-outputs-123456" },
          body: '{"outputs":["exe"]}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: {
            ...mutation("other"),
            "Idempotency-Key": "other-outputs-123456",
          },
          body: "{}",
        })
      ).status,
    ).toBe(404);
    const detail = (await (
      await app.request(`/app/api/v1/projects/${project.id}`, {
        headers: assertion("user"),
      })
    ).json()) as { revisions: { jobs: { id: string; outputs: string[] }[] }[] };
    expect(detail.revisions.flatMap((revision) => revision.jobs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.jobId, outputs: ["pdf"] }),
        expect.objectContaining({ id: second.jobId, outputs: ["pdf", "svg"] }),
      ]),
    );
    expect(database.sources.storageUsageForUser("user_one")).toBe(123);
    database.projects.softDelete(
      project.id,
      "user_one",
      new Date().toISOString(),
    );
    expect(
      database.sources.getOwnedReady(
        source.sourceId,
        "user_one",
        new Date().toISOString(),
      )?.id,
    ).toBe(source.sourceId);
    // Finished Jobs still retain the Source, but do not consume queue slots.
    database.raw
      .prepare("UPDATE jobs SET status='succeeded' WHERE source_id=?")
      .run(source.sourceId);
    const deletedProject = await render("outputs-deleted-123456", ["pdf"]);
    expect(deletedProject.status).toBe(404);
    expect(await deletedProject.json()).toMatchObject({
      error: { code: "PROJECT_NOT_FOUND" },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const reused = await app.request("/app/api/v1/source-tickets", {
        method: "POST",
        headers: {
          ...headers,
          "Idempotency-Key": "job-only-retained-reuse-123456",
        },
        body: JSON.stringify({ size: 123, sha256: "b".repeat(64) }),
      });
      expect(reused.status).toBe(200);
      expect(await reused.json()).toMatchObject({
        sourceId: source.sourceId,
        uploadRequired: false,
      });
    }
    database.raw
      .prepare("UPDATE jobs SET status='deleted' WHERE source_id=?")
      .run(source.sourceId);
    expect(
      database.sources.getOwnedReady(
        source.sourceId,
        "user_one",
        new Date().toISOString(),
      ),
    ).toBeUndefined();
    expect(
      (
        await app.request("/app/api/v1/source-tickets", {
          method: "POST",
          headers: {
            ...headers,
            "Idempotency-Key": "job-only-retained-reuse-123456",
          },
          body: JSON.stringify({ size: 123, sha256: "b".repeat(64) }),
        })
      ).status,
    ).toBe(410);
  });

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

    // An empty but structurally valid ZIP is enough to exercise exact
    // delivery. Upload validation is covered separately.
    const archive = Buffer.alloc(22);
    archive.writeUInt32LE(0x06054b50);
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    const sourceResponse = await fixture.app.request(
      "/app/api/v1/source-tickets",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "web-source-1234567890" },
        body: JSON.stringify({ size: archive.length, sha256: archiveSha }),
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
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
        outputs: ["pdf", "svg"],
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
      outputs_json: '["pdf","svg"]',
    });
    const reused = await fixture.app.request("/app/api/v1/render-tickets", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": "web-render-1234567890" },
      body: JSON.stringify({
        sourceId: source.sourceId,
        entrypoint: "chapters/report.tex",
        projectId: project.id,
        displayName: "第1稿",
        originalFilename: "research.zip",
        outputs: ["pdf", "svg"],
      }),
    });
    expect(reused.status).toBe(200);
    await expect(reused.json()).resolves.toMatchObject({
      jobId: rendered.jobId,
      revisionId: rendered.revisionId,
    });

    const secondProjectResponse = await fixture.app.request(
      "/app/api/v1/projects",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ displayName: "別プロジェクト" }),
      },
    );
    const secondProject = (await secondProjectResponse.json()) as {
      id: string;
    };
    const crossProjectReuse = await fixture.app.request(
      "/app/api/v1/render-tickets",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "web-render-1234567890" },
        body: JSON.stringify({
          sourceId: source.sourceId,
          entrypoint: "chapters/report.tex",
          projectId: secondProject.id,
          displayName: "第1稿",
          originalFilename: "research.zip",
        }),
      },
    );
    expect(crossProjectReuse.status).toBe(409);
    await expect(crossProjectReuse.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(fixture.database.jobs.get(rendered.jobId)?.project_revision_id).toBe(
      rendered.revisionId,
    );

    const jobsBeforeFailedProject = (
      fixture.database.raw
        .prepare("SELECT COUNT(*) AS count FROM jobs")
        .get() as {
        count: number;
      }
    ).count;
    const failedProject = await fixture.app.request(
      "/app/api/v1/render-tickets",
      {
        method: "POST",
        headers: {
          ...headers,
          "Idempotency-Key": "web-render-invalid-project",
        },
        body: JSON.stringify({
          sourceId: source.sourceId,
          entrypoint: "chapters/report.tex",
          projectId: `project_${"f".repeat(32)}`,
          displayName: "存在しないProject",
          originalFilename: "research.zip",
        }),
      },
    );
    expect(failedProject.status).toBe(404);
    expect(
      (
        fixture.database.raw
          .prepare("SELECT COUNT(*) AS count FROM jobs")
          .get() as { count: number }
      ).count,
    ).toBe(jobsBeforeFailedProject);
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

    const savedZip = join(fixture.root, "sources", source.sourceId, "source.zip");
    mkdirSync(dirname(savedZip), { recursive: true });
    writeFileSync(savedZip, archive);
    const downloadPath = `/app/api/v1/projects/${project.id}/revisions/${rendered.revisionId}/source.zip`;
    const download = await fixture.app.request(downloadPath, { headers: assertion("user") });
    expect(download.status).toBe(200);
    expect(download.headers.get("etag")).toBe(`"${archiveSha}"`);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(archive);
    const corrupted = Buffer.from(archive);
    corrupted[10] = 42;
    writeFileSync(savedZip, corrupted);
    const mismatched = await fixture.app.request(downloadPath, { headers: assertion("user") });
    expect(mismatched.status).toBe(410);

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
      outputs_json: '["pdf","svg"]',
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
      browserAuth: legacyTestBrowserAuth(database, access),
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: root,
      environmentRoot,
      rendererVersion: "test",
      maxOutputBytes: 1,
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
  return { app, database, tickets, root };
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
