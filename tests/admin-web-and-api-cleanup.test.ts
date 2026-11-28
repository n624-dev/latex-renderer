import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import {
  apiKeyScopeSchema,
  createApiKeySchema,
  renderApiScopes,
} from "../packages/contracts/src/index.js";
import { AppProjectsService } from "../apps/admin-api/src/services/app-projects.js";
import { AdminApiKeysService } from "../apps/admin-api/src/services/api-keys.js";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { createWebApp } from "../apps/admin-web/src/app.js";
import { localizedAdminScript } from "../apps/admin-web/src/assets/admin-script.js";
import { adminSource as adminScript } from "./helpers/admin-ui-source.js";
import { styles } from "../apps/admin-web/src/assets/styles.js";
import { readBrowserAsset } from "../apps/admin-web/src/browser-assets.js";
import { createStatusProbe } from "../apps/admin-web/src/status-probe.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.unstubAllGlobals();
});

describe("admin API cleanup", () => {
  it.each([
    "/app/api/v1/projects",
    "/app/api/v1/environment/packages/check",
    "/admin/api/v1/service-accounts",
  ])(
    "returns input errors for malformed and empty JSON at %s after authorization",
    async (path) => {
      const { app } = adminApp();
      const headers = {
        "Cf-Access-Jwt-Assertion": "test",
        "X-CSRF-Token": "1",
        "Content-Type": "application/json",
      };
      for (const body of ['{"private-body-sentinel":', "", "{}"]) {
        const response = await app.request(path, {
          method: "POST",
          headers,
          body,
        });
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain("private-body-sentinel");
      }
      const unauthenticated = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      expect(unauthenticated.status).toBe(401);
      const csrf = await app.request(path, {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "wrong" },
        body: "{",
      });
      expect(csrf.status).toBe(403);
    },
  );

  it("preserves an internal SyntaxError as 500 after valid request parsing", async () => {
    const { app } = adminApp();
    const spy = vi
      .spyOn(AppProjectsService.prototype, "create")
      .mockImplementation(() => {
        throw new SyntaxError("private-internal-sentinel");
      });
    try {
      const response = await app.request("/app/api/v1/projects", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": "test",
          "X-CSRF-Token": "1",
          "Content-Type": "application/json",
        },
        body: '{"displayName":"Valid"}',
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private-internal-sentinel");
    } finally {
      spy.mockRestore();
    }
  });
  it("accepts only known, non-mixed API key scopes", () => {
    const projectScopes = {
      "render:project:state:read": "readProjectDocumentState",
      "render:project:state:write": "writeProjectDocumentState",
      "render:project:delete": "applyProjectRevisionCleanup",
    };
    expect(renderApiScopes).toEqual(
      expect.arrayContaining(Object.keys(projectScopes)),
    );
    for (const [scope, label] of Object.entries(projectScopes)) {
      expect(apiKeyScopeSchema.parse(scope)).toBe(scope);
      expect(adminScript).toContain(
        `['${scope}', adminMessage("${label}"), false]`,
      );
      expect(
        createApiKeySchema.parse({ name: "project", scopes: [scope] }).scopes,
      ).toEqual([scope]);
      expect(
        createApiKeySchema.safeParse({
          name: "mixed",
          scopes: [scope, "admin:jobs:read"],
        }).success,
      ).toBe(false);
    }
    expect(
      createApiKeySchema.safeParse({
        name: "render",
        scopes: ["render:create", "render:read:own"],
      }).success,
    ).toBe(true);
    expect(
      createApiKeySchema.safeParse({
        name: "unknown",
        scopes: ["render:unknown"],
      }).success,
    ).toBe(false);
    expect(
      createApiKeySchema.safeParse({
        name: "mixed",
        scopes: ["render:create", "admin:users:read"],
      }).success,
    ).toBe(false);
    expect(
      createApiKeySchema.safeParse({
        name: "duplicate",
        scopes: ["render:create", "render:create"],
      }).success,
    ).toBe(false);
  });

  it("supports explicit enable/disable routes and removes unlock", async () => {
    const { app, database } = adminApp();
    const headers = {
      "Cf-Access-Jwt-Assertion": "test",
      "X-CSRF-Token": "1",
      "Content-Type": "application/json",
    };

    const enable = await app.request("/admin/v1/users/user_disabled/enable", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(enable.status).toBe(200);
    expect(database.users.get("user_disabled")?.status).toBe("active");

    const unlock = await app.request("/admin/v1/users/user_disabled/unlock", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(unlock.status).toBe(404);
    expect(
      database.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE action='user.unlocked'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("uses revoke as the only API-key removal operation", async () => {
    const { app, database } = adminApp();
    const headers = {
      "Cf-Access-Jwt-Assertion": "test",
      "X-CSRF-Token": "1",
      "Content-Type": "application/json",
    };

    const deletion = await app.request("/admin/v1/api-keys/key_seed", {
      method: "DELETE",
      headers,
    });
    expect(deletion.status).toBe(404);

    const revoke = await app.request("/admin/v1/api-keys/key_seed/revoke", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(revoke.status).toBe(200);
    expect(database.apiKeys.get("key_seed")?.revoked_at).not.toBeNull();
    expect(
      database.raw
        .prepare(
          "SELECT action FROM audit_logs WHERE target_id='key_seed' ORDER BY created_at DESC LIMIT 1",
        )
        .get(),
    ).toMatchObject({ action: "api_key.revoked" });
  });

  it("commits one successor and one audit entry when two rotations overlap", () => {
    const { database, apiKeys } = adminApp();
    const keys = new AdminApiKeysService({ database, apiKeys });
    const owner = {
      type: "user",
      id: "user_owner",
      userId: "user_owner",
      role: "owner",
    } as const;
    const generate = apiKeys.create.bind(apiKeys);
    let winner: ReturnType<typeof keys.rotate> | undefined;
    const spy = vi.spyOn(apiKeys, "create").mockImplementationOnce((kind) => {
      // The second caller commits after the first read but before its transaction.
      winner = keys.rotate(owner, "key_seed");
      return generate(kind);
    });
    try {
      expect(() => keys.rotate(owner, "key_seed")).toThrow(
        expect.objectContaining({ code: "API_KEY_STATE_CONFLICT" }),
      );
      expect(winner).toBeDefined();
      const active = database.apiKeys.activeJobIdentity(
        "key_seed",
        new Date().toISOString(),
      );
      expect(active).toMatchObject({ api_key_id: winner?.id });
      expect(
        database.apiKeys
          .listPage()
          .items.map(({ id }) => id)
          .sort(),
      ).toEqual(["key_seed", winner?.id].sort());
      expect(
        database.raw
          .prepare(
            "SELECT actor_id, target_id FROM audit_logs WHERE action='api_key.rotated'",
          )
          .all(),
      ).toEqual([{ actor_id: owner.id, target_id: winner?.id }]);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns secrets only on successful authorized issuance or rotation and keeps audit metadata safe", async () => {
    const { app, database } = adminApp();
    const headers = {
      "Cf-Access-Jwt-Assertion": "test",
      "X-CSRF-Token": "1",
      "Content-Type": "application/json",
    };
    const creation = "/admin/api/v1/service-accounts/sa_seed/api-keys";
    const body = JSON.stringify({ name: "fixture", scopes: ["render:create"] });
    expect((await app.request(creation, { method: "POST", body })).status).toBe(
      401,
    );
    expect(
      (
        await app.request(creation, {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": "bad" },
          body,
        })
      ).status,
    ).toBe(403);
    const issued = await app.request(creation, {
      method: "POST",
      headers,
      body,
    });
    expect(issued.status).toBe(201);
    expect(issued.headers.get("Cache-Control")).toContain("no-store");
    const { id, apiKey } = (await issued.json()) as {
      id: string;
      apiKey: string;
    };
    expect(apiKey).toMatch(/^lrk_/);
    const path = `/admin/api/v1/api-keys/${id}`;
    const rotate = () =>
      app.request(`${path}/rotate`, { method: "POST", headers, body: "{}" });
    const rotated = await rotate();
    expect(rotated.status).toBe(201);
    expect(rotated.headers.get("Cache-Control")).toContain("no-store");
    const replacement = (await rotated.json()) as {
      id: string;
      apiKey: string;
      replaces: string;
    };
    expect(replacement.replaces).toBe(id);
    expect(replacement.apiKey).toMatch(/^lrk_/);
    expect(replacement.apiKey).not.toBe(apiKey);
    const responses = await Promise.all([
      app.request(path, { headers }),
      app.request(`/admin/api/v1/api-keys/${replacement.id}`, { headers }),
      app.request("/admin/api/v1/api-keys", { headers }),
      app.request("/admin/api/v1/audit-logs", { headers }),
      rotate(),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 404,
    ]);
    const audit = database.raw
      .prepare(
        "SELECT action, actor_id, target_id, metadata_json FROM audit_logs WHERE action IN ('api_key.created','api_key.rotated') ORDER BY action",
      )
      .all();
    expect(audit).toEqual([
      expect.objectContaining({
        action: "api_key.created",
        actor_id: "user_owner",
        target_id: id,
      }),
      expect.objectContaining({
        action: "api_key.rotated",
        actor_id: "user_owner",
        target_id: replacement.id,
      }),
    ]);
    for (const value of [
      ...(await Promise.all(responses.map((response) => response.text()))),
      JSON.stringify(audit),
    ]) {
      expect(value).not.toContain(apiKey);
      expect(value).not.toContain(replacement.apiKey);
    }
  });

  it("keeps owner Web and Admin access to a rotated Job bound to the successor", async () => {
    const { app, database, tickets } = adminApp(process.cwd());
    const jobId = `job_${"2".repeat(32)}`;
    const sourceId = `source_${"3".repeat(32)}`;
    const timestamp = new Date().toISOString();
    database.sources.insertReserved({
      id: sourceId,
      ownerUserId: "user_owner",
      size: 1,
      sha256: "a".repeat(64),
      storageKey: `sources/${sourceId}/source.zip`,
      timestamp,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    database.raw
      .prepare("UPDATE sources SET status='ready',uploaded_at=? WHERE id=?")
      .run(timestamp, sourceId);
    database.jobs.insertReserved({
      id: jobId,
      userId: "user_owner",
      serviceAccountId: "sa_seed",
      apiKeyId: "key_seed",
      rendererVersion: "fixture",
      sourceSize: 1,
      sourceSha256: "a".repeat(64),
      timestamp,
      sourceId,
      reservedOutputBytes: 1,
    });
    database.raw
      .prepare("UPDATE jobs SET status='failed',completed_at=? WHERE id=?")
      .run(timestamp, jobId);
    const headers = {
      "Cf-Access-Jwt-Assertion": "test",
      "X-CSRF-Token": "1",
      "Content-Type": "application/json",
    };
    const call = (path: string, method = "GET", extraHeaders = {}) =>
      app.request(path, {
        method,
        headers: { ...headers, ...extraHeaders },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
    const rotated = await call(
      "/admin/api/v1/api-keys/key_seed/rotate",
      "POST",
    );
    expect(rotated.status).toBe(201);
    const { id } = (await rotated.json()) as { id: string };
    for (const prefix of ["/app/api/v1", "/admin/api/v1"]) {
      const path = `${prefix}/jobs/${jobId}`;
      expect((await call(path)).status).toBe(200);
      const access = await call(`${path}/access-ticket`, "POST");
      expect(access.status).toBe(200);
      const { jobTicket } = (await access.json()) as { jobTicket: string };
      await expect(
        tickets.verify(jobTicket, "status", jobId),
      ).resolves.toMatchObject({ api_key_id: id });
      const retried = await call(`${path}/retry`, "POST", {
        "Idempotency-Key": `fixture-retry-${prefix}`,
      });
      expect(retried.status).toBe(202);
      const retry = (await retried.json()) as {
        id?: string;
        jobId?: string;
        retryOfJobId: string;
      };
      expect(retry.retryOfJobId).toBe(jobId);
      const retryId = retry.id ?? retry.jobId;
      if (retryId === undefined) throw new Error("Missing retry Job ID");
      expect(database.jobs.getVisible(retryId)).toMatchObject({
        user_id: "user_owner",
        service_account_id: "sa_seed",
        api_key_id: "key_seed",
        retry_of_job_id: jobId,
        status: "queued",
      });
      expect(database.worker.subjectState(retryId)).toMatchObject({
        sa_status: "active",
        revoked_at: null,
      });
      expect(
        (await call(`${prefix}/jobs/${retryId}/cancel`, "POST")).status,
      ).toBe(202);
    }
    expect(
      (await call(`/admin/api/v1/api-keys/${id}/revoke`, "POST")).status,
    ).toBe(200);
    for (const prefix of ["/app/api/v1", "/admin/api/v1"]) {
      const path = `${prefix}/jobs/${jobId}`;
      expect((await call(path)).status).toBe(200);
      const access = await call(`${path}/access-ticket`, "POST");
      expect(access.status).toBe(403);
      await expect(access.json()).resolves.toMatchObject({
        error: { code: "JOB_IDENTITY_REVOKED" },
      });
    }
    expect((await call(`/app/api/v1/jobs/${jobId}`, "DELETE")).status).toBe(
      204,
    );
    expect(database.jobs.get(jobId)?.status).toBe("deleting");
  });

  it("pages audit logs and enforces ticket-key rotation safety", async () => {
    const { app, database } = adminApp(),
      headers = {
        "Cf-Access-Jwt-Assertion": "test",
        "X-CSRF-Token": "1",
        "Content-Type": "application/json",
      };
    database.settings.upsert(
      "worker_heartbeat",
      { workerId: "worker_test", at: new Date().toISOString() },
      "test",
      new Date().toISOString(),
    );
    expect((await app.request("/health/rendering")).status).toBe(200);
    await expect(
      (await app.request("/health/rendering")).json(),
    ).resolves.toEqual({ operational: true });
    database.settings.upsert(
      "worker_heartbeat",
      {
        workerId: "worker_test",
        at: new Date(Date.now() - 31_000).toISOString(),
      },
      "test",
      new Date().toISOString(),
    );
    expect((await app.request("/health/rendering")).status).toBe(503);
    const audit = await app.request(
      "/admin/v1/audit-logs?page=1&pageSize=1&action=api_key",
      { headers },
    );
    expect(audit.status).toBe(200);
    await expect(audit.json()).resolves.toMatchObject({
      page: 1,
      pageSize: 1,
      total: 0,
      totalPages: 0,
      items: [],
    });
    const keys = await app.request("/admin/v1/system/ticket-keys", { headers });
    await expect(keys.json()).resolves.toEqual({
      activeKid: "v2",
      verificationKids: ["v1"],
      minRevocationSeconds: 2100,
    });
    const active = await app.request("/admin/v1/system/ticket-keys/v2/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({
        reason: "rotation",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    expect(active.status).toBe(409);
    const short = await app.request("/admin/v1/system/ticket-keys/v1/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({
        reason: "rotation",
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      }),
    });
    expect(short.status).toBe(400);
    const old = await app.request("/admin/v1/system/ticket-keys/v1/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({
        reason: "rotation",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    expect(old.status).toBe(200);
  });
});

describe("public and administrative Web", () => {
  const distribution = {
    version: "0.3.0",
    archiveName: "latex-renderer-client-test.zip",
    manifest: Buffer.from('{"version":"test"}\n'),
    installer: Buffer.from("Write-Output ok\n"),
    uninstaller: Buffer.from("Write-Output removed\n"),
    commonInstaller: Buffer.from("process.stdout.write('ok')\n"),
    commonUninstaller: Buffer.from("process.stdout.write('removed')\n"),
    archive: Buffer.from("PK\u0003\u0004test"),
    gatewayOpenApi: Buffer.from("openapi: 3.1.0\n"),
    rendererOpenApi: Buffer.from("openapi: 3.1.0\n"),
    adminOpenApi: Buffer.from("openapi: 3.1.0\n"),
  };

  it("probes the public Gateway and local rendering heartbeat", async () => {
    const urlOf = (input: string | URL | Request) =>
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const fetchMock = vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        new Response(null, {
          status: urlOf(input).includes("rendering") ? 503 : 200,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await createStatusProbe(
      {
        clientDistRoot: "/tmp",
        publicOrigin: "https://latex.example.com",
        port: 3101,
        renderingHealthUrl: "http://127.0.0.1:3102/health/rendering",
        statusProbeTimeoutMs: 100,
      },
      distribution,
      { services: () => ({ managed: false, services: [] }) },
    )();
    expect(snapshot).toMatchObject({
      api: true,
      rendering: false,
      downloads: true,
    });
    expect(fetchMock.mock.calls.map(([input]) => urlOf(input))).toEqual([
      "https://latex.example.com/api/v1/health",
      "http://127.0.0.1:3102/health/rendering",
    ]);
  });

  it("shows user-focused public content and expanded API documentation", async () => {
    const app = createWebApp(distribution);
    const headers = { "Accept-Language": "ja" };
    const home = await (await app.request("/", { headers })).text();
    expect(home).toContain("LaTeXをPDFに変換");
    expect(home).not.toContain("Secure Japanese / English");
    expect(home).not.toContain("単一ドメイン");
    expect(home).not.toContain("分離された実行");
    expect(home).not.toContain('href="/admin/"');

    const docs = await (await app.request("/docs/")).text();
    expect(docs).toContain("最短でPDFを作る");
    expect(docs).toContain('href="/docs/integrations/"');
    expect(docs).toContain('href="/docs/mcp/"');

    const troubleshooting = await (
      await app.request("/docs/troubleshooting/")
    ).text();
    expect(troubleshooting).toContain("保存容量が上限");
    expect(troubleshooting).toContain('href="/docs/outputs/#');

    const api = await (await app.request("/docs/api/")).text();
    expect(api).toContain("POST /api/v1/render-tickets");
    expect(api).toContain("PUT /api/v1/jobs/{jobId}/source");
    expect(api).toContain("共通エラー");
    for (const environment of [
      "curl",
      "PowerShell",
      "JavaScript / TypeScript",
      "Python",
    ])
      expect(api).toContain(environment);

    const windows = await (await app.request("/docs/windows/")).text();
    expect(windows).toContain("n624-latex auth logout");
    expect(windows).toContain("uninstall-latex-renderer.ps1");

    const status = await (
      await createWebApp(distribution, () =>
        Promise.resolve({
          api: true,
          rendering: true,
          downloads: true,
          checkedAt: "2026-08-09T00:00:00.000Z",
        }),
      ).request("/status/", { headers })
    ).text();
    expect(status).toContain("API：応答中");
    expect(status).toContain("レンダリング処理：応答中");
    expect(status).toContain("ダウンロード：応答中");
    expect(status).toContain("最終更新");
  });

  it("provides light/dark themes using only neutral grayscale colors", async () => {
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain("prefers-color-scheme: dark");
    expect(readBrowserAsset("site")).toContain("latex-renderer-theme");
    const colors = [...styles.matchAll(/#([\da-f]{6}|[\da-f]{3})\b/gi)];
    expect(colors.length).toBeGreaterThan(30);
    for (const match of colors) {
      const hex = match[1];
      if (hex === undefined) throw new Error("Missing CSS color");
      const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
      expect(full.slice(0, 2), `neutral color #${hex}`).toBe(full.slice(2, 4));
      expect(full.slice(2, 4), `neutral color #${hex}`).toBe(full.slice(4, 6));
    }

    const app = createWebApp(distribution);
    const admin = await (await app.request("/admin/users/")).text();
    expect(admin).toContain("data-theme-toggle");
    expect(admin).toContain('id="logout"');
    expect(admin).not.toContain("/cdn-cgi/access/logout");
    expect(admin).not.toContain("owner / admin 専用");

    const adminDocs = await (await app.request("/admin/docs/", {
      headers: { "Accept-Language": "ja" },
    })).text();
    expect(adminDocs).toContain("管理API資料");
    expect(adminDocs).toContain("外部IDをissuerとsubject");
    expect(adminDocs).toContain("メールアドレスによる自動連携はありません");
    expect(adminDocs).toContain("ブラウザー認証とは別の lra_ 管理APIキー");
  });

  it("keeps the administrative module valid and exposes guarded operations", async () => {
    const check = promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--check"],
      { timeout: 5000 },
    );
    check.child.stdin?.end(localizedAdminScript("ja"));
    await check;
    expect(adminScript).not.toMatch(/\b(?:prompt|confirm|alert)\s*\(/);
    expect(adminScript).toContain("openAdminDialog");
    expect(adminScript).toContain("formDialog");
    expect(adminScript).toContain("confirmDialog");
    expect(adminScript).toContain("credentialDialog");
    expect(adminScript).toContain("showModal()");
    expect(adminScript).toContain("renderScopes");
    expect(adminScript).toContain("adminScopes");
    expect(adminScript).toContain("pageSize:'50'");
    expect(adminScript).toContain("jobTerminal.has(job.status)&&job.source_id");
    expect(adminScript).toContain(
      "jobTerminal=new Set(['succeeded','failed','timeout','canceled','rejected','expired'])",
    );
    expect(adminScript).toContain("params.get('job')");
    expect(adminScript).toContain("await jobDetail(requested)");
    const markup = adminScript.replaceAll(String.raw`\"`, '"');
    expect(markup).toContain('name="actor"');
    expect(markup).toContain('name="target"');
    expect(markup).toContain('name="from"');
    expect(markup).toContain('name="to"');
    expect(adminScript).toContain("watchAdminJob");
    expect(adminScript).toContain('esc(adminMessage("previousPage"))');
    expect(adminScript).toContain('esc(adminMessage("nextPage"))');
    expect(adminScript).toContain('img.alt=adminMessage("previewPageNumber",{page})');
    expect(adminScript).toContain("数十分〜数時間");
    expect(adminScript).toContain("CPU・ディスク容量");
    expect(adminScript).toContain("responsive-table");
    expect(adminScript).toContain("システム状態");
  });
});

function adminApp(storageRoot = "/nonexistent") {
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
      `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES ('user_disabled','disabled-subject','user@example.test','Disabled user','user','disabled',1,'test',?,?)`,
    )
    .run(now, now);
  database.raw
    .prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
    VALUES ('sa_seed','user_owner','test','ci','active',1,?,?)`,
    )
    .run(now, now);
  database.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
    VALUES ('key_seed','sa_seed','test','lrk_seed','00','v1','["render:create"]',?,'test')`,
    )
    .run(now);

  const access = {
    verify: () =>
      Promise.resolve({ subject: "subject", payload: { sub: "subject" } }),
  } as unknown as AccessJwtVerifier;
  const apiKeys = new ApiKeyService(
    database,
    new Map([["v1", Buffer.alloc(32, 1)]]),
    "v1",
  );
  const tickets = new TicketService(
    database,
    "latex-renderer",
    "latex-render",
    {
      kid: "v1",
      secret: Buffer.alloc(32, 8),
    },
    [],
  );
  const app = createAdminApp({
    database,
    apiKeys,
    renderTickets: { tickets, rendererPublicUrl: "https://latex.example.com" },
    browserAuth: legacyTestBrowserAuth(database, access),
    deploymentMode: "cloudflare",
    publicOrigin: "https://latex.example.com",
    allowedOrigins: new Set(),
    writeEnabled: true,
    storageRoot,
    rendererVersion: "sha256:" + "0".repeat(64),
    maxOutputBytes: 1,
    maxQueueLength: 100,
    maxUserStorageBytes: 1024 * 1024 * 1024,
    minFreeStorageBytes: 1,
    activeTicketKid: "v2",
    verificationTicketKids: ["v1"],
  });
  return { app, database, apiKeys, tickets };
}
