import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { ApiKeyService, type AccessJwtVerifier } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { validateAndExtract } from "@latex-renderer/zip-validation";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { createWebApp } from "../apps/admin-web/src/app.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";

const databases: RendererDatabase[] = [];
const temporaryPaths: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const path of temporaryPaths.splice(0))
    await rm(path, { recursive: true, force: true });
});

describe("state and credentials", () => {
  it("enforces compare-and-swap job transitions", () => {
    const db = seededDatabase();
    db.transitionJob(
      "job_00000000000000000000000000000000",
      ["reserved"],
      "uploading",
    );
    expect(() =>
      db.transitionJob(
        "job_00000000000000000000000000000000",
        ["reserved"],
        "queued",
      ),
    ).toThrow(/concurrently/);
  });

  it("allows exactly one nonce claimant", () => {
    const db = seededDatabase();
    const ticketExpiry = new Date(Date.now() + 60_000).toISOString(),
      firstClaimExpiry = new Date(Date.now() + 30_000).toISOString();
    db.raw
      .prepare(
        "INSERT INTO used_nonces(nonce,job_id,state,expires_at) VALUES ('nonce','job_00000000000000000000000000000000','unused',?)",
      )
      .run(ticketExpiry);
    db.claimNonce(
      "nonce",
      "job_00000000000000000000000000000000",
      "first",
      firstClaimExpiry,
    );
    expect(
      db.raw
        .prepare(
          "SELECT expires_at,claim_expires_at FROM used_nonces WHERE nonce='nonce'",
        )
        .get(),
    ).toEqual({ expires_at: ticketExpiry, claim_expires_at: firstClaimExpiry });
    const extended = new Date(Date.now() + 90_000).toISOString();
    expect(
      db.extendNonceClaim("nonce", "first", new Date().toISOString(), extended),
    ).toBe(1);
    expect(
      db.raw
        .prepare(
          "SELECT expires_at,claim_expires_at FROM used_nonces WHERE nonce='nonce'",
        )
        .get(),
    ).toEqual({ expires_at: ticketExpiry, claim_expires_at: extended });
    expect(() =>
      db.claimNonce(
        "nonce",
        "job_00000000000000000000000000000000",
        "second",
        new Date(Date.now() + 30_000).toISOString(),
      ),
    ).toThrow(/already in use/);
  });

  it("prevents an expired upload owner from releasing a recovered claim", () => {
    const db = seededDatabase(),
      now = new Date(),
      future = new Date(now.getTime() + 60_000).toISOString(),
      expired = new Date(now.getTime() - 1_000).toISOString();
    db.raw
      .prepare(
        "INSERT INTO used_nonces(nonce,job_id,state,expires_at) VALUES ('stale-nonce','job_00000000000000000000000000000000','unused',?)",
      )
      .run(future);
    db.claimNonce(
      "stale-nonce",
      "job_00000000000000000000000000000000",
      "stale-owner",
      expired,
    );
    expect(db.releaseNonce("stale-nonce", "stale-owner")).toBe(0);

    db.raw
      .prepare(
        "UPDATE used_nonces SET state='released',claim_owner=NULL,claimed_at=NULL,claim_expires_at=NULL WHERE nonce='stale-nonce'",
      )
      .run();
    db.claimNonce(
      "stale-nonce",
      "job_00000000000000000000000000000000",
      "recovery-owner",
      future,
    );
    expect(db.releaseNonce("stale-nonce", "stale-owner")).toBe(0);
    expect(
      db.raw
        .prepare(
          "SELECT state,claim_owner FROM used_nonces WHERE nonce='stale-nonce'",
        )
        .get(),
    ).toEqual({ state: "claimed", claim_owner: "recovery-owner" });
  });

  it("invalidates an API key and an already-issued ticket when its user is disabled", async () => {
    const db = seededDatabase();
    const pepper = Buffer.alloc(32, 7);
    const auth = new ApiKeyService(db, new Map([["v1", pepper]]), "v1");
    const generated = auth.create("render");
    db.raw.prepare("DELETE FROM jobs").run();
    db.raw.prepare("DELETE FROM api_keys").run();
    db.raw
      .prepare(
        `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
      VALUES (?,'sa_seed','test',?,?,?,'["render:create"]',?,'test')`,
      )
      .run(
        generated.id,
        generated.prefix,
        generated.secretHash,
        generated.pepperId,
        new Date().toISOString(),
      );
    db.raw
      .prepare(
        `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at)
      VALUES ('job_00000000000000000000000000000000','user_seed','sa_seed',?,'reserved','test',1,?,?,?)`,
      )
      .run(
        generated.id,
        "0".repeat(64),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    expect(auth.authenticate(generated.token, "render:create").apiKeyId).toBe(
      generated.id,
    );
    const tickets = new TicketService(
      db,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 9) },
      [],
    );
    const token = await tickets.issueJob({
      jobId: "job_00000000000000000000000000000000",
      userId: "user_seed",
      serviceAccountId: "sa_seed",
      apiKeyId: generated.id,
      userSecurityVersion: 1,
      serviceAccountSecurityVersion: 1,
    });
    await expect(
      tickets.verify(token, "status", "job_00000000000000000000000000000000"),
    ).resolves.toMatchObject({
      job_id: "job_00000000000000000000000000000000",
    });
    db.raw
      .prepare(
        "UPDATE users SET status='disabled',security_version=2 WHERE id='user_seed'",
      )
      .run();
    expect(() => auth.authenticate(generated.token)).toThrow(/disabled/);
    await expect(
      tickets.verify(token, "status", "job_00000000000000000000000000000000"),
    ).rejects.toThrow(/inactive/);
  });

  it("rejects a credential when its prefix-derived kind disagrees with the database kind", () => {
    const db = seededDatabase();
    const auth = new ApiKeyService(
      db,
      new Map([["v1", Buffer.alloc(32, 7)]]),
      "v1",
    );
    const generated = auth.create("render");
    db.apiKeys.insert({
      id: generated.id,
      serviceAccountId: "sa_seed",
      name: "kind-mismatch",
      prefix: generated.prefix,
      kind: "admin",
      secretHash: generated.secretHash,
      pepperId: generated.pepperId,
      scopes: ["render:create"],
      createdAt: new Date().toISOString(),
      createdBy: "test",
    });

    expect(() => auth.authenticate(generated.token)).toThrow(
      expect.objectContaining({ code: "INVALID_API_KEY", status: 401 }),
    );
  });

  it("reports a malformed renderer ticket as an authentication error", async () => {
    const tickets = new TicketService(
      seededDatabase(),
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 9) },
      [],
    );
    await expect(
      tickets.verify(
        "not-a-jwt",
        "status",
        "job_00000000000000000000000000000000",
      ),
    ).rejects.toMatchObject({ code: "INVALID_TICKET", status: 401 });
  });
});

