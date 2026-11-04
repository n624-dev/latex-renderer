import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LanHttpsClientState,
  withLanHttpsClientLock,
} from "../deploy/lan-https/client-state.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lanCertificateFixture } from "./fixtures/lan-https.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-client-state-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return { root, state: new LanHttpsClientState(root) };
}

describe("private bounded installation state", () => {
  it("persists identity, ACME and TLS keys before any network enrollment and reuses them after restart", () => {
    const f = fixture(),
      first = f.state.ensureKeys();
    const restarted = new LanHttpsClientState(f.root).ensureKeys();
    expect(restarted).toEqual(first);
    expect(readdirSync(f.root).sort()).toEqual([
      "account.pem",
      "identity.pem",
      "tls-key.pem",
    ]);
    for (const file of readdirSync(f.root))
      expect(lstatSync(join(f.root, file)).mode & 0o777).toBe(0o600);
  });
  it("persists accounts by issuer without changing or exposing key files", () => {
    const f = fixture();
    const keys = f.state.ensureKeys();
    f.state.saveAccount(
      "zerossl",
      "https://acme.example.test/directory",
      "https://acme.example.test/account/1",
    );
    expect(
      new LanHttpsClientState(f.root).readAccounts().zerossl?.accountUrl,
    ).toBe("https://acme.example.test/account/1");
    expect(f.state.ensureKeys()).toEqual(keys);
    expect(() =>
      f.state.saveAccount(
        "other",
        "https://acme.example.test/directory",
        "https://attacker.test/account",
      ),
    ).toThrow();
    expect(() => f.state.read("../../outside")).toThrow();
    unlinkSync(join(f.root, "account.pem"));
    expect(() => f.state.ensureKeys()).toThrow(/restore the saved state/);
  });
  it("refuses unsafe modes, external symlinks, and corrupt metadata without resetting them", () => {
    const f = fixture();
    f.state.ensureKeys();
    chmodSync(join(f.root, "identity.pem"), 0o644);
    expect(() => f.state.ensureKeys()).toThrow(/unsafe/);
    chmodSync(join(f.root, "identity.pem"), 0o600);
    const external = join(f.root, "untouched");
    writeFileSync(external, "retained", { mode: 0o600 });
    unlinkSync(join(f.root, "identity.pem"));
    symlinkSync(external, join(f.root, "identity.pem"));
    expect(() => f.state.ensureKeys()).toThrow();
    expect(readFileSync(external, "utf8")).toBe("retained");
    writeFileSync(join(f.root, "accounts.json"), "broken", { mode: 0o600 });
    expect(() => f.state.readAccounts()).toThrow(/invalid/);
    expect(readFileSync(join(f.root, "accounts.json"), "utf8")).toBe("broken");
    chmodSync(f.root, 0o755);
    expect(() => new LanHttpsClientState(f.root)).toThrow(/unsafe/);
  });
  it("installs only a verified certificate/key bundle and retains just one previous generation", async () => {
    const f = fixture();
    f.state.ensureKeys();
    const cert = await lanCertificateFixture();
    cleanups.push(cert.cleanup);
    writeFileSync(join(f.root, "tls-key.pem"), cert.tlsKey, { mode: 0o600 });
    const options = {
      hostnames: cert.request.hostnames,
      trustedCertificates: [cert.root.certificate.toString()],
    };
    await f.state.installCertificate(cert.certificate, options);
    const previous = f.state.read("bundle.pem");
    await expect(
      f.state.installCertificate("invalid", options),
    ).rejects.toThrow();
    expect(f.state.read("bundle.pem")).toEqual(previous);
    await f.state.installCertificate(cert.certificate, options);
    expect(f.state.read("previous.pem")).toEqual(previous);
    expect(
      readdirSync(f.root).filter((name) => name.endsWith(".pem")),
    ).toHaveLength(5);
    expect(
      readdirSync(f.root).some((name) => name.startsWith(".update-")),
    ).toBe(false);
  });
  it("preserves committed state and removes partial temporary files on ENOSPC", () => {
    const f = fixture();
    f.state.ensureKeys();
    f.state.saveAccount(
      "zerossl",
      "https://acme.example.test/directory",
      "https://acme.example.test/account/1",
    );
    const before = readFileSync(join(f.root, "accounts.json"));
    const failing = new LanHttpsClientState(f.root, {
      writeBytes: () => {
        const error = new Error("fixture disk full");
        Object.assign(error, { code: "ENOSPC" });
        throw error;
      },
    });
    expect(() =>
      failing.saveAccount(
        "zerossl",
        "https://acme.example.test/directory",
        "https://acme.example.test/account/2",
      ),
    ).toThrow(/disk full/);
    expect(readFileSync(join(f.root, "accounts.json"))).toEqual(before);
    expect(
      readdirSync(f.root).some((name) => name.startsWith(".update-")),
    ).toBe(false);
  });
  it("reclaims only validated crash leftovers under the publisher's shared lock protocol", () => {
    const f = fixture();
    f.state.ensureKeys();
    writeFileSync(join(f.root, ".update-" + "a".repeat(32)), "partial", {
      mode: 0o600,
    });
    writeFileSync(join(f.root, "keep.txt"), "retained", { mode: 0o600 });
    expect(f.state.recoverTemporaryFiles()).toEqual({ removed: 1 });
    expect(readFileSync(join(f.root, "keep.txt"), "utf8")).toBe("retained");
    expect(f.state.recoverTemporaryFiles()).toEqual({ removed: 0 });
    symlinkSync(
      join(f.root, "keep.txt"),
      join(f.root, ".update-" + "b".repeat(32)),
    );
    expect(() => f.state.recoverTemporaryFiles()).toThrow(/Unsafe entry/);
    expect(readFileSync(join(f.root, "keep.txt"), "utf8")).toBe("retained");
  });
  it("holds a real OS lock across async work and releases it after completion", async () => {
    const f = fixture();
    let release: () => void = () => {
      throw new Error("Fixture gate was not initialized");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withLanHttpsClientLock(f.root, () => gate);
    try {
      await expect(
        withLanHttpsClientLock(f.root, () => Promise.resolve()),
      ).rejects.toThrow(/publisher is busy/);
    } finally {
      release();
      await first;
    }
    await expect(
      withLanHttpsClientLock(f.root, () => Promise.resolve("available")),
    ).resolves.toBe("available");
  });
  it("recovers the lock after a publisher is forcibly killed without PID or directory guesses", async () => {
    const f = fixture();
    const module = new URL(
      "../deploy/lan-https/client-state.mjs",
      import.meta.url,
    ).href;
    const script = `import {withLanHttpsClientLock} from ${JSON.stringify(module)};await withLanHttpsClientLock(process.argv[1],()=>{process.stdout.write("locked");return new Promise(()=>{setInterval(()=>{},10000);});});`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, f.root],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const [ready] = (await once(child.stdout, "data")) as [Buffer];
      expect(ready.toString()).toBe("locked");
      await expect(
        withLanHttpsClientLock(f.root, () => Promise.resolve()),
      ).rejects.toThrow(/publisher is busy/);
    } finally {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await expect(
      withLanHttpsClientLock(f.root, () => Promise.resolve("recovered")),
    ).resolves.toBe("recovered");
  });
});
