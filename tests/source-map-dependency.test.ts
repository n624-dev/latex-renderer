import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps every locked source-map-js copy outside GHSA-68fv-2mgg-jv7q", () => {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const versions = [
    ...lock.matchAll(/^ {2}source-map-js@(\d+)\.(\d+)\.(\d+):/gm),
  ];
  expect(versions.length).toBeGreaterThan(0);
  for (const [, major, minor, patch] of versions)
    expect(
      Number(major) > 1 ||
        (Number(major) === 1 &&
          (Number(minor) > 2 || (Number(minor) === 2 && Number(patch) >= 2))),
    ).toBe(true);
});

it("bounds indexed maps and preserves valid mappings through Vite/PostCSS", () => {
  // Isolate synchronous parsing behind an absolute subprocess deadline; use
  // tiny maps, never allocate the advisory's huge output or block Vitest.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const root = createRequire(process.cwd() + "/package.json");
    const vitest = createRequire(root.resolve("vitest/package.json"));
    const vite = createRequire(vitest.resolve("vite/package.json"));
    const postcss = createRequire(vite.resolve("postcss/package.json"));
    const { SourceMapConsumer, SourceNode } = postcss("source-map-js");
    const original = { version: 3, sources: ["fixture.js"],
      sourcesContent: ["x"], names: [], mappings: "AAAA" };
    const indexed = (line, column = 0, map = original) => ({
      version: 3, sections: [{ offset: { line, column }, map }]
    });
    for (const invalid of [-1, 1.5, Infinity, NaN, "1", null, 9007199254740992]) {
      assert.throws(() => new SourceMapConsumer(indexed(invalid)));
      assert.throws(() => new SourceMapConsumer(indexed(0, invalid)));
    }
    assert.throws(() => new SourceMapConsumer(indexed(10000001)), /must not exceed/);
    assert.throws(() => new SourceMapConsumer(indexed(5000000, 0,
      indexed(5000000, 0, indexed(5000000)))), /including offsets of nested sections/);
    const consumer = new SourceMapConsumer(indexed(2));
    assert.deepEqual(consumer.originalPositionFor({ line: 3, column: 1 }), {
      source: "fixture.js", line: 1, column: 0, name: null
    });
    const text = "x\\n";
    const pastEnd = SourceNode.fromStringWithSourceMap(text,
      new SourceMapConsumer(indexed(5000)));
    assert.equal(pastEnd.toString(), text);
    assert(pastEnd.children.length < 10);
    let nested = original;
    for (let i = 0; i < 12; i++) nested = indexed(0, 0, nested);
    const nestedConsumer = new SourceMapConsumer(nested);
    let innermost = nestedConsumer;
    for (let i = 0; i < 12; i++) innermost = innermost._sections[0].consumer;
    const sources = innermost.sources;
    let reads = 0;
    Object.defineProperty(innermost, "sources", { get() { reads++; return sources; } });
    assert.deepEqual(nestedConsumer.sources, ["fixture.js"]);
    assert.equal(reads, 1);
    assert.equal(SourceNode.fromStringWithSourceMap(text, nestedConsumer).toString(), text);
  `,
    ],
    { timeout: 15_000, stdio: "pipe" },
  );
});
