import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverSetupChildEnvironment } from "../deploy/scripts/server-setup.mjs";
import { requireServerSetupRecoveryOrdering } from "../deploy/scripts/configure-authentication.mjs";
import { serverSetupUnits } from "../deploy/scripts/authentication-change.mjs";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
async function fixture() {
  // Do not create root files or relax /tmp's permissions for this test. The
  // injected trusted UID applies only to this pure read-only boundary check.
  const root = await mkdtemp(
    new URL("../.setup-ca-fixture-", import.meta.url).pathname,
  );
  directories.push(root);
  await chmod(root, 0o700);
  const path = join(root, "ca.pem");
  await writeFile(path, "fixture CA content", { mode: 0o600 });
  await chmod(path, 0o600);
  return { root, path, uid: process.getuid?.() ?? 0 };
}
describe("prepared settings child environment", () => {
  it("also rejects recovery ordering missing fresh-host Web/HTTPS consumers", () => {
    const consumers = [
      ...serverSetupUnits,
      "latex-renderer-web.service",
      "latex-renderer-ingress.service",
    ];
    expect(() =>
      requireServerSetupRecoveryOrdering(
        serverSetupUnits.join(" "),
        "latex-renderer-authentication-recovery.service",
        consumers,
      ),
    ).toThrow("Compatible recovery ordering");
    expect(() =>
      requireServerSetupRecoveryOrdering(
        consumers.join(" "),
        "latex-renderer-authentication-recovery.service",
        consumers,
      ),
    ).not.toThrow();
  });
  it("requires the actually loaded five-consumer recovery ordering, not merely an active old unit", () => {
    expect(() =>
      requireServerSetupRecoveryOrdering(
        serverSetupUnits.join(" "),
        "latex-renderer-authentication-recovery.service",
      ),
    ).not.toThrow();
    expect(() =>
      requireServerSetupRecoveryOrdering(
        "latex-renderer-admin-api.service latex-renderer-remote-mcp.service",
        "latex-renderer-authentication-recovery.service",
      ),
    ).toThrow("Compatible recovery ordering");
    expect(() =>
      requireServerSetupRecoveryOrdering(
        serverSetupUnits.join(" "),
        "network.target",
      ),
    ).toThrow("Compatible recovery ordering");
    expect(() => requireServerSetupRecoveryOrdering(null, null)).toThrow(
      "Compatible recovery ordering",
    );
    for (const missing of serverSetupUnits)
      expect(() =>
        requireServerSetupRecoveryOrdering(
          serverSetupUnits.filter((unit) => unit !== missing).join(" "),
          "latex-renderer-authentication-recovery.service",
        ),
      ).toThrow("Compatible recovery ordering");
  });
  it("does not forward ambient credentials, loader hooks or TLS-disable switches", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    vi.stubEnv("NODE_OPTIONS", "--require /untrusted-hook");
    vi.stubEnv("PRIVATE_API_TOKEN", "fixture-token");
    expect(await serverSetupChildEnvironment()).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
    });
  });
  it("retains only an explicitly selected bounded trusted CA path, not its contents", async () => {
    const f = await fixture(),
      result = await serverSetupChildEnvironment(f.path, f.uid);
    expect(result.NODE_EXTRA_CA_CERTS).toBe(f.path);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture CA content");
    expect(await readFile(f.path, "utf8")).toBe("fixture CA content");
  });
  it("refuses group-writable files/parents instead of chmodding them", async () => {
    const f = await fixture();
    await chmod(f.path, 0o660);
    await expect(serverSetupChildEnvironment(f.path, f.uid)).rejects.toThrow(
      "root-controlled regular file",
    );
    await chmod(f.path, 0o600);
    await chmod(f.root, 0o770);
    await expect(serverSetupChildEnvironment(f.path, f.uid)).rejects.toThrow(
      "root-controlled directories",
    );
  });
  it("resolves an explicitly selected symlink only to a trusted regular CA, never a directory", async () => {
    const f = await fixture(),
      alias = join(f.root, "alias");
    await symlink(f.path, alias);
    expect(
      (await serverSetupChildEnvironment(alias, f.uid)).NODE_EXTRA_CA_CERTS,
    ).toBe(f.path);
    await expect(serverSetupChildEnvironment(f.root, f.uid)).rejects.toThrow(
      "regular file",
    );
  });
  it("rejects relative paths and oversized or empty CA files without modifying them", async () => {
    const f = await fixture();
    await expect(
      serverSetupChildEnvironment("relative.pem", f.uid),
    ).rejects.toThrow("absolute path");
    await writeFile(f.path, "");
    await expect(serverSetupChildEnvironment(f.path, f.uid)).rejects.toThrow(
      "bounded",
    );
    await writeFile(f.path, Buffer.alloc(2 * 1024 ** 2 + 1));
    await expect(serverSetupChildEnvironment(f.path, f.uid)).rejects.toThrow(
      "bounded",
    );
    expect((await readFile(f.path)).length).toBe(2 * 1024 ** 2 + 1);
  });
});
