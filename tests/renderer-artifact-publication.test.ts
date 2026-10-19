import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  directorySize,
  publishArtifacts,
  validateArtifacts,
} from "../apps/renderer-worker/src/artifact-validator.js";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("renderer artifact publication", () => {
  it("publishes only validated artifacts and reports the stored byte total", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-publication-"));
    roots.push(root);
    const staging = join(root, "staging"),
      output = join(root, "output");
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "compile.log"), "compiled\n");
    await writeFile(join(staging, "errors.json"), '{"errors":[]}\n');
    await writeFile(join(staging, "dependencies.json"), '{"inputs":[]}\n');
    await writeFile(join(staging, "main.aux"), "must not persist\n");
    await writeFile(join(staging, "renderer-secret.tmp"), "unknown\n");

    const timings = { scanMs: 0, formatMs: 0, hashMs: 0, copyMs: 0 };
    const artifacts = await validateArtifacts(
      config(root),
      staging,
      false,
      false,
      "",
      timings,
    );
    await publishArtifacts(staging, output, artifacts, timings);
    for (const duration of Object.values(timings)) {
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(0);
    }

    expect(await readdir(output)).toEqual([
      "compile.log",
      "dependencies.json",
      "errors.json",
    ]);
    expect(await readFile(join(output, "compile.log"), "utf8")).toBe(
      "compiled\n",
    );
    expect(await directorySize(output)).toBe(
      artifacts.reduce((total, artifact) => total + artifact.size, 0),
    );
    const original = await lstat(join(staging, "compile.log")),
      published = await lstat(join(output, "compile.log"));
    expect(original.nlink).toBe(1);
    expect(published.nlink).toBe(1);
    expect(original.ino).not.toBe(published.ino);
    await writeFile(join(staging, "compile.log"), "changed\n");
    expect(await readFile(join(output, "compile.log"), "utf8")).toBe(
      "compiled\n",
    );
    await expect(
      publishArtifacts(staging, output, artifacts),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(output, "compile.log"), "utf8")).toBe(
      "compiled\n",
    );
  });
  it.skipIf(process.platform === "win32")(
    "does not replace a symlink at the copy destination",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "artifact-copy-link-"));
      roots.push(root);
      const staging = join(root, "staging"),
        output = join(root, "output"),
        outside = join(root, "outside");
      await mkdir(staging);
      await mkdir(output);
      await writeFile(join(staging, "compile.log"), "new");
      await writeFile(outside, "keep");
      await symlink(outside, join(output, "compile.log"));
      await expect(
        publishArtifacts(staging, output, [
          { path: "compile.log", type: "log", size: 3, sha256: "0".repeat(64) },
        ]),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(outside, "utf8")).toBe("keep");
    },
  );
});

function config(storageRoot: string): WorkerConfig {
  return {
    databasePath: ":memory:",
    storageRoot,
    image: `sha256:${"0".repeat(64)}`,
    workerId: "worker_test",
    seccompProfile: "/tmp/seccomp.json",
    apparmorProfile: undefined,
    maxUploadBytes: 20 * 1024 * 1024,
    maxExtractedBytes: 100 * 1024 * 1024,
    maxFileCount: 500,
    maxZipEntries: 1_000,
    maxOutputBytes: 200 * 1024 * 1024,
    maxOutputFileCount: 2_000,
    maxOutputDirectoryCount: 200,
    maxLogBytes: 10 * 1024 * 1024,
    maxSvgObjects: 200,
    maxSvgBytes: 10 * 1024 * 1024,
    maxSvgTotalBytes: 100 * 1024 * 1024,
    svgConversionTimeoutSeconds: 120,
    containerUid: 10_000,
    containerGid: 10_000,
    jobTimeoutMs: 420_000,
  };
}