describe("administrative safety", () => {
  it("rejects disabling the final active owner inside the write transaction", async () => {
    const db = seededDatabase();
    const access = {
      verify: () =>
        Promise.resolve({ subject: "subject", payload: { sub: "subject" } }),
    } as unknown as AccessJwtVerifier;
    const app = createAdminApp({
      database: db,
      apiKeys: new ApiKeyService(
        db,
        new Map([["v1", Buffer.alloc(32, 1)]]),
        "v1",
      ),
      browserAuth: legacyTestBrowserAuth(db, access),
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: "/nonexistent",
      rendererVersion: "sha256:" + "0".repeat(64),
      maxOutputBytes: 1,
      maxQueueLength: 100,
      maxUserStorageBytes: 1024 * 1024 * 1024,
      minFreeStorageBytes: 1,
      activeTicketKid: "v2",
      verificationTicketKids: ["v1"],
    });
    const response = await app.request("/admin/v1/users/user_seed/disable", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": "test", "X-CSRF-Token": "1" },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "LAST_OWNER" },
    });
  });

  it("identifies the current owner and issues a one-time client API key", async () => {
    const db = seededDatabase();
    const access = {
      verify: () =>
        Promise.resolve({ subject: "subject", payload: { sub: "subject" } }),
    } as unknown as AccessJwtVerifier;
    const app = createAdminApp({
      database: db,
      apiKeys: new ApiKeyService(
        db,
        new Map([["v1", Buffer.alloc(32, 1)]]),
        "v1",
      ),
      browserAuth: legacyTestBrowserAuth(db, access),
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(),
      writeEnabled: true,
      storageRoot: "/nonexistent",
      rendererVersion: "sha256:" + "0".repeat(64),
      maxOutputBytes: 1,
      maxQueueLength: 100,
      maxUserStorageBytes: 1024 * 1024 * 1024,
      minFreeStorageBytes: 1,
      activeTicketKid: "v2",
      verificationTicketKids: ["v1"],
    });
    const headers = {
      "Cf-Access-Jwt-Assertion": "test",
      "X-CSRF-Token": "1",
      "Content-Type": "application/json",
    };
    const me = await app.request("/admin/v1/me", { headers });
    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toContain("no-store");
    expect(me.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    await expect(me.json()).resolves.toEqual({
      userId: "user_seed",
      displayName: "Owner",
      role: "owner",
    });
    const account = await app.request("/admin/v1/service-accounts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ownerUserId: "user_seed",
        name: "remote-windows",
        clientType: "codex",
      }),
    });
    expect(account.status).toBe(201);
    const accountBody = (await account.json()) as { id: string };
    const key = await app.request(
      `/admin/v1/service-accounts/${accountBody.id}/api-keys`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "render-key",
          scopes: ["render:create", "render:read:own"],
        }),
      },
    );
    expect(key.status).toBe(201);
    const keyBody = (await key.json()) as { prefix: string; apiKey: string };
    expect(keyBody.prefix).toMatch(/^lrk_/);
    expect(keyBody.apiKey).toMatch(/^lrk_/);
  });
});

