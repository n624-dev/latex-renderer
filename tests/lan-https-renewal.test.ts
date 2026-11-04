import { afterEach, expect, it } from "vitest";
import { X509Certificate } from "node:crypto";
import {
  lanHttpsAcmeCertificateId,
  planLanHttpsRenewal,
} from "../deploy/lan-https/renewal.mjs";
import type { LanHttpsAuthorityTransport } from "../deploy/lan-https/authority-client.mjs";
import { lanCertificateFixture } from "./fixtures/lan-https.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
it("extracts the actual AKI and unsigned serial for RFC 9773", async () => {
  const f = await lanCertificateFixture();
  cleanups.push(f.cleanup);
  expect(lanHttpsAcmeCertificateId(f.certificate)).toMatch(
    /^[A-Za-z0-9_-]+\.MDk$/,
  );
  expect(() => lanHttpsAcmeCertificateId("invalid")).toThrow();
});
it("uses a bounded randomized ARI window, including a separate credential-free HTTPS ARI host", async () => {
  const f = await lanCertificateFixture();
  cleanups.push(f.cleanup);
  const now = Date.now();
  const calls: string[] = [];
  const transport: LanHttpsAuthorityTransport = (url, options) => {
    calls.push(url.href);
    expect(options).toEqual({ method: "GET" });
    return Promise.resolve(
      calls.length === 1
        ? {
            status: 200,
            body: { renewalInfo: "https://ari.example.test/renewalInfo" },
          }
        : {
            status: 200,
            body: {
              suggestedWindow: {
                start: new Date(now + 1000).toISOString(),
                end: new Date(now + 5000).toISOString(),
              },
            },
          },
    );
  };
  const plan = await planLanHttpsRenewal({
    certificate: f.certificate,
    directoryUrl: "https://acme.example.test/directory",
    now,
    transport,
    random: (max) => max - 1,
  });
  expect(plan.ari).toBe(true);
  expect(plan.renewAt).toBe(now + 4999);
  expect(calls[1]).toBe(
    `https://ari.example.test/renewalInfo/${lanHttpsAcmeCertificateId(f.certificate)}`,
  );
});
it("falls back to early renewal on missing, failed, unsafe or malformed ARI without discarding the certificate", async () => {
  const f = await lanCertificateFixture();
  cleanups.push(f.cleanup);
  const now = Date.parse(new X509Certificate(f.certificate).validFrom) + 1000;
  for (const response of [
    { status: 503, body: {} },
    { status: 200, body: {} },
    { status: 200, body: { renewalInfo: "http://unsafe.test/ari" } },
    {
      status: 200,
      body: {
        renewalInfo: "https://ari.example.test/info",
        suggestedWindow: { start: "invalid", end: "invalid" },
      },
    },
  ]) {
    const plan = await planLanHttpsRenewal({
      certificate: f.certificate,
      directoryUrl: "https://acme.example.test/directory",
      now,
      transport: () => Promise.resolve(response),
    });
    expect(plan.ari).toBe(false);
    expect(plan.renewAt).toBeGreaterThan(now);
    expect(plan.certificateId).toBeNull();
  }
});
