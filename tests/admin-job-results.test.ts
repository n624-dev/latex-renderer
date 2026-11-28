import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import {
  ProjectDraftOperations,
  RendererDatabase,
} from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { RenderTicketsService } from "../apps/internal-api/src/services/render-tickets.js";
import { createRendererApp } from "../apps/renderer-api/src/app.js";
import { RemoteRenderService } from "../packages/remote-mcp-core/src/index.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("administrator Job results and Sources", () => {
  it("hides internal smoke resources before pagination and blocks direct user/Admin access", async () => {
    const { database, app, headers } = await setup(),
      timestamp = new Date().toISOString(),
      sourceId = `source_${"d".repeat(32)}`,
      jobId = `job_${"d".repeat(32)}`;
    database.raw.exec(`INSERT INTO service_accounts
      (id,owner_user_id,name,client_type,created_at,updated_at,purpose)
      VALUES ('sa_smoke','user_owner','production-smoke-sa_smoke','ci','2026-10-01','2026-10-01','production-smoke');
      INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
      VALUES ('key_smoke','sa_smoke','production-smoke','smoke_prefix','hash','v1','["render:create"]','2026-10-01','local-smoke-test');`);
    database.sources.insertReserved({
      id: sourceId,
      ownerUserId: "user_owner",
      serviceAccountId: "sa_smoke",
      size: 100,
      sha256: "d".repeat(64),
      storageKey: `sources/${sourceId}/source.zip`,
      timestamp,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    database.jobs.insertReserved({
      id: jobId,
      userId: "user_owner",
      serviceAccountId: "sa_smoke",
      apiKeyId: "key_smoke",
      rendererVersion: "test",
      sourceSize: 100,
      sourceSha256: "d".repeat(64),
      sourceId,
      timestamp,
      reservedOutputBytes: 50,
    });
    database.audit({
      actorType: "local",
      actorId: "0",
      action: "api_key.created",
      targetType: "api_key",
      targetId: "key_smoke",
      result: "success",
      metadata: { smokeTest: true },
    });
    database.audit({
      actorType: "service_account",
      actorId: "sa_smoke",
      action: "render.created",
      targetType: "job",
      targetId: jobId,
      result: "success",
    });

    for (const [path, total] of [
      ["service-accounts", 1],
      ["api-keys", 1],
      ["jobs", 0],
      ["sources", 0],
    ] as const) {
      const response = await app.request(`/admin/api/v1/${path}?pageSize=1`, {
        headers,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ total, hasMore: false });
      const search = await app.request(
        `/admin/api/v1/${path}?query=production-smoke`,
        { headers },
      );
      expect(await search.json()).toMatchObject({ items: [], total: 0 });
    }
    for (const path of [
      "/admin/api/v1/service-accounts/sa_smoke",
      "/admin/api/v1/api-keys/key_smoke",
      `/admin/api/v1/jobs/${jobId}`,
      `/admin/api/v1/sources/${sourceId}`,
      `/app/api/v1/jobs/${jobId}`,
    ])
      expect((await app.request(path, { headers })).status).toBe(404);
    for (const action of ["cancel", "retry"]) {
      expect(
        (
          await app.request(`/admin/api/v1/jobs/${jobId}/${action}`, {
            method: "POST",
            headers: {
              ...headers,
              "X-CSRF-Token": "1",
              "Idempotency-Key": `internal-${action}-123456789`,
            },
          })
        ).status,
      ).toBe(404);
    }
    expect(
      (
        await app.request(`/admin/api/v1/jobs/${jobId}`, {
          method: "DELETE",
          headers: { ...headers, "X-CSRF-Token": "1" },
        })
      ).status,
    ).toBe(404);
    expect(
      await (await app.request("/app/api/v1/jobs", { headers })).json(),
    ).toMatchObject({ items: [] });
    expect(
      database.apiKeys
        .listRenderIdentities(timestamp)
        .map((row) => row.api_key_id),
    ).toEqual(["key_web"]);
    expect(database.auditLogs.list()).toEqual([]);
    expect(database.auditLogs.search({ page: 1, pageSize: 10 }).total).toBe(0);
    // Internal diagnostics still consume space and admission capacity, and remain
    // available to worker cleanup and their own authenticated ticket operations.
    expect(database.jobs.getOwned(jobId, "user_owner", "sa_smoke")?.id).toBe(
      jobId,
    );
    expect(database.jobs.countActive()).toBe(1);
    expect(database.jobs.countActiveForUser("user_owner")).toBe(1);
    expect(database.jobs.storageUsageForUser("user_owner")).toBe(150);
    expect(
      database.raw.prepare("SELECT COUNT(*) AS count FROM audit_logs").get(),
    ).toEqual({ count: 2 });
    expect(database.jobs.get(jobId)?.status).toBe("reserved");
    database.audit({
      actorType: "system",
      actorId: "fixture-worker",
      action: "render.fixture_finished",
      targetType: "job",
      targetId: jobId,
      result: "success",
    });
    database.audit({
      actorType: "system",
      actorId: "fixture-worker",
      action: "user.unrelated",
      targetType: "job",
      targetId: `job_${"f".repeat(32)}`,
      result: "success",
    });
    // Physical history retention must not make Worker-authored smoke records
    // reappear after the join to the original Job becomes impossible.
    database.raw.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
    expect(database.auditLogs.list().map((row) => row.action)).toEqual([
      "user.unrelated",
    ]);
    expect(database.auditLogs.search({ page: 1, pageSize: 10 }).total).toBe(1);
    expect(
      database.raw
        .prepare("SELECT id FROM internal_resource_tombstones WHERE kind='job'")
        .get(),
    ).toEqual({ id: jobId });
    expect(
      database.raw.prepare("SELECT COUNT(*) AS count FROM audit_logs").get(),
    ).toEqual({ count: 4 });
  });

  it("retries a failed Job using retained input after its orphan deadline", async () => {
    const fixture = await setup(),
      sourceId = `source_${"f".repeat(32)}`,
      jobId = `job_${"f".repeat(32)}`,
      timestamp = new Date().toISOString();
    seedSource(fixture.database, sourceId, timestamp, ["main.tex"]);
    expect(
      fixture.database.jobs.insertQueued({
        id: jobId,
        userId: "user_owner",
        serviceAccountId: "sa_web",
        apiKeyId: "key_web",
        rendererVersion: "test",
        sourceId,
        entrypoint: "main.tex",
        timestamp,
        reservedOutputBytes: 1,
      }),
    ).toBe(1);
    fixture.database.raw
      .prepare("UPDATE jobs SET status='failed' WHERE id=?")
      .run(jobId);
    fixture.database.raw
      .prepare(
        "UPDATE sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(sourceId);
    const response = await fixture.app.request(
      `/admin/api/v1/jobs/${jobId}/retry`,
      {
        method: "POST",
        headers: {
          ...fixture.headers,
          "X-CSRF-Token": "1",
          "Idempotency-Key": "retained-source-admin-retry-123456",
        },
      },
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string };
    expect(fixture.database.jobs.get(body.id)).toMatchObject({
      status: "queued",
      source_id: sourceId,
      retry_of_job_id: jobId,
    });
  });

  it("checks storage on ready renders, audits their options, and retries expired Jobs with ready Sources", async () => {
    const f = await registrationFixture();
    const {
      database,
      sourceId,
      project,
      internal,
      remote,
      post,
      actor,
      identity,
    } = f;
    const pressure = { code: "STORAGE_PRESSURE", status: 503 };
    const key = "registration-test-1234567890";
    const request = {
      sourceId,
      engine: "xelatex" as const,
      outputs: ["pdf", "svg"] as ("pdf" | "svg")[],
    };
    const internalReady = () =>
      internal.create(actor, { ...request, project }, key);
    const adminReady = () =>
      post("/admin/api/v1/jobs/render-tickets", key, {
        ...request,
        apiKeyId: actor.apiKeyId,
      });
    const webReady = () =>
      post(
        `/app/api/v1/projects/${project.projectId}/revisions/${project.revisionId}/render`,
        "web-" + key,
      );
    const remoteReady = () =>
      remote.renderProjectRevision(
        identity,
        project.projectId,
        project.revisionId,
        undefined,
        key,
      );

    await expect(internalReady()).rejects.toMatchObject(pressure);
    await expectStoragePressure(await adminReady());
    await expectStoragePressure(await webReady());
    await expect(remoteReady()).rejects.toMatchObject(pressure);
    expect(database.jobs.countActive()).toBe(0);

    f.setFreeBytes(1);
    const {
      value: { jobId },
    } = await internalReady();
    expect((await adminReady()).status).toBe(201);
    expect((await webReady()).status).toBe(201);
    const remoteJob = await remoteReady();
    const audits = database.raw
      .prepare(
        "SELECT action, metadata_json FROM audit_logs WHERE action IN ('render.queued','remote_mcp.render.queued') ORDER BY rowid",
      )
      .all();
    expect(audits).toEqual(
      [true, false, true, true].map((hasRevision, index) => ({
        action: index === 3 ? "remote_mcp.render.queued" : "render.queued",
        metadata_json: JSON.stringify({
          sourceId,
          entrypoint: "main.tex",
          outputs: request.outputs,
          engine: "xelatex",
          ...(hasRevision ? { projectRevisionId: project.revisionId } : {}),
        }),
      })),
    );

    f.setFreeBytes(0);
    await expect(internalReady()).resolves.toMatchObject({ status: 200 });
    expect((await adminReady()).status).toBe(200);
    expect((await webReady()).status).toBe(200);
    await expect(remoteReady()).resolves.toMatchObject({ id: remoteJob.id });
    await expect(
      internal.create(actor, { retrySvgJobId: jobId }, key),
    ).rejects.toMatchObject(pressure);
    await expectStoragePressure(
      await post(`/admin/api/v1/jobs/${jobId}/retry-svg`, key),
    );
    await expectStoragePressure(
      await post(`/app/api/v1/jobs/${jobId}/retry-svg`, key),
    );
    expect(() => remote.retrySvgRender(identity, remoteJob.id, key)).toThrow(
      expect.objectContaining(pressure),
    );

    database.raw
      .prepare(
        "UPDATE jobs SET status='expired',render_status='expired' WHERE id IN (?,?)",
      )
      .run(jobId, remoteJob.id);
    const adminRetry = () => post(`/admin/api/v1/jobs/${jobId}/retry`, key);
    const webRetry = () =>
      post(`/app/api/v1/jobs/${jobId}/retry`, "web-" + key);
    const remoteRetry = () => remote.retryRender(identity, remoteJob.id, key);
    await expectStoragePressure(await adminRetry());
    await expectStoragePressure(await webRetry());
    expect(remoteRetry).toThrow(expect.objectContaining(pressure));

    f.setFreeBytes(1);
    const setSourceStatus = database.raw.prepare(
      "UPDATE sources SET status=? WHERE id=?",
    );
    setSourceStatus.run("expired", sourceId);
    expect((await adminRetry()).status).toBe(410);
    expect(remoteRetry).toThrow(
      expect.objectContaining({ code: "SOURCE_NOT_READY", status: 409 }),
    );
    setSourceStatus.run("ready", sourceId);
    for (const retry of [adminRetry, webRetry]) {
      const response = await retry();
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        retryOfJobId: jobId,
      });
    }
    expect(remoteRetry()).toMatchObject({
      retryOf: remoteJob.id,
      status: "queued",
    });
  });

  it("audits each new draft preview once across Internal, web, and MCP", async () => {
    const f = await registrationFixture();
    const {
      database,
      project: { projectId },
      drafts,
      internal,
      remote,
      post,
      actor,
      identity,
    } = f;
    const pressure = { code: "STORAGE_PRESSURE", status: 503 };
    const preview = (version: number) =>
      post(
        `/app/api/v1/projects/${projectId}/draft/preview`,
        "draft-preview-1234567890",
        { version },
      );
    const queue = [
      () => internal.createDraftPreview(actor, projectId, 1),
      async () => {
        const response = await preview(2);
        expect(response.status).toBe(202);
        return (await response.json()) as { jobId: string };
      },
      () => remote.queueSharedDraftPreview(identity, projectId, 3),
    ];
    const expected = [];
    for (const [index, create] of queue.entries()) {
      const version = index + 1;
      if (version > 1)
        drafts.update(f.projectActor, projectId, {
          version: version - 1,
          files: [],
        });
      f.setFreeBytes(0);
      if (version === 2) await expectStoragePressure(await preview(version));
      else if (version === 1)
        await expect(create()).rejects.toMatchObject(pressure);
      else expect(create).toThrow(expect.objectContaining(pressure));
      f.setFreeBytes(1);
      const { jobId } = await create();
      f.setFreeBytes(0);
      await expect((await preview(version)).json()).resolves.toMatchObject({
        jobId,
        reused: true,
      });
      expected.push({
        target_id: jobId,
        metadata_json: JSON.stringify({
          projectId,
          draftVersion: version,
          jobId,
        }),
      });
    }
    expect(
      database.raw
        .prepare(
          "SELECT target_id, metadata_json FROM audit_logs WHERE action='render.draft_preview.queued' ORDER BY rowid",
        )
        .all(),
    ).toEqual(expected);
  });

  it("defers storage admission for both legacy reservations until upload", async () => {
    const { internal, actor, post, database, renderer } =
      await registrationFixture();
    const request = { size: 1, sha256: hash(Buffer.from("x")) };
    const reserved = await internal.create(
      actor,
      request,
      "legacy-registration-123456",
    );
    expect(reserved.status).toBe(201);
    expect(
      (
        await post(
          "/admin/api/v1/jobs/render-tickets",
          "legacy-registration-123456",
          { ...request, apiKeyId: actor.apiKeyId },
        )
      ).status,
    ).toBe(201);
    const { jobId } = reserved.value;
    if (
      !("uploadTicket" in reserved.value) ||
      typeof reserved.value.uploadTicket !== "string"
    )
      throw new Error("Expected an upload ticket");
    await expectStoragePressure(
      await renderer.request(`/api/v1/jobs/${jobId}/source`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${reserved.value.uploadTicket}`,
          "Content-Type": "application/zip",
          "Content-Length": "1",
        },
        body: "x",
      }),
    );
    expect(database.jobs.get(jobId)?.status).toBe("reserved");
  });

  it.each(["page-1.png", "page-01.png", "page-001.png"])(
    "shows retained metadata and streams authenticated, integrity-labelled artifacts (%s)",
    async (previewName) => {
      const fixture = await setup(),
        jobId = `job_${"a".repeat(32)}`,
        sourceId = `source_${"b".repeat(32)}`,
        now = new Date(),
        started = new Date(now.getTime() - 3_000).toISOString(),
        completed = now.toISOString(),
        pdf = new TextEncoder().encode("%PDF-test"),
        log = new TextEncoder().encode("compile output"),
        errors = new TextEncoder().encode(
          JSON.stringify({ errors: [], warnings: [] }),
        ),
        svg = new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
        );
      seedSource(fixture.database, sourceId, now.toISOString(), [
        "main.tex",
        "images/a.png",
      ]);
      fixture.database.raw
        .prepare(
          `INSERT INTO jobs
      (id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,source_id,entrypoint,created_at,updated_at,queued_at,started_at,completed_at,exit_code,output_size)
      VALUES (?,'user_owner','sa_web','key_web','succeeded','test',100,?,?,? ,?,?,?,?,?,0,?)`,
        )
        .run(
          jobId,
          "1".repeat(64),
          sourceId,
          "main.tex",
          started,
          completed,
          started,
          started,
          completed,
          pdf.length,
        );
      await mkdir(join(fixture.root, "jobs", jobId, "output", "previews"), {
        recursive: true,
      });
      await mkdir(
        join(fixture.root, "jobs", jobId, "output", "svg", "objects"),
        {
          recursive: true,
        },
      );
      await Promise.all([
        store(fixture, jobId, "pdf", "result.pdf", pdf, "artifact_pdf"),
        store(fixture, jobId, "log", "compile.log", log, "artifact_log"),
        store(
          fixture,
          jobId,
          "errors",
          "errors.json",
          errors,
          "artifact_errors",
        ),
        store(
          fixture,
          jobId,
          "svg",
          "svg/objects/math-000001.svg",
          svg,
          "artifact_svg",
        ),
        store(
          fixture,
          jobId,
          "preview",
          `previews/${previewName}`,
          new Uint8Array([1, 2, 3]),
          "artifact_preview",
        ),
      ]);
      const detail = await fixture.app.request(`/admin/api/v1/jobs/${jobId}`, {
        headers: fixture.headers,
      });
      expect(detail.status).toBe(200);
      const detailBody = (await detail.json()) as {
        artifacts: Array<{ relative_path: string; size: number }>;
        previews: Array<{ relative_path: string }>;
        [key: string]: unknown;
      };
      expect(detailBody).toMatchObject({
        id: jobId,
        source_id: sourceId,
        entrypoint: "main.tex",
        duration_ms: 3000,
        artifacts_available: true,
        previews: [{ relative_path: `previews/${previewName}` }],
      });
      expect(
        detailBody.artifacts.find(
          (item) => item.relative_path === "result.pdf",
        ),
      ).toMatchObject({ size: pdf.length });
      const download = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}/artifacts/result.pdf`,
        { headers: fixture.headers },
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain(
        "attachment",
      );
      expect(download.headers.get("x-artifact-sha256")).toBe(hash(pdf));
      expect(download.headers.get("cache-control")).toContain("no-store");
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
      const svgDownload = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}/artifacts/svg/objects/math-000001.svg?disposition=inline`,
        { headers: fixture.headers },
      );
      expect(svgDownload.status).toBe(200);
      expect(svgDownload.headers.get("content-type")).toBe("image/svg+xml");
      expect(svgDownload.headers.get("content-disposition")).toContain(
        "attachment",
      );
      expect(svgDownload.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await svgDownload.arrayBuffer())).toEqual(svg);
      const archive = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}/archive`,
        { headers: fixture.headers },
      );
      expect(archive.status).toBe(200);
      expect(archive.headers.get("content-type")).toBe("application/zip");
      expect(archive.headers.get("cache-control")).toContain("no-store");
      const archiveBytes = Buffer.from(await archive.arrayBuffer());
      expect(archiveBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
      for (const name of [
        "result.pdf",
        "compile.log",
        "errors.json",
        "svg/objects/math-000001.svg",
        `previews/${previewName}`,
      ])
        expect(archiveBytes.includes(Buffer.from(name))).toBe(true);
      for (const prefix of ["/admin/api/v1", "/app/api/v1"])
        for (const name of new Set([previewName, "page-1.png"])) {
          const response = await fixture.app.request(
            `${prefix}/jobs/${jobId}/previews/${name}`,
            { headers: fixture.headers },
          );
          expect(response.status).toBe(200);
          expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            new Uint8Array([1, 2, 3]),
          );
        }
      expect(
        fixture.database.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM artifact_download_leases WHERE job_id=?",
          )
          .get(jobId),
      ).toEqual({ count: 0 });
      const inline = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}/artifacts/result.pdf?disposition=inline`,
        { headers: fixture.headers },
      );
      expect(inline.headers.get("content-disposition")).toContain("inline");
      await inline.arrayBuffer();
      const auditActions = fixture.database.raw
        .prepare(
          "SELECT action FROM audit_logs ORDER BY created_at DESC LIMIT 20",
        )
        .all() as Array<{ action: string }>;
      expect(auditActions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "admin.artifact.downloaded",
          "admin.artifact.viewed",
          "admin.artifacts.archive_downloaded",
        ]),
      );
      fixture.database.raw
        .prepare("UPDATE jobs SET completed_at=?,updated_at=? WHERE id=?")
        .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", jobId);
      const expiredDetail = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}`,
        { headers: fixture.headers },
      );
      await expect(expiredDetail.json()).resolves.toMatchObject({
        artifacts_available: false,
        artifacts: [],
        previews: [],
      });
      const expiredDownload = await fixture.app.request(
        `/admin/api/v1/jobs/${jobId}/artifacts/result.pdf`,
        { headers: fixture.headers },
      );
      expect(expiredDownload.status).toBe(410);
    },
  );

  it("lists, reuses, references, and safely deletes Sources", async () => {
    const fixture = await setup(),
      now = new Date().toISOString(),
      reusable = `source_${"c".repeat(32)}`,
      removable = `source_${"d".repeat(32)}`,
      expiredOnly = `source_${"e".repeat(32)}`;
    seedSource(fixture.database, reusable, now, [
      "main.tex",
      "chapters/one.tex",
    ]);
    seedSource(fixture.database, removable, now, ["main.tex"]);
    seedSource(fixture.database, expiredOnly, now, ["main.tex"]);
    fixture.database.jobs.insertReserved({
      id: `job_${"e".repeat(32)}`,
      userId: "user_owner",
      serviceAccountId: "sa_web",
      apiKeyId: "key_web",
      rendererVersion: "test",
      sourceSize: 100,
      sourceSha256: "1".repeat(64),
      timestamp: now,
      sourceId: expiredOnly,
      reservedOutputBytes: 1,
    });
    fixture.database.raw
      .prepare(
        "UPDATE jobs SET status='expired',render_status='expired',completed_at=?,updated_at=? WHERE source_id=?",
      )
      .run(now, now, expiredOnly);
    const list = await fixture.app.request("/admin/api/v1/sources", {
      headers: fixture.headers,
    });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(3);
    const render = await fixture.app.request(
      `/admin/api/v1/sources/${reusable}/render`,
      {
        method: "POST",
        headers: {
          ...fixture.headers,
          "Content-Type": "application/json",
          "X-CSRF-Token": "1",
          "Idempotency-Key": "source-render-test-123456",
        },
        body: JSON.stringify({
          apiKeyId: "key_web",
          entrypoint: "chapters/one.tex",
        }),
      },
    );
    expect(render.status).toBe(201);
    const rendered = (await render.json()) as { jobId: string };
    expect(fixture.database.jobs.get(rendered.jobId)).toMatchObject({
      source_id: reusable,
      entrypoint: "chapters/one.tex",
    });
    const reference = await fixture.app.request(
      `/admin/api/v1/sources/${reusable}/source-ref`,
      {
        method: "POST",
        headers: {
          ...fixture.headers,
          "Content-Type": "application/json",
          "X-CSRF-Token": "1",
        },
        body: JSON.stringify({ apiKeyId: "key_web" }),
      },
    );
    expect(reference.status).toBe(201);
    const referenceBody = (await reference.json()) as { sourceRef: string };
    expect(referenceBody.sourceRef).toMatch(/^source_ref_/);
    const blocked = await fixture.app.request(
      `/admin/api/v1/sources/${reusable}`,
      {
        method: "DELETE",
        headers: { ...fixture.headers, "X-CSRF-Token": "1" },
      },
    );
    expect(blocked.status).toBe(409);
    const deleted = await fixture.app.request(
      `/admin/api/v1/sources/${removable}`,
      {
        method: "DELETE",
        headers: { ...fixture.headers, "X-CSRF-Token": "1" },
      },
    );
    expect(deleted.status).toBe(202);
    expect(fixture.database.sources.get(removable)).toMatchObject({
      status: "deleting",
    });
    const expiredDetail = await fixture.app.request(
      `/admin/api/v1/sources/${expiredOnly}`,
      { headers: fixture.headers },
    );
    await expect(expiredDetail.json()).resolves.toMatchObject({
      deletable: true,
      jobs: [{ status: "expired" }],
    });
    const expiredDeleted = await fixture.app.request(
      `/admin/api/v1/sources/${expiredOnly}`,
      {
        method: "DELETE",
        headers: { ...fixture.headers, "X-CSRF-Token": "1" },
      },
    );
    expect(expiredDeleted.status).toBe(202);
  });
});

