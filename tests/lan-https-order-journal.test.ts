import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LanHttpsClientState } from "../deploy/lan-https/client-state.mjs";
import {
  LanHttpsOrderJournal,
  normalizeLanHttpsOrder,
} from "../deploy/lan-https/order-journal.mjs";
import {
  issueLanHttpsCertificate,
  LanHttpsIssuanceError,
} from "../deploy/lan-https/acme.mjs";
import { lanCertificateFixture } from "./fixtures/lan-https.js";
import type { Order } from "acme-client";

const cleanups: (() => void)[] = [];
it("ignores bounded remote extensions while preserving names, authority URLs and order states", async () => {
  const f = await fixture();
  const names = f.order.identifiers.map((item) => item.value);
  const account = "https://acme.example.test/account";
  expect(
    normalizeLanHttpsOrder(
      {
        ...f.order,
        profile: "classic",
        identifiers: f.order.identifiers.map((item) => ({
          ...item,
          futureExtension: true,
        })),
      },
      names,
      account,
    ),
  ).toEqual(f.order);
  for (const change of [
    { url: "https://foreign.example.test/order" },
    { finalize: "https://acme.example.test/finalize?secret=unexpected" },
    { status: "unknown" },
    {
      identifiers: [
        { type: "dns", value: "other.example.test" },
        f.order.identifiers[1],
      ],
    },
    { authorizations: ["https://foreign.example.test/authz"] },
    { futureExtension: "x".repeat(512 * 1024) },
  ])
    expect(() =>
      normalizeLanHttpsOrder({ ...f.order, ...change }, names, account),
    ).toThrow();
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
async function fixture() {
  const f = await lanCertificateFixture();
  cleanups.push(f.cleanup);
  const root = mkdtempSync(join(tmpdir(), "lan-order-journal-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const state = new LanHttpsClientState(root);
  state.ensureKeys();
  const context = {
    state,
    provider: f.provider,
    installationId: f.id,
    issuerId: "zerossl",
    directoryUrl: "https://acme.example.test/directory",
    accountUrl: "https://acme.example.test/account",
    accountKey: f.accountKey,
    tlsKey: f.tlsKey,
  };
  const journal = new LanHttpsOrderJournal(context);
  const order: Order = {
    status: "pending",
    url: "https://acme.example.test/order",
    finalize: "https://acme.example.test/finalize",
    authorizations: [],
    identifiers: f.request.hostnames.map((value) => ({ type: "dns", value })),
  };
  const options = {
    provider: f.provider,
    authority: f.authority,
    client: f.client,
    issuerId: "zerossl",
    accountKey: f.accountKey,
    tlsKey: f.tlsKey,
    termsAccepted: true,
    saveAccount: () => Promise.resolve(),
    journal,
    verifyCertificate: () =>
      Promise.resolve({ fingerprint256: "fixture", expiresAt: "fixture" }),
  };
  return { ...f, root, state, context, journal, order, options };
}

describe("bounded durable ACME order journal", () => {
  it("persists a CA order with extension fields before a failure and resumes it without another newOrder", async () => {
    const f = await fixture();
    const create = f.client.createOrder.bind(f.client);
    f.client.createOrder = async (input) => ({
      ...(await create(input)),
      profile: "classic",
      futureExtension: { enabled: true },
    });
    const verify = f.client.verifyChallenge.bind(f.client);
    f.client.verifyChallenge = () =>
      Promise.reject(new Error("interrupted after order creation"));
    await expect(issueLanHttpsCertificate(f.options)).rejects.toThrow(
      "issuance failed",
    );
    expect(f.journal.load()?.order.url).toBe(f.order.url);
    expect(f.journal.load()?.order).not.toHaveProperty("profile");
    f.client.verifyChallenge = verify;
    f.client.getOrder = () =>
      Promise.resolve({
        ...f.order,
        status: "ready",
        profile: "classic",
        futureExtension: "ignored",
      });
    const finalize = f.client.finalizeOrder.bind(f.client);
    f.client.finalizeOrder = async (order, csr) => ({
      ...(await finalize(order, csr)),
      profile: "classic",
    });
    await expect(issueLanHttpsCertificate(f.options)).resolves.toHaveProperty(
      "certificate",
      f.certificate,
    );
    expect(f.events.filter((event) => event === "order")).toHaveLength(1);
    const stored = JSON.parse(
      readFileSync(join(f.root, "order.json"), "utf8"),
    ) as { pending: { order: Record<string, unknown> } };
    stored.pending.order.futureExtension = true;
    writeFileSync(join(f.root, "order.json"), JSON.stringify(stored), {
      mode: 0o600,
    });
    expect(() => f.journal.load()).toThrow("state was retained");
  });
  it("survives restart, refuses changed keys/settings, and retains one order", async () => {
    const f = await fixture();
    f.journal.save(f.order, f.request.csr);
    expect(new LanHttpsOrderJournal(f.context).load()).toEqual({
      order: f.order,
      csr: f.request.csr,
    });
    for (const changed of [
      { provider: { ...f.provider, address: "192.168.1.51" } },
      { accountKey: f.tlsKey },
      { tlsKey: f.accountKey },
      { accountUrl: "https://acme.example.test/account/other" },
    ]) {
      const other = new LanHttpsOrderJournal({ ...f.context, ...changed });
      expect(() => other.load()).toThrow(/state was retained/);
      expect(() => other.clear()).toThrow(/state was retained/);
    }
    f.journal.save({ ...f.order, status: "processing" }, f.request.csr);
    expect(f.journal.load()?.order.status).toBe("processing");
    f.journal.clear();
    expect(f.journal.load()).toBeNull();
    expect(
      new LanHttpsOrderJournal({ ...f.context, accountKey: f.tlsKey }).load(),
    ).toBeNull();
  });
  it("refuses foreign names/URLs and corrupt state without erasing evidence", async () => {
    const f = await fixture();
    for (const order of [
      { ...f.order, url: "https://other.test/order" },
      { ...f.order, certificate: "http://acme.example.test/certificate" },
      { ...f.order, authorizations: ["https://other.test/authorization"] },
      { ...f.order, identifiers: [{ type: "dns", value: "outside.test" }] },
      {
        ...f.order,
        identifiers: [f.order.identifiers[0], f.order.identifiers[0]],
      },
    ])
      expect(() => f.journal.save(order as Order, f.request.csr)).toThrow();
    writeFileSync(join(f.root, "order.json"), "broken", { mode: 0o600 });
    expect(() => f.journal.load()).toThrow(/state was retained/);
    expect(() => f.journal.clear()).toThrow();
    expect(readFileSync(join(f.root, "order.json"), "utf8")).toBe("broken");
  });
  it("refuses to regenerate keys referenced only by an interrupted order", async () => {
    const f = await fixture();
    f.journal.save(f.order, f.request.csr);
    unlinkSync(join(f.root, "tls-key.pem"));
    expect(() => f.state.ensureKeys()).toThrow(/restore the saved state/);
  });
  it("resumes an interrupted processing order without new orders, DNS or duplicate finalization", async () => {
    const f = await fixture();
    f.journal.save(f.order, f.request.csr);
    f.client.getOrder = () =>
      Promise.resolve({ ...f.order, status: "processing" });
    const result = await issueLanHttpsCertificate(f.options);
    expect(result.certificate).toBe(f.certificate);
    expect(f.events).not.toContain("order");
    expect(f.events).not.toContain("finalize");
    expect(f.events).not.toContain("verify");
    // Only the publisher may clear after installing the verified bundle.
    expect(f.journal.load()?.order.status).toBe("processing");
  });
  it("retains and resumes the same order after challenge failure", async () => {
    const f = await fixture();
    const verify = f.client.verifyChallenge.bind(f.client);
    f.client.verifyChallenge = () =>
      Promise.reject(new Error("DNS unavailable"));
    await expect(issueLanHttpsCertificate(f.options)).rejects.toThrow(
      /issuance failed/,
    );
    expect(f.journal.load()?.order.url).toBe(f.order.url);
    f.client.verifyChallenge = verify;
    f.client.getOrder = () => Promise.resolve({ ...f.order, status: "ready" });
    await issueLanHttpsCertificate(f.options);
    expect(f.events.filter((e) => e === "order")).toHaveLength(1);
    expect(f.events.filter((e) => e === "finalize")).toHaveLength(1);
  });
  it("persists orders before challenges and refuses to proceed on ENOSPC", async () => {
    const f = await fixture();
    const state = new LanHttpsClientState(f.root, {
      writeBytes: () => {
        throw new Error("fixture ENOSPC");
      },
    });
    const journal = new LanHttpsOrderJournal({ ...f.context, state });
    await expect(
      issueLanHttpsCertificate({ ...f.options, journal }),
    ).rejects.toThrow(/issuance failed/);
    expect(f.events).toContain("order");
    expect(f.events).not.toContain("verify");
    expect(f.events).not.toContain("finalize");
  });
  it("refreshes after a lost finalize response and resumes without finalizing twice", async () => {
    const f = await fixture();
    f.journal.save({ ...f.order, status: "ready" }, f.request.csr);
    let finalized = false;
    f.client.getOrder = () =>
      Promise.resolve({
        ...f.order,
        status: finalized ? "processing" : "ready",
      });
    f.client.finalizeOrder = () => {
      finalized = true;
      f.events.push("finalize");
      return Promise.reject(new Error("response lost after CA commit"));
    };
    await expect(issueLanHttpsCertificate(f.options)).rejects.toThrow(
      /issuance failed/,
    );
    expect(f.journal.load()?.order.status).toBe("ready");
    await issueLanHttpsCertificate(f.options);
    expect(f.events.filter((e) => e === "finalize")).toHaveLength(1);
    expect(f.events).not.toContain("order");
  });
  it("retains a terminal order and reports it explicitly without creating another", async () => {
    const f = await fixture();
    f.journal.save(f.order, f.request.csr);
    f.client.getOrder = () =>
      Promise.resolve({ ...f.order, status: "invalid" });
    await expect(issueLanHttpsCertificate(f.options)).rejects.toMatchObject({
      orderTerminal: true,
    });
    expect(f.journal.load()?.order.status).toBe("invalid");
    expect(f.events).not.toContain("order");
  });
  it("honors Retry-After in account and finalize stages without echoing CA details", async () => {
    const f = await fixture();
    f.client.createAccount = () =>
      Promise.reject(
        Object.assign(new Error("fixture CA refusal"), {
          response: {
            headers: { "retry-after": "3600" },
            data: "private diagnostic",
          },
        }),
      );
    const now = Date.now();
    await expect(
      issueLanHttpsCertificate({ ...f.options, now: () => now }),
    ).rejects.toMatchObject({ retryAt: now + 3600000 });
    const e = new LanHttpsIssuanceError([], now + 3600000);
    expect(e.message).not.toContain("private");
    f.journal.save({ ...f.order, status: "ready" }, f.request.csr);
    f.client.getAccountUrl = () => "https://acme.example.test/account";
    f.client.getOrder = () => Promise.resolve({ ...f.order, status: "ready" });
    f.client.finalizeOrder = () =>
      Promise.reject(
        Object.assign(new Error("fixture CA refusal"), {
          response: {
            headers: { "retry-after": new Date(now + 7200000).toUTCString() },
          },
        }),
      );
    await expect(
      issueLanHttpsCertificate({ ...f.options, now: () => now }),
    ).rejects.toMatchObject({
      retryAt: Math.floor((now + 7200000) / 1000) * 1000,
    });
  });
});
