import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureReleaseRetention,
  collectReleases,
  collectHelperStages,
} from "../deploy/scripts/release-retention.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".retention-fixture-"));
  roots.push(root);
  await chmod(root, 0o700);
  const releasesRoot = join(root, "releases"),
    currentLink = join(root, "current"),
    statePath = join(root, "retention.json");
  await mkdir(releasesRoot, { mode: 0o700 });
  const id = (n: number) =>
    `v1.0.${n}-${String(n).padStart(40, "a").slice(0, 12)}`;
  async function create(n: number) {
    const path = join(releasesRoot, id(n));
    await mkdir(path, { mode: 0o750 });
    await writeFile(
      join(path, ".latex-renderer-release.json"),
      JSON.stringify({
        version: `1.0.${n}`,
        commit: String(n).padStart(40, "a"),
      }),
      { mode: 0o640 },
    );
    await writeFile(join(path, "payload"), String(n), { mode: 0o640 });
    return id(n);
  }
  async function activate(n: number) {
    await unlink(currentLink).catch(() => {});
    await symlink(join(releasesRoot, id(n)), currentLink);
  }
  return { root, releasesRoot, currentLink, statePath, id, create, activate };
}
describe.skipIf(process.platform !== "linux")(
  "successful release and recovery-reference retention",
  () => {
    it("collects only marked inactive helper stages and resumes its own partial trash without following an external link", async () => {
      const f = await fixture();
      for (const name of [
        "privileged-abcdef",
        ".gc-privileged-rollback-ABCDEF",
        "privileged-legacy",
      ]) {
        const path = join(f.root, name);
        await mkdir(path, { mode: 0o700 });
        await writeFile(join(path, "data"), "retained");
      }
      const managed = join(f.root, "privileged-abcdef");
      await writeFile(join(managed, ".helper-stage-v2"), '{"format":2}', {
        mode: 0o600,
      });
      await symlink(f.releasesRoot, join(managed, "outside"));
      expect(await collectHelperStages({ root: f.root })).toBe(2);
      expect(
        await readFile(join(f.root, "privileged-legacy", "data"), "utf8"),
      ).toBe("retained");
      expect((await lstat(f.releasesRoot)).isDirectory()).toBe(true);
    });
    it("refuses helper-stage mount traversal", async () => {
      const f = await fixture(),
        path = join(f.root, "privileged-abcdef");
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, ".helper-stage-v2"), '{"format":2}', {
        mode: 0o600,
      });
      await expect(
        collectHelperStages({
          root: f.root,
          mountPaths: [join(path, "nested")],
        }),
      ).rejects.toThrow("Mounted");
      expect((await lstat(path)).isDirectory()).toBe(true);
    });
    it.each(["deletion-recorded", "trashed", "deleted"] as const)(
      "resumes interrupted deletion at %s without touching retained code",
      async (phase) => {
        const f = await fixture();
        await f.create(1);
        await f.activate(1);
        await captureReleaseRetention(f);
        await f.create(2);
        await f.create(3);
        await f.activate(3);
        await expect(
          collectReleases({
            ...f,
            releaseId: f.id(3),
            checkpoint: (p) =>
              p === phase
                ? Promise.reject(new Error("interrupted"))
                : Promise.resolve(),
          }),
        ).rejects.toThrow("interrupted");
        await collectReleases({
          ...f,
          releaseId: f.id(3),
          markVerified: false,
        });
        expect(await readdir(f.releasesRoot)).toEqual([f.id(1), f.id(3)]);
        expect(JSON.parse(await readFile(f.statePath, "utf8"))).toMatchObject({
          deleting: [],
        });
      },
    );
    it("periodic GC does not label a failed active candidate as a successful release", async () => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      await f.create(2);
      await f.activate(2);
      await collectReleases({ ...f, releaseId: f.id(2), markVerified: false });
      expect(JSON.parse(await readFile(f.statePath, "utf8"))).toMatchObject({
        successful: [{ id: f.id(1) }],
      });
    });
    it("does not let failed candidates with newer mtimes displace the last known-good release", async () => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      for (const n of [2, 3, 4]) {
        await f.create(n);
        await utimes(
          join(f.releasesRoot, f.id(n)),
          new Date("2099-01-01"),
          new Date("2099-01-01"),
        );
      }
      await f.create(5);
      await f.activate(5);
      const result = await collectReleases({ ...f, releaseId: f.id(5) });
      expect(result.removed).toBe(3);
      expect(await readdir(f.releasesRoot)).toEqual(
        expect.arrayContaining([f.id(1), f.id(5)]),
      );
      expect(JSON.parse(await readFile(f.statePath, "utf8"))).toMatchObject({
        previous: f.id(1),
        successful: [{ id: f.id(5) }, { id: f.id(1) }],
      });
    });
    it("keeps three successful generations plus live recovery references, then collects after unprotection", async () => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      for (const n of [2, 3, 4, 5]) {
        await captureReleaseRetention(f);
        await f.create(n);
        await f.activate(n);
        await collectReleases({
          ...f,
          releaseId: f.id(n),
          protectedIds: [f.id(1)],
        });
      }
      expect(await readdir(f.releasesRoot)).toEqual(
        expect.arrayContaining([f.id(1), f.id(3), f.id(4), f.id(5)]),
      );
      await collectReleases({ ...f, releaseId: f.id(5) });
      expect(await readdir(f.releasesRoot)).toEqual([
        f.id(3),
        f.id(4),
        f.id(5),
      ]);
    });
    it("does not promote an unverified active candidate on retry/restart", async () => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      await f.create(2);
      await f.activate(2);
      await captureReleaseRetention(f);
      expect(JSON.parse(await readFile(f.statePath, "utf8"))).toMatchObject({
        previous: f.id(1),
        successful: [{ id: f.id(1) }],
      });
      await f.create(3);
      await f.activate(3);
      await collectReleases({ ...f, releaseId: f.id(3) });
      expect(await readdir(f.releasesRoot)).toEqual([f.id(1), f.id(3)]);
    });
    it.each([
      "corrupt-state",
      "wrong-current",
      "external-link",
      "nested-mount",
      "wrong-metadata",
      "writable-dir",
    ] as const)("fails closed before any deletion: %s", async (fault) => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      await f.create(2);
      await f.create(3);
      await f.activate(3);
      let mountPaths: string[] = [];
      if (fault === "corrupt-state") await writeFile(f.statePath, "{");
      if (fault === "wrong-current") await f.activate(2);
      if (fault === "external-link")
        await symlink(f.root, join(f.releasesRoot, f.id(2), "outside"));
      if (fault === "nested-mount")
        mountPaths = [join(f.releasesRoot, f.id(2), "nested")];
      if (fault === "wrong-metadata")
        await writeFile(
          join(f.releasesRoot, f.id(2), ".latex-renderer-release.json"),
          "{}",
        );
      if (fault === "writable-dir")
        await chmod(join(f.releasesRoot, f.id(2)), 0o770);
      await expect(
        collectReleases({ ...f, releaseId: f.id(3), mountPaths }),
      ).rejects.toThrow();
      expect(await readdir(f.releasesRoot)).toHaveLength(3);
      expect((await lstat(f.root)).isDirectory()).toBe(true);
    });
    it("rejects malicious protected IDs and corrupted pre-switch metadata", async () => {
      const f = await fixture();
      await f.create(1);
      await f.activate(1);
      await captureReleaseRetention(f);
      await expect(
        collectReleases({
          ...f,
          releaseId: f.id(1),
          protectedIds: ["../elsewhere"],
        }),
      ).rejects.toThrow("identity");
      await writeFile(f.statePath, "{}");
      await expect(captureReleaseRetention(f)).rejects.toThrow("Corrupt");
    });
  },
);
