import { afterEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  ApiKeyService,
  AccessJwtVerifier,
  BrowserAuthenticationService,
  createBrowserAuthenticationFromEnvironment,
  OidcClient,
  SESSION_COOKIE,
  CSRF_COOKIE,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import type { BrowserAuthenticationSelection } from "../packages/server-setup-core/src/index.mjs";
import { createAdminApp } from "../apps/admin-api/src/app.js";

const databases: RendererDatabase[] = [];
const origin = "https://renderer.example.test";
const issuer = "https://identity.example.test/tenant";
const password = "a correct horse battery staple 2026";
const dual = {
  backend: "native",
  passwordEnabled: true,
  oidcEnabled: true,
} as const;
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("per-method browser authentication policy", () => {
  it("logs in with both real password derivation and signed OIDC on the same explicitly provisioned user", async () => {
    const f = await fixture();
    const passwordSession = await f.passwordLogin();
    const oidcSession = await f.oidcLogin();
    expect(passwordSession.principal.authMode).toBe("password");
    expect(oidcSession.principal.authMode).toBe("oidc");
    expect(oidcSession.principal.user.id).toBe(
      passwordSession.principal.user.id,
    );
    expect(
      f.service.authenticateSession(request(passwordSession.token))?.authMode,
    ).toBe("password");
    expect(
      f.service.authenticateSession(request(oidcSession.token))?.authMode,
    ).toBe("oidc");
    expect(
      f.database.browserAuth.getSession(
        passwordSession.principal.session?.token_hash ?? "",
      )?.identity_id,
    ).toBeNull();
    expect(
      f.database.browserAuth.getSession(
        oidcSession.principal.session?.token_hash ?? "",
      )?.identity_id,
    ).not.toBeNull();
    expect(
      f.database.raw
        .prepare(
          "SELECT count(*) AS count FROM audit_logs WHERE action='auth.login' AND result='success'",
        )
        .get(),
    ).toMatchObject({ count: 2 });
  });

  it.each(["password", "oidc"] as const)(
    "disabling %s revokes only that method's sessions",
    async (disabled) => {
      const f = await fixture();
      const sessions = {
        password: await f.passwordLogin(),
        oidc: await f.oidcLogin(),
      };
      const next = f.withSelection({
        backend: "native",
        passwordEnabled: disabled !== "password",
        oidcEnabled: disabled !== "oidc",
      });
      expect(
        next.authenticateSession(request(sessions[disabled].token)),
      ).toBeUndefined();
      const retained = disabled === "password" ? "oidc" : "password";
      expect(
        next.authenticateSession(request(sessions[retained].token))?.authMode,
      ).toBe(retained);
      // A revoked session does not revive when a method is later re-enabled.
      expect(
        f.service.authenticateSession(request(sessions[disabled].token)),
      ).toBeUndefined();
      if (disabled === "password") {
        await expect(next.loginPassword(loginInput())).rejects.toMatchObject({
          code: "AUTH_MODE_MISMATCH",
          status: 404,
        });
        await expect(
          next.createPasswordCredential({
            userId: "user_owner",
            loginName: "owner",
            password,
          }),
        ).rejects.toMatchObject({ code: "AUTH_MODE_MISMATCH", status: 409 });
      } else {
        await expect(next.beginOidc()).rejects.toMatchObject({
          code: "AUTH_MODE_MISMATCH",
          status: 404,
        });
        await expect(
          next.finishOidc({
            code: "unused",
            state: "unused",
            stateCookie: "unused",
          }),
        ).rejects.toMatchObject({ code: "AUTH_MODE_MISMATCH", status: 404 });
      }
    },
  );

  it.each(["password", "oidc"] as const)(
    "retirement invalidates unused real %s sessions without reviving them on re-enable",
    async (disabled) => {
      const f = await fixture();
      const sessions = {
        password: await f.passwordLogin(),
        oidc: await f.oidcLogin(),
      };
      const changed = f.withSelection({
        backend: "native",
        passwordEnabled: disabled !== "password",
        oidcEnabled: disabled !== "oidc",
      });
      // Neither cookie has been used since issuance. Retirement is not lazy.
      expect(changed.retireIncompatibleSessions()).toBe(1);
      const restored = f.withSelection(dual);
      expect(restored.retireIncompatibleSessions()).toBe(0);
      expect(
        restored.authenticateSession(request(sessions[disabled].token)),
      ).toBeUndefined();
      const retained = disabled === "password" ? "oidc" : "password";
      expect(
        restored.authenticateSession(request(sessions[retained].token))
          ?.authMode,
      ).toBe(retained);
      expect(f.database.users.get("user_owner")?.security_version).toBe(1);
      expect(
        f.database.browserAuth.getCredentialForUser("user_owner"),
      ).toBeDefined();
      expect(
        f.database.browserAuth.identitiesForUser("user_owner"),
      ).toHaveLength(1);
    },
  );

  it.each(["password", "oidc"] as const)(
    "enabling the other method preserves a legacy %s session",
    async (mode) => {
      const f = await fixture();
      const legacy = new BrowserAuthenticationService({
        database: f.database,
        mode,
        publicOrigin: origin,
        passwordPepper: Buffer.alloc(32, 7),
        oidc: f.oidc,
        scryptLogN: 12,
      });
      const session =
        mode === "password"
          ? await legacy.loginPassword(loginInput())
          : await f.oidcLogin(legacy);
      expect(
        f.service.authenticateSession(request(session.token))?.authMode,
      ).toBe(mode);
    },
  );

  it.each(["password", "oidc"] as const)(
    "repairs a missing CSRF cookie without losing %s provenance or extending its lifetime",
    async (method) => {
      const f = await fixture();
      const session =
        method === "password" ? await f.passwordLogin() : await f.oidcLogin();
      const repaired = await f.service.establishSession(request(session.token));
      expect(repaired.principal.authMode).toBe(method);
      expect(repaired.principal.session?.absolute_expires_at).toBe(
        session.principal.session?.absolute_expires_at,
      );
      expect(repaired.principal.identity?.id).toBe(
        session.principal.identity?.id,
      );
      expect(repaired.token).not.toBe(session.token);
      expect(
        f.service.authenticateSession(request(session.token)),
      ).toBeUndefined();
      expect(
        f.service.authenticateSession(request(repaired.token))?.authMode,
      ).toBe(method);
    },
  );

  it("rejects a session whose identity and recorded authentication method disagree", async () => {
    const f = await fixture();
    const session = await f.passwordLogin();
    f.database.raw
      .prepare("UPDATE web_sessions SET auth_mode='oidc' WHERE token_hash=?")
      .run(session.principal.session?.token_hash ?? "");
    expect(
      f.service.authenticateSession(request(session.token)),
    ).toBeUndefined();
  });

  it("requires all enabled method dependencies and rejects an ambiguous constructor", async () => {
    const f = await fixture();
    const base = { database: f.database, publicOrigin: origin, scryptLogN: 12 };
    expect(
      () =>
        new BrowserAuthenticationService({
          ...base,
          selection: dual,
          oidc: f.oidc,
        }),
    ).toThrow(/pepper/);
    expect(
      () =>
        new BrowserAuthenticationService({
          ...base,
          selection: dual,
          passwordPepper: Buffer.alloc(32),
        }),
    ).toThrow(/OIDC client/);
    expect(
      () =>
        new BrowserAuthenticationService({
          ...base,
          selection: dual,
          mode: "password",
        } as never),
    ).toThrow(/either/);
    expect(
      () =>
        new BrowserAuthenticationService({
          ...base,
          selection: { ...dual, passwordEnabled: "true" },
        } as never),
    ).toThrow(/boolean/);
  });

  it("OIDC issuer changes revoke OIDC but not Password; identity removal remains enforced", async () => {
    const f = await fixture();
    const passwordSession = await f.passwordLogin(),
      oidcSession = await f.oidcLogin();
    const differentIssuer = new BrowserAuthenticationService({
      database: f.database,
      selection: dual,
      publicOrigin: origin,
      passwordPepper: Buffer.alloc(32, 7),
      oidc: new OidcClient({
        issuer: "https://other.example.test",
        clientId: "fixture",
        clientSecret: "different-secret-marker",
        publicOrigin: origin,
      }),
      scryptLogN: 12,
    });
    expect(
      differentIssuer.authenticateSession(request(oidcSession.token)),
    ).toBeUndefined();
    expect(
      differentIssuer.authenticateSession(request(passwordSession.token))
        ?.authMode,
    ).toBe("password");
    const newSession = await f.oidcLogin();
    f.database.browserAuth.deleteIdentity(
      "user_owner",
      newSession.principal.identity?.id ?? "",
    );
    expect(
      f.service.authenticateSession(request(newSession.token)),
    ).toBeUndefined();
    expect(
      f.service.authenticateSession(request(passwordSession.token)),
    ).toBeDefined();
  });

  it.each(["disabled", "security-version", "absolute-expiry"] as const)(
    "still rejects both methods after %s",
    async (change) => {
      const f = await fixture();
      const sessions = [await f.passwordLogin(), await f.oidcLogin()];
      if (change === "disabled")
        f.database.users.setStatus(
          "user_owner",
          "disabled",
          new Date().toISOString(),
        );
      else if (change === "security-version")
        f.database.users.incrementSecurityVersion(
          "user_owner",
          new Date().toISOString(),
        );
      else
        f.database.raw
          .prepare("UPDATE web_sessions SET absolute_expires_at=?")
          .run(new Date(Date.now() - 1000).toISOString());
      for (const session of sessions)
        expect(
          f.service.authenticateSession(request(session.token)),
        ).toBeUndefined();
    },
  );

  it("changing to Access rejects both native sessions and never trusts an Access header in native mode", async () => {
    const f = await fixture();
    const sessions = [await f.passwordLogin(), await f.oidcLogin()];
    await expect(
      f.service.authenticate(
        new Request(`${origin}/app/`, {
          headers: { "Cf-Access-Jwt-Assertion": "not-trusted" },
        }),
      ),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    const access = new BrowserAuthenticationService({
      database: f.database,
      mode: "cloudflare-access",
      publicOrigin: origin,
      access: new AccessJwtVerifier(
        "https://fixture.cloudflareaccess.com",
        "a".repeat(64),
      ),
      scryptLogN: 12,
    });
    for (const session of sessions)
      expect(
        access.authenticateSession(request(session.token)),
      ).toBeUndefined();
  });

  it("does not bind OIDC to an existing password user by matching email", async () => {
    const f = await fixture("unprovisioned-subject");
    await expect(f.oidcLogin()).rejects.toMatchObject({
      code: "IDENTITY_NOT_PROVISIONED",
      status: 403,
    });
    expect(f.database.browserAuth.identitiesForUser("user_owner")).toHaveLength(
      1,
    );
    expect(
      f.database.raw
        .prepare("SELECT count(*) AS count FROM web_sessions")
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("exposes only safe configured methods and retains legacy configuration fields", async () => {
    const f = await fixture();
    const response = await f.app.request("/auth/config");
    expect(response.status).toBe(200);
    const configuration = (await response.json()) as unknown;
    expect(configuration).toMatchObject({
      backend: "native",
      mode: "native",
      methods: [
        { id: "password" },
        { id: "oidc", displayName: "School Account" },
      ],
      loginPath: "/login/",
      passwordMinimumLength: 12,
    });
    expect(JSON.stringify(configuration)).not.toMatch(
      /secret-marker|pepper|clientId|identity\.example\.test/,
    );
    expect(
      f
        .withSelection({
          backend: "native",
          passwordEnabled: false,
          oidcEnabled: true,
        })
        .configuration(),
    ).toMatchObject({
      mode: "oidc",
      methods: [{ id: "oidc", displayName: "OIDC" }],
      loginPath: "/auth/oidc/start",
      passwordMinimumLength: null,
    });
    expect(
      f
        .withSelection({
          backend: "native",
          passwordEnabled: true,
          oidcEnabled: false,
        })
        .configuration(),
    ).toMatchObject({
      mode: "password",
      methods: [{ id: "password" }],
      passwordMinimumLength: 12,
    });
    const copy = f.service.configuration();
    copy.methods.length = 0;
    expect(f.service.configuration().methods).toHaveLength(2);
  });

  it("keeps Origin/CSRF and password rate limits independent of enabling OIDC", async () => {
    const f = await fixture();
    await expect(
      f.service.loginPassword({
        ...loginInput(),
        request: new Request(`${origin}/auth/password/login`, {
          headers: { Origin: "https://elsewhere.example.test" },
        }),
      }),
    ).rejects.toMatchObject({ code: "ORIGIN_REJECTED" });
    const session = await f.passwordLogin();
    expect(() =>
      f.service.requireMutationCsrf(request(session.token), session.principal),
    ).toThrow(/Origin/);
    for (let i = 0; i < 5; i++)
      await expect(
        f.service.loginPassword({
          ...loginInput(),
          password: "wrong-password",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(f.passwordLogin()).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      status: 429,
    });
    expect((await f.oidcLogin()).principal.authMode).toBe("oidc");
  });

  it("still lets an owner reset a password and revokes both methods by security version", async () => {
    const f = await fixture();
    const first = await f.passwordLogin();
    const sessions = [first, await f.oidcLogin()];
    const result = await f.app.request(
      "/admin/api/v1/users/user_owner/password",
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${first.token}; ${CSRF_COOKIE}=${first.csrfToken}`,
          "X-CSRF-Token": first.csrfToken,
        },
        body: JSON.stringify({
          loginName: "owner",
          password: "a replacement horse battery staple 2026",
          reason: "fixture reset",
        }),
      },
    );
    expect(result.status).toBe(200);
    for (const session of sessions)
      expect(
        f.service.authenticateSession(request(session.token)),
      ).toBeUndefined();
  });

  it.each(["password", "external"] as const)(
    "allows an owner to provision an enabled %s method",
    async (type) => {
      const f = await fixture();
      const session = await f.passwordLogin();
      const result = await f.app.request("/admin/api/v1/users", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${session.token}; ${CSRF_COOKIE}=${session.csrfToken}`,
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          displayName: "Another User",
          role: "user",
          authentication:
            type === "password"
              ? { type, loginName: "another", password }
              : { type, subject: "another-subject" },
        }),
      });
      expect(result.status).toBe(201);
    },
  );

  it("rejects environment opt-in before reading secrets or mutating the database", () => {
    const database = new RendererDatabase(":memory:");
    databases.push(database);
    database.migrate();
    expect(() =>
      createBrowserAuthenticationFromEnvironment(database, undefined, {
        DEPLOYMENT_MODE: "standalone",
        PUBLIC_ORIGIN: origin,
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: "true",
        AUTH_OIDC_ENABLED: "true",
        OIDC_CLIENT_SECRET_FILE: "/must-not-be-read",
      }),
    ).toThrow(/not deployable yet/);
    expect(
      database.raw
        .prepare("SELECT count(*) AS count FROM user_identities")
        .get(),
    ).toMatchObject({ count: 0 });
  });
});

async function fixture(providerSubject = "owner-subject") {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  database.users.insertInvitation({
    id: "user_owner",
    email: "same@example.test",
    displayName: "Fixture Owner",
    role: "owner",
    createdBy: "fixture",
    timestamp: new Date().toISOString(),
  });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "fixture-key",
    alg: "RS256",
    use: "sig",
  };
  let nonce = "";
  const oidc = new OidcClient({
    issuer,
    clientId: "fixture-client",
    clientSecret: "fixture-client-secret-marker",
    publicOrigin: origin,
    fetchImpl: async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/token`)
        return Response.json({
          id_token: await new SignJWT({ nonce, email: "same@example.test" })
            .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
            .setIssuer(issuer)
            .setSubject(providerSubject)
            .setAudience("fixture-client")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(privateKey),
        });
      throw new Error("Unexpected fixture provider request");
    },
  });
  const withSelection = (selection: BrowserAuthenticationSelection) =>
    new BrowserAuthenticationService({
      database,
      selection,
      publicOrigin: origin,
      oidc,
      passwordPepper: Buffer.alloc(32, 7),
      scryptLogN: 12,
    });
  const service = withSelection({ ...dual, oidcDisplayName: "School Account" });
  await service.createPasswordCredential({
    userId: "user_owner",
    loginName: "owner",
    password,
  });
  service.createExternalIdentity({
    userId: "user_owner",
    subject: "owner-subject",
    email: "same@example.test",
  });
  const app = createAdminApp({
    database,
    apiKeys: new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 1)]]),
      "v1",
    ),
    browserAuth: service,
    deploymentMode: "standalone",
    publicOrigin: origin,
    allowedOrigins: new Set([origin]),
    writeEnabled: true,
    storageRoot: "/nonexistent",
    rendererVersion: "fixture",
    maxOutputBytes: 1,
    maxQueueLength: 10,
    maxUserStorageBytes: 1024,
    minFreeStorageBytes: 1,
    activeTicketKid: "v1",
    verificationTicketKids: [],
  });
  const oidcLogin = async (authentication = service) => {
    const flow = await authentication.beginOidc("/app/", "192.0.2.10");
    nonce = new URL(flow.authorizationUrl).searchParams.get("nonce") ?? "";
    return authentication.finishOidc({
      code: "fixture-code",
      state: flow.state,
      stateCookie: flow.state,
      request: new Request(`${origin}/auth/oidc/callback`),
    });
  };
  return {
    database,
    service,
    app,
    oidc,
    withSelection,
    oidcLogin,
    passwordLogin: () => service.loginPassword(loginInput()),
  };
}
function request(token: string) {
  return new Request(`${origin}/app/`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });
}
function loginInput() {
  return {
    loginName: "owner",
    password,
    ipAddress: "192.0.2.10",
    request: new Request(`${origin}/auth/password/login`, {
      headers: { Origin: origin },
    }),
  };
}
