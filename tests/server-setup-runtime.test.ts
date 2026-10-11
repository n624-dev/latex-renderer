import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRuntimeMutationLockForPath } from "../deploy/scripts/server-setup-prepare.mjs";
import { prepareServerSetupDirectory } from "../deploy/scripts/server-setup-initial-host.mjs";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";

const roots: string[] = [];
const uid = process.getuid?.() ?? 0,
  gid = process.getgid?.() ?? 0;
const identity = { rootUid: uid, updaterUid: uid, gid };
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "server-setup-runtime-"));
  roots.push(root);
  const runtime = join(root, "runtime"),
    lock = join(runtime, "mutation.lock");
  return { root, runtime, lock };
}

describe.skipIf(process.platform !== "linux")(
  "boot runtime preparation",
  () => {
    it("recreates volatile state and preserves a held lock inode across repeat preparation", async () => {
      const f = await fixture();
      await prepareRuntimeMutationLockForPath(f.runtime, identity);
      const before = await lstat(f.lock);
      expect(before.mode & 0o7777).toBe(0o660);
      expect((await lstat(f.runtime)).mode & 0o7777).toBe(0o770);
      const held = await acquireMutationLockForPath(f.lock);
      try {
        await prepareRuntimeMutationLockForPath(f.runtime, identity);
        expect((await lstat(f.lock)).ino).toBe(before.ino);
        await expect(acquireMutationLockForPath(f.lock)).rejects.toMatchObject({
          code: "MUTATION_LOCK_BUSY",
        });
      } finally {
        await held.release();
      }
      // Simulate /run being lost on reboot, not a production reboot.
      await rm(f.runtime, { recursive: true });
      await prepareRuntimeMutationLockForPath(f.runtime, identity);
      const reacquired = await acquireMutationLockForPath(f.lock);
      await reacquired.release();
    });
    it.each(["symlink", "hardlink", "nonempty"])(
      "refuses a %s lock without changing its target",
      async (kind) => {
        const f = await fixture();
        await mkdir(f.runtime, { mode: 0o770 });
        await chmod(f.runtime, 0o770);
        const target = join(f.root, "outside");
        await writeFile(target, "", { mode: 0o600 });
        await chmod(target, 0o600);
        if (kind === "symlink") await symlink(target, f.lock);
        else if (kind === "hardlink") await link(target, f.lock);
        else await writeFile(f.lock, "existing lock data", { mode: 0o600 });
        await expect(
          prepareRuntimeMutationLockForPath(f.runtime, identity),
        ).rejects.toThrow();
        expect((await lstat(target)).mode & 0o7777).toBe(0o600);
        expect(await readFile(target, "utf8")).toBe("");
        if (kind === "nonempty")
          expect(await readFile(f.lock, "utf8")).toBe("existing lock data");
      },
    );
    it("rejects unexpected directory owners/modes instead of repairing them", async () => {
      const f = await fixture();
      await mkdir(f.runtime, { mode: 0o700 });
      await chmod(f.runtime, 0o700);
      await expect(
        prepareRuntimeMutationLockForPath(f.runtime, identity),
      ).rejects.toThrow();
      expect((await lstat(f.runtime)).mode & 0o7777).toBe(0o700);
      await chmod(f.runtime, 0o770);
      await expect(
        prepareRuntimeMutationLockForPath(f.runtime, {
          ...identity,
          rootUid: uid + 1,
          updaterUid: uid + 2,
        }),
      ).rejects.toThrow("owner");
      await expect(lstat(f.lock)).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("accepts the Updater-owned shared directory without changing its owner", async () => {
      const f = await fixture();
      await mkdir(f.runtime, { mode: 0o770 });
      await chmod(f.runtime, 0o770);
      // Select this fixture UID as the Updater identity. Invalid lock ownership is
      // checked before any chown to the deliberately distinct root identity.
      await writeFile(f.lock, "keep", { mode: 0o600 });
      await expect(
        prepareRuntimeMutationLockForPath(f.runtime, {
          ...identity,
          rootUid: uid + 1,
        }),
      ).rejects.toThrow("Unsafe mutation lock");
      expect((await lstat(f.runtime)).uid).toBe(uid);
      expect(await readFile(f.lock, "utf8")).toBe("keep");
    });
    it("refuses directory/parent symlinks and invalid paths before creating outside data", async () => {
      const f = await fixture();
      const outside = join(f.root, "outside"),
        alias = join(f.root, "alias");
      await mkdir(outside);
      await symlink(outside, alias);
      await expect(
        prepareRuntimeMutationLockForPath(join(alias, "runtime"), identity),
      ).rejects.toThrow();
      await expect(lstat(join(outside, "runtime"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await symlink(outside, f.runtime);
      await expect(
        prepareRuntimeMutationLockForPath(f.runtime, identity),
      ).rejects.toThrow();
      await expect(
        prepareRuntimeMutationLockForPath("relative", identity),
      ).rejects.toThrow();
      await expect(
        prepareRuntimeMutationLockForPath(join(f.root, "other"), {
          ...identity,
          gid: NaN,
        }),
      ).rejects.toThrow();
    });
    it("uses the service owner for ingress runtime on both first setup and subsequent recovery", async () => {
      const f = await fixture();
      await prepareServerSetupDirectory(f.runtime, gid, 0o750, uid);
      const before = await lstat(f.runtime);
      await prepareServerSetupDirectory(f.runtime, gid, 0o750, uid);
      expect((await lstat(f.runtime)).ino).toBe(before.ino);
      expect(before.uid).toBe(uid);
      await expect(
        prepareServerSetupDirectory(f.runtime, gid, 0o750, uid + 1),
      ).rejects.toThrow();
      await chmod(f.runtime, 0o770);
      await expect(
        prepareServerSetupDirectory(f.runtime, gid, 0o750, uid),
      ).rejects.toThrow();
      expect((await lstat(f.runtime)).mode & 0o7777).toBe(0o770);
    });
  },
);
