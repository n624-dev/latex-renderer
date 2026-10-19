import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readArtifactSinglePass } from "../apps/renderer-worker/src/artifact-validator.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(bytes: Buffer | string) {
  const root = await mkdtemp(join(tmpdir(), "artifact-single-pass-"));
  roots.push(root);
  const file = join(root, "artifact");
  await writeFile(file, bytes);
  return { root, file, stat: await lstat(file) };
}
describe("single-pass artifact candidate", () => {
  it.each([
    ["pdf", "%PDF-1.7\n"],
    ["preview", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 42])],
    ["errors", '{"errors":["日本語"]}'],
    ["dependencies", '{"inputs":["日本語.tex"]}'],
    ["svg_manifest", '{"schemaVersion":2}'],
    ["log", "log\n"],
    [
      "svg",
      `<svg xmlns="http://www.w3.org/2000/svg"><path data-note="${"あ".repeat(50000)}" d="M0 0L1 1"/></svg>`,
    ],
  ])(
    "hashes the exact validated %s bytes, including split UTF-8 chunks",
    async (type, bytes) => {
      const f = await fixture(bytes),
        timings = { scanMs: 0, formatMs: 0, hashMs: 0, copyMs: 0 };
      const result = await readArtifactSinglePass(
        f.file,
        type,
        f.stat,
        timings,
      );
      expect(result.sha256).toBe(
        createHash("sha256")
          .update(await readFile(f.file))
          .digest("hex"),
      );
      expect(result.metadata).toEqual(
        type === "svg_manifest" ? Buffer.from(bytes) : undefined,
      );
      expect(timings.hashMs).toBeGreaterThanOrEqual(0);
    },
  );
  it.each([
    ["pdf", "not a PDF", "PDF_MAGIC_INVALID"],
    ["preview", "not a PNG", "PNG_MAGIC_INVALID"],
    ["svg", '<svg><path href="https://example.test/"/></svg>', "SVG_UNSAFE"],
    ["svg", "<!DOCTYPE svg><svg/>", "SVG_UNSAFE"],
    ["svg", "<svg><path></svg>", "SVG_INVALID"],
    ["svg", "", "SVG_INVALID"],
  ])(
    "rejects unsafe or malformed %s without a digest",
    async (type, bytes, code) => {
      const f = await fixture(bytes);
      await expect(
        readArtifactSinglePass(f.file, type, f.stat),
      ).rejects.toMatchObject({ code });
    },
  );
  it("rejects invalid JSON instead of validating only its hash", async () => {
    const f = await fixture("{");
    await expect(
      readArtifactSinglePass(f.file, "errors", f.stat),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
  it("rejects files replaced or changed since the bounded tree scan", async () => {
    const f = await fixture("log");
    await writeFile(f.file, "longer log");
    await expect(
      readArtifactSinglePass(f.file, "log", f.stat),
    ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT" });
  });
  it.skipIf(process.platform === "win32")(
    "rejects symlinks and hardlinked files",
    async () => {
      const f = await fixture("safe");
      const alias = join(f.root, "alias");
      await symlink(f.file, alias);
      await expect(
        readArtifactSinglePass(alias, "log", f.stat),
      ).rejects.toMatchObject({ code: "ELOOP" });
      await rm(alias);
      await link(f.file, alias);
      await expect(
        readArtifactSinglePass(f.file, "log", f.stat),
      ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT" });
    },
  );
});
