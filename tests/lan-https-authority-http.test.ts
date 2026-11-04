import { afterEach, describe, expect, it } from "vitest";
import { createServer, request } from "node:http";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createLanHttpsAuthorityHandler } from "../deploy/lan-https/authority-http.mjs";
import { LanHttpsAuthorityStore } from "../deploy/lan-https/authority-store.mjs";
import { createLanHttpsProof } from "../deploy/lan-https/proof.mjs";
import { createLanHttpsRateLimit } from "../deploy/lan-https/rate-limit.mjs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
async function fixture(
  options: {
    invite?: boolean;
    tightRate?: boolean;
    trustedProxy?: boolean;
  } = {},
) {
  const db = new DatabaseSync(":memory:");
  const origin = "https://akebi.example.test";
  const store = new LanHttpsAuthorityStore({
    database: db,
    policy: {
      format: 1,
      registration: options.invite ? "invite" : "open",
      serverOrigin: origin,
      lanDomain: "lan.example.test",
    },
  });
  const eab = {
    id: "zerossl",
    directoryUrl: "https://acme.example.test/directory",
    newAccountUrl: "https://acme.example.test/new-account",
    kid: "private-fixture-kid",
    hmacKey: randomBytes(32).toString("base64url"),
  };
  const server = createServer(
    createLanHttpsAuthorityHandler({
      store,
      issuers: [eab],
      trustLoopbackProxy: options.trustedProxy ?? false,
      ...(options.tightRate
        ? {
            requestLimit: createLanHttpsRateLimit({
              requestsPerKey: 1,
              requestsTotal: 1,
            }),
          }
        : {}),
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  });
  const port = (server.address() as AddressInfo).port;
  function call(
    path: string,
    value?: object,
    headers: Record<string, string> = {},
  ) {
    const data =
      value === undefined ? undefined : Buffer.from(JSON.stringify(value));
    return new Promise<{
      status: number;
      body: Record<string, unknown>;
      text: string;
    }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            host: "akebi.example.test",
            ...(data
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": String(data.length),
                }
              : {}),
            ...headers,
          },
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString();
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(text) as Record<string, unknown>,
              text,
            });
          });
        },
      );
      req.on("error", reject);
      req.end(data);
    });
  }
  const key = generateKeyPairSync("ed25519"),
    exported = key.publicKey.export({ format: "jwk" });
  const publicKey = { kty: "OKP", crv: "Ed25519", x: exported.x };
  async function signed(path: string, value: object) {
    const nonce = await call("/v1/nonce", { publicKey });
    if (typeof nonce.body.nonce !== "string")
      throw new Error("Expected server nonce");
    const proof = createLanHttpsProof(key.privateKey, {
      audience: origin,
      path,
      nonce: nonce.body.nonce,
      body: Buffer.from(JSON.stringify(value)),
    });
    const headers = {
      "x-latex-renderer-lan-proof": Buffer.from(JSON.stringify(proof)).toString(
        "base64url",
      ),
    };
    return { response: await call(path, value, headers), headers };
  }
  return { store, db, eab, call, signed, publicKey };
}