async function setup(readFreeStorageBytes?: () => number) {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const root = await mkdtemp(join(tmpdir(), "admin-results-"));
  roots.push(root);
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
    VALUES ('sa_web','user_owner','Web','generic','active',1,?,?)`,
    )
    .run(now, now);
  database.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
    VALUES ('key_web','sa_web','Browser','lrk_public','hash','v1','["render:create"]',?,'test')`,
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
    } as unknown as AccessJwtVerifier,
    apiKeys = new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 1)]]),
      "v1",
    ),
    app = createAdminApp({
      database,
      apiKeys,
      browserAuth: legacyTestBrowserAuth(database, access),
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: root,
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 20,
      maxUserStorageBytes: 1_000_000,
      minFreeStorageBytes: 1,
      readFreeStorageBytes,
      activeTicketKid: "v1",
      verificationTicketKids: [],
      artifactRetentionHours: 24,
      renderTickets: {
        tickets,
        rendererPublicUrl: "https://latex.example.com",
      },
    });
  return {
    database,
    root,
    app,
    tickets,
    apiKeys,
    headers: { "Cf-Access-Jwt-Assertion": "test" },
  };
}

async function registrationFixture() {
  let freeBytes = 0;
  const readFreeStorageBytes = () => freeBytes;
  const { database, app, root, tickets, apiKeys, headers } =
    await setup(readFreeStorageBytes);
  database.raw.exec(
    "UPDATE service_accounts SET name='External renderer' WHERE id='sa_web'",
  );
  const storage = {
    storageRoot: root,
    minFreeStorageBytes: 1,
    readFreeStorageBytes,
  };
  const origin = "https://latex.example.com";
  const renderer = createRendererApp({
    database,
    tickets,
    ...storage,
    maxUploadBytes: 100,
    artifactRetentionHours: 24,
  });
  const internal = new RenderTicketsService({
    database,
    tickets,
    apiKeys,
    ...storage,
    rendererPublicUrl: origin,
    rendererVersion: "test",
    maxOutputBytes: 1,
    maxQueueLength: 20,
    maxUserStorageBytes: 1_000_000,
  });
  const remote = new RemoteRenderService(
    database,
    root,
    "test",
    origin,
    20,
    1_000_000,
    undefined,
    undefined,
    1,
    24,
    storage,
  );
  const userId = "user_owner",
    serviceAccountId = "sa_web",
    apiKeyId = "key_web";
  const actor = {
    userId,
    serviceAccountId,
    apiKeyId,
    userSecurityVersion: 1,
    serviceAccountSecurityVersion: 1,
    keyKind: "render",
    scopes: ["render:create"],
  } as const;
  const identity = { userId, scopes: ["mcp:render"] } as const;
  const projectActor = { userId, type: "user", id: userId };
  const sourceId = `source_${"a".repeat(32)}`,
    projectId = `project_${"a".repeat(32)}`,
    revisionId = `revision_${"a".repeat(32)}`,
    timestamp = new Date().toISOString();
  seedSource(database, sourceId, timestamp, ["main.tex"]);
  database.projects.insert({
    id: projectId,
    ownerUserId: userId,
    displayName: "Example",
    timestamp,
  });
  database.projects.insertRevision({
    id: revisionId,
    projectId,
    sourceId,
    entrypoint: "main.tex",
    engine: "xelatex",
    displayName: "Example",
    originalFilename: "example.zip",
    outputs: ["pdf", "svg"],
    timestamp,
  });
  const drafts = new ProjectDraftOperations(database);
  drafts.open(projectActor, projectId, revisionId);
  const post = (path: string, key: string, body: object = {}) =>
    app.request(path, {
      method: "POST",
      headers: {
        ...headers,
        "X-CSRF-Token": "1",
        "Idempotency-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return {
    database,
    sourceId,
    project: { projectId, revisionId },
    projectActor,
    renderer,
    drafts,
    internal,
    remote,
    post,
    actor,
    identity,
    setFreeBytes: (value: number) => {
      freeBytes = value;
    },
  };
}

async function expectStoragePressure(response: Response) {
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "STORAGE_PRESSURE" },
  });
}

function seedSource(
  database: RendererDatabase,
  id: string,
  timestamp: string,
  paths: string[],
) {
  database.sources.insertReserved({
    id,
    ownerUserId: "user_owner",
    size: 100,
    sha256: "1".repeat(64),
    storageKey: `sources/${id}/source.zip`,
    timestamp,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    dedupeEligible: true,
  });
  database.raw
    .prepare(
      "UPDATE sources SET status='ready',paths_json=?,uploaded_at=? WHERE id=?",
    )
    .run(JSON.stringify(paths), timestamp, id);
}

async function store(
  fixture: Awaited<ReturnType<typeof setup>>,
  jobId: string,
  type: string,
  relativePath: string,
  bytes: Uint8Array,
  id: string,
) {
  await writeFile(
    join(fixture.root, "jobs", jobId, "output", relativePath),
    bytes,
  );
  fixture.database.artifacts.insert({
    id,
    job_id: jobId,
    type,
    relative_path: relativePath,
    size: bytes.length,
    sha256: hash(bytes),
    created_at: new Date().toISOString(),
  });
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
