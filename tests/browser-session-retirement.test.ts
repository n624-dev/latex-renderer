import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccessJwtVerifier,
  BrowserAuthenticationService,
  createBrowserAuthenticationFromEnvironment,
  OidcClient,
  SESSION_COOKIE,
} from "@latex-renderer/auth";
import {
  RendererDatabase,
  type BrowserAuthMode,
  type ExternalIdentityProvider,
} from "@latex-renderer/database";

const origin = "https://renderer.example.test";
const issuer = "https://id.example.test/tenant";
const accessIssuer = "https://fixture.cloudflareaccess.com";
const timestamp = new Date().toISOString();
const databases = new Set<RendererDatabase>();
const directories: string[] = [];
afterEach(() => {
  for (const database of databases) database.close();
  databases.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
  vi.restoreAllMocks();
});

describe("durable browser-session policy retirement", () => {
  it.each(["password", "oidc", "cloudflare-access", "native"] as const)(
    "retires never-used incompatible sessions under %s, retaining the enabled methods",
    (mode) => {
      const database = fixture();
      const before = snapshot(database);
      const authentication = service(database, mode);
      // Construction alone is also used by the local password CLI.
      expect(snapshot(database)).toEqual(before);
      const retained = mode === "native" ? ["password", "oidc"] : [mode];
      expect(authentication.retireIncompatibleSessions()).toBe(
        3 - retained.length,
      );
      for (const method of methods)
        expect(database.browserAuth.getSession(hash(method))?.revoked_at).toBe(
          retained.includes(method) ? null : timestamp,
        );
      expect(authentication.retireIncompatibleSessions()).toBe(0);
      expect(audits(database)).toHaveLength(1);
      // The constructor used for password hashing must not discard OIDC/Access.
      service(database, "password");
      for (const method of retained)
        expect(
          database.browserAuth.getSession(hash(method))?.revoked_at,
        ).toBeNull();
    },
  );

  it.each(["password", "oidc"] as const)(
    "does not revive an unused %s session after disable, DB reopen, and re-enable",
    (disabled) => {
      const directory = tempDirectory();
      const path = join(directory, "fixture.sqlite");
      const database = fixture(path);
      const retained = disabled === "password" ? "oidc" : "password";
      service(database, retained).retireIncompatibleSessions();
      database.close();
      databases.delete(database);
      const reopened = new RendererDatabase(path);
      databases.add(reopened);
      const enabledAgain = service(reopened, "native");
      expect(enabledAgain.retireIncompatibleSessions()).toBe(0);
      expect(reopened.browserAuth.getSession(hash(disabled))?.revoked_at).toBe(
        timestamp,
      );
      expect(
        enabledAgain.authenticateSession(request(disabled)),
      ).toBeUndefined();
      expect(
        enabledAgain.authenticateSession(request(retained))?.authMode,
      ).toBe(retained);
    },
  );

  it.each(["oidc", "cloudflare-access"] as const)(
    "an issuer change permanently retires unused %s sessions, even if the issuer is restored",
    (method) => {
      const database = fixture();
      const nextIssuer = "https://other.example.test";
      const changed =
        method === "oidc"
          ? service(database, "native", nextIssuer)
          : service(database, "cloudflare-access", nextIssuer);
      changed.retireIncompatibleSessions();
      expect(database.browserAuth.getSession(hash(method))?.revoked_at).toBe(
        timestamp,
      );
      if (method === "oidc")
        expect(
          database.browserAuth.getSession(hash("password"))?.revoked_at,
        ).toBeNull();
      const restored = service(database, method === "oidc" ? "native" : method);
      expect(restored.retireIncompatibleSessions()).toBe(0);
      expect(restored.authenticateSession(request(method))).toBeUndefined();
    },
  );

  it("retires malformed or cross-user identity provenance without touching valid native sessions", () => {
    const database = fixture();
    database.users.insertInvitation({
      id: "user_other",
      displayName: "Other",
      role: "user",
      createdBy: "fixture",
      timestamp,
    });
    identity(database, "other_identity", "oidc", issuer, "user_other");
    session(database, "wrong-user", "oidc", "other_identity");
    session(database, "wrong-provider", "oidc", "identity_cloudflare-access");
    session(database, "missing-identity", "oidc", null);
    session(database, "password-with-identity", "password", "identity_oidc");
    session(
      database,
      "already-revoked",
      "oidc",
      null,
      "2026-01-01T00:00:00.000Z",
    );
    expect(service(database, "native").retireIncompatibleSessions()).toBe(5);
    for (const token of [
      "wrong-user",
      "wrong-provider",
      "missing-identity",
      "password-with-identity",
    ])
      expect(database.browserAuth.getSession(hash(token))?.revoked_at).toBe(
        timestamp,
      );
    expect(
      database.browserAuth.getSession(hash("already-revoked"))?.revoked_at,
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(
      database.browserAuth.getSession(hash("password"))?.revoked_at,
    ).toBeNull();
    expect(
      database.browserAuth.getSession(hash("oidc"))?.revoked_at,
    ).toBeNull();
  });

  it("rolls retirement back on an audit write failure, then safely retries", () => {
    const database = fixture();
    const before = snapshot(database);
    const authentication = service(database, "password");
    database.raw
      .exec(`CREATE TRIGGER reject_auth_audit BEFORE INSERT ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END`);
    expect(() => authentication.retireIncompatibleSessions()).toThrow(
      "fixture audit unavailable",
    );
    expect(snapshot(database)).toEqual(before);
    database.raw.exec("DROP TRIGGER reject_auth_audit");
    expect(authentication.retireIncompatibleSessions()).toBe(2);
    expect(audits(database)).toHaveLength(1);
    const audit = audits(database)[0] as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toEqual({
      count: 2,
      passwordEnabled: true,
      externalProvider: null,
    });
    expect(audit.metadata_json).not.toMatch(
      /token|subject|pepper|secret|https:/,
    );
  });

  it.each(["password", "oidc", "cloudflare-access"] as const)(
    "the production %s factory retires sessions before returning, idempotently for Admin and Remote MCP",
    (mode) => {
      const database = fixture();
      const environment = environmentFor(mode);
      // No discovery, JWKS or other external network is needed for retirement.
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network forbidden"));
      for (const audienceVariable of [
        "CLOUDFLARE_ADMIN_AUDIENCE",
        "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
      ])
        expect(
          createBrowserAuthenticationFromEnvironment(
            database,
            audienceVariable,
            environment,
          ).browserAuth.mode,
        ).toBe(mode);
      for (const method of methods)
        expect(
          database.browserAuth.getSession(hash(method))?.revoked_at === null,
        ).toBe(method === mode);
      expect(audits(database)).toHaveLength(1);
      expect(network).not.toHaveBeenCalled();
    },
  );

  it("a retirement failure prevents the factory returning a usable service", () => {
    const database = fixture();
    const before = snapshot(database);
    database.raw
      .exec(`CREATE TRIGGER reject_retirement BEFORE UPDATE OF revoked_at ON web_sessions
      BEGIN SELECT RAISE(ABORT, 'fixture database unavailable'); END`);
    expect(() =>
      createBrowserAuthenticationFromEnvironment(
        database,
        undefined,
        environmentFor("password"),
      ),
    ).toThrow("fixture database unavailable");
    expect(snapshot(database)).toEqual(before);
    expect(audits(database)).toHaveLength(0);
  });

  it.each(["missing-secret", "invalid-origin", "new-model-gated"] as const)(
    "invalid configuration (%s) does not retire sessions",
    (failure) => {
      const database = fixture();
      const before = snapshot(database);
      const environment = environmentFor("password");
      if (failure === "missing-secret")
        environment.AUTH_PASSWORD_PEPPER_FILE =
          "/does-not-exist/auth-fixture-pepper";
      else if (failure === "invalid-origin")
        environment.PUBLIC_ORIGIN = "http://insecure.example.test";
      else {
        delete environment.AUTH_MODE;
        environment.AUTH_BACKEND = "native";
        environment.AUTH_PASSWORD_ENABLED = "true";
        environment.AUTH_OIDC_ENABLED = "true";
      }
      expect(() =>
        createBrowserAuthenticationFromEnvironment(
          database,
          undefined,
          environment,
        ),
      ).toThrow();
      expect(snapshot(database)).toEqual(before);
      expect(audits(database)).toHaveLength(0);
    },
  );
});

const methods = ["password", "oidc", "cloudflare-access"] as const;
function fixture(path = ":memory:") {
  const database = new RendererDatabase(path);
  databases.add(database);
  database.migrate();
  database.users.insertInvitation({
    id: "user_owner",
    displayName: "Owner",
    role: "owner",
    createdBy: "fixture",
    timestamp,
  });
  identity(database, "identity_oidc", "oidc", issuer);
  identity(
    database,
    "identity_cloudflare-access",
    "cloudflare-access",
    accessIssuer,
  );
  for (const method of methods)
    session(
      database,
      method,
      method,
      method === "password" ? null : `identity_${method}`,
    );
  return database;
}
function service(
  database: RendererDatabase,
  mode: BrowserAuthMode | "native",
  externalIssuer?: string,
) {
  const common = {
    database,
    publicOrigin: origin,
    passwordPepper: Buffer.alloc(32, 7),
    scryptLogN: 12,
    now: () => new Date(timestamp),
    oidc: new OidcClient({
      issuer: externalIssuer ?? issuer,
      clientId: "fixture",
      clientSecret: "synthetic-fixture-secret",
      publicOrigin: origin,
    }),
    access: new AccessJwtVerifier(
      externalIssuer ?? accessIssuer,
      "fixture-audience",
    ),
  };
  return new BrowserAuthenticationService(
    mode === "native"
      ? {
          ...common,
          selection: {
            backend: "native",
            passwordEnabled: true,
            oidcEnabled: true,
          },
        }
      : { ...common, mode },
  );
}
function identity(
  database: RendererDatabase,
  id: string,
  provider: ExternalIdentityProvider,
  externalIssuer: string,
  userId = "user_owner",
) {
  database.browserAuth.insertIdentity({
    id,
    user_id: userId,
    provider,
    issuer: externalIssuer,
    subject: `fixture-subject-${id}`,
    preferred_username: null,
    email_at_provider: null,
    linked_at: timestamp,
    last_seen_at: timestamp,
  });
}
function token(label: string) {
  return createHash("sha256").update(label).digest("base64url");
}
function hash(label: string) {
  return createHash("sha256").update(token(label)).digest("hex");
}
function session(
  database: RendererDatabase,
  label: string,
  method: BrowserAuthMode,
  identityId: string | null,
  revokedAt: string | null = null,
) {
  database.browserAuth.insertSession({
    token_hash: hash(label),
    user_id: "user_owner",
    auth_mode: method,
    identity_id: identityId,
    user_security_version: 1,
    csrf_hash: "c".repeat(64),
    created_at: timestamp,
    last_seen_at: timestamp,
    idle_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    absolute_expires_at: new Date(
      Date.now() + 8 * 60 * 60 * 1000,
    ).toISOString(),
    revoked_at: revokedAt,
  });
}
function request(label: string) {
  return new Request(`${origin}/app/`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token(label)}` },
  });
}
function snapshot(database: RendererDatabase) {
  return database.raw
    .prepare("SELECT * FROM web_sessions ORDER BY token_hash")
    .all();
}
function audits(database: RendererDatabase) {
  return database.raw
    .prepare(
      "SELECT metadata_json FROM audit_logs WHERE action='auth.sessions-retired'",
    )
    .all();
}
function tempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "browser-retirement-fixture-"));
  directories.push(directory);
  return directory;
}
function environmentFor(mode: BrowserAuthMode): NodeJS.ProcessEnv {
  const directory = tempDirectory();
  const pepperPath = join(directory, "pepper");
  const secretPath = join(directory, "oidc-secret");
  writeFileSync(pepperPath, Buffer.alloc(32, 7), { mode: 0o600 });
  writeFileSync(secretPath, "synthetic-fixture-secret", { mode: 0o600 });
  return {
    DEPLOYMENT_MODE: mode === "cloudflare-access" ? "cloudflare" : "standalone",
    PUBLIC_ORIGIN: origin,
    AUTH_MODE: mode,
    AUTH_PASSWORD_PEPPER_FILE: pepperPath,
    OIDC_CLIENT_SECRET_FILE: secretPath,
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: "fixture",
    CLOUDFLARE_ACCESS_ISSUER: accessIssuer,
    CLOUDFLARE_ADMIN_AUDIENCE: "admin-fixture-audience",
    CLOUDFLARE_REMOTE_MCP_AUDIENCE: "remote-fixture-audience",
  };
}