describe("public authority HTTP boundary", () => {
  it("exposes only public provider metadata and no invite, revoke or arbitrary signing API", async () => {
    const f = await fixture();
    const meta = await f.call("/.well-known/latex-renderer-lan-https");
    expect(meta.status).toBe(200);
    expect(meta.body.registration).toBe("open");
    expect(meta.text).not.toContain(f.eab.kid);
    expect(meta.text).not.toContain(f.eab.hmacKey);
    for (const path of [
      "/v1/invite",
      "/v1/revoke",
      "/sign",
      "/admin/api",
      "/.well-known/latex-renderer-lan-https?x=1",
    ])
      expect((await f.call(path)).status).toBe(404);
    expect(
      (
        await f.call("/.well-known/latex-renderer-lan-https", undefined, {
          host: "attacker.test",
        })
      ).status,
    ).toBe(421);
  });
  it("performs actual nonce, automatic enrollment and key-bound EAB requests without sending CA secrets", async () => {
    const f = await fixture();
    const input = { publicKey: f.publicKey };
    const enroll = await f.signed("/v1/enroll", input);
    expect(enroll.response.status).toBe(200);
    expect(enroll.response.body.created).toBe(true);
    expect((await f.call("/v1/enroll", input, enroll.headers)).status).toBe(
      401,
    );
    const publicKey = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }).publicKey.export({ format: "jwk" });
    const binding = await f.signed("/v1/acme/bind", {
      issuer: "zerossl",
      publicKey,
    });
    expect(binding.response.status).toBe(200);
    expect(binding.response.body.externalAccountBinding).toBeTypeOf("object");
    expect(binding.response.text).not.toContain(f.eab.hmacKey);
    expect(
      (await f.signed("/v1/acme/bind", { issuer: "unconfigured", publicKey }))
        .response.body.error,
    ).toBe("issuer_not_configured");
  });
  it("does not let a client replace invite registration policy", async () => {
    const f = await fixture({ invite: true });
    expect(
      (await f.call("/.well-known/latex-renderer-lan-https")).body.registration,
    ).toBe("invite");
    expect(
      (await f.signed("/v1/enroll", { publicKey: f.publicKey })).response
        .status,
    ).toBe(403);
    expect(
      (
        await f.signed("/v1/enroll", {
          publicKey: f.publicKey,
          registration: "open",
        })
      ).response.status,
    ).toBe(400);
    const code = f.store.createInvite().code;
    expect(
      (
        await f.signed("/v1/enroll", {
          publicKey: f.publicKey,
          invitationCode: code,
        })
      ).response.status,
    ).toBe(200);
  });
  it("enforces real socket peer rate limits and ignores spoofed forwarding headers by default", async () => {
    const f = await fixture({ tightRate: true });
    expect(
      (
        await f.call("/.well-known/latex-renderer-lan-https", undefined, {
          "x-forwarded-for": "1.2.3.4",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.call("/.well-known/latex-renderer-lan-https", undefined, {
          "x-latex-renderer-client-ip": "8.8.8.8",
        })
      ).status,
    ).toBe(429);
  });
  it("requires a well-formed explicit trusted proxy header when configured", async () => {
    const f = await fixture({ trustedProxy: true });
    expect((await f.call("/.well-known/latex-renderer-lan-https")).status).toBe(
      400,
    );
    expect(
      (
        await f.call("/.well-known/latex-renderer-lan-https", undefined, {
          "x-latex-renderer-client-ip": "1.2.3.4, 5.6.7.8",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call("/.well-known/latex-renderer-lan-https", undefined, {
          "x-latex-renderer-client-ip": "192.0.2.1",
        })
      ).status,
    ).toBe(200);
  });
  it("rejects unsupported methods, types and oversized bodies before state mutations", async () => {
    const f = await fixture();
    expect((await f.call("/v1/nonce")).status).toBe(405);
    expect(
      (
        await f.call(
          "/v1/nonce",
          { publicKey: f.publicKey },
          { "Content-Type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    expect(
      (await f.call("/v1/nonce", { publicKey: "a".repeat(65536) })).status,
    ).toBe(413);
    expect(f.store.counts().nonces).toBe(0);
    expect(
      (await f.call("/v1/enroll", { publicKey: f.publicKey })).status,
    ).toBe(401);
  });
  it("reports unavailable state without treating it as empty or exposing SQLite details", async () => {
    const f = await fixture();
    f.db.exec("PRAGMA query_only=ON");
    const response = await f.call("/v1/nonce", { publicKey: f.publicKey });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "authority_unavailable" });
    expect(response.text).not.toMatch(/SQLITE|sqlite|readonly|publicKey/);
    expect(f.store.counts().installations).toBe(0);
  });
});
