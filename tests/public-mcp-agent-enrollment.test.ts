import { describe, expect, it, vi } from "vitest";
import { createAgentEnrollmentClient } from "../apps/public-mcp-agent/src/enrollment-http.js";
import { createAgentEnrollmentHandler } from "../apps/public-mcp-gateway/src/agent-enrollment-http.js";
import {
  configureAgentEnrollment,
  createAgentEnrollmentKeys,
  replaceAgentEnrollmentKey,
  signAgentEnrollment,
} from "../apps/public-mcp-agent/src/enrollment.js";
import { GatewayAgentEnrollment } from "../apps/public-mcp-gateway/src/agent-enrollment.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

const gatewayOrigin = "https://gateway.example.com";
const signal = new AbortController().signal;

describe("optional setup and public agent enrollment", () => {
  it("requires the same Renderer account to connect before approving deletion", () => {
    using fixture = createFixture();
    const keys = createAgentEnrollmentKeys();
    const registered = fixture.enrollment.complete(
      signAgentEnrollment(keys, fixture.enrollment.begin(), gatewayOrigin),
    );
    const admin = fixture.store.profileFor(keys.instanceId, "renderer-user");
    const other = fixture.store.profileFor(keys.instanceId, "other-user");
    const approval = {
      profileId: admin.id,
      transportId: registered.transportId,
      localGrantId: "delete-grant",
      scopes: ["mcp:delete"] as const,
      expiresAt: 2000,
    };
    expect(() => fixture.store.createAuthorization(approval, 1000)).toThrow();
    fixture.store.createAuthorization(
      { ...approval, localGrantId: "read-grant", scopes: ["mcp:read"] },
      1000,
    );
    expect(() =>
      fixture.store.createAuthorization(
        { ...approval, profileId: other.id },
        1000,
      ),
    ).toThrow();
    expect(fixture.store.createAuthorization(approval, 1000).scopes).toEqual([
      "mcp:delete",
    ]);
  });
  it("retires the previous communications key while preserving an active approval", () => {
    using fixture = createFixture();
    const keys = createAgentEnrollmentKeys();
    const enroll = (candidate: typeof keys) =>
      fixture.enrollment.complete(
        signAgentEnrollment(
          candidate,
          fixture.enrollment.begin(),
          gatewayOrigin,
        ),
      );
    const previous = enroll(keys);
    const profile = fixture.store.profileFor(keys.instanceId, "local-user");
    const approved = fixture.store.createAuthorization(
      {
        profileId: profile.id,
        transportId: previous.transportId,
        localGrantId: "grant",
        scopes: ["mcp:read"],
        expiresAt: 600_000,
      },
      0,
    );
    const fresh = enroll(replaceAgentEnrollmentKey(keys));
    expect(
      fixture.store.transport(previous.transportId)?.disabledAt,
    ).not.toBeNull();
    expect(fixture.store.authorization(approved.id)).toMatchObject({
      transportId: fresh.transportId,
      profileId: profile.id,
      revokedAt: null,
    });
    expect(() => enroll(keys)).toThrow();
  });
  it("requires a fresh agent key after restoring while preserving the installation's profile", () => {
    using fixture = createFixture();
    const keys = createAgentEnrollmentKeys();
    const enroll = (candidate: typeof keys) =>
      fixture.enrollment.complete(
        signAgentEnrollment(
          candidate,
          fixture.enrollment.begin(),
          gatewayOrigin,
        ),
      );
    const old = enroll(keys);
    const profile = fixture.store.profileFor(keys.instanceId, "local-user");
    fixture.store.invalidateRestoredAuthorizations(1);
    expect(fixture.store.transport(old.transportId)?.disabledAt).toBe(1);
    expect(() => enroll(keys)).toThrow();
    const fresh = enroll(replaceAgentEnrollmentKey(keys));
    expect(fresh.transportId).not.toBe(old.transportId);
    expect(fixture.store.profileFor(keys.instanceId, "local-user").id).toBe(
      profile.id,
    );
  });
  it("uses the same versioned proof through the HTTP registration endpoints", async () => {
    using fixture = createFixture();
    const allowEnrollment = vi.fn(() => true);
    const handle = createAgentEnrollmentHandler({
      enrollment: fixture.enrollment,
      maximumProofBytes: 4096,
      allowEnrollment,
    });
    const request = vi.fn(async (incoming: Request) => {
      expect(incoming.redirect).toBe("error");
      return (await handle(incoming)) ?? new Response(null, { status: 404 });
    });
    const client = createAgentEnrollmentClient(gatewayOrigin, 4096, request);
    const keys = createAgentEnrollmentKeys();
    await expect(
      configureAgentEnrollment(
        "connect",
        () => ({ gatewayOrigin, keys, client }),
        signal,
      ),
    ).resolves.toMatchObject({ status: "registered" });
    expect(request).toHaveBeenCalledTimes(2);
    allowEnrollment.mockReturnValue(false);
    await expect(client.getNonce(signal)).rejects.toThrow(
      "registration was rejected",
    );
  });

  it("skips setup without reading connection settings or touching the network", async () => {
    const configuration = vi.fn(() => {
      throw new Error("network or secrets unavailable");
    });
    const disconnected = AbortSignal.abort();
    await expect(
      configureAgentEnrollment("skip", configuration, disconnected),
    ).resolves.toEqual({ status: "skipped" });
    expect(configuration).not.toHaveBeenCalled();
  });

  it("uses both distinct keys and does not grant a profile or document access on registration", async () => {
    using fixture = createFixture();
    const keys = createAgentEnrollmentKeys();
    const result = await configureAgentEnrollment(
      "connect",
      () => ({
        gatewayOrigin,
        keys,
        client: {
          getNonce: () => Promise.resolve(fixture.enrollment.begin()),
          register: (proof) =>
            Promise.resolve(fixture.enrollment.complete(proof)),
        },
      }),
      signal,
    );
    expect(result.status).toBe("registered");
    if (result.status !== "registered")
      throw new Error("Enrollment was not registered");
    const proof = signAgentEnrollment(
      keys,
      fixture.enrollment.begin(),
      gatewayOrigin,
    );
    expect(proof.instance.publicKey).not.toBe(proof.agentPublicKey);
    expect(fixture.store.transport(result.transportId)).toMatchObject({
      instanceId: keys.instanceId,
      endpoint: { kind: "agent", publicKey: proof.agentPublicKey },
    });
    expect(fixture.enrollment.complete(proof)).toEqual({
      transportId: result.transportId,
    });
    expect(() => fixture.enrollment.complete(proof)).toThrow();
    expect(() =>
      fixture.store.createAuthorization(
        {
          profileId: "missing-profile",
          transportId: result.transportId,
          scopes: ["mcp:read"],
          localGrantId: "unverified-grant",
          expiresAt: 100_000,
        },
        0,
      ),
    ).toThrow();
  });

  it("rejects expired enrollment, mismatched origins and signatures, and distinct keys reusing one instance ID", () => {
    using fixture = createFixture();
    const original = createAgentEnrollmentKeys();
    const nonce = fixture.enrollment.begin();
    const otherGateway = signAgentEnrollment(
      original,
      nonce,
      "https://other.example.com",
    );
    expect(() => fixture.enrollment.complete(otherGateway)).toThrow();
    fixture.time(1_000);
    expect(() =>
      fixture.enrollment.complete(
        signAgentEnrollment(original, nonce, gatewayOrigin),
      ),
    ).toThrow();
    const valid = signAgentEnrollment(
      original,
      fixture.enrollment.begin(),
      gatewayOrigin,
    );
    expect(() =>
      fixture.enrollment.complete({
        ...valid,
        agentSignature: valid.instanceSignature,
      }),
    ).toThrow();
    expect(fixture.enrollment.complete(valid).transportId).toMatch(
      /^transport_/,
    );
    const clone = createAgentEnrollmentKeys();
    expect(clone.instanceId).not.toBe(original.instanceId);
    const conflicting = signAgentEnrollment(
      { ...clone, instanceId: original.instanceId },
      fixture.enrollment.begin(),
      gatewayOrigin,
    );
    expect(() => fixture.enrollment.complete(conflicting)).toThrow();
  });
});

function createFixture() {
  const store = new SqliteConnectionStore(":memory:");
  let current = 0;
  const enrollment = new GatewayAgentEnrollment(
    gatewayOrigin,
    store,
    { lifetimeMs: 1_000, pending: 2, registrations: 2 },
    () => current,
  );
  return {
    store,
    enrollment,
    time: (now: number) => {
      current = now;
    },
    [Symbol.dispose]: () => store.close(),
  };
}
