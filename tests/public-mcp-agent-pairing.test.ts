import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GatewayAgentPairing,
  pairingLifetimeMs,
} from "../apps/public-mcp-gateway/src/agent-pairing.js";
import { GatewayOAuthTokens } from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

const issuer = "https://gateway.example.com";
const verifier = "x".repeat(43);
const request = {
  clientId: "chat-client",
  redirectUri: "https://client.example.com/callback",
  resource: `${issuer}/mcp`,
  codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  state: "client-state",
  scopes: ["mcp:read", "mcp:render"] as const,
};

function fixture() {
  const store = new SqliteConnectionStore(":memory:");
  let now = 1000;
  const clock = () => now;
  const pairing = new GatewayAgentPairing(
    store.agentPairing,
    Buffer.alloc(32, 6),
    { perTransport: 2, perInstance: 3, total: 10 },
    clock,
  );
  const tokens = new GatewayOAuthTokens(
    issuer,
    store.oauth,
    Buffer.alloc(32, 7),
    60_000,
    clock,
  );
  store.putVerifiedInstance({ id: "one", publicKey: "instance-one" });
  store.putVerifiedInstance({ id: "two", publicKey: "instance-two" });
  function register(instanceId: string, publicKey: string) {
    const transport = store.addTransport(instanceId, {
      kind: "agent",
      publicKey,
    });
    return { instanceId, publicKey, transportId: transport.id };
  }
  const first = register("one", "agent-one");
  const second = register("two", "agent-two");
  const session = tokens.beginConsent(request, {
    lifetimeMs: 600_000,
    capacity: 5,
  });
  const code = pairing.start(session, request);
  return {
    store,
    pairing,
    tokens,
    first,
    second,
    session,
    code,
    register,
    advance: (delta: number) => {
      now += delta;
    },
    [Symbol.dispose]: () => store.close(),
  };
}

describe("agent pairing", () => {
  it("requires one authenticated local approval and confirmation in the original OAuth browser", () => {
    using f = fixture();
    expect(f.code).toMatch(/^\d{8}$/);
    expect(
      f.pairing.claim(
        { ...f.first, publicKey: "invalid" },
        "local-user",
        f.code,
      ),
    ).toBeUndefined();
    const claim = f.pairing.claim(f.first, "local-user", f.code);
    if (!claim) throw new Error("Pairing claim was not available");
    expect(claim).toMatchObject({
      clientId: request.clientId,
      expiresAt: 1000 + pairingLifetimeMs,
      scopes: request.scopes,
    });
    expect(f.pairing.claim(f.second, "local-user", f.code)).toBeUndefined();
    expect(() =>
      f.tokens.completePairedConsent(f.session, request, ["mcp:read"]),
    ).toThrow();
    const approval = {
      id: claim.id,
      nonce: claim.nonce,
      localProfileId: "local-user",
      localGrantId: "local-grant",
      scopes: ["mcp:read"] as const,
    };
    expect(f.pairing.approve(f.second, approval)).toBe(false);
    expect(
      f.pairing.approve(f.first, { ...approval, localProfileId: "other-user" }),
    ).toBe(false);
    expect(
      f.pairing.approve(f.first, { ...approval, scopes: ["mcp:delete"] }),
    ).toBe(false);
    expect(
      f.pairing.approve(f.first, { ...approval, nonce: "wrong-nonce" }),
    ).toBe(false);
    expect(f.pairing.approve(f.first, approval)).toBe(true);
    expect(f.pairing.approve(f.first, approval)).toBe(false);
    const otherBrowser = { ...f.session, browserSecret: "wrong-browser" };
    expect(f.pairing.approved(otherBrowser, request)).toBeUndefined();
    expect(f.pairing.approved(f.session, request)).toEqual({
      instanceId: "one",
      localProfileId: "local-user",
      scopes: ["mcp:read"],
    });
    expect(() =>
      f.tokens.completePairedConsent(otherBrowser, request, approval.scopes),
    ).toThrow();
    expect(() =>
      f.tokens.completePairedConsent(
        f.session,
        { ...request, state: "changed" },
        approval.scopes,
      ),
    ).toThrow();
    expect(() =>
      f.tokens.completePairedConsent(f.session, request, request.scopes),
    ).toThrow();
    const redirected = f.tokens.completePairedConsent(
      f.session,
      request,
      approval.scopes,
    );
    expect(() =>
      f.tokens.completePairedConsent(f.session, request, approval.scopes),
    ).toThrow();
    const issued = f.tokens.exchangeCode(
      request.clientId,
      new URLSearchParams({
        code: redirected.searchParams.get("code") ?? "",
        code_verifier: verifier,
        resource: request.resource,
        redirect_uri: request.redirectUri,
      }),
    );
    expect(f.tokens.authenticate(issued.access_token)).toMatchObject({
      transportId: f.first.transportId,
      instanceId: "one",
      localGrantId: approval.localGrantId,
      scopes: ["mcp:read"],
    });
  });

  it("limits code lookups by transport and installation", () => {
    using f = fixture();
    const wrongCode = f.code === "00000000" ? "00000001" : "00000000";
    expect(f.pairing.claim(f.first, "local-user", wrongCode)).toBeUndefined();
    expect(f.pairing.claim(f.first, "local-user", wrongCode)).toBeUndefined();
    expect(f.pairing.claim(f.first, "local-user", f.code)).toBeUndefined();
    const alternate = f.register("one", "agent-alt");
    expect(f.pairing.claim(alternate, "local-user", wrongCode)).toBeUndefined();
    expect(f.pairing.claim(alternate, "local-user", f.code)).toBeUndefined();
    expect(f.pairing.claim(f.second, "local-user", f.code)).toBeDefined();
  });

  it("expires codes and refuses final consent on a disabled transport", () => {
    using f = fixture();
    const claim = f.pairing.claim(f.first, "local-user", f.code);
    if (!claim) throw new Error("Pairing claim was not available");
    expect(
      f.pairing.approve(f.first, {
        id: claim.id,
        nonce: claim.nonce,
        localProfileId: "local-user",
        localGrantId: "local-grant",
        scopes: ["mcp:read"],
      }),
    ).toBe(true);
    f.store.disableTransport(f.first.transportId, 1200);
    expect(() =>
      f.tokens.completePairedConsent(f.session, request, ["mcp:read"]),
    ).toThrow();
    const other = f.tokens.beginConsent(request, {
      lifetimeMs: 600_000,
      capacity: 5,
    });
    const code = f.pairing.start(other, request);
    f.advance(pairingLifetimeMs);
    expect(f.pairing.claim(f.second, "local-user", code)).toBeUndefined();
  });
});
