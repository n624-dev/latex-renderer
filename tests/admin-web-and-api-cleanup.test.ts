import { afterEach, describe, expect, it, vi } from "vitest";
import { Script } from "node:vm";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createApiKeySchema } from "../packages/contracts/src/index.js";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { createWebApp } from "../apps/admin-web/src/app.js";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";
import { styles } from "../apps/admin-web/src/assets/styles.js";
import { siteScript } from "../apps/admin-web/src/assets/site-script.js";
import { createStatusProbe } from "../apps/admin-web/src/status-probe.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.unstubAllGlobals();
});

describe("admin API cleanup", () => {
  it("accepts only known, non-mixed API key scopes", () => {
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
    const home = await (await app.request("/")).text();
    expect(home).toContain("LaTeXをPDFに変換");
    expect(home).not.toContain("Secure Japanese / English");
    expect(home).not.toContain("単一ドメイン");
    expect(home).not.toContain("分離された実行");
    expect(home).not.toContain('href="/admin/"');

    const docs = await (await app.request("/docs/")).text();
    expect(docs).toContain("最短でPDFを作る");
    expect(docs).toContain("Codex・Claude Code・MCP");

    const troubleshooting = await (
      await app.request("/docs/troubleshooting/")
    ).text();
    expect(troubleshooting).toContain("保存容量不足");
    expect(troubleshooting).toContain("成果物が見つからない");

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
    expect(windows).toContain("latex-render auth logout");
    expect(windows).toContain("uninstall-latex-renderer.ps1");

    const status = await (
      await createWebApp(distribution, () =>
        Promise.resolve({
          api: true,
          rendering: true,
          downloads: true,
          checkedAt: "2026-08-09T00:00:00.000Z",
        }),
      ).request("/status/")
    ).text();
    expect(status).toContain("API：応答中");
    expect(status).toContain("レンダリング処理：応答中");
    expect(status).toContain("ダウンロード：応答中");
    expect(status).toContain("最終更新");
  });

  it("provides real light/dark themes without the previous blue palette", async () => {
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain("prefers-color-scheme: dark");
    expect(siteScript).toContain("latex-renderer-theme");
    for (const color of ["#60a5fa", "#93c5fd", "#1d4ed8"])
      expect(styles.toLowerCase()).not.toContain(color);

    const app = createWebApp(distribution);
    const admin = await (await app.request("/admin/users/")).text();
    expect(admin).toContain("data-theme-toggle");
    expect(admin).toContain('id="logout"');
    expect(admin).not.toContain('/cdn-cgi/access/logout');
    expect(admin).not.toContain("owner / admin 専用");

    const adminDocs = await (await app.request("/admin/docs/")).text();
    expect(adminDocs).toContain("管理API資料");
    expect(adminDocs).toContain("外部identityはissuer＋subject");
    expect(adminDocs).toContain("emailでは自動連携しません");
    expect(adminDocs).toContain("ブラウザ認証とは独立した");
  });

  it("keeps the administrative module valid and exposes guarded operations", () => {
    expect(() => new Script(`(async () => {${adminScript}\n})`)).not.toThrow();
    expect(adminScript).not.toMatch(/\b(?:prompt|confirm|alert)\s*\(/);
    expect(adminScript).toContain("openAdminDialog");
    expect(adminScript).toContain("formDialog");
    expect(adminScript).toContain("confirmDialog");
    expect(adminScript).toContain("credentialDialog");
    expect(adminScript).toContain("showModal()");
    expect(adminScript).toContain("renderScopes");
    expect(adminScript).toContain("adminScopes");
    expect(adminScript).toContain("pageSize:'50'");
    expect(adminScript).toContain("deletable.has(job.status)");
    expect(adminScript).toContain(
      "new URLSearchParams(location.search).get('job')",
    );
    expect(adminScript).toContain(
      "details(await request('/jobs/'+requestedJob),'ジョブ詳細')",
    );
    expect(adminScript).toContain('name="actor"');
    expect(adminScript).toContain('name="target"');
    expect(adminScript).toContain('name="from"');
    expect(adminScript).toContain('name="to"');
  });
});

function adminApp(): {
  app: ReturnType<typeof createAdminApp>;
  database: RendererDatabase;
} {
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
    storageRoot: "/nonexistent",
    rendererVersion: "sha256:" + "0".repeat(64),
    maxQueueLength: 100,
    maxUserStorageBytes: 1024 * 1024 * 1024,
    minFreeStorageBytes: 1,
    activeTicketKid: "v2",
    verificationTicketKids: ["v1"],
  });
  return { app, database };
}
