import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { pruneGeneratedArtifacts } from "../packages/client-core/src/artifact-cleanup.js";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "artifact-cleanup-regression-"));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function manifest(root: string, names: string[]) {
  await writeFile(join(root, "job.json"), JSON.stringify({ artifacts: names.map(relativePath => ({ relativePath })) }));
}

describe("previous generated artifact cleanup", () => {
  it("removes only previously recorded generated paths, preserving current and user files", async () => fixture(async root => {
    const names = ["result.pdf", "compile.log", "previews/page-01.png", "previews/page-2.png", "svg/manifest.json", "svg/objects/math-000001.svg", "notes.txt", "../outside.txt"];
    for (const name of names.filter(name => !name.startsWith(".."))) {
      await mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 });
      await writeFile(join(root, name), name);
    }
    await writeFile(join(root, "previews/page-1.png"), "canonical old preview");
    await manifest(root, names);
    await pruneGeneratedArtifacts(root, new Set(["result.pdf", "previews/page-2.png"]));
    assert.equal(await readFile(join(root, "result.pdf"), "utf8"), "result.pdf");
    assert.equal(await readFile(join(root, "previews/page-2.png"), "utf8"), "previews/page-2.png");
    assert.equal(await readFile(join(root, "notes.txt"), "utf8"), "notes.txt");
    for (const name of ["compile.log", "previews/page-01.png", "previews/page-1.png", "svg/manifest.json", "svg/objects/math-000001.svg"]) {
      await assert.rejects(readFile(join(root, name)), { code: "ENOENT" });
    }
  }));

  it("does not infer ownership from a reserved filename alone", async () => fixture(async root => {
    await writeFile(join(root, "result.pdf"), "user file");
    await pruneGeneratedArtifacts(root, new Set());
    assert.equal(await readFile(join(root, "result.pdf"), "utf8"), "user file");
  }));

  it("does not follow a symlinked artifact directory", async () => fixture(async root => {
    await mkdir(join(root, "outside"));
    await writeFile(join(root, "outside/page-1.png"), "keep");
    await symlink(join(root, "outside"), join(root, "previews"));
    await manifest(root, ["previews/page-1.png"]);
    await assert.rejects(pruneGeneratedArtifacts(root, new Set()), { code: "UNSAFE_OUTPUT_DIRECTORY" });
    assert.equal(await readFile(join(root, "outside/page-1.png"), "utf8"), "keep");
  }));

  it("does not follow a symlinked previous manifest", async () => fixture(async root => {
    await writeFile(join(root, "notes.txt"), "{}");
    await symlink(join(root, "notes.txt"), join(root, "job.json"));
    await assert.rejects(pruneGeneratedArtifacts(root, new Set()), { code: "UNSAFE_OUTPUT_PATH" });
  }));
});
