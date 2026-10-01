import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertReleaseExtractor,
  copyRootReleaseBundle,
  prepareReleaseExtraction,
} from "../deploy/scripts/release-extraction.mjs";
import { validateReleaseArchive } from "../deploy/scripts/release-archive.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat), chown: vi.fn(actual.chown) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.lstat).mockReset();
  vi.mocked(fs.chown).mockReset();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function simulateRootCopy(root: string, destination: string) {
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.spyOn(process, "getuid").mockReturnValue(0);
  vi.mocked(fs.chown).mockResolvedValue(undefined);
  vi.mocked(fs.lstat).mockImplementation(async (path) => {
    const info = await actual.lstat(path);
    return path === root || path === destination
      ? Object.assign(info, { uid: 0, gid: 0 })
      : info;
  });
}

it("seals only the new root copy and preserves input content/owner/mode", async () => {
  const f = await fixture(),
    destination = join(f.root, "root-copy.tar.gz");
  const before = await fs.lstat(f.bundle);
  await simulateRootCopy(f.root, destination);
  await copyRootReleaseBundle(f.bundle, destination);
  expect(fs.chown).toHaveBeenCalledExactlyOnceWith(destination, 0, 0);
  const copied = await fs.stat(destination),
    after = await fs.stat(f.bundle);
  expect(copied.mode & 0o7777).toBe(0o600);
  expect(copied.nlink).toBe(1);
  expect(copied.ino).not.toBe(after.ino);
  expect(after.uid).toBe(before.uid);
  expect(after.mode).toBe(before.mode);
  expect(await fs.readFile(destination)).toEqual(await fs.readFile(f.bundle));
});

it("rejects non-root copies before any ownership mutation", async () => {
  const f = await fixture();
  vi.spyOn(process, "getuid").mockReturnValue(12345);
  await expect(
    copyRootReleaseBundle(f.bundle, join(f.root, "root-copy")),
  ).rejects.toThrow("requires root");
  expect(fs.chown).not.toHaveBeenCalled();
});

it("never overwrites or takes ownership of an existing destination", async () => {
  const f = await fixture(),
    destination = join(f.root, "existing");
  await fs.writeFile(destination, "keep existing");
  await simulateRootCopy(f.root, destination);
  await expect(
    copyRootReleaseBundle(f.bundle, destination),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(fs.chown).not.toHaveBeenCalled();
  expect(await fs.readFile(destination, "utf8")).toBe("keep existing");
});

it("rejects non-private root destination and shared source inodes", async () => {
  const f = await fixture(),
    destination = join(f.root, "root-copy");
  await simulateRootCopy(f.root, destination);
  await fs.chmod(f.root, 0o750);
  await expect(copyRootReleaseBundle(f.bundle, destination)).rejects.toThrow(
    "private root directory",
  );
  await fs.chmod(f.root, 0o700);
  await fs.link(f.bundle, join(f.root, "source-alias"));
  await expect(copyRootReleaseBundle(f.bundle, destination)).rejects.toThrow(
    "private regular file",
  );
  expect(fs.chown).not.toHaveBeenCalled();
});

it("rejects source or destination-parent symlinks before root copying", async () => {
  const f = await fixture(),
    destination = join(f.root, "root-copy"),
    link = join(f.root, "source-link"),
    parent = join(f.root, "parent-link");
  await simulateRootCopy(f.root, destination);
  await fs.symlink(f.bundle, link);
  await fs.symlink(f.root, parent);
  await expect(copyRootReleaseBundle(link, destination)).rejects.toThrow(
    "canonical paths",
  );
  await expect(
    copyRootReleaseBundle(f.bundle, join(parent, "root-copy")),
  ).rejects.toThrow("canonical paths");
  expect(fs.chown).not.toHaveBeenCalled();
});

it("rejects a copy whose ownership did not become root after sealing", async () => {
  const f = await fixture(),
    destination = join(f.root, "root-copy");
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.spyOn(process, "getuid").mockReturnValue(0);
  vi.mocked(fs.chown).mockResolvedValue(undefined);
  vi.mocked(fs.lstat).mockImplementation(async (path) => {
    const info = await actual.lstat(path);
    return path === f.root
      ? Object.assign(info, { uid: 0 })
      : path === destination
        ? Object.assign(info, { uid: 12345 })
        : info;
  });
  await expect(copyRootReleaseBundle(f.bundle, destination)).rejects.toThrow(
    "not sealed",
  );
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "release-extraction-"));
  roots.push(root);
  const source = join(root, "source"),
    directory = join(root, "verified"),
    bundle = join(root, "release.tar.gz");
  await fs.mkdir(join(source, "release", "nested"), { recursive: true });
  await fs.writeFile(
    join(source, "release", "nested", "fixture.txt"),
    "verified bytes",
  );
  execFileSync("tar", ["-czf", bundle, "-C", source, "release"]);
  await fs.chmod(bundle, 0o600);
  await fs.mkdir(directory, { mode: 0o700 });
  return { root, source, directory, bundle };
}

