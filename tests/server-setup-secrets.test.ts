import {
  mkdtemp,
  chmod,
  readFile,
  rm,
  lstat,
  symlink,
  writeFile,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerSetupSecrets } from "../deploy/scripts/server-setup-secrets.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "server-setup-secrets-"));
  roots.push(root);
  await chmod(root, 0o700);
  const store = new ServerSetupSecrets(
    root,
    process.getgid?.() ?? 0,
    process.getuid?.() ?? 0,
    process.getgid?.() ?? 0,
  );
  return { root, store };
}
describe("prepared-host generated secrets", () => {
  it.each(["image-manager-token", "update-manager-token"] as const)(
    "creates printable %s compatible with existing bearer-token readers",
    async (slot) => {
      const f = await fixture();
      await f.store.ensure(slot);
      const value = await readFile(join(f.root, slot), "utf8");
      expect(value).toMatch(/^[a-f0-9]{64}\n$/);
      expect((await lstat(join(f.root, slot))).mode & 0o7777).toBe(0o400);
      expect(await f.store.ensure(slot)).toEqual({ slot, status: "preserved" });
      expect((await f.store.read(slot)).toString()).toBe(value);
    },
  );
  it("preserves valid legacy hex tokens and rejects binary/invalid token files", async () => {
    const f = await fixture(),
      path = join(f.root, "image-manager-token");
    await writeFile(path, "a".repeat(64), { mode: 0o400 });
    await chmod(path, 0o400);
    expect(await f.store.ensure("image-manager-token")).toMatchObject({
      status: "preserved",
    });
    await chmod(path, 0o600);
    await writeFile(path, Buffer.alloc(65, 255));
    await chmod(path, 0o400);
    await expect(f.store.ensure("image-manager-token")).rejects.toThrow(
      "encoding",
    );
    expect(await readFile(path)).toEqual(Buffer.alloc(65, 255));
  });
  it("supports only explicitly opted-in read-only service-group key directories", async () => {
    const f = await fixture(),
      uid = process.getuid?.() ?? 0,
      gid = process.getgid?.() ?? 0;
    await chmod(f.root, 0o750);
    const store = new ServerSetupSecrets(f.root, gid, uid, gid, true);
    await store.ensure("v1.key");
    expect((await store.read("v1.key")).length).toBe(32);
    expect((await lstat(join(f.root, "v1.key"))).mode & 0o7777).toBe(0o440);
    await chmod(f.root, 0o770);
    await expect(store.ensure("v1.key")).rejects.toThrow("prepared");
  });
  it.each(["api-key-pepper", "auth-password-pepper"] as const)(
    "creates %s once with exact permissions and never outputs its contents",
    async (slot) => {
      const f = await fixture(),
        first = await f.store.ensure(slot);
      expect(first).toEqual({ slot, status: "created" });
      const value = await readFile(join(f.root, slot)),
        info = await lstat(join(f.root, slot));
      expect(value.length).toBe(32);
      expect(info.nlink).toBe(1);
      expect(info.mode & 0o7777).toBe(
        slot === "api-key-pepper" ? 0o400 : 0o440,
      );
      expect(await f.store.ensure(slot)).toEqual({ slot, status: "preserved" });
      expect(await f.store.read(slot)).toEqual(value);
      expect(await readFile(join(f.root, slot))).toEqual(value);
      expect(JSON.stringify(first)).not.toContain(value.toString("hex"));
    },
  );
  it("does not rotate or repair an invalid existing key", async () => {
    const f = await fixture(),
      path = join(f.root, "api-key-pepper");
    await writeFile(path, "existing invalid key", { mode: 0o400 });
    await chmod(path, 0o400);
    await expect(f.store.ensure("api-key-pepper")).rejects.toThrow(
      "Existing secret is invalid",
    );
    expect(await readFile(path, "utf8")).toBe("existing invalid key");
  });
  it("refuses unexpected sharing and permission bits without changing an existing key", async () => {
    const f = await fixture();
    await f.store.ensure("api-key-pepper");
    const path = join(f.root, "api-key-pepper");
    await link(path, join(f.root, "shared"));
    await expect(f.store.ensure("api-key-pepper")).rejects.toThrow(
      "Existing secret is invalid",
    );
    expect((await lstat(path)).nlink).toBe(2);
    await rm(join(f.root, "shared"));
    await chmod(path, 0o440);
    await expect(f.store.ensure("api-key-pepper")).rejects.toThrow(
      "Existing secret is invalid",
    );
    expect((await lstat(path)).mode & 0o7777).toBe(0o440);
  });
  it("does not follow a secret symlink or overwrite its target", async () => {
    const f = await fixture(),
      outside = await fixture();
    const target = join(outside.root, "untouched");
    await writeFile(target, "do not change");
    await symlink(target, join(f.root, "api-key-pepper"));
    await expect(f.store.ensure("api-key-pepper")).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("do not change");
  });
  it("does not create the directory or fix insecure directory permissions", async () => {
    const f = await fixture();
    await chmod(f.root, 0o750);
    await expect(f.store.ensure("api-key-pepper")).rejects.toThrow(
      "already be prepared",
    );
    expect((await lstat(f.root)).mode & 0o7777).toBe(0o750);
  });
  it("restricts slot names, not arbitrary file paths", async () => {
    const f = await fixture();
    await expect(
      Reflect.apply(f.store.ensure.bind(f.store), f.store, ["../outside"]),
    ).rejects.toThrow("Unsupported generated secret slot");
  });
  it("recovers a pre-publication orphan and a linked publication without rotating the key", async () => {
    const f = await fixture();
    await f.store.ensure("api-key-pepper");
    const value = await f.store.read("api-key-pepper");
    await link(
      join(f.root, "api-key-pepper"),
      join(f.root, `.setup-secret-${"a".repeat(48)}`),
    );
    const orphan = join(f.root, `.setup-secret-${"b".repeat(48)}`);
    await writeFile(orphan, "", { mode: 0o600 });
    await chmod(orphan, 0o600);
    expect(await f.store.recover()).toEqual({ removed: 2 });
    expect(await f.store.read("api-key-pepper")).toEqual(value);
    expect(await f.store.recover()).toEqual({ removed: 0 });
  });
  it("never follows external symlinks or erases unexpected shared recovery entries", async () => {
    const f = await fixture(),
      outside = await fixture();
    const value = join(outside.root, "outside");
    await writeFile(value, "untouched", { mode: 0o600 });
    const temporary = join(f.root, `.setup-secret-${"c".repeat(48)}`);
    await symlink(value, temporary);
    await expect(f.store.recover()).rejects.toThrow(
      "Unexpected secret recovery entry",
    );
    expect(await readFile(value, "utf8")).toBe("untouched");
    await rm(temporary);
    await link(value, temporary);
    await expect(f.store.recover()).rejects.toThrow(
      "Unexpected secret recovery sharing",
    );
    expect((await lstat(value)).nlink).toBe(2);
  });
});
