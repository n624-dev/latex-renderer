import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { Resolver } from "node:dns/promises";
import { generateKeyPairSync } from "node:crypto";
import {
  initializeLanHttpsAuthority,
  startLanHttpsAuthority,
} from "../deploy/lan-https/authority-runtime.mjs";
import { createLanHttpsAuthorityClient } from "../deploy/lan-https/authority-client.mjs";
import type { LanHttpsAuthorityTransport } from "../deploy/lan-https/authority-client.mjs";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
async function fixture(corrupt = false, keyless = false) {
  const root = mkdtempSync(join(tmpdir(), "lan-authority-runtime-"));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    return Promise.resolve();
  });
  const config = {
    format: 1,
    role: "authority",
    stateDirectory: root,
    policy: {
      format: 1,
      registration: "open",
      serverOrigin: "https://akebi.example.test",
      lanDomain: "lan.example.test",
    },
    http: { address: "127.0.0.1", port: 3181, trustLoopbackProxy: false },
    dns: {
      listeners: [{ address: "127.0.0.1", port: 53 }],
      nameserver: "ns1.example.test",
      caaIssuers: ["letsencrypt.org"],
    },
    ...(keyless
      ? {
          keyless: {
            binary: "/nonexistent/lan-signer",
            bundleFile: join(root, "missing.pem"),
          },
        }
      : {}),
    issuers: [
      {
        id: "letsencrypt",
        directoryUrl: "https://acme.example.test/directory",
        newAccountUrl: "https://acme.example.test/newAccount",
      },
    ],
  };
  initializeLanHttpsAuthority(config);
  if (corrupt)
    writeFileSync(join(root, "authority.sqlite"), "broken sqlite", {
      mode: 0o600,
    });
  const ephemeral = {
    ...config,
    http: { ...config.http, port: 0 },
    dns: { ...config.dns, listeners: [{ address: "127.0.0.1", port: 0 }] },
  };
  const events: unknown[] = [];
  const service = await startLanHttpsAuthority(ephemeral, {
    allowEphemeral: true,
    event: (entry) => events.push(entry),
  });
  cleanups.push(() => service.close());
  const transport: LanHttpsAuthorityTransport = (url, options) =>
    new Promise((resolve, reject) => {
      const call = request(
        {
          host: "127.0.0.1",
          port: service.httpPort,
          path: url.pathname,
          method: options.method,
          agent: false,
          headers: {
            Host: "akebi.example.test",
            ...(options.body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": String(options.body.length),
                }
              : {}),
            ...options.headers,
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            try {
              resolve({
                status: response.statusCode ?? 0,
                body: JSON.parse(body) as unknown,
              });
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error("Invalid fixture JSON"),
              );
            }
          });
        },
      );
      call.on("error", reject);
      call.end(options.body);
    });
  const client = createLanHttpsAuthorityClient({
    provider: {
      format: 1,
      provider: "akebi-local-acme",
      serverOrigin: config.policy.serverOrigin,
      lanDomain: config.policy.lanDomain,
      address: "192.168.1.50",
      keylessFallback: false,
    },
    identityKey: generateKeyPairSync("ed25519").privateKey,
    transport,
  });
  const dns = new Resolver({ timeout: 1000, tries: 1 });
  dns.setServers([`127.0.0.1:${service.dnsPorts[0] ?? 0}`]);
  return { root, config, ephemeral, service, client, dns, events };
}
describe("self-hosted authority lifecycle", () => {
  it("starts actual API and authoritative DNS, binds EAB-free accounts and publishes/cleans DNS-01", async () => {
    const f = await fixture();
    expect(
      (await f.client.metadata()).issuers[0]?.externalAccountRequired,
    ).toBe(false);
    await f.client.enroll();
    const publicKey = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }).publicKey.export({ format: "jwk" });
    expect(await f.client.bindAcmeAccount("letsencrypt", publicKey)).toBeNull();
    expect(await f.dns.resolve4("192-168-1-50.lan.example.test")).toEqual([
      "192.168.1.50",
    ]);
    const challenge = await f.client.presentChallenge(
      "192-168-1-50.lan.example.test",
      "A".repeat(43),
    );
    expect(
      await f.dns.resolveTxt("_acme-challenge.192-168-1-50.lan.example.test"),
    ).toEqual([["A".repeat(43)]]);
    await f.client.removeChallenge(challenge.id);
    await expect(
      f.dns.resolveTxt("_acme-challenge.192-168-1-50.lan.example.test"),
    ).rejects.toMatchObject({ code: "ENODATA" });
    await expect(
      startLanHttpsAuthority(f.ephemeral, { allowEphemeral: true }),
    ).rejects.toThrow(/publisher is busy/);
    expect(() => initializeLanHttpsAuthority(f.config)).toThrow();
    expect(f.events).toEqual([
      { event: "lan_https.authority_state_available" },
    ]);
  });
  it("keeps stateless address DNS available but rejects mutations and TXT when the DB is corrupt", async () => {
    const f = await fixture(true);
    expect(await f.dns.resolve4("192-168-1-50.lan.example.test")).toEqual([
      "192.168.1.50",
    ]);
    await expect(f.client.enroll()).rejects.toMatchObject({ status: 503 });
    await expect(
      f.dns.resolveTxt("_acme-challenge.192-168-1-50.lan.example.test"),
    ).rejects.toMatchObject({ code: "ESERVFAIL" });
    expect(f.events).toEqual([
      { event: "lan_https.authority_state_unavailable" },
    ]);
  });
});

it("keeps DNS and enrollment available while an optional Keyless signer is unavailable", async () => {
  const f = await fixture(false, true);
  expect(await f.dns.resolve4("192-168-1-50.lan.example.test")).toEqual([
    "192.168.1.50",
  ]);
  expect(await f.client.enroll()).toMatchObject({ created: true });
  expect(f.events).toContainEqual({ event: "lan_https.keyless_unavailable" });
});
