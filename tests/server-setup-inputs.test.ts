import {
  mkdtemp,
  chmod,
  rm,
  writeFile,
  utimes,
  lstat,
  readFile,
  symlink,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupServerSetupInputs } from "../deploy/scripts/server-setup-inputs.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "server-setup-inputs-"));
  roots.push(root);
  await chmod(root, 0o700);
  const uid = process.getuid?.() ?? 0,
    gid = process.getgid?.() ?? 0;
  return { root, cleanup: () => cleanupServerSetupInputs(root, uid, gid) };
}
async function input(root: string, name = "a".repeat(48), old = true) {
  const path = join(root, `${name}.json`);
  await writeFile(path, "{}", { mode: 0o600 });
  await chmod(path, 0o600);
  if (old) {
    const time = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(path, time, time);
  }
  return path;
}
describe("bounded private setup-input cleanup", () => {
  it("removes only old owned wizard inputs, never a current operation or operator file", async () => {
    const f = await fixture(),
      stale = await input(f.root),
      current = await input(f.root, "b".repeat(48), false);
    const operator = join(f.root, "operator-review.json");
    await writeFile(operator, "operator file");
    expect(await f.cleanup()).toEqual({ removed: 1 });
    await expect(lstat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(current, "utf8")).toBe("{}");
    expect(await readFile(operator, "utf8")).toBe("operator file");
    expect(await f.cleanup()).toEqual({ removed: 0 });
  });
  it("does not follow an external symlink", async () => {
    const f = await fixture(),
      outside = await fixture();
    const target = await input(outside.root);
    await symlink(target, join(f.root, `${"c".repeat(48)}.json`));
    await expect(f.cleanup()).rejects.toThrow("refuse automatic deletion");
    expect(await readFile(target, "utf8")).toBe("{}");
  });
  it("does not unlink shared or incorrectly permitted inputs", async () => {
    const f = await fixture(),
      path = await input(f.root);
    await link(path, join(f.root, "operator-link"));
    await expect(f.cleanup()).rejects.toThrow("refuse automatic deletion");
    expect((await lstat(path)).nlink).toBe(2);
    await rm(join(f.root, "operator-link"));
    await chmod(path, 0o640);
    await expect(f.cleanup()).rejects.toThrow("refuse automatic deletion");
    expect(await readFile(path, "utf8")).toBe("{}");
  });
  it("rejects an insecure root and never repairs its permissions", async () => {
    const f = await fixture();
    await input(f.root);
    await chmod(f.root, 0o750);
    await expect(f.cleanup()).rejects.toThrow("canonical and private");
    expect((await lstat(f.root)).mode & 0o7777).toBe(0o750);
  });
});
