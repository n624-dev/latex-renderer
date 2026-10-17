import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishRelease,
  collectReleasePublications,
} from "../deploy/scripts/release-publication.mjs";

const roots: string[] = [];
// Fixture identities must not become the application's active RC on a bump.
const fixtureVersion = "7.8.9";
const fixturePackage = JSON.stringify({ version: fixtureVersion }) + "\n";
it.skipIf(process.platform !== "linux")(
  "bounds interrupted publications by count and age under the same publication lock",
  async () => {
    const f = await fixture();
    for (let n = 0; n < 4; n++)
      await expect(
        publishRelease({
          ...f,
          releaseId: `fixture-${n}`,
          copy: () => Promise.reject(new Error("interrupted")),
        }),
      ).rejects.toThrow("interrupted");
    const options = {
      releasesRoot: f.releasesRoot,
      journalRoot: f.journalRoot,
    };
    await collectReleasePublications(options);
    expect(
      (await readdir(f.releasesRoot)).filter((n) => n.startsWith(".pending-")),
    ).toHaveLength(2);
    expect(
      await collectReleasePublications({
        ...options,
        now: Date.now() + 25 * 3600_000,
      }),
    ).toBe(2);
    expect(await readdir(f.releasesRoot)).toEqual([]);
  },
);
it.skipIf(process.platform !== "linux")(
  "does not collect a publication while its copy is running",
  async () => {
    const f = await fixture();
    let ready!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
    const publication = publishRelease({
      ...f,
      copy: async () => {
        ready();
        await gate;
        throw new Error("fixture end");
      },
    });
    const expected = expect(publication).rejects.toThrow("fixture end");
    await started;
    try {
      await expect(
        collectReleasePublications({
          releasesRoot: f.releasesRoot,
          journalRoot: f.journalRoot,
          now: Date.now() + 25 * 3600_000,
        }),
      ).rejects.toMatchObject({ code: "MUTATION_LOCK_BUSY" });
    } finally {
      finish();
      await expected;
    }
  },
);
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".publication-fixture-"));
  roots.push(root);
  const source = join(root, "source"),
    releasesRoot = join(root, "releases"),
    journalRoot = join(root, "journals");
  await mkdir(source, { mode: 0o755 });
  await mkdir(releasesRoot, { mode: 0o755 });
  await mkdir(join(source, "bin"));
  await writeFile(join(source, "package.json"), fixturePackage);
  await writeFile(join(source, "bin", "run"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await symlink("bin/run", join(source, "native"));
  return {
    source,
    releasesRoot,
    journalRoot,
    releaseId: `v${fixtureVersion}-aaaaaaaaaaaa`,
  };
}
const copy = async (source: string, destination: string) => {
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
};
const pending = async (root: string) =>
  (await readdir(root)).filter((x) => x.startsWith(".pending-"));

async function verifiedFixture() {
  const f = await fixture(),
    commit = "a".repeat(40),
    driver = "deploy/scripts/deploy-production-release.sh";
  await mkdir(join(f.source, "deploy", "scripts"), { recursive: true });
  const bytes = Buffer.from("#!/bin/sh\n# original signed driver\n");
  await writeFile(join(f.source, driver), bytes);
  const identity = { schemaVersion: 1, version: fixtureVersion, commit };
  await writeFile(
    join(f.source, ".latex-renderer-release.json"),
    JSON.stringify({ ...identity, repository: "n624-dev/latex-renderer" }),
  );
  await writeFile(
    join(f.source, ".latex-renderer-updater.json"),
    JSON.stringify({
      ...identity,
      files: {
        [driver]: {
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    }),
  );
  await mkdir(join(f.source, "client-dist"));
  await writeFile(
    join(f.source, "client-dist", "signed.mcpb"),
    "first build signature",
  );
  return f;
}

describe.skipIf(process.platform !== "linux")(
  "atomic release publication",
  () => {
    it("rejects shared copied inodes before changing source permissions", async () => {
      const f = await fixture(),
        file = join(f.source, "package.json"),
        before = await lstat(file);
      await expect(
        publishRelease({
          ...f,
          copy: async (_s, d) => {
            await link(file, join(d, "package.json"));
          },
        }),
      ).rejects.toThrow("Shared release copy inode");
      expect((await lstat(file)).mode).toBe(before.mode);
      expect(await readFile(file, "utf8")).toContain(fixtureVersion);
    });
    it("refuses an external lock symlink without touching the other file", async () => {
      const f = await fixture();
      await mkdir(f.journalRoot, { mode: 0o700 });
      const outside = join(f.source, "package.json");
      await symlink(outside, join(f.journalRoot, "publication.lock"));
      await expect(publishRelease(f)).rejects.toThrow(
        "Unsafe release publication lock",
      );
      expect(await readFile(outside, "utf8")).toContain(fixtureVersion);
    });
    it("refuses source symlinks outside the payload and validates excluded stage leftovers before recovery", async () => {
      const f = await fixture();
      await symlink(f.releasesRoot, join(f.source, "outside"));
      await expect(publishRelease(f)).rejects.toThrow(
        "External release symlink",
      );
      await rm(join(f.source, "outside"));
      await expect(
        publishRelease({ ...f, copy: () => Promise.reject(new Error("stop")) }),
      ).rejects.toThrow("stop");
      const journal = JSON.parse(
        await readFile(join(f.journalRoot, `${f.releaseId}.json`), "utf8"),
      ) as { stage: string };
      await symlink(f.source, join(f.releasesRoot, journal.stage, ".git"));
      await expect(publishRelease(f)).rejects.toThrow(
        "External release symlink",
      );
    });
    it("reuses verified source after a different CMS build while detecting control and installed tampering", async () => {
      const f = await verifiedFixture();
      await publishRelease(f);
      await writeFile(
        join(f.source, "client-dist", "signed.mcpb"),
        "another build signature",
      );
      expect((await publishRelease(f)).reused).toBe(true);
      expect(
        await readFile(
          join(f.releasesRoot, f.releaseId, "client-dist", "signed.mcpb"),
          "utf8",
        ),
      ).toBe("first build signature");
      await writeFile(
        join(f.source, "package.json"),
        "modified control source",
      );
      await expect(publishRelease(f)).rejects.toThrow("identity differs");
      await writeFile(join(f.source, "package.json"), fixturePackage);
      await writeFile(
        join(f.releasesRoot, f.releaseId, "client-dist", "signed.mcpb"),
        "tampered installed build",
      );
      await expect(publishRelease(f)).rejects.toThrow("contents differ");
    });
    it("restarts an interrupted publication with regenerated derived output", async () => {
      const f = await verifiedFixture();
      await expect(
        publishRelease({
          ...f,
          checkpoint: (p) =>
            p === "copy-durable"
              ? Promise.reject(new Error("interrupted"))
              : Promise.resolve(),
        }),
      ).rejects.toThrow("interrupted");
      await writeFile(
        join(f.source, "client-dist", "signed.mcpb"),
        "rebuilt signature",
      );
      expect((await publishRelease(f)).reused).toBe(false);
      expect(
        await readFile(
          join(f.releasesRoot, f.releaseId, "client-dist", "signed.mcpb"),
          "utf8",
        ),
      ).toBe("rebuilt signature");
    });
    it("preserves the immutable tree when rollback uses the verified running Updater driver", async () => {
      const f = await verifiedFixture();
      await publishRelease(f);
      const driver = "deploy/scripts/deploy-production-release.sh";
      await writeFile(
        join(f.source, driver),
        "# current signed updater driver used only to run rollback\n",
      );
      expect((await publishRelease(f)).reused).toBe(true);
      expect(
        await readFile(join(f.releasesRoot, f.releaseId, driver), "utf8"),
      ).toContain("original signed driver");
    });
    it("reuses a legacy complete release for locked rollback without overwriting its original driver", async () => {
      const f = await verifiedFixture();
      await publishRelease(f);
      const target = join(f.releasesRoot, f.releaseId),
        marker = join(target, ".host-prepare-source-complete");
      await writeFile(marker, "");
      const before = await lstat(target);
      await writeFile(
        join(f.source, "deploy/scripts/deploy-production-release.sh"),
        "# trusted running updater driver\n",
      );
      expect((await publishRelease(f)).reused).toBe(true);
      expect((await lstat(target)).ino).toBe(before.ino);
      expect(
        await readFile(
          join(target, "deploy/scripts/deploy-production-release.sh"),
          "utf8",
        ),
      ).toContain("original signed driver");
    });
    it("uses the native copy and publishes a fully checked, normalized payload, reusing it without writes", async () => {
      const f = await fixture();
      await mkdir(join(f.source, ".git"));
      await writeFile(join(f.source, ".git", "ignored"), "git");
      await mkdir(join(f.source, ".deployment-tooling"));
      await writeFile(join(f.source, ".deployment-tooling", "ignored"), "tool");
      expect(await publishRelease(f)).toEqual({
        releaseId: f.releaseId,
        reused: false,
      });
      const target = join(f.releasesRoot, f.releaseId),
        before = await lstat(target);
      const marker = JSON.parse(
        await readFile(join(target, ".host-prepare-source-complete"), "utf8"),
      ) as { treeHash: string };
      expect(marker).toMatchObject({ format: 1, releaseId: f.releaseId });
      expect(marker.treeHash).toMatch(/^[a-f0-9]{64}$/);
      expect((await lstat(join(target, "package.json"))).mode & 0o777).toBe(
        0o640,
      );
      expect((await lstat(join(target, "bin", "run"))).mode & 0o777).toBe(
        0o750,
      );
      expect(await readdir(target)).not.toContain(".git");
      expect(await readdir(target)).not.toContain(".deployment-tooling");
      expect(await publishRelease(f)).toEqual({
        releaseId: f.releaseId,
        reused: true,
      });
      expect((await lstat(target)).ino).toBe(before.ino);
      expect((await lstat(target)).mtimeMs).toBe(before.mtimeMs);
      expect(await pending(f.releasesRoot)).toEqual([]);
    });
    it.each(["ENOSPC", "EIO"])(
      "retries the same immutable release after a partial %s without publishing incomplete data",
      async (code) => {
        const f = await fixture(),
          old = join(f.releasesRoot, "old-good");
        await mkdir(old);
        await writeFile(join(old, "kept"), "old");
        await expect(
          publishRelease({
            ...f,
            copy: async (_s, destination) => {
              await writeFile(join(destination, "partial"), "partial");
              throw Object.assign(new Error(code), { code });
            },
          }),
        ).rejects.toMatchObject({ code });
        expect(await readdir(f.releasesRoot)).not.toContain(f.releaseId);
        expect(await pending(f.releasesRoot)).toHaveLength(1);
        expect((await publishRelease({ ...f, copy })).reused).toBe(false);
        expect(await readFile(join(old, "kept"), "utf8")).toBe("old");
        expect(await pending(f.releasesRoot)).toEqual([]);
      },
    );
    it.each(["journal-durable", "copy-durable", "published"] as const)(
      "recovers interruption at %s",
      async (phase) => {
        const f = await fixture();
        await expect(
          publishRelease({
            ...f,
            copy,
            checkpoint: (p) =>
              p === phase
                ? Promise.reject(new Error("interrupted"))
                : Promise.resolve(),
          }),
        ).rejects.toThrow("interrupted");
        const result = await publishRelease({ ...f, copy });
        expect(result.reused).toBe(phase === "published");
        expect(await pending(f.releasesRoot)).toEqual([]);
        expect(
          (await readdir(f.journalRoot)).filter((x) => x.endsWith(".json")),
        ).toEqual([]);
      },
    );
    it("recovers an actual SIGKILL after durable copy with the kernel lock released", async () => {
      const f = await fixture();
      const script = `import {publishRelease} from ${JSON.stringify(resolve("deploy/scripts/release-publication.mjs"))};await publishRelease({...${JSON.stringify(f)},checkpoint:async phase=>{if(phase==='copy-durable')process.kill(process.pid,'SIGKILL');}});`;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        { stdio: "ignore" },
      );
      const signal = await new Promise((resolvePromise) =>
        child.once("close", (_code, s) => resolvePromise(s)),
      );
      expect(signal).toBe("SIGKILL");
      const deadline = Date.now() + 2000;
      for (;;) {
        try {
          await publishRelease({ ...f, copy });
          break;
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "MUTATION_LOCK_BUSY"
            ) ||
            Date.now() >= deadline
          )
            throw error;
          await delay(20);
        }
      }
      expect(await pending(f.releasesRoot)).toEqual([]);
    });
    it("rejects concurrent publication while the first copy is active", async () => {
      const f = await fixture();
      let copied = () => {},
        release = () => {};
      const entered = new Promise<void>((r) => {
          copied = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const first = publishRelease({
        ...f,
        copy: async (s, d) => {
          copied();
          await gate;
          await copy(s, d);
        },
      });
      await Promise.race([entered, first]);
      try {
        await expect(publishRelease({ ...f, copy })).rejects.toMatchObject({
          code: "MUTATION_LOCK_BUSY",
        });
      } finally {
        release();
        await first;
      }
    });
    it("never overwrites a completed release with different bytes or trusts a marker alone", async () => {
      const f = await fixture();
      await publishRelease({ ...f, copy });
      const target = join(f.releasesRoot, f.releaseId);
      await writeFile(join(f.source, "package.json"), "different");
      await expect(publishRelease({ ...f, copy })).rejects.toThrow(
        "identity differs",
      );
      expect(await readFile(join(target, "package.json"), "utf8")).toContain(
        fixtureVersion,
      );
      await writeFile(join(f.source, "package.json"), fixturePackage);
      await writeFile(join(target, "package.json"), "tampered");
      await expect(publishRelease({ ...f, copy })).rejects.toThrow(
        "contents differ",
      );
    });
    it("allows an old empty completion marker only after full source verification", async () => {
      const f = await fixture();
      await publishRelease({ ...f, copy });
      await writeFile(
        join(f.releasesRoot, f.releaseId, ".host-prepare-source-complete"),
        "",
      );
      expect((await publishRelease({ ...f, copy })).reused).toBe(true);
    });
    it("refuses unknown legacy partial directories, target links and traversal", async () => {
      const f = await fixture(),
        target = join(f.releasesRoot, f.releaseId);
      await mkdir(target, { mode: 0o755 });
      await writeFile(join(target, "unknown"), "keep");
      await expect(publishRelease({ ...f, copy })).rejects.toThrow(
        "incomplete or unrecognized",
      );
      expect(await readFile(join(target, "unknown"), "utf8")).toBe("keep");
      await expect(
        publishRelease({ ...f, releaseId: "../outside", copy }),
      ).rejects.toThrow("identifier");
      const other = { ...f, releaseId: "link-target" };
      await symlink(f.source, join(f.releasesRoot, other.releaseId));
      await expect(publishRelease({ ...other, copy })).rejects.toThrow(
        "Unsafe",
      );
    });
    it("refuses corrupted, writable, mismatched journals and modified pending links without deleting outside data", async () => {
      const f = await fixture();
      await expect(
        publishRelease({
          ...f,
          copy: () => Promise.reject(new Error("copy failed")),
        }),
      ).rejects.toThrow("copy failed");
      const journalPath = join(f.journalRoot, `${f.releaseId}.json`),
        original = await readFile(journalPath, "utf8");
      await writeFile(journalPath, "{");
      await expect(publishRelease({ ...f, copy })).rejects.toThrow();
      await writeFile(journalPath, original);
      await chmod(journalPath, 0o666);
      await expect(publishRelease({ ...f, copy })).rejects.toThrow("Unsafe");
      await chmod(journalPath, 0o600);
      const j = JSON.parse(original) as { stage: string };
      await writeFile(
        journalPath,
        JSON.stringify({ ...j, stage: "../source" }),
      );
      await expect(publishRelease({ ...f, copy })).rejects.toThrow(
        "Corrupt pending publication journal",
      );
      await writeFile(journalPath, original);
      await symlink(f.source, join(f.releasesRoot, j.stage, "outside"));
      await expect(publishRelease({ ...f, copy })).rejects.toThrow("External");
      expect(await readFile(join(f.source, "package.json"), "utf8")).toContain(
        fixtureVersion,
      );
    });
    it("detects a bad copy before the final name becomes visible", async () => {
      const f = await fixture();
      await expect(
        publishRelease({
          ...f,
          copy: async (s, d) => {
            await copy(s, d);
            await writeFile(join(d, "extra"), "not verified");
          },
        }),
      ).rejects.toThrow("differs");
      expect(await readdir(f.releasesRoot)).not.toContain(f.releaseId);
    });
  },
);
