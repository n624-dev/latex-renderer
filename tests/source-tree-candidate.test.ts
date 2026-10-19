import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureValidatedSourceTree,
  verifyValidatedSourceTree,
  validateAndExtract,
  type ZipLimits,
} from "@latex-renderer/zip-validation";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const limits: ZipLimits = {
  maxExtractedBytes: 4096,
  maxFileBytes: 1024,
  maxEntries: 10,
  maxFiles: 5,
  maxDepth: 5,
  maxNameLength: 255,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "source-tree-candidate-"));
  roots.push(root);
  const archive = join(root, "source.zip"),
    tree = join(root, "tree"),
    zip = new yazl.ZipFile(),
    name = "chapters/cafe\u0301.tex";
  zip.addBuffer(Buffer.from("main"), "main.tex");
  zip.addBuffer(Buffer.from("other"), name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(archive, { flags: "wx" }));
  const extracted = await validateAndExtract(archive, tree, limits),
    manifest = await captureValidatedSourceTree(tree, extracted, limits);
  return { root, tree, name, extracted, manifest };
}
describe("verified Source tree read-only candidate (not an enabled persistent cache)", () => {
  it("retains full validated bytes, Unicode spelling and entrypoint selection without writing the shared tree", async () => {
    const f = await fixture(),
      before = await lstat(join(f.tree, f.name));
    for (const entrypoint of ["main.tex", f.name]) {
      const result = await verifyValidatedSourceTree(
        f.tree,
        f.manifest,
        limits,
        entrypoint,
      );
      expect(result.bytes).toBe(f.extracted.bytes);
      expect([...result.paths].sort()).toEqual([...f.extracted.paths].sort());
    }
    expect(await readFile(join(f.tree, f.name), "utf8")).toBe("other");
    const after = await lstat(join(f.tree, f.name));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.mode).toBe(before.mode);
    expect(after.nlink).toBe(1);
    await expect(
      verifyValidatedSourceTree(
        f.tree,
        f.manifest,
        limits,
        f.name.normalize("NFC"),
      ),
    ).rejects.toMatchObject({ code: "ENTRYPOINT_MISSING" });
  });
  it.each([
    "content",
    "missing",
    "extra-file",
    "extra-directory",
    "version",
    "limits",
  ])(
    "rejects %s without treating the manifest as proof of bytes",
    async (kind) => {
      const f = await fixture();
      if (kind === "content") {
        const info = await lstat(join(f.tree, "main.tex"));
        await writeFile(join(f.tree, "main.tex"), "evil");
        await utimes(join(f.tree, "main.tex"), info.atime, info.mtime);
      }
      if (kind === "missing") await rm(join(f.tree, "main.tex"));
      if (kind === "extra-file")
        await writeFile(join(f.tree, "extra.tex"), "extra");
      if (kind === "extra-directory") await mkdir(join(f.tree, "extra"));
      const manifest =
        kind === "version"
          ? { ...f.manifest, version: 2 as unknown as 1 }
          : f.manifest;
      await expect(
        verifyValidatedSourceTree(
          f.tree,
          manifest,
          kind === "limits" ? { ...limits, maxExtractedBytes: 1 } : limits,
        ),
      ).rejects.toMatchObject({ code: "SOURCE_TREE_MISMATCH" });
    },
  );
  it
    .skipIf(process.platform === "win32")
    .each(["symlink", "hardlink", "directory-link", "permissions"])(
    "rejects %s without changing an outside file",
    async (kind) => {
      const f = await fixture(),
        outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "private.tex"), "outside");
      if (kind === "symlink") {
        await rm(join(f.tree, "main.tex"));
        await symlink(join(outside, "private.tex"), join(f.tree, "main.tex"));
      }
      if (kind === "hardlink") {
        await rm(join(f.tree, "main.tex"));
        await link(join(outside, "private.tex"), join(f.tree, "main.tex"));
      }
      if (kind === "directory-link") {
        await rm(join(f.tree, "chapters"), { recursive: true });
        await symlink(outside, join(f.tree, "chapters"), "dir");
      }
      if (kind === "permissions") await chmod(join(f.tree, "main.tex"), 0o600);
      await expect(
        verifyValidatedSourceTree(f.tree, f.manifest, limits),
      ).rejects.toThrow();
      expect(await readFile(join(outside, "private.tex"), "utf8")).toBe(
        "outside",
      );
    },
  );
  it("does not capture a tree with unvalidated paths", async () => {
    const f = await fixture();
    await writeFile(join(f.tree, "unvalidated.tex"), "extra");
    await expect(
      captureValidatedSourceTree(f.tree, f.extracted, limits),
    ).rejects.toMatchObject({ code: "SOURCE_TREE_MISMATCH" });
  });
});
