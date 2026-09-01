import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("administrator Job results and Sources", () => {
  it("shows retained metadata and streams authenticated, integrity-labelled artifacts", async () => {
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
    await mkdir(join(fixture.root, "jobs", jobId, "output", "svg", "objects"), {
      recursive: true,
    });
    await Promise.all([
      store(fixture, jobId, "pdf", "result.pdf", pdf, "artifact_pdf"),
      store(fixture, jobId, "log", "compile.log", log, "artifact_log"),
      store(fixture, jobId, "errors", "errors.json", errors, "artifact_errors"),
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
        "previews/page-1.png",
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
      previews: [{ relative_path: "previews/page-1.png" }],
    });
    expect(
      detailBody.artifacts.find((item) => item.relative_path === "result.pdf"),
    ).toMatchObject({ size: pdf.length });
    const download = await fixture.app.request(
      `/admin/api/v1/jobs/${jobId}/artifacts/result.pdf`,
      { headers: fixture.headers },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
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
      "previews/page-1.png",
    ])
      expect(archiveBytes.includes(Buffer.from(name))).toBe(true);
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
  });

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

async function setup() {
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
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 20,
      maxUserStorageBytes: 1_000_000,
      minFreeStorageBytes: 1,
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
    headers: { "Cf-Access-Jwt-Assertion": "test" },
  };
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