it("extracts a validated nested GNU archive with fixed libarchive executable and safe flags", async () => {
  const f = await fixture();
  await validateReleaseArchive({
    bundle: f.bundle,
    topLevel: "release",
    maxEntries: 10,
    maxExpandedBytes: 100,
    maxExpandedFileBytes: 100,
  });
  const plan = await prepareReleaseExtraction(f.bundle, f.directory);
  expect(plan.command).toBe("/usr/bin/bsdtar");
  expect(plan.args).toEqual([
    "-xf",
    f.bundle,
    "--directory",
    f.directory,
    "--no-same-owner",
    "--no-same-permissions",
    "--no-acls",
    "--no-fflags",
    "--no-xattrs",
    "--safe-writes",
  ]);
  execFileSync(plan.command, plan.args);
  expect(
    await fs.readFile(join(f.directory, "release/nested/fixture.txt"), "utf8"),
  ).toBe("verified bytes");
});

it("rejects existing output instead of overwriting it", async () => {
  const f = await fixture();
  await fs.writeFile(join(f.directory, "existing.txt"), "keep");
  await expect(prepareReleaseExtraction(f.bundle, f.directory)).rejects.toThrow(
    "must be empty",
  );
  expect(await fs.readFile(join(f.directory, "existing.txt"), "utf8")).toBe(
    "keep",
  );
});

it("does not import setuid/setgid permissions from the archive", async () => {
  const f = await fixture();
  await fs.chmod(join(f.source, "release/nested/fixture.txt"), 0o6755);
  execFileSync("tar", ["-czf", f.bundle, "-C", f.source, "release"]);
  const plan = await prepareReleaseExtraction(f.bundle, f.directory);
  execFileSync(plan.command, plan.args);
  expect(
    (await fs.lstat(join(f.directory, "release/nested/fixture.txt"))).mode &
      0o6000,
  ).toBe(0);
});

it.each(["bundle", "directory"] as const)(
  "rejects a symlink %s",
  async (field) => {
    const f = await fixture(),
      link = join(f.root, "link");
    await fs.symlink(f[field], link);
    await expect(
      prepareReleaseExtraction(
        field === "bundle" ? link : f.bundle,
        field === "directory" ? link : f.directory,
      ),
    ).rejects.toThrow("canonical absolute paths");
  },
);

it("rejects symlink ancestors and noncanonical/relative paths", async () => {
  const f = await fixture(),
    link = join(f.root, "parent-link");
  await fs.symlink(f.root, link);
  await expect(
    prepareReleaseExtraction(join(link, "release.tar.gz"), f.directory),
  ).rejects.toThrow("canonical absolute paths");
  await expect(
    prepareReleaseExtraction(`${f.root}/source/../release.tar.gz`, f.directory),
  ).rejects.toThrow("canonical absolute paths");
  await expect(
    prepareReleaseExtraction("release.tar.gz", f.directory),
  ).rejects.toThrow("canonical absolute paths");
});

it("rejects shared bundle inodes and group-writable bundles", async () => {
  const f = await fixture(),
    alias = join(f.root, "alias");
  await fs.link(f.bundle, alias);
  await expect(prepareReleaseExtraction(f.bundle, f.directory)).rejects.toThrow(
    "private regular bundle",
  );
  await fs.unlink(alias);
  await fs.chmod(f.bundle, 0o620);
  await expect(prepareReleaseExtraction(f.bundle, f.directory)).rejects.toThrow(
    "private regular bundle",
  );
});

it("rejects a non-private destination", async () => {
  const f = await fixture();
  await fs.chmod(f.directory, 0o750);
  await expect(prepareReleaseExtraction(f.bundle, f.directory)).rejects.toThrow(
    "private destination",
  );
});

it("fails clearly when libarchive-tools is missing, without a GNU tar fallback", async () => {
  vi.mocked(fs.lstat).mockRejectedValueOnce(
    Object.assign(new Error("absent"), { code: "ENOENT" }),
  );
  await expect(assertReleaseExtractor()).rejects.toThrow(
    "Install libarchive-tools",
  );
});

it.each([{ uid: 12345 }, { mode: 0o777 }, { isFile: () => false }])(
  "rejects an unsealed extractor %j",
  async (override) => {
    const info = Object.assign(await fs.lstat("/usr/bin/bsdtar"), override);
    vi.mocked(fs.lstat).mockResolvedValueOnce(info);
    await expect(assertReleaseExtractor()).rejects.toThrow(
      "sealed root-owned executable",
    );
  },
);
