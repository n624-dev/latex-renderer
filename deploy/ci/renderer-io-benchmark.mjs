// Opt-in measurements on a disposable runner; never read a production Source.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { validateAndExtract } from "../../packages/zip-validation/dist/index.js";
import {
  publishArtifacts,
  validateArtifacts,
} from "../../apps/renderer-worker/dist/artifact-validator.js";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const root = await mkdtemp(join(tmpdir(), "renderer-io-benchmark-"));
const config = {
  maxOutputBytes: 200 * 1024 ** 2,
  maxOutputFileCount: 2000,
  maxOutputDirectoryCount: 200,
  maxLogBytes: 10 * 1024 ** 2,
  maxSvgBytes: 10 * 1024 ** 2,
  maxSvgTotalBytes: 100 * 1024 ** 2,
  maxSvgObjects: 200,
};
const limits = {
  maxExtractedBytes: 100 * 1024 ** 2,
  maxFileBytes: 20 * 1024 ** 2,
  maxEntries: 1000,
  maxFiles: 500,
  maxDepth: 10,
  maxNameLength: 255,
};
const timings = () => ({ scanMs: 0, formatMs: 0, hashMs: 0, copyMs: 0 });
async function measure(name, work) {
  const before = process.resourceUsage(),
    start = performance.now();
  const result = await work();
  const after = process.resourceUsage();
  console.log(
    `RENDERER_IO_BENCHMARK ${JSON.stringify({
      name,
      revision: process.env.GITHUB_SHA ?? null,
      elapsedMs: performance.now() - start,
      userCpuUsec: after.userCPUTime - before.userCPUTime,
      systemCpuUsec: after.systemCPUTime - before.systemCPUTime,
      processHighWaterRssBytes: after.maxRSS * 1024,
      kernelInputBlocks: after.fsRead - before.fsRead,
      kernelOutputBlocks: after.fsWrite - before.fsWrite,
      ...result,
    })}`,
  );
}
try {
  const actual = process.argv[2];
  if (actual) {
    await measure("actual-artifacts", async () => {
      // The renderer smoke wrapper does not generate Worker diagnostics.
      for (const file of ["errors.json", "dependencies.json"])
        await writeFile(join(actual, file), "{}");
      const stages = timings();
      const artifacts = await validateArtifacts(
        config,
        actual,
        true,
        false,
        "",
        stages,
      );
      await publishArtifacts(
        actual,
        join(root, "published"),
        artifacts,
        stages,
      );
      return {
        stages,
        files: artifacts.length,
        bytes: artifacts.reduce((n, f) => n + f.size, 0),
      };
    });
  } else {
    for (const [name, count, bytes] of [
      ["tiny", 1, 64],
      ["many-files", 400, 1024],
      ["large-image", 1, 16 * 1024 ** 2],
    ]) {
      const archive = join(root, `${name}.zip`),
        zip = new ZipFile();
      zip.addBuffer(
        Buffer.from(
          "\\documentclass{article}\\begin{document}Benchmark\\end{document}",
        ),
        "main.tex",
      );
      const data = randomBytes(bytes);
      for (let index = 0; index < count; index++)
        zip.addBuffer(data, `assets/${index}.png`);
      zip.end();
      await pipeline(
        zip.outputStream,
        createWriteStream(archive, { flags: "wx" }),
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        const target = join(root, `${name}-${attempt}`);
        await measure(`source-${name}-${attempt}`, async () => {
          const result = await validateAndExtract(archive, target, limits);
          return {
            ...result,
            paths: undefined,
            archiveBytes: (await stat(archive)).size,
          };
        });
        await rm(target, { recursive: true, force: true });
      }
      await rm(archive);
    }
    for (const pages of [1, 20, 100]) {
      const source = join(root, `artifacts-${pages}`);
      await mkdir(join(source, "previews"), { recursive: true });
      await mkdir(join(source, "svg", "objects"), { recursive: true });
      const objects = [];
      await writeFile(
        join(source, "result.pdf"),
        Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(4 * 1024 ** 2)]),
      );
      await writeFile(join(source, "compile.log"), "benchmark\n");
      await writeFile(join(source, "errors.json"), "{}");
      await writeFile(join(source, "dependencies.json"), "{}");
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        randomBytes(128 * 1024),
      ]);
      for (let page = 1; page <= pages; page++)
        await writeFile(join(source, "previews", `page-${page}.png`), png);
      for (let id = 1; id <= 100; id++) {
        const path = `svg/objects/math-${String(id).padStart(6, "0")}.svg`;
        await writeFile(
          join(source, path),
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>',
        );
        objects.push({
          id,
          kind: "math",
          artifact: path,
          sourceFile: "main.tex",
          sourceLine: id,
          page: 1,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        });
      }
      await writeFile(
        join(source, "svg/manifest.json"),
        JSON.stringify({
          schemaVersion: 1,
          coordinateSystem: {
            unit: "pdf-point",
            origin: "top-left",
            xAxis: "right",
            yAxis: "down",
          },
          objects,
        }),
      );
      await measure(`artifacts-${pages}`, async () => {
        const stages = timings(),
          artifacts = await validateArtifacts(
            config,
            source,
            true,
            true,
            "",
            stages,
          );
        const destination = join(root, `published-${pages}`);
        await publishArtifacts(source, destination, artifacts, stages);
        for (const artifact of artifacts)
          assert.equal(
            createHash("sha256")
              .update(await readFile(join(destination, artifact.path)))
              .digest("hex"),
            artifact.sha256,
          );
        return {
          stages,
          files: artifacts.length,
          bytes: artifacts.reduce((n, f) => n + f.size, 0),
        };
      });
      await measure(`ordinary-copy-${pages}`, async () => {
        const destination = join(root, `ordinary-${pages}`);
        await mkdir(destination);
        await copyFile(
          join(source, "result.pdf"),
          join(destination, "result.pdf"),
        );
        return { bytes: (await stat(join(destination, "result.pdf"))).size };
      });
      await rm(source, { recursive: true, force: true });
      await rm(join(root, `published-${pages}`), {
        recursive: true,
        force: true,
      });
      await rm(join(root, `ordinary-${pages}`), {
        recursive: true,
        force: true,
      });
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
