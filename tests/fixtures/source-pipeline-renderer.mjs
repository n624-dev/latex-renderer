// Deterministic renderer boundary for ordinary tests. This is NOT TeX/PDF E2E.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
const [
  input,
  output,
  entrypoint,
  gate,
  mode = "all",
  pdfDirectory,
  svgExit = "0",
  previewPage = "0",
  lazyPreviews = "0",
] = process.argv.slice(2);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
if (mode === "preview") {
  assert(
    (await readFile(join(pdfDirectory, "result.pdf"), "utf8")).startsWith(
      "%PDF-",
    ),
  );
  assert(Number(previewPage) >= 1 && Number(previewPage) <= 3);
  await mkdir(join(output, "previews"), { recursive: true });
  await writeFile(join(output, `previews/page-${previewPage}.png`), png);
  await writeFile(
    join(output, "compile.log"),
    "Preview deterministic fixture\n",
  );
  process.exit(0);
}
const source = await readFile(join(input, entrypoint), "utf8");
const pages = Number(/% pipeline-pages: ([1-3])/.exec(source)?.[1]);
assert.ok(pages >= 1 && pages <= 3);
if (gate) {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await stat(gate);
      ready = true;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await setTimeout(50);
  }
  assert.ok(ready, "Gated renderer fixture was not released within 10 seconds");
}
if (mode === "svg") {
  assert(
    (await readFile(join(pdfDirectory, "result.pdf"), "utf8")).startsWith(
      "%PDF-",
    ),
  );
  await writeFile(join(output, "compile.log"), "SVG deterministic fixture\n");
  if (Number(svgExit) !== 0) process.exit(Number(svgExit));
  await mkdir(join(output, "svg/objects"), { recursive: true });
  await writeFile(
    join(output, "svg/manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      coordinateSystem: {
        unit: "pdf-point",
        origin: "top-left",
        xAxis: "right",
        yAxis: "down",
      },
      objects: [
        {
          id: 1,
          kind: "math",
          sourceFile: entrypoint,
          sourceLine: 1,
          artifact: "svg/objects/math-000001.svg",
          placementStatus: "unknown",
          width: 10,
          height: 10,
        },
      ],
    }),
  );
  await writeFile(
    join(output, "svg/objects/math-000001.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0L1 1"/></svg>',
  );
  process.exit(0);
}
await mkdir(join(output, "previews"), { recursive: true });
await writeFile(join(output, "result.pdf"), "%PDF-1.7\n" + source);
if (mode === "pdf")
  await writeFile(
    join(output, "result.synctex.gz"),
    "deterministic-synctex-fixture",
  );
await writeFile(join(output, "compile.log"), "Output written on result.pdf\n");
if (lazyPreviews === "1")
  await writeFile(
    join(output, ".preview-info.json"),
    JSON.stringify({ schemaVersion: 1, pages, dpi: 150 }),
  );
for (let page = 1; page <= (lazyPreviews === "1" ? 1 : pages); page++)
  await writeFile(join(output, "previews", `page-${page}.png`), png);
