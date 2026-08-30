import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  ApiKeyService,
  AccessJwtVerifier,
  BrowserAuthenticationService,
  parseAuthMode,
  parseDeploymentMode,
  OidcClient,
  SESSION_COOKIE,
  CSRF_COOKIE,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { createAdminApp } from "../apps/admin-api/src/app.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.unstubAllGlobals();
});

describe("strict browser authentication", () => {
  it("stores only session hashes and enforces exact Origin plus per-session CSRF", async () => {
    const { app, database } = await passwordFixture();
    const login = await app.request("/auth/password/login", {
      method: "POST",
      headers: {
        Origin: "https://latex.example.com",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
        "X-Latex-Renderer-Client-IP": "192.0.2.10",
      },
      body: JSON.stringify({
        loginName: "owner",
        password: "correct horse battery staple 2026",
      }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { csrfToken: string };
    const setCookie = login.headers.get("set-cookie") ?? "";
    const sessionToken = cookieValue(setCookie, SESSION_COOKIE);
    const csrfToken = cookieValue(setCookie, CSRF_COOKIE);
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfToken).toBe(body.csrfToken);
    const row = database.raw
      .prepare("SELECT token_hash,csrf_hash FROM web_sessions")
      .get() as { token_hash: string; csrf_hash: string };
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.csrf_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(sessionToken);
    expect(JSON.stringify(row)).not.toContain(csrfToken);

    const cookie = `${SESSION_COOKIE}=${sessionToken}; ${CSRF_COOKIE}=${csrfToken}`;
    const rejected = await app.request(
      "/admin/api/v1/users/user_owner/disable",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
          "X-CSRF-Token": csrfToken,
        },
      },
    );
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "ORIGIN_REJECTED" },
    });

    const acceptedBoundary = await app.request(
      "/admin/api/v1/users/user_owner/disable",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://latex.example.com",
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
        },
      },
    );
    expect(acceptedBoundary.status).toBe(409);
    await expect(acceptedBoundary.json()).resolves.toMatchObject({
      error: { code: "LAST_OWNER" },
    });
  });

  it("does not extend the absolute session lifetime when repairing a missing CSRF cookie", async () => {
    const database = databaseFixture();
    seedUser(database, "user_owner", "owner@example.test", "owner");
    let now = Date.parse("2026-08-30T00:00:00.000Z");
    const browserAuth = new BrowserAuthenticationService({
      database,
      mode: "password",
      publicOrigin: "https://latex.example.com",
      passwordPepper: Buffer.alloc(32, 7),
      sessionIdleMs: 30 * 60 * 1000,
      sessionAbsoluteMs: 60 * 60 * 1000,
      scryptLogN: 12,
      now: () => new Date(now),
    });
    await browserAuth.createPasswordCredential({
      userId: "user_owner",
      loginName: "owner",
      password: "correct horse battery staple 2026",
    });
    const original = await browserAuth.loginPassword({
      loginName: "owner",
      password: "correct horse battery staple 2026",
      ipAddress: "192.0.2.30",
      request: new Request("https://latex.example.com/auth/password/login", {
        method: "POST",
        headers: {
          Origin: "https://latex.example.com",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
    });
    expect(original.principal.session?.absolute_expires_at).toBe(
      "2026-08-30T01:00:00.000Z",
    );

    now += 10 * 60 * 1000;
    const repaired = await browserAuth.establishSession(
      new Request("https://latex.example.com/app/", {
        headers: { Cookie: `${SESSION_COOKIE}=${original.token}` },
      }),
    );
    expect(repaired.principal.session?.absolute_expires_at).toBe(
      original.principal.session?.absolute_expires_at,
    );

    now = Date.parse("2026-08-30T01:00:00.000Z");
    expect(
      browserAuth.authenticateSession(
        new Request("https://latex.example.com/app/", {
          headers: {
            Cookie: `${SESSION_COOKIE}=${repaired.token}; ${CSRF_COOKIE}=${repaired.csrfToken}`,
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("uses generic password failures and rate-limits both login and address keys", async () => {
    const { app, database } = await passwordFixture();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await passwordLogin(app, "owner", "not the password");
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Login name or password is invalid",
        },
      });
    }
    const limited = await passwordLogin(app, "owner", "not the password");
    expect(limited.status).toBe(429);
    expect(
      (
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM auth_login_attempts")
          .get() as { count: number }
      ).count,
    ).toBe(2);
  });

  it("bounds retained login state and concurrent password derivations", async () => {
    const { app, database, browserAuth } = await passwordFixture();
    const timestamp = new Date().toISOString();
    const insert = database.raw.prepare(
      `INSERT INTO auth_login_attempts
       (key_hash,failure_count,window_started_at,blocked_until,updated_at)
       VALUES (?,1,?,NULL,?)`,
    );
    database.transaction(() => {
      for (let index = 0; index < 10_005; index += 1)
        insert.run(index.toString(16).padStart(64, "0"), timestamp, timestamp);
    });
    expect(
      (await passwordLogin(app, "unknown", "invalid password")).status,
    ).toBe(401);
    expect(
      (
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM auth_login_attempts")
          .get() as { count: number }
      ).count,
    ).toBeLessThanOrEqual(10_000);

    const encoded = await browserAuth.hashPassword(
      "another correct horse battery staple",
      "another-owner",
    );
    const differentPepper = new BrowserAuthenticationService({
      database,
      mode: "password",
      publicOrigin: "https://latex.example.com",
      passwordPepper: Buffer.alloc(32, 8),
      scryptLogN: 12,
    });
    expect(
      await differentPepper.verifyPassword(
        "another correct horse battery staple",
        encoded,
      ),
    ).toBe(false);
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, () =>
        browserAuth.verifyPassword(
          "another correct horse battery staple",
          encoded,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(8);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "PASSWORD_AUTH_BUSY", status: 503 },
    });
  });

  it("revokes sessions when authentication mode or external issuer changes", async () => {
    const { app, database } = await passwordFixture();
    const login = await passwordLogin(
      app,
      "owner",
      "correct horse battery staple 2026",
    );
    const cookieHeader = login.headers.get("set-cookie") ?? "";
    const token = cookieValue(cookieHeader, SESSION_COOKIE);
    const csrf = cookieValue(cookieHeader, CSRF_COOKIE);
    const request = new Request("https://latex.example.com/app/", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}` },
    });
    const access = {
      issuer: "https://new-team.cloudflareaccess.com",
      verify: () => Promise.reject(new Error("not used")),
    } as unknown as AccessJwtVerifier;
    const changedMode = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access,
      scryptLogN: 12,
    });
    expect(changedMode.authenticateSession(request)).toBeUndefined();
    expect(
      (
        database.raw
          .prepare(
            "SELECT revoked_at FROM web_sessions WHERE token_hash IS NOT NULL",
          )
          .get() as { revoked_at: string | null }
      ).revoked_at,
    ).not.toBeNull();

    const externalUser = "user_external_issuer";
    seedUser(database, externalUser, null, "user");
    const firstAccess = {
      issuer: "https://first-team.cloudflareaccess.com",
      verify: () =>
        Promise.resolve({
          provider: "cloudflare-access" as const,
          issuer: "https://first-team.cloudflareaccess.com",
          subject: "external-subject",
          payload: {},
        }),
    } as unknown as AccessJwtVerifier;
    const first = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access: firstAccess,
      scryptLogN: 12,
    });
    first.createExternalIdentity({
      userId: externalUser,
      subject: "external-subject",
    });
    const externalSession = await first.establishSession(
      new Request("https://latex.example.com/app/", {
        headers: { "Cf-Access-Jwt-Assertion": "assertion" },
      }),
    );
    const secondAccess = {
      issuer: "https://second-team.cloudflareaccess.com",
      verify: () => Promise.reject(new Error("not used")),
    } as unknown as AccessJwtVerifier;
    const second = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access: secondAccess,
      scryptLogN: 12,
    });
    expect(
      second.authenticateSession(
        new Request("https://latex.example.com/app/", {
          headers: {
            Cookie: `${SESSION_COOKIE}=${externalSession.token}; ${CSRF_COOKIE}=${externalSession.csrfToken}`,
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("never links an external identity by a matching email attribute", async () => {
    const database = databaseFixture();
    seedUser(database, "user_external", "same@example.test", "user");
    const access = {
      issuer: "https://team.cloudflareaccess.com",
      verify: () =>
        Promise.resolve({
          provider: "cloudflare-access" as const,
          issuer: "https://team.cloudflareaccess.com",
          subject: "stable-subject",
          email: "same@example.test",
          payload: {},
        }),
    } as unknown as AccessJwtVerifier;
    const authentication = new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access,
      scryptLogN: 12,
    });
    await expect(
      authentication.authenticate(
        new Request("https://latex.example.com/app/", {
          headers: { "Cf-Access-Jwt-Assertion": "jwt" },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_NOT_PROVISIONED", status: 403 });
    expect(database.browserAuth.identitiesForUser("user_external")).toEqual([]);
  });

  it("consumes legacy Access subjects once so an unlinked identity cannot return", () => {
    const database = databaseFixture();
    const timestamp = new Date().toISOString();
    database.raw
      .prepare(
        `INSERT INTO users
         (id,access_subject,access_subject_linked_at,access_subject_generation,email,display_name,role,status,security_version,created_by,created_at,updated_at)
         VALUES ('user_legacy','legacy-subject',?,1,NULL,'Legacy','admin','active',1,'test',?,?)`,
      )
      .run(timestamp, timestamp, timestamp);
    const access = {
      issuer: "https://team.cloudflareaccess.com",
      verify: () => Promise.reject(new Error("not used")),
    } as unknown as AccessJwtVerifier;
    new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access,
      scryptLogN: 12,
    });
    const [migrated] = database.browserAuth.identitiesForUser("user_legacy");
    expect(migrated?.subject).toBe("legacy-subject");
    expect(database.users.get("user_legacy")?.access_subject).toBeNull();
    expect(
      database.browserAuth.deleteIdentity("user_legacy", migrated?.id ?? ""),
    ).toBe(1);

    new BrowserAuthenticationService({
      database,
      mode: "cloudflare-access",
      publicOrigin: "https://latex.example.com",
      access,
      scryptLogN: 12,
    });
    expect(database.browserAuth.identitiesForUser("user_legacy")).toEqual([]);
  });

  it("requires explicit deployment and authentication modes", () => {
    expect(() => parseDeploymentMode(undefined)).toThrow(/DEPLOYMENT_MODE/);
    expect(() => parseAuthMode(undefined)).toThrow(/AUTH_MODE/);
    expect(() => parseDeploymentMode("development")).toThrow(/DEPLOYMENT_MODE/);
    expect(() => parseAuthMode("none")).toThrow(/AUTH_MODE/);
  });

  it("requires bounded Cloudflare Access JWTs, claims, expiry, and JWKS responses", async () => {
    const issuer = "https://team.cloudflareaccess.com";
    const audience = "a".repeat(64);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { kid: "access-key", alg: "RS256", use: "sig" });
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        return Promise.resolve(Response.json({ keys: [jwk] }));
      },
    );
    const verifier = new AccessJwtVerifier(issuer, audience, fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const valid = await new SignJWT({
      type: "app",
      name: "Owner\nInjected",
      email: "owner@example.test",
    })
      .setProtectedHeader({ alg: "RS256", kid: "access-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("stable-access-subject")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    const identity = await verifier.verify(valid);
    expect(identity).toMatchObject({
      subject: "stable-access-subject",
      email: "owner@example.test",
    });
    expect(identity).not.toHaveProperty("name");

    const withoutExpiry = await new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "access-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("stable-access-subject")
      .setIssuedAt(now)
      .sign(privateKey);
    await expect(verifier.verify(withoutExpiry)).rejects.toMatchObject({
      code: "INVALID_ACCESS_TOKEN",
    });
    await expect(
      verifier.verify("x".repeat(64 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("completes OIDC code+PKCE with exact issuer, state, nonce, and an asymmetric allowlist", async () => {
    const issuer = "https://id.example.test/tenant";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });
    let nonce = "";
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname.endsWith("/.well-known/openid-configuration"))
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
          });
        if (url.pathname.endsWith("/token")) {
          expect(new Headers(init?.headers).get("Authorization")).toMatch(
            /^Basic /,
          );
          const now = Math.floor(Date.now() / 1000);
          const token = await new SignJWT({
            nonce,
            email: "verified@example.test",
            email_verified: true,
            preferred_username: "verified-user",
          })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setIssuer(issuer)
            .setAudience("latex-renderer")
            .setSubject("stable-oidc-subject")
            .setIssuedAt(now)
            .setExpirationTime(now + 300)
            .sign(privateKey);
          return Response.json({ id_token: token });
        }
        if (url.pathname.endsWith("/jwks"))
          return Response.json({ keys: [jwk] });
        throw new Error(`Unexpected OIDC request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new OidcClient({
      issuer,
      clientId: "latex-renderer",
      clientSecret: "strict-test-client-secret",
      publicOrigin: "https://latex.example.com",
      fetchImpl: fetchMock,
    });
    const started = await client.begin("/app/projects/?page=2");
    const authorization = new URL(started.authorizationUrl);
    nonce = authorization.searchParams.get("nonce") ?? "";
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    await expect(
      client.callback({
        code: "code",
        state: started.state,
        stateCookie: "wrong",
      }),
    ).rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });

    const completed = await client.callback({
      code: "code",
      state: started.state,
      stateCookie: started.state,
    });
    expect(completed.returnTo).toBe("/app/projects/?page=2");
    expect(completed.identity).toMatchObject({
      provider: "oidc",
      issuer,
      subject: "stable-oidc-subject",
      email: "verified@example.test",
    });
    await expect(
      client.callback({
        code: "replay",
        state: started.state,
        stateCookie: started.state,
      }),
    ).rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });
  });
});

