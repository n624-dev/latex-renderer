import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReleaseArchive } from "../deploy/scripts/release-archive.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("release archive validation", () => {
  it("accepts a bounded regular release tree", async () => {
    const fixture = await archiveFixture("hello");
    await expect(
      validateReleaseArchive({
        bundle: fixture.bundle,
        topLevel: "release",
        maxEntries: 2,
        maxExpandedBytes: 5,
        maxExpandedFileBytes: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects entry-count, expanded-file, and duplicate-path attacks", async () => {
    const fixture = await archiveFixture("hello");
    await expect(
      validateReleaseArchive({
        bundle: fixture.bundle,
        topLevel: "release",
        maxEntries: 1,
        maxExpandedBytes: 100,
        maxExpandedFileBytes: 100,
      }),
    ).rejects.toThrow("too many entries");
    await expect(
      validateReleaseArchive({
        bundle: fixture.bundle,
        topLevel: "release",
        maxEntries: 10,
        maxExpandedBytes: 100,
        maxExpandedFileBytes: 4,
      }),
    ).rejects.toThrow("oversized expanded file");

    const duplicate = join(fixture.root, "duplicate.tar.gz");
    tar(fixture.root, duplicate, ["release", "release/file.txt"]);
    await expect(
      validateReleaseArchive({
        bundle: duplicate,
        topLevel: "release",
        maxEntries: 10,
        maxExpandedBytes: 100,
        maxExpandedFileBytes: 100,
      }),
    ).rejects.toThrow("duplicate paths");
  });

  it("rejects symbolic links before extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "release-archive-link-"));
    roots.push(root);
    await mkdir(join(root, "release"));
    await symlink("target", join(root, "release", "link"));
    const bundle = join(root, "link.tar.gz");
    tar(root, bundle, ["release"]);
    await expect(
      validateReleaseArchive({
        bundle,
        topLevel: "release",
        maxEntries: 10,
        maxExpandedBytes: 100,
        maxExpandedFileBytes: 100,
      }),
    ).rejects.toThrow("regular files and directories");
  });
});

async function archiveFixture(contents: string) {
  const root = await mkdtemp(join(tmpdir(), "release-archive-"));
  roots.push(root);
  await mkdir(join(root, "release"));
  await writeFile(join(root, "release", "file.txt"), contents);
  const bundle = join(root, "release.tar.gz");
  tar(root, bundle, ["release"]);
  return { root, bundle };
}

function tar(root: string, bundle: string, entries: string[]): void {
  const result = spawnSync("tar", ["-czf", bundle, "-C", root, ...entries], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`tar failed: ${result.stderr || result.stdout}`);
}
