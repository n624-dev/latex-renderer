import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey } from "node:crypto";
import type { Client } from "acme-client";
import { withLanHttpsProfile } from "../deploy/lan-https/profiles.mjs";
import { rotateLanHttpsAccountKeys } from "../deploy/lan-https/key-rotation.mjs";
import { validateLanHttpsClientConfiguration } from "../deploy/lan-https/configuration.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const pub = (key: Buffer) =>
  createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .toString("base64");
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-account-rotation-"));
  roots.push(root);
  const config = validateLanHttpsClientConfiguration({
    format: 1,
    role: "client",
    stateDirectory: root,
    provider: {
      format: 1,
      provider: "akebi-local-acme",
      serverOrigin: "https://akebi.example.test",
      lanDomain: "lan.example.test",
      address: "192.168.1.50",
      keylessFallback: false,
    },
    issuerId: "ca",
    termsAccepted: true,
    allowedNetworks: ["192.168.1.0/24"],
  });
  const keys = await withLanHttpsProfile(config, ({ state, groupState }) => {
    const account = {
      directoryUrl: "https://ca.example.test/directory",
      accountUrl: "https://ca.example.test/account/original",
    };
    state.saveAccount("ca", account.directoryUrl, account.accountUrl);
    groupState.saveAccount("ca", account.directoryUrl, account.accountUrl);
    return state.ensureKeys();
  });
  return { config, keys };
}
it("resumes a lost keyChange response using the same new key and existing CA account", async () => {
  const f = await fixture();
  let accepted = pub(f.keys.accountKey),
    changes = 0;
  const factory = ({
    accountKey,
    accountUrl,
  }: {
    accountKey: Buffer;
    accountUrl: string;
  }) =>
    Promise.resolve({
      updateAccount: () => {
        expect(accountUrl).toBe("https://ca.example.test/account/original");
        if (pub(accountKey) !== accepted)
          return Promise.reject(new Error("Wrong key"));
        return Promise.resolve({ status: "valid" });
      },
      updateAccountKey: (next: Buffer) => {
        expect(pub(accountKey)).toBe(accepted);
        accepted = pub(next);
        changes++;
        return Promise.reject(new Error("Response lost after CA commit"));
      },
    } as Pick<Client, "updateAccount" | "updateAccountKey">);
  await expect(
    rotateLanHttpsAccountKeys(f.config, { clientFactory: factory }),
  ).rejects.toThrow(/Response lost/);
  await expect(withLanHttpsProfile(f.config, () => {})).rejects.toThrow(
    /Resume the pending/,
  );
  expect(
    await rotateLanHttpsAccountKeys(f.config, { clientFactory: factory }),
  ).toEqual({ rotated: true, accounts: 1 });
  expect(changes).toBe(1);
  await withLanHttpsProfile(f.config, ({ state, groupState }) => {
    expect(pub(state.ensureKeys().accountKey)).toBe(accepted);
    expect(state.ensureKeys().identityKey).toEqual(f.keys.identityKey);
    expect(state.ensureKeys().tlsKey).toEqual(f.keys.tlsKey);
    expect(groupState.read("account-next.pem")).toBeNull();
    expect(state.readAccounts().ca?.accountUrl).toBe(
      "https://ca.example.test/account/original",
    );
  });
});
it("blocks rollover before contacting a CA when any profile has an unfinished order", async () => {
  const f = await fixture();
  await withLanHttpsProfile(f.config, ({ state }) => {
    state.saveProtocolRecord("order.json", {
      format: 1,
      context: "a".repeat(64),
      pending: { order: {}, csr: "x" },
    });
  });
  let calls = 0;
  await expect(
    rotateLanHttpsAccountKeys(f.config, {
      clientFactory: () => {
        calls++;
        throw new Error("must not call");
      },
    }),
  ).rejects.toThrow(/pending authority orders/);
  expect(calls).toBe(0);
});

it("retains pending keys when a completed rollover journal disagrees with durable keys", async () => {
  const f = await fixture();
  let pending: Buffer | undefined;
  await withLanHttpsProfile(f.config, ({ groupState }) => {
    pending = groupState.prepareAccountRotation();
    groupState.saveProtocolRecord("account-rotation.json", {
      format: 1,
      phase: "done",
      oldKey: "b".repeat(64),
      newKey: "c".repeat(64),
      accounts: groupState.readAccounts(),
      completed: ["ca"],
    });
  });
  let calls = 0;
  await expect(
    rotateLanHttpsAccountKeys(f.config, {
      clientFactory: () => {
        calls++;
        throw new Error("must not call");
      },
    }),
  ).rejects.toThrow(/does not match the saved keys/);
  expect(calls).toBe(0);
  await withLanHttpsProfile(f.config, ({ groupState }) => {
    expect(groupState.read("account-next.pem")).toEqual(pending);
  });
});
