import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  directorySize,
  inspectOutputTree,
  validateArtifacts,
} from "../apps/renderer-worker/src/artifact-validator.js";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";
import { generateMetadata } from "../apps/renderer-worker/src/metadata.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("renderer output resource limits", () => {
  it("fails closed when the output tree cannot be read", async () => {
    await expect(directorySize("/definitely/missing/renderer-output")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("stops scanning as soon as file or directory limits are exceeded", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "one"), "1");
    await writeFile(join(root, "two"), "2");
    await expect(
      inspectOutputTree({ ...config(root), maxOutputFileCount: 1 }, root),
    ).rejects.toMatchObject({ code: "OUTPUT_FILE_LIMIT" });

    await mkdir(join(root, "first"));
    await mkdir(join(root, "second"));
    await expect(
      inspectOutputTree({ ...config(root), maxOutputDirectoryCount: 1 }, root),
    ).rejects.toMatchObject({ code: "OUTPUT_DIRECTORY_LIMIT" });
  });

  it("counts unknown renderer files toward the total byte limit", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "compile.log"), "ok");
    await writeFile(join(root, "errors.json"), "{}");
    await writeFile(join(root, "dependencies.json"), "{}");
    await writeFile(join(root, "unrecognized.tmp"), "x".repeat(20));
    await expect(
      validateArtifacts({ ...config(root), maxOutputBytes: 10 }, root, false),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("reads compile logs and recorder metadata through an explicit byte cap", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "compile.log"), "x".repeat(11));
    await writeFile(join(root, "main.fls"), "INPUT main.tex\n");
    await expect(generateMetadata(root, 1, 10)).rejects.toThrow(
      "Renderer metadata input exceeds limit",
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "renderer-output-limit-"));
  roots.push(root);
  return root;
}

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