async function passwordFixture() {
  const database = databaseFixture();
  seedUser(database, "user_owner", "owner@example.test", "owner");
  const browserAuth = new BrowserAuthenticationService({
    database,
    mode: "password",
    publicOrigin: "https://latex.example.com",
    passwordPepper: Buffer.alloc(32, 7),
    scryptLogN: 12,
  });
  database.browserAuth.upsertCredential({
    user_id: "user_owner",
    login_name: "owner",
    password_hash: await browserAuth.hashPassword(
      "correct horse battery staple 2026",
      "owner",
    ),
    password_updated_at: new Date().toISOString(),
  });
  const app = createAdminApp({
    database,
    apiKeys: new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 1)]]),
      "v1",
    ),
    browserAuth,
    deploymentMode: "standalone",
    publicOrigin: "https://latex.example.com",
    allowedOrigins: new Set(["https://latex.example.com"]),
    writeEnabled: true,
    storageRoot: "/nonexistent",
    rendererVersion: "test",
    maxQueueLength: 10,
    maxUserStorageBytes: 1024 * 1024,
    minFreeStorageBytes: 1,
    activeTicketKid: "v1",
    verificationTicketKids: [],
  });
  return { app, database, browserAuth };
}

function databaseFixture(): RendererDatabase {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  return database;
}

function seedUser(
  database: RendererDatabase,
  id: string,
  email: string | null,
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

async function passwordLogin(
  app: ReturnType<typeof createAdminApp>,
  loginName: string,
  password: string,
): Promise<Response> {
  return await app.request("/auth/password/login", {
    method: "POST",
    headers: {
      Origin: "https://latex.example.com",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      "X-Latex-Renderer-Client-IP": "192.0.2.20",
    },
    body: JSON.stringify({ loginName, password }),
  });
}

function cookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookie);
  if (match?.[1] === undefined) throw new Error(`Missing cookie ${name}`);
  return match[1];
}
