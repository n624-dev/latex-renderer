import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps all locked sharp copies outside GHSA-rgj7-g3m4-5g8c", () => {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const versions = [...lock.matchAll(/^ {2}sharp@(\d+)\.(\d+)\.(\d+):/gm)];
  expect(versions.length).toBeGreaterThan(0);
  for (const [, major, minor, patch] of versions) {
    expect(
      Number(major) > 0 ||
        Number(minor) > 35 ||
        (Number(minor) === 35 && Number(patch) >= 4),
    ).toBe(true);
  }
});

it("loads patched native image decoding through the actual Wrangler dependency", () => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const root = createRequire(process.cwd() + "/package.json");
    const wrangler = createRequire(root.resolve("wrangler/package.json"));
    const miniflare = createRequire(wrangler.resolve("miniflare"));
    const sharp = miniflare("sharp");
    const atLeast = (version, floor) => {
      const actual = version.split(".").map(Number);
      for (let i = 0; i < floor.length; i++) {
        if (actual[i] !== floor[i]) return actual[i] > floor[i];
      }
      return true;
    };
    assert(atLeast(sharp.versions.sharp, [0, 35, 4]));
    assert(atLeast(sharp.versions.heif, [1, 23, 2]));
    for (const format of ["png", "avif"]) {
      const input = await sharp({ create: {
        width: 4, height: 4, channels: 3, background: "#ff0000"
      }}).toFormat(format).toBuffer();
      const { info } = await sharp(input).resize(2, 2).png()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 2);
      assert.equal(info.height, 2);
      assert.equal(info.format, "png");
      await assert.rejects(sharp(input.subarray(0, 8)).toBuffer());
    }
    await assert.rejects(sharp(Buffer.from("not an image")).toBuffer());
  `,
    ],
    { timeout: 30_000, stdio: "pipe" },
  );
});
