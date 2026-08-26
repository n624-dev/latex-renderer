import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RendererDatabase } from "@latex-renderer/database";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteOAuthService, RemoteRenderService } from "./index.js";

const databases: RendererDatabase[] = [];
const temporary: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Remote MCP core", () => {
  it("uses Authorization Code + PKCE and revokes a reused refresh family", () => {
    const database = seededDatabase(),
      now = Date.parse("2026-08-12T00:00:00.000Z"),
      oauth = new RemoteOAuthService(
        database,
        "https://latex.example.com",
        "https://latex.example.com/mcp",
        () => now,
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
    expect(() =>
      oauth.refresh({
        refreshToken: tokens.refresh_token,
        clientId: client.clientId,
        resource: "https://latex.example.com/mcp",
      }),
    ).toThrowError("Refresh token reuse revoked the grant");
    expect(() => oauth.verifyAccessToken(rotated.access_token)).toThrowError(
      "Access token is invalid",
    );
  });

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
      expiresAt: "2026-08-13T00:00:00.000Z",
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
