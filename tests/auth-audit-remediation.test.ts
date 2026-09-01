import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiKeyService,
  BrowserAuthenticationService,
  OIDC_STATE_COOKIE,
  OidcClient,
  oidcStateCookieName,
  type AccessJwtVerifier,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";
import { AdminApiKeysService } from "../apps/admin-api/src/services/api-keys.js";
import { UsersService } from "../apps/admin-api/src/services/users.js";
import { loginScript } from "../apps/admin-web/src/assets/login-script.js";
import type { AdminDependencies } from "../apps/admin-api/src/types.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

describe("browser authentication audit remediations", () => {
  it("keeps the address-wide password failure window after a successful login", async () => {
    const database = databaseFixture();
    seedUser(database, "user_owner", "owner@example.test", "owner");
    const authentication = passwordAuthentication(database);
    await authentication.createPasswordCredential({
      userId: "user_owner",
      loginName: "owner",
      password: "correct horse battery staple 2026",
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(
        authentication.loginPassword({
          loginName: `missing-${index}`,
          password: "not the password",
          ipAddress: "192.0.2.10",
          request: sameOriginRequest(),
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }

    await authentication.loginPassword({
      loginName: "owner",
      password: "correct horse battery staple 2026",
      ipAddress: "192.0.2.10",
      request: sameOriginRequest(),
    });
    await expect(
      authentication.loginPassword({
        loginName: "missing-4",
        password: "not the password",
        ipAddress: "192.0.2.10",
        request: sameOriginRequest(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      authentication.loginPassword({
        loginName: "missing-5",
        password: "not the password",
        ipAddress: "192.0.2.10",
        request: sameOriginRequest(),
      }),
    ).rejects.toMatchObject({ code: "LOGIN_RATE_LIMITED", status: 429 });
  });

  it("limits pending OIDC starts per client address", async () => {
    const issuer = "https://id.example.test/tenant";
    const client = new OidcClient({
      issuer,
      clientId: "latex-renderer",
      clientSecret: "strict-test-client-secret",
      publicOrigin: "https://latex.example.com",
      fetchImpl: () => Promise.resolve(Response.json(oidcMetadata(issuer))),
    });
    for (let index = 0; index < 20; index += 1)
      await client.begin("/app/", "192.0.2.20");
    await expect(client.begin("/app/", "192.0.2.20")).rejects.toMatchObject({
      code: "OIDC_LOGIN_RATE_LIMITED",
      status: 429,
    });
    const other = await client.begin("/app/", "192.0.2.21");
    expect(other.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("recovers OIDC discovery after a transient failure", async () => {
    const issuer = "https://id.example.test/tenant";
    let available = false;
    const fetchImpl = vi.fn(() => {
      if (!available)
        return Promise.reject(new Error("temporary discovery outage"));
      return Promise.resolve(Response.json(oidcMetadata(issuer)));
    });
    const client = new OidcClient({
      issuer,
      clientId: "latex-renderer",
      clientSecret: "strict-test-client-secret",
      publicOrigin: "https://latex.example.com",
      fetchImpl,
    });
    await expect(client.begin("/app/", "192.0.2.30")).rejects.toThrow(
      "temporary discovery outage",
    );
    available = true;
    const started = await client.begin("/app/", "192.0.2.31");
    expect(started.authorizationUrl).toContain("/authorize?");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("mirrors server return_to control-character limits in the login script", () => {
    expect(loginScript).toContain("candidate.length<=2048");
    expect(loginScript).toContain("[\\u0000-\\u001f\\u007f]");
  });

  it("uses a distinct OIDC state cookie name for every flow", () => {
    const first = oidcStateCookieName("a".repeat(43));
    const second = oidcStateCookieName("b".repeat(43));
    expect(first).not.toBe(second);
    expect(first).toContain("_" + "a".repeat(43));
  });

  it("completes two OIDC route flows even when the legacy cookie is overwritten", async () => {
    const states = ["a".repeat(43), "b".repeat(43)];
    const completed: Array<{ state: string; stateCookie: string }> = [];
    const browserAuth = {
      beginOidc: () => {
        const state = states.shift();
        if (state === undefined) throw new Error("unexpected OIDC start");
        return Promise.resolve({
          authorizationUrl: `https://id.example.test/authorize?state=${state}`,
          state,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      },
      finishOidc: (input: { state: string; stateCookie: string }) => {
        completed.push(input);
        return Promise.resolve({ returnTo: "/app/", cookies: [] });
      },
      logout: () => [],
    };
    const deps = {
      browserAuth,
      deploymentMode: "standalone",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(["https://latex.example.com"]),
      writeEnabled: true,
    } as unknown as AdminDependencies;
    const app = createAdminApp(deps);

    const first = await app.request("/auth/oidc/start");
    const second = await app.request("/auth/oidc/start");
    const firstState = "a".repeat(43);
    const secondState = "b".repeat(43);
    expect(first.headers.get("Set-Cookie")).toContain(
      `${oidcStateCookieName(firstState)}=${firstState}`,
    );
    expect(second.headers.get("Set-Cookie")).toContain(
      `${oidcStateCookieName(secondState)}=${secondState}`,
    );

    const bothCookies = [
      `${oidcStateCookieName(firstState)}=${firstState}`,
      `${oidcStateCookieName(secondState)}=${secondState}`,
      `${OIDC_STATE_COOKIE}=${secondState}`,
    ].join("; ");
    expect(
      await app.request(
        `/auth/oidc/callback?state=${firstState}&code=first-code`,
        { headers: { Cookie: bothCookies } },
      ),
    ).toMatchObject({ status: 303 });
    expect(
      await app.request(
        `/auth/oidc/callback?state=${secondState}&code=second-code`,
        {
          headers: {
            Cookie: `${oidcStateCookieName(secondState)}=${secondState}`,
          },
        },
      ),
    ).toMatchObject({ status: 303 });
    expect(completed).toMatchObject([
      { state: firstState, stateCookie: firstState },
      { state: secondState, stateCookie: secondState },
    ]);
  });

  it("maps create and reset login-name uniqueness races to a domain conflict", async () => {
    const database = databaseFixture();
    seedUser(database, "user_owner", "owner@example.test", "owner");
    seedUser(database, "user_target", "target@example.test", "user");
    seedUser(database, "user_other", "other@example.test", "user");
    const authentication = passwordAuthentication(database);
    const createHash = await authentication.hashPassword(
      "a valid competing password",
      "racer",
    );
    const deps = {
      database,
      browserAuth: authentication,
    } as unknown as AdminDependencies;
    const service = new UsersService(deps);
    const actor = {
      type: "user" as const,
      id: "user_owner",
      role: "owner" as const,
      userId: "user_owner",
    };
    const hashSpy = vi
      .spyOn(authentication, "hashPassword")
      .mockImplementation(() => {
        database.browserAuth.upsertCredential({
          user_id: "user_other",
          login_name: "racer",
          password_hash: createHash,
          password_updated_at: new Date().toISOString(),
        });
        return Promise.resolve(createHash);
      });
    await expect(
      service.create(actor, {
        email: null,
        displayName: "Racing User",
        role: "user",
        authentication: {
          type: "password",
          loginName: "racer",
          password: "a valid competing password",
        },
      }),
    ).rejects.toMatchObject({ code: "LOGIN_NAME_CONFLICT", status: 409 });
    hashSpy.mockRestore();

    const resetHash = await authentication.hashPassword(
      "a valid reset password",
      "reset-racer",
    );
    vi.spyOn(authentication, "hashPassword").mockImplementation(() => {
      database.browserAuth.upsertCredential({
        user_id: "user_other",
        login_name: "reset-racer",
        password_hash: resetHash,
        password_updated_at: new Date().toISOString(),
      });
      return Promise.resolve(resetHash);
    });
    await expect(
      service.resetPassword(actor, "user_target", {
        loginName: "reset-racer",
        password: "a valid reset password",
        reason: "test race",
      }),
    ).rejects.toMatchObject({ code: "LOGIN_NAME_CONFLICT", status: 409 });
  });

  it("records a common auth.login event for password and external sessions", async () => {
    const database = databaseFixture();
    seedUser(database, "user_owner", "owner@example.test", "owner");
    const password = passwordAuthentication(database);
    await password.createPasswordCredential({
      userId: "user_owner",
      loginName: "owner",
      password: "correct horse battery staple 2026",
    });
    await password.loginPassword({
      loginName: "owner",
      password: "correct horse battery staple 2026",
      ipAddress: "192.0.2.40",
      request: new Request("https://latex.example.com/login", {
        method: "POST",
        headers: {
          Origin: "https://latex.example.com",
          "User-Agent": "audit-test",
        },
      }),
    });

    const external = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access: {
        issuer: "https://team.cloudflareaccess.com",
        verify: () =>
          Promise.resolve({
            provider: "cloudflare-access" as const,
            issuer: "https://team.cloudflareaccess.com",
            subject: "external-subject",
            payload: {},
          }),
      } as unknown as AccessJwtVerifier,
    });
    external.createExternalIdentity({
      userId: "user_owner",
      subject: "external-subject",
    });
    await external.establishSession(
      new Request("https://latex.example.com/auth/session", {
        headers: {
          "Cf-Access-Jwt-Assertion": "test-assertion",
          "CF-Connecting-IP": "192.0.2.41",
          "User-Agent": "audit-test",
        },
      }),
    );

    const rows = database.raw
      .prepare(
        "SELECT action,metadata_json,ip_address FROM audit_logs WHERE action='auth.login' ORDER BY created_at,id",
      )
      .all() as Array<{
      action: string;
      metadata_json: string;
      ip_address: string | null;
    }>;
    expect(rows).toHaveLength(2);
    const passwordAudit = rows.find(
      (row) =>
        (JSON.parse(row.metadata_json) as { mode?: unknown }).mode ===
        "password",
    );
    const externalAudit = rows.find(
      (row) =>
        (JSON.parse(row.metadata_json) as { mode?: unknown }).mode ===
        "cloudflare-access",
    );
    expect(passwordAudit).toBeDefined();
    expect(externalAudit).toBeDefined();
    expect(JSON.parse(passwordAudit?.metadata_json ?? "{}")).toMatchObject({
      mode: "password",
    });
    expect(passwordAudit?.ip_address).toBe("192.0.2.40");
    expect(JSON.parse(externalAudit?.metadata_json ?? "{}")).toMatchObject({
      mode: "cloudflare-access",
      provider: "cloudflare-access",
      issuer: "https://team.cloudflareaccess.com",
    });
  });

  it("bounds active sessions per user and revokes the oldest first", async () => {
    const database = databaseFixture();
    seedUser(database, "user_external", "external@example.test", "user");
    const authentication = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access: {
        issuer: "https://team.cloudflareaccess.com",
        verify: () =>
          Promise.resolve({
            provider: "cloudflare-access" as const,
            issuer: "https://team.cloudflareaccess.com",
            subject: "external-subject",
            payload: {},
          }),
      } as unknown as AccessJwtVerifier,
    });
    authentication.createExternalIdentity({
      userId: "user_external",
      subject: "external-subject",
    });
    for (let index = 0; index < 21; index += 1)
      await authentication.establishSession(
        new Request("https://latex.example.com/auth/session", {
          headers: { "Cf-Access-Jwt-Assertion": "test-assertion" },
        }),
      );
    expect(
      database.browserAuth.activeSessionCount(
        new Date(Date.now() - 1_000).toISOString(),
      ),
    ).toBe(20);
    expect(
      (
        database.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM web_sessions WHERE user_id=? AND revoked_at IS NOT NULL",
          )
          .get("user_external") as { count: number }
      ).count,
    ).toBe(1);
  });

  it("rejects rotation of an already expired API key", () => {
    const database = databaseFixture();
    seedUser(database, "user_owner", "owner@example.test", "owner");
    database.serviceAccounts.insert({
      id: "sa_owner",
      ownerUserId: "user_owner",
      name: "owner-service",
      clientType: "generic",
      timestamp: new Date().toISOString(),
    });
    const apiKeys = new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 1)]]),
      "v1",
    );
    const generated = apiKeys.create("render");
    database.apiKeys.insert({
      id: generated.id,
      serviceAccountId: "sa_owner",
      name: "expired",
      prefix: generated.prefix,
      kind: generated.kind,
      secretHash: generated.secretHash,
      pepperId: generated.pepperId,
      scopes: ["render:create"],
      expiresAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
      createdBy: "user_owner",
    });
    const service = new AdminApiKeysService({
      database,
      apiKeys,
    } as unknown as AdminDependencies);
    expect(() =>
      service.rotate(
        {
          type: "user",
          id: "user_owner",
          role: "owner",
          userId: "user_owner",
        },
        generated.id,
      ),
    ).toThrow(
      expect.objectContaining({ code: "API_KEY_EXPIRED", status: 409 }),
    );
  });

  it("persists authorization-code security versions in the migrated schema", () => {
    const database = databaseFixture();
    seedUser(database, "user_code", "code@example.test", "user");
    const columns = database.raw
      .prepare("PRAGMA table_info(remote_mcp_authorization_codes)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain(
      "user_security_version",
    );
    database.raw
      .prepare(
        `INSERT INTO remote_mcp_clients(client_id,client_name,redirect_uris_json,created_at)
         VALUES ('mcp_client_test','Test','["https://client.example/callback"]',?)`,
      )
      .run(new Date().toISOString());
    database.remoteMcp.insertAuthorizationCode({
      codeHash: "a".repeat(64),
      clientId: "mcp_client_test",
      userId: "user_code",
      userSecurityVersion: 7,
      redirectUri: "https://client.example/callback",
      scopes: ["mcp:read"],
      resource: "https://latex.example.com/mcp",
      codeChallenge: "b".repeat(43),
      timestamp: new Date().toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(database.remoteMcp.authorizationCode("a".repeat(64))).toMatchObject({
      user_security_version: 7,
    });
  });
});

function databaseFixture(): RendererDatabase {
  const database = new RendererDatabase(":memory:");
  database.migrate();
  databases.push(database);
  return database;
}

function seedUser(
  database: RendererDatabase,
  id: string,
  email: string,
  role: "owner" | "admin" | "user",
): void {
  database.users.insertInvitation({
    id,
    email,
    displayName: id,
    role,
    createdBy: "test",
    timestamp: new Date().toISOString(),
  });
}

function passwordAuthentication(
  database: RendererDatabase,
): BrowserAuthenticationService {
  return new BrowserAuthenticationService({
    database,
    mode: "password",
    publicOrigin: "https://latex.example.com",
    passwordPepper: Buffer.alloc(32, 7),
    scryptLogN: 12,
  });
}

function sameOriginRequest(): Request {
  return new Request("https://latex.example.com/auth/password/login", {
    method: "POST",
    headers: {
      Origin: "https://latex.example.com",
      "Sec-Fetch-Site": "same-origin",
    },
  });
}

function oidcMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
  };
}
