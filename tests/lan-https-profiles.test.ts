import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  withLanHttpsProfile,
  lanHttpsProfileId,
} from "../deploy/lan-https/profiles.mjs";
import { validateLanHttpsClientConfiguration } from "../deploy/lan-https/configuration.mjs";
import {
  LanHttpsClientState,
  withLanHttpsClientLock,
} from "../deploy/lan-https/client-state.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-profiles-"));
  roots.push(root);
  const config = (
    address: string,
    serverOrigin = "https://akebi.example.test",
  ) =>
    validateLanHttpsClientConfiguration({
      format: 1,
      role: "client",
      stateDirectory: root,
      provider: {
        format: 1,
        provider: "akebi-local-acme",
        serverOrigin,
        lanDomain: "lan.example.test",
        address,
        keylessFallback: true,
      },
      issuerId: "zerossl",
      termsAccepted: true,
      allowedNetworks: ["192.168.1.0/24"],
    });
  return { root, config };
}
describe("bounded LAN configuration profiles", () => {
  it("preserves installation identity and authority account across IP changes while using independent TLS keys", async () => {
    const f = fixture();
    const a = await withLanHttpsProfile(f.config("192.168.1.50"), (c) => {
      c.groupState.saveAccount(
        "zerossl",
        "https://acme.example.test/directory",
        "https://acme.example.test/account",
      );
      return { keys: c.state.ensureKeys(), id: c.installationId };
    });
    const b = await withLanHttpsProfile(f.config("192.168.1.51"), (c) => ({
      keys: c.state.ensureKeys(),
      id: c.installationId,
      accounts: c.state.readAccounts(),
    }));
    expect(b.id).toBe(a.id);
    expect(b.keys.identityKey).toEqual(a.keys.identityKey);
    expect(b.keys.accountKey).toEqual(a.keys.accountKey);
    expect(b.keys.tlsKey).not.toEqual(a.keys.tlsKey);
    expect(b.accounts.zerossl?.accountUrl).toBe(
      "https://acme.example.test/account",
    );
    const other = await withLanHttpsProfile(
      f.config("192.168.1.50", "https://custom.example.test"),
      (c) => c.state.ensureKeys(),
    );
    expect(other.identityKey).toEqual(a.keys.identityKey);
    expect(other.accountKey).not.toEqual(a.keys.accountKey);
    const again = await withLanHttpsProfile(f.config("192.168.1.50"), (c) =>
      c.state.ensureKeys(),
    );
    expect(again).toEqual(a.keys);
    expect(readdirSync(f.root)).not.toContain("account.pem");
    expect(readdirSync(f.root)).not.toContain("tls-key.pem");
  });
  it("does not create a new certificate identity when fallback policy changes", () => {
    const f = fixture(),
      a = f.config("192.168.1.50");
    expect(lanHttpsProfileId(a.provider, a.issuerId)).toBe(
      lanHttpsProfileId({ ...a.provider, keylessFallback: false }, a.issuerId),
    );
  });
  it("keeps at most three inactive configuration profiles while protecting a serving profile", async () => {
    const f = fixture(),
      first = f.config("192.168.1.50");
    let firstRoot = "";
    await withLanHttpsProfile(first, (c) => {
      firstRoot = c.profileRoot;
    });
    let release: () => void = () => {
      throw new Error("gate not initialized");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const serving = withLanHttpsClientLock(firstRoot, () => gate, {
      lockFile: "serve.lock",
    });
    try {
      for (const ip of ["192.168.1.51", "192.168.1.52", "192.168.1.53"])
        await withLanHttpsProfile(f.config(ip), () => Promise.resolve());
      expect(existsSync(firstRoot)).toBe(true);
      expect(readdirSync(join(f.root, "profiles"))).toHaveLength(3);
    } finally {
      release();
      await serving;
    }
    await withLanHttpsProfile(f.config("192.168.1.54"), () =>
      Promise.resolve(),
    );
    expect(existsSync(firstRoot)).toBe(false);
    expect(readdirSync(join(f.root, "profiles"))).toHaveLength(3);
  });
  it("reclaims validated interrupted profiles but refuses corrupt indexes and unrecognized paths", async () => {
    const f = fixture();
    await withLanHttpsProfile(f.config("192.168.1.50"), () =>
      Promise.resolve(),
    );
    const orphan = join(f.root, "profiles", "f".repeat(64));
    new LanHttpsClientState(orphan).ensureKeys();
    await withLanHttpsProfile(f.config("192.168.1.51"), () =>
      Promise.resolve(),
    );
    expect(existsSync(orphan)).toBe(false);
    writeFileSync(join(f.root, "profiles.json"), "broken", { mode: 0o600 });
    await expect(
      withLanHttpsProfile(f.config("192.168.1.52"), () => Promise.resolve()),
    ).rejects.toThrow(/corrupt/);
  });
});

it("inspection leaves the selected profile and index unchanged", async () => {
  const f = fixture();
  const a = f.config("192.168.1.50"),
    b = f.config("192.168.1.51");
  await withLanHttpsProfile(a, () => {});
  await withLanHttpsProfile(b, () => {});
  const { readFileSync } = await import("node:fs");
  const { withExistingLanHttpsProfile } =
    await import("../deploy/lan-https/profiles.mjs");
  const before = readFileSync(join(f.root, "profiles.json"));
  await withExistingLanHttpsProfile(a, (c) => {
    expect(c.id).toBe(lanHttpsProfileId(a.provider, a.issuerId));
  });
  expect(readFileSync(join(f.root, "profiles.json"))).toEqual(before);
  await expect(
    withExistingLanHttpsProfile(f.config("192.168.1.52"), () => {}),
  ).rejects.toThrow(/not initialized/);
  expect(readFileSync(join(f.root, "profiles.json"))).toEqual(before);
});

it("does not regenerate a referenced authority account key after an IP change", async () => {
  const f = fixture();
  await withLanHttpsProfile(f.config("192.168.1.50"), () => {});
  const { unlinkSync, readFileSync } = await import("node:fs");
  const group = readdirSync(join(f.root, "authorities"))[0];
  if (!group) throw new Error("Missing fixture group");
  unlinkSync(join(f.root, "authorities", group, "account.pem"));
  const before = readFileSync(join(f.root, "profiles.json"));
  await expect(
    withLanHttpsProfile(f.config("192.168.1.51"), () => {}),
  ).rejects.toThrow(/account key is missing/);
  expect(readFileSync(join(f.root, "profiles.json"))).toEqual(before);
});