describe("remote client distribution", () => {
  it("serves canonical downloads and redirects legacy client paths", async () => {
    const bytes = Buffer.from("PK\u0003\u0004test");
    const text = Buffer.from("test\n");
    const app = createWebApp({
      version: "0.2.0",
      archiveName: "latex-renderer-client-0.2.0.zip",
      manifest: Buffer.from('{"version":"0.2.0"}\n'),
      installer: Buffer.from("Write-Output ok\n"),
      uninstaller: Buffer.from("Write-Output removed\n"),
      commonInstaller: Buffer.from("process.stdout.write('ok')\n"),
      commonUninstaller: Buffer.from("process.stdout.write('removed')\n"),
      archive: bytes,
      gatewayOpenApi: text,
      rendererOpenApi: text,
      adminOpenApi: text,
    });
    const manifest = await app.request("/downloads/windows/manifest.json");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/json");
    await expect(manifest.text()).resolves.toContain('"version":"0.2.0"');
    const commonInstaller = await app.request("/downloads/client/install.mjs");
    expect(commonInstaller.status).toBe(200);
    expect(commonInstaller.headers.get("content-type")).toContain(
      "text/javascript",
    );
    const installer = await app.request("/downloads/windows/install.ps1");
    expect(installer.status).toBe(200);
    expect(installer.headers.get("content-disposition")).toContain(
      "install-latex-renderer.ps1",
    );
    const uninstaller = await app.request("/downloads/windows/uninstall.ps1");
    expect(uninstaller.status).toBe(200);
    expect(uninstaller.headers.get("content-disposition")).toContain(
      "uninstall-latex-renderer.ps1",
    );
    const archive = await app.request(
      "/downloads/windows/latex-renderer-client-0.2.0.zip",
    );
    expect(archive.status).toBe(200);
    expect(archive.headers.get("content-type")).toBe("application/zip");
    expect(
      Buffer.from(await archive.arrayBuffer())
        .subarray(0, 4)
        .toString("binary"),
    ).toBe("PK\u0003\u0004");
    const legacy = await app.request("/client/latest.zip", {
      redirect: "manual",
    });
    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("location")).toBe("/downloads/client/latest.zip");
  });
});

describe("ZIP boundary", () => {
  it("extracts a valid main.tex and rejects a central/local filename mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-zip-test-"));
    temporaryPaths.push(root);
    const valid = join(root, "valid.zip");
    await createZip(valid, [
      [
        "main.tex",
        "\\documentclass{article}\\begin{document}ok\\end{document}",
      ],
      ["chapters/intro.tex", "Nested input"],
    ]);
    const output = join(root, "output");
    await expect(
      validateAndExtract(valid, output, limits),
    ).resolves.toMatchObject({ files: 2 });
    expect(await readFile(join(output, "main.tex"), "utf8")).toContain(
      "documentclass",
    );
    expect((await stat(output)).mode & 0o777).toBe(0o775);
    expect((await stat(join(output, "chapters"))).mode & 0o777).toBe(0o775);
    const bytes = await readFile(valid);
    const localName = bytes.indexOf(Buffer.from("main.tex"));
    expect(localName).toBeGreaterThan(0);
    bytes[localName] = "n".charCodeAt(0);
    const tampered = join(root, "tampered.zip");
    await writeFile(tampered, bytes);
    await expect(
      validateAndExtract(tampered, join(root, "bad"), limits),
    ).rejects.toThrow(/do not match/);
  });

  it("counts directory entries separately from extracted files", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-zip-entries-"));
    temporaryPaths.push(root);
    const archive = join(root, "directories.zip"),
      zip = new yazl.ZipFile(),
      done = pipeline(zip.outputStream, createWriteStream(archive));
    zip.addEmptyDirectory("one/");
    zip.addEmptyDirectory("two/");
    zip.addEmptyDirectory("three/");
    zip.end();
    await done;
    await expect(
      validateAndExtract(
        archive,
        join(root, "output"),
        {
          ...limits,
          maxEntries: 2,
        },
        "",
      ),
    ).rejects.toMatchObject({ code: "ZIP_TOO_MANY_ENTRIES" });
  });
});

const limits = {
  maxExtractedBytes: 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxEntries: 20,
  maxFiles: 10,
  maxDepth: 3,
  maxNameLength: 100,
};
async function createZip(
  path: string,
  entries: ReadonlyArray<readonly [name: string, value: string]>,
): Promise<void> {
  const zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(path));
  for (const [name, value] of entries) zip.addBuffer(Buffer.from(value), name);
  zip.end();
  await done;
}

function seededDatabase(): RendererDatabase {
  const db = new RendererDatabase(":memory:");
  databases.push(db);
  db.migrate();
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES ('user_seed','subject','owner@example.test','Owner','owner','active',1,'test',?,?)`,
    )
    .run(now, now);
  db.raw
    .prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
    VALUES ('sa_seed','user_seed','test','ci','active',1,?,?)`,
    )
    .run(now, now);
  db.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
    VALUES ('key_seed','sa_seed','test','lrk_seed','00','v1','["render:create"]',?,'test')`,
    )
    .run(now);
  db.raw
    .prepare(
      `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at)
    VALUES ('job_00000000000000000000000000000000','user_seed','sa_seed','key_seed','reserved','test',1,?, ?,?)`,
    )
    .run("0".repeat(64), now, now);
  return db;
}
