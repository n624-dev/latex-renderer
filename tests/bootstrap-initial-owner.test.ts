import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { BrowserAuthenticationService } from "@latex-renderer/auth";
import { bootstrapInitialOwner } from "../packages/auth/src/bootstrap-owner.js";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const databases: RendererDatabase[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
function database() {
  const db = new RendererDatabase(":memory:");
  db.migrate();
  databases.push(db);
  return db;
}
const passwordInput = () => ({
  method: "password" as const,
  displayName: "Initial owner",
  email: "owner@example.test",
  loginName: "Owner.Login",
  password: "fixture-only secure 8246",
  passwordPepper: Buffer.alloc(32, 17),
});
function ownerCount(db: RendererDatabase) {
  return db.raw
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner'")
    .get()?.count;
}

describe("shared initial-owner bootstrap", () => {
  it("also works through the actual compiled privileged CLI on an isolated fixture DB", async () => {
    const root = await mkdtemp(join(tmpdir(), "bootstrap-cli-fixture-"));
    directories.push(root);
    const password = join(root, "password"),
      api = join(root, "api-pepper"),
      pepper = join(root, "password-pepper"),
      databasePath = join(root, "fixture.sqlite3");
    await writeFile(password, passwordInput().password, { mode: 0o600 });
    await chmod(password, 0o600);
    await writeFile(api, Buffer.alloc(32, 29), { mode: 0o400 });
    await writeFile(pepper, passwordInput().passwordPepper, { mode: 0o400 });
    const args = [
      new URL("../apps/admin-local/dist/index.js", import.meta.url).pathname,
      "bootstrap",
      "--auth-mode",
      "password",
      "--display-name",
      "Fixture owner",
      "--login-name",
      "fixture.owner",
      "--password-file",
      password,
    ];
    const options = {
      encoding: "utf8" as const,
      timeout: 30_000,
      env: {
        PATH: process.env.PATH,
        DATABASE_PATH: databasePath,
        API_KEY_PEPPER_FILE: api,
        AUTH_PASSWORD_PEPPER_FILE: pepper,
        LATEX_RENDERER_ADMIN_GID: String(
          process.getgroups?.()[0] ?? process.getgid?.() ?? 0,
        ),
      },
    };
    const first = spawnSync(process.execPath, args, options);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim()).toMatch(/^user_[a-f0-9]{32}$/);
    const second = spawnSync(process.execPath, args, options);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("An owner already exists");
    expect(
      `${first.stdout}${first.stderr}${second.stdout}${second.stderr}`,
    ).not.toContain(passwordInput().password);
    const db = new RendererDatabase(databasePath);
    databases.push(db);
    expect(ownerCount(db)).toBe(1);
  });
  it("stores a real policy-compliant scrypt credential, normalized login and secret-free audit", async () => {
    const db = database(),
      input = passwordInput();
    const id = await bootstrapInitialOwner(db, input, "0");
    const credential = db.raw
      .prepare("SELECT * FROM local_credentials WHERE user_id=?")
      .get(id) as { login_name: string; password_hash: string };
    expect(credential.login_name).toBe("owner.login");
    expect(credential.password_hash).not.toBe(input.password);
    const auth = new BrowserAuthenticationService({
      database: db,
      mode: "password",
      publicOrigin: "https://bootstrap.invalid",
      passwordPepper: input.passwordPepper,
    });
    expect(
      await auth.verifyPassword(input.password, credential.password_hash),
    ).toBe(true);
    expect(
      await auth.verifyPassword("wrong password", credential.password_hash),
    ).toBe(false);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM user_identities").get()
        ?.count,
    ).toBe(0);
    const audit = db.raw
      .prepare("SELECT * FROM audit_logs WHERE target_id=?")
      .get(id);
    expect(JSON.stringify(audit)).not.toMatch(
      /fixture-only|password_hash|8246/,
    );
    expect(ownerCount(db)).toBe(1);
  });
  it.each(["oidc", "cloudflare-access"] as const)(
    "records an exact explicit %s identity, never email linking",
    async (method) => {
      const db = database();
      db.users.insertInvitation({
        id: "user_fixture",
        email: "owner@example.test",
        displayName: "Other user",
        role: "user",
        createdBy: "fixture",
        timestamp: new Date().toISOString(),
      });
      const issuer =
        method === "oidc"
          ? "https://identity.example.test/tenant/"
          : "https://identity.example.test";
      const id = await bootstrapInitialOwner(
        db,
        {
          method,
          displayName: "Owner",
          issuer,
          subject: "immutable-subject",
          email: "owner@example.test",
        },
        "0",
      );
      const row = db.raw
        .prepare("SELECT user_id,provider,issuer,subject FROM user_identities")
        .get();
      expect(row).toMatchObject({
        user_id: id,
        provider: method,
        issuer,
        subject: "immutable-subject",
      });
      expect(id).not.toBe("user_fixture");
      expect(ownerCount(db)).toBe(1);
    },
  );
  it("does not replace an existing owner, even when disabled", async () => {
    const db = database();
    const id = await bootstrapInitialOwner(
      db,
      {
        method: "oidc",
        displayName: "Owner",
        issuer: "https://identity.example.test",
        subject: "original",
      },
      "0",
    );
    db.raw.prepare("UPDATE users SET status='disabled' WHERE id=?").run(id);
    await expect(
      bootstrapInitialOwner(
        db,
        {
          method: "oidc",
          displayName: "Replacement",
          issuer: "https://identity.example.test",
          subject: "replacement",
        },
        "0",
      ),
    ).rejects.toThrow("An owner already exists");
    expect(
      db.raw
        .prepare("SELECT subject FROM user_identities WHERE user_id=?")
        .get(id)?.subject,
    ).toBe("original");
    expect(ownerCount(db)).toBe(1);
  });
  it("serializes concurrent first-owner attempts under the actual SQLite transaction", async () => {
    const db = database();
    const results = await Promise.allSettled([
      bootstrapInitialOwner(db, passwordInput(), "0"),
      bootstrapInitialOwner(
        db,
        { ...passwordInput(), loginName: "second.owner" },
        "0",
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(ownerCount(db)).toBe(1);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM local_credentials").get()
        ?.count,
    ).toBe(1);
  });
  it("rolls back all owner/identity/audit state if creation fails", async () => {
    const db = database();
    vi.spyOn(db.webPrincipals, "ensure").mockImplementation(() => {
      throw new Error("fixture failure");
    });
    await expect(
      bootstrapInitialOwner(
        db,
        {
          method: "oidc",
          displayName: "Owner",
          issuer: "https://identity.example.test",
          subject: "subject",
        },
        "0",
      ),
    ).rejects.toThrow("fixture failure");
    expect(ownerCount(db)).toBe(0);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM user_identities").get()
        ?.count,
    ).toBe(0);
    expect(
      db.raw
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_logs WHERE action='user.created'",
        )
        .get()?.count,
    ).toBe(0);
  });
  it.each([
    "http://identity.example.test",
    "https://user:pass@identity.example.test",
    "https://identity.example.test/?key=secret",
    "https://identity.example.test/#secret",
  ])("rejects unsafe issuer %s without writes", async (issuer) => {
    const db = database();
    await expect(
      bootstrapInitialOwner(
        db,
        { method: "oidc", displayName: "Owner", issuer, subject: "subject" },
        "0",
      ),
    ).rejects.toThrow("HTTPS");
    expect(ownerCount(db)).toBe(0);
  });
  it("rejects an Access tenant path rather than treating it as an origin", async () => {
    const db = database();
    await expect(
      bootstrapInitialOwner(
        db,
        {
          method: "cloudflare-access",
          displayName: "Owner",
          issuer: "https://identity.example.test/tenant/",
          subject: "subject",
        },
        "0",
      ),
    ).rejects.toThrow("HTTPS");
    expect(ownerCount(db)).toBe(0);
  });
  it.each([
    "short",
    "contains owner.login inside password",
    "has a null \u0000 character",
  ])(
    "maintains password policy without creating an owner",
    async (password) => {
      const db = database();
      await expect(
        bootstrapInitialOwner(db, { ...passwordInput(), password }, "0"),
      ).rejects.toThrow("Password must");
      expect(ownerCount(db)).toBe(0);
    },
  );
  it.each([
    { displayName: " bad" },
    { displayName: "bad\nname" },
    { email: "not-email" },
  ])("rejects invalid metadata %j", async (patch) => {
    const db = database();
    await expect(
      bootstrapInitialOwner(db, { ...passwordInput(), ...patch }, "0"),
    ).rejects.toThrow(/metadata|email/);
    expect(ownerCount(db)).toBe(0);
  });
});
