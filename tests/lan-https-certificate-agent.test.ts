import { afterEach, describe, expect, it } from "vitest";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLanHttpsCertificateAgent } from "../deploy/lan-https/certificate-agent.mjs";
import {
  LanHttpsClientState,
  withLanHttpsClientLock,
} from "../deploy/lan-https/client-state.mjs";
import { LanHttpsOrderJournal } from "../deploy/lan-https/order-journal.mjs";
import { lanHttpsPublicIdentity } from "../deploy/lan-https/proof.mjs";
import { lanCertificateFixture } from "./fixtures/lan-https.js";
import type { LanHttpsAuthorityClient } from "../deploy/lan-https/authority-client.mjs";
import type { Order } from "acme-client";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
async function fixture() {
  const identityKey = generateKeyPairSync("ed25519").privateKey.export({
    format: "pem",
    type: "pkcs8",
  });
  const key = createPublicKey(identityKey).export({ format: "jwk" });
  const { installationId } = lanHttpsPublicIdentity({
    kty: "OKP",
    crv: "Ed25519",
    x: key.x ?? "",
  });
  const f = await lanCertificateFixture({ installationId });
  cleanups.push(f.cleanup);
  const root = mkdtempSync(join(tmpdir(), "lan-certificate-agent-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const state = new LanHttpsClientState(root);
  state.ensureKeys();
  for (const [name, value] of Object.entries({
    "identity.pem": identityKey,
    "account.pem": f.accountKey,
    "tls-key.pem": f.tlsKey,
  }))
    writeFileSync(join(root, name), value, { mode: 0o600 });
  let clock = Date.now(),
    factoryCalls = 0;
  const directoryUrl = "https://acme.example.test/directory";
  const authority: LanHttpsAuthorityClient = {
    ...f.authority,
    publicKey: { kty: "OKP", crv: "Ed25519", x: key.x ?? "" },
    metadata: () =>
      Promise.resolve({
        format: 1,
        serverOrigin: f.provider.serverOrigin,
        lanDomain: f.provider.lanDomain,
        registration: "open",
        proofAlgorithm: "Ed25519",
        issuers: [
          {
            id: "zerossl",
            directoryUrl,
            newAccountUrl: "https://acme.example.test/newAccount",
          },
        ],
      }),
    enroll: () => Promise.resolve({ installationId, created: true }),
  };
  const options = {
    root,
    provider: f.provider,
    issuerId: "zerossl",
    termsAccepted: true,
    trustedCertificates: [f.root.certificate.toString()],
    now: () => clock,
    authorityFactory: () => {
      factoryCalls++;
      return authority;
    },
    clientFactory: () => Promise.resolve(f.client),
    renewalPlanner: () =>
      Promise.resolve({
        ari: false,
        renewAt: clock + 3600000,
        certificateId: null,
      }),
  };
  const forceDue = () => {
    const record = JSON.parse(
      readFileSync(join(root, "renewal.json"), "utf8"),
    ) as Record<string, unknown>;
    state.saveProtocolRecord("renewal.json", {
      ...record,
      renewAt: clock,
      nextAttemptAt: null,
    });
  };
  return {
    ...f,
    root,
    state,
    directoryUrl,
    authority,
    options,
    forceDue,
    factoryCalls: () => factoryCalls,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe("installation certificate timer transaction", () => {
  it("requires terms before making requests or changing persisted state", async () => {
    const f = await fixture();
    await expect(
      runLanHttpsCertificateAgent({ ...f.options, termsAccepted: false }),
    ).rejects.toThrow(/terms/);
    expect(f.factoryCalls()).toBe(0);
    expect(f.state.read("renewal.json")).toBeNull();
  });
  it("enrolls, issues, verifies real TLS, publishes and persists the next renewal without exposing keys", async () => {
    const f = await fixture(),
      before = f.state.ensureKeys();
    const result = await runLanHttpsCertificateAgent(f.options);
    expect(result).toMatchObject({
      status: "issued",
      certificateAvailable: true,
      cleanupPending: 0,
    });
    expect(f.state.ensureKeys()).toEqual(before);
    expect(f.state.readAccounts().zerossl?.directoryUrl).toBe(f.directoryUrl);
    expect(f.state.read("bundle.pem")?.toString()).toContain(
      "BEGIN CERTIFICATE",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /BEGIN|accountKey|identityKey|tlsKey/,
    );
    const hash = createHash("sha256")
      .update(f.state.read("bundle.pem") ?? "")
      .digest("hex");
    const calls = f.factoryCalls();
    const second = await runLanHttpsCertificateAgent(f.options);
    expect(second).toMatchObject({
      status: "deferred",
      reason: "scheduled",
      certificateAvailable: true,
    });
    expect(f.factoryCalls()).toBe(calls);
    expect(
      createHash("sha256")
        .update(f.state.read("bundle.pem") ?? "")
        .digest("hex"),
    ).toBe(hash);
    expect(f.events.filter((e) => e === "order")).toHaveLength(1);
  });
  it("retains retry timing across restarts and makes no requests while backoff is active", async () => {
    const f = await fixture();
    f.authority.metadata = () =>
      Promise.reject(new Error("private provider diagnostic"));
    const failed = await runLanHttpsCertificateAgent(f.options);
    expect(failed).toMatchObject({
      status: "deferred",
      reason: "retry_scheduled",
      certificateAvailable: false,
    });
    expect(failed.nextAttemptAt).toBeGreaterThan(f.now());
    const calls = f.factoryCalls();
    expect(await runLanHttpsCertificateAgent(f.options)).toMatchObject({
      reason: "scheduled",
    });
    expect(f.factoryCalls()).toBe(calls);
    f.advance(180001);
    await runLanHttpsCertificateAgent(f.options);
    expect(f.factoryCalls()).toBe(calls + 1);
    expect(f.state.read("bundle.pem")).toBeNull();
    expect(f.state.read("renewal.json")?.toString()).not.toContain(
      "private provider diagnostic",
    );
  });
  it("keeps the previously working certificate after renewal failure", async () => {
    const f = await fixture();
    await runLanHttpsCertificateAgent(f.options);
    const previous = f.state.read("bundle.pem");
    f.forceDue();
    f.client.getCertificate = () => Promise.reject(new Error("CA unavailable"));
    const result = await runLanHttpsCertificateAgent(f.options);
    expect(result).toMatchObject({
      reason: "retry_scheduled",
      certificateAvailable: true,
    });
    expect(f.state.read("bundle.pem")).toEqual(previous);
    expect(f.state.read("order.json")?.toString()).toContain("processing");
  });
  it("rejects corrupt schedules, unsafe state and a live publisher before network activity", async () => {
    const f = await fixture();
    await withLanHttpsClientLock(f.root, async () => {
      await expect(runLanHttpsCertificateAgent(f.options)).rejects.toThrow(
        /publisher is busy/,
      );
    });
    expect(f.factoryCalls()).toBe(0);
    writeFileSync(join(f.root, "renewal.json"), "broken", { mode: 0o600 });
    await expect(runLanHttpsCertificateAgent(f.options)).rejects.toThrow(
      /state was retained/,
    );
    expect(f.factoryCalls()).toBe(0);
    expect(readFileSync(join(f.root, "renewal.json"), "utf8")).toBe("broken");
  });
  it("resumes an order left after publication even when the certificate is not yet due", async () => {
    const f = await fixture();
    await runLanHttpsCertificateAgent(f.options);
    const account = f.state.readAccounts().zerossl;
    if (!account) throw new Error("Missing fixture account");
    const journal = new LanHttpsOrderJournal({
      state: f.state,
      provider: f.provider,
      installationId: f.id,
      issuerId: "zerossl",
      ...account,
      accountKey: f.accountKey,
      tlsKey: f.tlsKey,
    });
    const order: Order = {
      status: "processing",
      url: "https://acme.example.test/order",
      finalize: "https://acme.example.test/finalize",
      authorizations: [],
      identifiers: f.request.hostnames.map((value) => ({ type: "dns", value })),
    };
    journal.save(order, f.request.csr);
    f.client.getOrder = () => Promise.resolve(order);
    expect(await runLanHttpsCertificateAgent(f.options)).toMatchObject({
      status: "issued",
    });
    expect(f.events.filter((e) => e === "order")).toHaveLength(1);
    expect(f.events.filter((e) => e === "finalize")).toHaveLength(1);
    expect(journal.load()).toBeNull();
  });
  it("refuses a silently changed issuer endpoint and keeps the active bundle", async () => {
    const f = await fixture();
    await runLanHttpsCertificateAgent(f.options);
    const previous = f.state.read("bundle.pem");
    f.forceDue();
    const original = f.authority.metadata.bind(f.authority);
    f.authority.metadata = async () => ({
      ...(await original()),
      issuers: [
        {
          id: "zerossl",
          directoryUrl: "https://other.test/directory",
          newAccountUrl: "https://other.test/newAccount",
        },
      ],
    });
    expect(await runLanHttpsCertificateAgent(f.options)).toMatchObject({
      reason: "retry_scheduled",
      certificateAvailable: true,
    });
    expect(f.state.read("bundle.pem")).toEqual(previous);
    expect(f.events.filter((e) => e === "order")).toHaveLength(1);
  });
});
