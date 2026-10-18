import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "../packages/database/src/index.js";
import {
  RemoteMcpLoginContinuations,
  oauthLoginCookie,
  oauthLoginCookieName,
  OAUTH_LOGIN_TTL_MS,
  OAUTH_LOGIN_MAX_PENDING,
} from "../packages/remote-mcp-core/src/login-continuations.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
function fixture(path = ":memory:") {
  const db = new RendererDatabase(path);
  databases.push(db);
  db.migrate();
  const clientId = "continuation_fixture";
  if (!db.remoteMcp.client(clientId))
    db.remoteMcp.insertClient({
      id: clientId,
      name: "fixture",
      redirectUris: ["https://client.example/callback"],
      timestamp: "2026-10-18T00:00:00.000Z",
    });
  let now = Date.parse("2026-10-18T00:00:00.000Z");
  const store = new RemoteMcpLoginContinuations(db, () => now);
  const target =
    "/oauth/authorize?" +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: "https://client.example/" + "a".repeat(200),
      state: "x".repeat(1800),
      scope: "mcp:read mcp:render",
      resource: "https://renderer.example/mcp",
      code_challenge_method: "S256",
      code_challenge: "a".repeat(43),
    }).toString();
  return {
    db,
    store,
    clientId,
    target,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function credentials(pending: { returnTo: string; cookie: string }) {
  const handle = pending.returnTo.slice("/oauth/continue/".length);
  return {
    handle,
    binding: oauthLoginCookie(pending.cookie.split(";")[0] ?? null, handle),
  };
}

describe("bounded server-side OAuth login continuations", () => {
  it("keeps long state and redirect bytes off the login URL and resumes exactly once", () => {
    const f = fixture();
    expect(f.target.length).toBeGreaterThan(2048);
    const pending = f.store.create(f.target, f.clientId, null),
      c = credentials(pending);
    expect(pending.returnTo.length).toBeLessThan(100);
    expect(pending.returnTo).not.toContain("client_id");
    expect(pending.cookie).toContain(
      "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
    );
    const row = f.db.raw
      .prepare(
        "SELECT handle_hash,browser_hash FROM remote_mcp_login_continuations",
      )
      .get();
    expect(JSON.stringify(row)).not.toContain(c.handle);
    expect(JSON.stringify(row)).not.toContain(c.binding);
    expect(f.store.consume(c.handle, c.binding)).toBe(f.target);
    expect(() => f.store.consume(c.handle, c.binding)).toThrow();
  });
  it("binds to a separate browser cookie without burning a flow on mismatch", () => {
    const f = fixture(),
      pending = f.store.create(f.target, f.clientId, null),
      c = credentials(pending);
    expect(() => oauthLoginCookie(null, c.handle)).toThrow();
    expect(() =>
      oauthLoginCookie(
        `${oauthLoginCookieName(c.handle)}=${c.binding}; ${oauthLoginCookieName(c.handle)}=${c.binding}`,
        c.handle,
      ),
    ).toThrow();
    expect(() => f.store.consume(c.handle, "z".repeat(43))).toThrow();
    expect(f.store.consume(c.handle, c.binding)).toBe(f.target);
  });
  it("isolates two browser tabs and does not renew the ten-minute deadline", () => {
    const f = fixture(),
      first = f.store.create(f.target, f.clientId, null),
      a = credentials(first);
    f.advance(1);
    const second = f.store.create(
        f.target + "&tab=2",
        f.clientId,
        first.cookie.split(";")[0] ?? null,
      ),
      b = credentials(second);
    expect(a.handle).not.toBe(b.handle);
    expect(() => f.store.consume(a.handle, b.binding)).toThrow();
    f.advance(OAUTH_LOGIN_TTL_MS - 1);
    expect(() => f.store.consume(a.handle, a.binding)).toThrow();
    expect(f.store.consume(b.handle, b.binding)).toBe(f.target + "&tab=2");
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(0);
  });
  it.each([
    "https://external.example/oauth/authorize?client_id=continuation_fixture",
    "//external.example/oauth/authorize?client_id=continuation_fixture",
    "/app/?client_id=continuation_fixture",
    "/oauth/authorize?client_id=other",
    "/oauth/authorize?client_id=continuation_fixture#external",
    "/oauth/authorize?client_id=continuation_fixture\r\n",
    "/oauth/authorize?client_id=continuation_fixture&state=" +
      "x".repeat(65536),
  ])("rejects unsafe, mismatched or oversized targets", (target) => {
    const f = fixture();
    expect(() => f.store.create(target, f.clientId, null)).toThrow();
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(0);
  });
  it("preserves live flows at capacity and reclaims expired records", () => {
    const f = fixture();
    f.db.raw
      .prepare(
        `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x+1<?)
      INSERT INTO remote_mcp_login_continuations(handle_hash,browser_hash,client_id,target,expires_at)
      SELECT printf('%064x',x),printf('%064x',x),?,?,? FROM n`,
      )
      .run(
        OAUTH_LOGIN_MAX_PENDING,
        f.clientId,
        f.target,
        "2026-10-18T00:10:00.000Z",
      );
    expect(() => f.store.create(f.target, f.clientId, null)).toThrowError(
      expect.objectContaining({ code: "OAUTH_LOGIN_CAPACITY", status: 503 }),
    );
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(
      OAUTH_LOGIN_MAX_PENDING,
    );
    f.advance(OAUTH_LOGIN_TTL_MS);
    expect(f.store.create(f.target, f.clientId, null).returnTo).toMatch(
      /^\/oauth\/continue\//,
    );
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(1);
  });
  it("limits per-browser pending cookies", () => {
    const f = fixture(),
      cookies = Array.from(
        { length: 8 },
        (_, i) => `__Host-latex_renderer_oauth_login_${i}=value`,
      ).join("; ");
    expect(() => f.store.create(f.target, f.clientId, cookies)).toThrow();
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(0);
  });
  it("keeps an old registered client while its login is pending, then reclaims it after completion", () => {
    const f = fixture(),
      pending = credentials(f.store.create(f.target, f.clientId, null));
    const cleanup = () =>
      f.db.remoteMcp.cleanup({
        now: "2026-10-18T00:05:00.000Z",
        rateLimitBefore: "2026-10-18T00:00:00.000Z",
        unusedClientBefore: "2026-10-18T00:01:00.000Z",
      });
    cleanup();
    expect(f.db.remoteMcp.client(f.clientId)).toBeDefined();
    expect(f.store.consume(pending.handle, pending.binding)).toBe(f.target);
    cleanup();
    expect(f.db.remoteMcp.client(f.clientId)).toBeUndefined();
  });
  it("scheduled cleanup expires pending rows without a new login or OAuth request", () => {
    const root = mkdtempSync(join(tmpdir(), "oauth-cleanup-test-"));
    roots.push(root);
    const path = join(root, "renderer.sqlite3"),
      f = fixture(path);
    f.store.create(f.target, f.clientId, null);
    f.store.create(f.target, f.clientId, null);
    const rows = f.db.raw
      .prepare("SELECT handle_hash FROM remote_mcp_login_continuations")
      .all();
    f.db.raw
      .prepare(
        "UPDATE remote_mcp_login_continuations SET expires_at=? WHERE handle_hash=?",
      )
      .run("2000-01-01T00:00:00.000Z", String(rows[0]?.handle_hash));
    f.db.raw
      .prepare(
        "UPDATE remote_mcp_login_continuations SET expires_at=? WHERE handle_hash=?",
      )
      .run("2999-01-01T00:00:00.000Z", String(rows[1]?.handle_hash));
    const stdout = execFileSync(
      process.execPath,
      ["deploy/scripts/cleanup.mjs"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        env: {
          ...process.env,
          NODE_OPTIONS: "--max-old-space-size=32",
          DATABASE_PATH: path,
          STORAGE_ROOT: join(root, "storage"),
          AUDIT_EXPORT_CHECKPOINT: join(root, "audit", "checkpoint"),
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      remoteLoginContinuationsDeleted: 1,
    });
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(1);
  });
  it("persists a flow across database reopen and migrates legacy v19 additively", () => {
    const root = mkdtempSync(join(tmpdir(), "oauth-continuation-test-"));
    roots.push(root);
    const path = join(root, "renderer.sqlite3"),
      f = fixture(path),
      c = credentials(f.store.create(f.target, f.clientId, null));
    databases.splice(databases.indexOf(f.db), 1);
    f.db.close();
    const next = fixture(path);
    expect(next.store.consume(c.handle, c.binding)).toBe(f.target);
    next.db.raw.exec(
      "DROP TABLE remote_mcp_login_continuations; DELETE FROM schema_migrations WHERE version=20",
    );
    const client = next.db.remoteMcp.client(next.clientId);
    next.db.migrate();
    next.db.migrate();
    expect(next.db.remoteMcp.client(next.clientId)).toEqual(client);
    expect(next.db.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(next.db.remoteMcp.loginContinuationCount()).toBe(0);
  });
  it("keeps deployment SQL and runtime migration definitions aligned", () => {
    const f = fixture();
    f.db.raw.exec(
      "DROP TABLE remote_mcp_login_continuations; DELETE FROM schema_migrations WHERE version=20",
    );
    f.db.raw.exec(
      readFileSync(
        new URL(
          "../deploy/migrations/020_remote_mcp_login_continuations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(() => f.db.migrate()).not.toThrow();
    expect(f.db.remoteMcp.loginContinuationCount()).toBe(0);
  });
});
