// Deterministic renderer boundary for ordinary tests. This is NOT TeX/PDF E2E.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
const [input, output, entrypoint, gate] = process.argv.slice(2);
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
await mkdir(join(output, "previews"), { recursive: true });
await writeFile(join(output, "result.pdf"), "%PDF-1.7\n" + source);
await writeFile(join(output, "compile.log"), "Output written on result.pdf\n");
for (let page = 1; page <= pages; page++)
  await writeFile(
    join(output, "previews", `page-${page}.png`),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
