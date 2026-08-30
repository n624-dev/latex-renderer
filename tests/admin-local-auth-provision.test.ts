import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "../packages/database/src/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("local authentication-mode recovery", () => {
  it("provisions a new owner method once and revokes existing sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "latex-renderer-auth-provision-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3");
    const apiPepperPath = privateFile(root, "api-pepper", "a".repeat(32));
    const passwordPepperPath = privateFile(
      root,
      "password-pepper",
      "b".repeat(32),
    );
    const passwordPath = privateFile(
      root,
      "owner-password",
      "correct horse battery staple",
    );
    const environment = {
      ...process.env,
      DATABASE_PATH: databasePath,
      API_KEY_PEPPER_ID: "v1",
      API_KEY_PEPPER_FILE: apiPepperPath,
      AUTH_PASSWORD_PEPPER_FILE: passwordPepperPath,
      LATEX_RENDERER_ADMIN_GID: String(process.getgid?.() ?? 0),
    };

    const bootstrap = runAdminLocal(
      [
        "bootstrap",
        "--auth-mode",
        "oidc",
        "--display-name",
        "Owner",
        "--issuer",
        "https://identity.example/",
        "--subject",
        "stable-owner-subject",
      ],
      environment,
    );
    expect(bootstrap.status, bootstrap.stderr).toBe(0);
    const ownerId = bootstrap.stdout.trim();
    expect(ownerId).toMatch(/^user_[a-f0-9]{32}$/);

    const database = new RendererDatabase(databasePath);
    database.browserAuth.insertSession({
      token_hash: "a".repeat(64),
      user_id: ownerId,
      auth_mode: "oidc",
      identity_id: null,
      user_security_version: 1,
      csrf_hash: "b".repeat(64),
      created_at: "2026-08-30T00:00:00.000Z",
      last_seen_at: "2026-08-30T00:00:00.000Z",
      idle_expires_at: "2026-08-30T01:00:00.000Z",
      absolute_expires_at: "2026-08-31T00:00:00.000Z",
      revoked_at: null,
    });
    database.close();

    const provision = runAdminLocal(
      [
        "auth",
        "provision-owner",
        "--owner-id",
        ownerId,
        "--auth-mode",
        "password",
        "--login-name",
        "owner",
        "--password-file",
        passwordPath,
        "--yes",
      ],
      environment,
    );
    expect(provision.status, provision.stderr).toBe(0);
    expect(provision.stdout).toContain("password authentication provisioned");

    const inspected = new RendererDatabase(databasePath);
    expect(inspected.browserAuth.getCredentialForUser(ownerId)).toMatchObject({
      login_name: "owner",
    });
    expect(
      inspected.browserAuth.getSession("a".repeat(64))?.revoked_at,
    ).not.toBe(null);
    expect(inspected.users.get(ownerId)?.security_version).toBe(2);
    const audit = inspected.raw
      .prepare(
        "SELECT action,target_id,result,metadata_json FROM audit_logs WHERE action='user.auth_provisioned'",
      )
      .get() as
      | {
          action: string;
          target_id: string;
          result: string;
          metadata_json: string;
        }
      | undefined;
    expect(audit).toMatchObject({
      action: "user.auth_provisioned",
      target_id: ownerId,
      result: "success",
    });
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toEqual({
      authMode: "password",
    });
    inspected.close();

    const duplicate = runAdminLocal(
      [
        "auth",
        "provision-owner",
        "--owner-id",
        ownerId,
        "--auth-mode",
        "password",
        "--login-name",
        "another-owner",
        "--password-file",
        passwordPath,
        "--yes",
      ],
      environment,
    );
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("CREDENTIAL_ALREADY_EXISTS");
  });
});

function privateFile(root: string, name: string, value: string): string {
  const path = join(root, name);
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function runAdminLocal(
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "apps/admin-local/src/index.ts", ...arguments_],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return result;
}
