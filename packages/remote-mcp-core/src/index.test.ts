import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RendererDatabase } from "@latex-renderer/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteOAuthService, RemoteRenderService } from "./index.js";

const databases: RendererDatabase[] = [];
const temporary: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Remote MCP core", () => {
  it("bounds reply retention to 128 families without revoking an evicted family", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    for (let i = 0; i < 128; i++) {
      const redirect = f.oauth.authorize("user_test", {
        clientId: f.exchangeInput.clientId,
        redirectUri: f.exchangeInput.redirectUri,
        scopes: ["mcp:read"],
        resource: f.exchangeInput.resource,
        codeChallenge: createHash("sha256")
          .update(f.exchangeInput.codeVerifier)
          .digest("base64url"),
      });
      const token = f.oauth.exchangeAuthorizationCode({
        ...f.exchangeInput,
        code: redirect.searchParams.get("code") as string,
      });
      f.refresh(token.refresh_token);
    }
    expect(() => f.refresh(f.tokens.refresh_token)).toThrow(
      expect.objectContaining({ code: "OAUTH_REFRESH_RETRY" }),
    );
    expect(f.oauth.verifyAccessToken(first.access_token)).toBeDefined();
  });
  it("discards retained replies at the deadline even without another request", () => {
    vi.useFakeTimers();
    const f = refreshFixture();
    f.refresh(f.tokens.refresh_token);
    expect(vi.getTimerCount()).toBe(1);
    f.now.value += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not replay an explicitly revoked family", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    const row = f.database.remoteMcp.token(
      createHash("sha256").update(first.refresh_token).digest("hex"),
    );
    if (!row) throw new Error("Missing fixture token");
    f.database.remoteMcp.revokeFamily(
      row.family_id,
      new Date(f.now.value).toISOString(),
    );
    expect(() => f.refresh(f.tokens.refresh_token)).toThrow(
      "expired or revoked",
    );
    expect(() => f.oauth.verifyAccessToken(first.access_token)).toThrow();
  });
  it("recovers a lost rotation response after 17 seconds without issuing or extending tokens", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    const count = f.database.raw
      .prepare("SELECT COUNT(*) AS n FROM remote_mcp_tokens")
      .get();
    f.now.value += 17_000;
    const retried = f.refresh(f.tokens.refresh_token);
    expect(retried).toMatchObject({
      access_token: first.access_token,
      refresh_token: first.refresh_token,
      expires_in: 583,
    });
    expect(
      f.database.raw
        .prepare("SELECT COUNT(*) AS n FROM remote_mcp_tokens")
        .get(),
    ).toEqual(count);
    expect(f.events.map((e) => e.outcome)).toEqual([
      "authorized",
      "issued",
      "replayed",
    ]);
    expect(JSON.stringify(f.events)).not.toContain(first.refresh_token);
  });
  it("merges interleaved retries into the latest still-usable successor", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    f.now.value += 2000;
    const second = f.refresh(first.refresh_token);
    expect(f.refresh(f.tokens.refresh_token)).toMatchObject({
      access_token: second.access_token,
      refresh_token: second.refresh_token,
    });
    expect(f.oauth.verifyAccessToken(second.access_token)).toBeDefined();
  });
  it("does not slide the original replay deadline after successful retries", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    f.now.value += 29_000;
    expect(f.refresh(f.tokens.refresh_token).refresh_token).toBe(
      first.refresh_token,
    );
    f.now.value += 1000;
    expect(() => f.refresh(f.tokens.refresh_token)).toThrow("reuse revoked");
    expect(() => f.oauth.verifyAccessToken(first.access_token)).toThrow(
      "invalid",
    );
  });
  it("checks client/resource binding before replay and does not revoke another grant", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    expect(() =>
      f.oauth.refresh({
        refreshToken: f.tokens.refresh_token,
        clientId: "wrong",
        resource: f.exchangeInput.resource,
      }),
    ).toThrow("binding");
    expect(() =>
      f.oauth.refresh({
        refreshToken: f.tokens.refresh_token,
        clientId: f.exchangeInput.clientId,
        resource: "https://other.example/mcp",
      }),
    ).toThrow("binding");
    expect(f.oauth.verifyAccessToken(first.access_token)).toBeDefined();
  });
  it("never replays a reply after subject security changes or explicit revocation", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    f.database.users.incrementSecurityVersion(
      "user_test",
      new Date(f.now.value).toISOString(),
    );
    expect(() => f.refresh(f.tokens.refresh_token)).toThrow(
      "User authorization changed",
    );
    expect(() => f.oauth.verifyAccessToken(first.access_token)).toThrow();
  });
  it("returns a retryable failure after a process-local reply is lost, preserving the durable grant", () => {
    const f = refreshFixture(),
      first = f.refresh(f.tokens.refresh_token);
    const restarted = new RemoteOAuthService(
      f.database,
      "https://latex.example.com",
      f.exchangeInput.resource,
      () => f.now.value,
    );
    expect(() =>
      restarted.refresh({
        refreshToken: f.tokens.refresh_token,
        clientId: f.exchangeInput.clientId,
        resource: f.exchangeInput.resource,
      }),
    ).toThrow(
      expect.objectContaining({ code: "OAUTH_REFRESH_RETRY", status: 503 }),
    );
    expect(restarted.verifyAccessToken(first.access_token)).toBeDefined();
    expect(
      restarted.refresh({
        refreshToken: first.refresh_token,
        clientId: f.exchangeInput.clientId,
        resource: f.exchangeInput.resource,
      }).refresh_token,
    ).not.toBe(first.refresh_token);
  });
  it("uses Authorization Code + PKCE and revokes a reused refresh family", () => {
    const database = seededDatabase(),
      now = { value: Date.parse("2026-08-12T00:00:00.000Z") },
      oauth = new RemoteOAuthService(
        database,
        "https://latex.example.com",
        "https://latex.example.com/mcp",
        () => now.value,
      ),
      client = oauth.registerClient({
        clientName: "Test MCP client",
        redirectUris: ["http://127.0.0.1:49152/callback"],
      }),
      verifier = "v".repeat(64),
      challenge = createHash("sha256").update(verifier).digest("base64url"),
      params = new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: "http://127.0.0.1:49152/callback",
        scope: "mcp:render mcp:read",
        resource: "https://latex.example.com/mcp",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "state-value",
      }),
      request = oauth.validateAuthorizationRequest(params),
      redirect = oauth.authorize("user_test", request),
      tokens = oauth.exchangeAuthorizationCode({
        code: redirect.searchParams.get("code") as string,
        clientId: client.clientId,
        redirectUri: redirect.origin + redirect.pathname,
        codeVerifier: verifier,
        resource: "https://latex.example.com/mcp",
      });

    expect(oauth.verifyAccessToken(tokens.access_token)).toMatchObject({
      userId: "user_test",
      resource: "https://latex.example.com/mcp",
      scopes: ["mcp:render", "mcp:read"],
    });
    const rotated = oauth.refresh({
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      resource: "https://latex.example.com/mcp",
    });
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect(
      oauth.refresh({
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        resource: "https://latex.example.com/mcp",
      }),
    ).toMatchObject({
      access_token: rotated.access_token,
      refresh_token: rotated.refresh_token,
    });
    // A concurrent retry must not revoke the family that already produced a
    // valid replacement. A later replay still exercises strict reuse detection.
    expect(oauth.verifyAccessToken(rotated.access_token)).toBeDefined();
    now.value += 31_000;
    expect(() =>
      oauth.refresh({
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        resource: "https://latex.example.com/mcp",
      }),
    ).toThrow("Refresh token reuse revoked the grant");
    expect(() => oauth.verifyAccessToken(rotated.access_token)).toThrow(
      "Access token is invalid",
    );
  });

  it("rejects an authorization code after the user's security version changes", () => {
    const fixture = authorizationFixture();
    fixture.database.users.incrementSecurityVersion(
      "user_test",
      "2026-08-12T00:01:00.000Z",
    );

    expect(() =>
      fixture.oauth.exchangeAuthorizationCode(fixture.exchangeInput),
    ).toThrow("User authorization changed");
    expect(
      fixture.database.remoteMcp.authorizationCode(
        createHash("sha256").update(fixture.exchangeInput.code).digest("hex"),
      )?.used_at,
    ).toBeNull();
    expect(
      (
        fixture.database.raw
          .prepare("SELECT COUNT(*) AS count FROM remote_mcp_token_families")
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });

  it("rolls back code and token rows when client activity tracking fails", () => {
    const fixture = authorizationFixture();
    const touchClient = vi
      .spyOn(fixture.database.remoteMcp, "touchClient")
      .mockImplementation(() => {
        throw new Error("touch client failed");
      });

    expect(() =>
      fixture.oauth.exchangeAuthorizationCode(fixture.exchangeInput),
    ).toThrow("touch client failed");
    expect(
      fixture.database.remoteMcp.authorizationCode(
        createHash("sha256").update(fixture.exchangeInput.code).digest("hex"),
      )?.used_at,
    ).toBeNull();
    expect(
      (
        fixture.database.raw
          .prepare("SELECT COUNT(*) AS count FROM remote_mcp_token_families")
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        fixture.database.raw
          .prepare("SELECT COUNT(*) AS count FROM remote_mcp_tokens")
          .get() as { count: number }
      ).count,
    ).toBe(0);

    touchClient.mockRestore();
    expect(() =>
      fixture.oauth.exchangeAuthorizationCode(fixture.exchangeInput),
    ).not.toThrow();
  });

  it.each(["active", "disabled"] as const)(
    "creates a separate MCP principal when an %s user account already has its display name",
    async (status) => {
      const database = seededDatabase(),
        storage = await mkdtemp(join(tmpdir(), "remote-mcp-name-"));
      temporary.push(storage);
      database.serviceAccounts.insert({
        id: "sa_user_named_remote",
        ownerUserId: "user_test",
        name: "Remote MCP",
        clientType: "generic",
        timestamp: new Date().toISOString(),
      });
      if (status === "disabled")
        database.serviceAccounts.setStatus(
          "sa_user_named_remote",
          status,
          new Date().toISOString(),
        );
      const before = database.serviceAccounts.get("sa_user_named_remote"),
        service = new RemoteRenderService(
          database,
          storage,
          "renderer:test",
          "https://latex.example.com",
        ),
        identity = { userId: "user_test", scopes: ["mcp:render"] as const },
        input = {
          inlineSource:
            "\\documentclass{article}\\begin{document}ok\\end{document}",
          entrypoint: "main.tex",
        };
      const first = await service.createRender(identity, input),
        principal = database.remoteMcp.principal("user_test");
      if (!principal) throw new Error("Missing MCP principal");
      expect(first.status).toBe("queued");
      expect(principal.service_account_id).not.toBe("sa_user_named_remote");
      expect(
        database.serviceAccounts.get(principal.service_account_id)?.name,
      ).toBe(`Remote MCP (${principal.service_account_id})`);
      expect(database.serviceAccounts.get("sa_user_named_remote")).toEqual(
        before,
      );
      await service.createRender(identity, input);
      expect(database.remoteMcp.principal("user_test")).toEqual(principal);
      expect(database.serviceAccounts.get("sa_user_named_remote")).toEqual(
        before,
      );
    },
  );

  it("renders small inline source without creating an external API key", async () => {
    const database = seededDatabase(),
      storage = await mkdtemp(join(tmpdir(), "remote-mcp-core-"));
    temporary.push(storage);
    const service = new RemoteRenderService(
        database,
        storage,
        "renderer:test",
        "https://latex.example.com",
      ),
      job = await service.createRender(
        { userId: "user_test", scopes: ["mcp:render"] },
        {
          inlineSource:
            "\\documentclass{article}\\begin{document}ok\\end{document}",
          entrypoint: "report.tex",
        },
      );

    expect(job).toMatchObject({ status: "queued", entrypoint: "report.tex" });
    const principal = database.remoteMcp.principal("user_test");
    expect(principal).toBeDefined();
    const accounting = database.apiKeys.get(principal?.api_key_id ?? "");
    expect(accounting?.prefix).toMatch(/^oauth_/);
    expect(accounting?.scopes_json).toBe('["oauth:mcp"]');
    expect(accounting?.prefix).not.toMatch(/^lr[ak]_/);
  });

  it("keeps hosted Source references owner-scoped and short-lived", () => {
    const database = seededDatabase(),
      timestamp = "2026-08-12T00:00:00.000Z";
    database.sources.insertReserved({
      id: `source_${"1".repeat(32)}`,
      ownerUserId: "user_test",
      size: 10,
      sha256: "a".repeat(64),
      storageKey: "sources/test/source.zip",
      timestamp,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    database.sources.transition(
      `source_${"1".repeat(32)}`,
      ["reserved"],
      "ready",
      timestamp,
      { uploaded_at: timestamp, paths_json: '["main.tex"]' },
    );
    const service = new RemoteRenderService(
        database,
        "/tmp/not-used",
        "renderer:test",
        "https://latex.example.com",
      ),
      reference = service.createSourceRef(
        "user_test",
        `source_${"1".repeat(32)}`,
      );

    expect(reference.sourceRef).toMatch(/^source_ref_[a-f0-9]{32}$/);
    expect(
      database.remoteMcp.sourceRef(
        reference.sourceRef,
        "different-user",
        timestamp,
      ),
    ).toBeUndefined();
    const audit = database.raw
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE action='source_ref.created'",
      )
      .get() as { metadata_json: string };
    expect(audit.metadata_json).not.toContain(reference.sourceRef);
  });
});

function authorizationFixture(
  clock = () => Date.parse("2026-08-12T00:00:00.000Z"),
  diagnostic: ConstructorParameters<typeof RemoteOAuthService>[4] = () => {},
): {
  database: RendererDatabase;
  oauth: RemoteOAuthService;
  exchangeInput: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
  };
} {
  const database = seededDatabase(),
    oauth = new RemoteOAuthService(
      database,
      "https://latex.example.com",
      "https://latex.example.com/mcp",
      clock,
      diagnostic,
    ),
    client = oauth.registerClient({
      clientName: "Test MCP client",
      redirectUris: ["http://127.0.0.1:49152/callback"],
    }),
    codeVerifier = "v".repeat(64),
    codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url"),
    request = oauth.validateAuthorizationRequest(
      new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: "http://127.0.0.1:49152/callback",
        scope: "mcp:render mcp:read",
        resource: "https://latex.example.com/mcp",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }),
    ),
    redirect = oauth.authorize("user_test", request),
    code = redirect.searchParams.get("code");
  if (code === null) throw new Error("authorization code was not issued");
  return {
    database,
    oauth,
    exchangeInput: {
      code,
      clientId: client.clientId,
      redirectUri: redirect.origin + redirect.pathname,
      codeVerifier,
      resource: "https://latex.example.com/mcp",
    },
  };
}

function refreshFixture() {
  const now = { value: Date.parse("2026-08-12T00:00:00.000Z") };
  const events: Array<
    Parameters<
      NonNullable<ConstructorParameters<typeof RemoteOAuthService>[4]>
    >[0]
  > = [];
  const f = authorizationFixture(
    () => now.value,
    (e) => events.push(e),
  );
  const tokens = f.oauth.exchangeAuthorizationCode(f.exchangeInput);
  return {
    ...f,
    now,
    events,
    tokens,
    refresh: (refreshToken: string) =>
      f.oauth.refresh({
        refreshToken,
        clientId: f.exchangeInput.clientId,
        resource: f.exchangeInput.resource,
      }),
  };
}

function seededDatabase(): RendererDatabase {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  database.users.insertInvitation({
    id: "user_test",
    email: "user@example.test",
    displayName: "Test User",
    role: "admin",
    createdBy: "test",
    timestamp: "2026-08-12T00:00:00.000Z",
  });
  database.raw
    .prepare(
      `UPDATE users SET access_subject='access-subject',access_subject_linked_at=?
       WHERE id='user_test'`,
    )
    .run("2026-08-12T00:00:00.000Z");
  return database;
}
