import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const execute = promisify(execFile);

async function executable(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
}

// Exercise the real scripts with deterministic external-tool responses. These
// regressions do not claim to replace the TeX Live container smoke tests.
describe("renderer audit regressions", () => {
  const cases = [
    ["main.tex", "pdf", 1],
    ["main.tex", "pdf", 10],
    ["Main.TEX", "pdf", 100],
    ["result.tex", "pdf,svg", 10],
    ["result.TeX", "pdf,svg", 1],
  ] as const;
  for (const [entrypoint, outputs, pages] of cases) {
    it(`compiles ${entrypoint} (${outputs}, ${pages} pages) with canonical output names`, async () => {
      const root = await mkdtemp(join(tmpdir(), "renderer-script-regression-"));
      try {
        const work = join(root, "work"), opt = join(root, "opt"), scratch = join(root, "tmp"), bin = join(root, "bin");
        await mkdir(join(work, "input"), { recursive: true });
        await mkdir(scratch);
        await mkdir(join(opt, "texlive/2026/texmf-var/luatex-cache/generic/names"), { recursive: true });
        await writeFile(join(work, "input", entrypoint), "test source");
        await executable(join(bin, "latexmk"), `
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const out = args.find(x => x.startsWith('-outdir=')).slice(8);
const name = path.basename(args.at(-1)).replace(/\\.[^.]*$/, '');
fs.writeFileSync(path.join(out, name + '.pdf'), '%PDF-1.4\\n');
fs.writeFileSync(path.join(out, name + '.synctex.gz'), 'map');`);
        await executable(join(bin, "pdfinfo"), "console.log('Pages: ' + process.env.TEST_PAGE_COUNT);");
        await executable(join(bin, "pdftoppm"), `
const fs = require('node:fs');
const count = Number(process.env.TEST_PAGE_COUNT), prefix = process.argv.at(-1);
for (let i = 1; i <= count; i++) fs.writeFileSync(prefix + '-' + String(i).padStart(String(count).length, '0') + '.png', 'preview');`);
        await executable(join(bin, "lualatex"), "const fs = require('node:fs'); fs.writeFileSync('objects.meta', ''); fs.writeFileSync('objects.pdf', 'capture');");
        await executable(join(opt, "renderer/export-svg.pl"), "process.exit(0);");
        const original = await readFile(new URL("../renderer/compile.sh", import.meta.url), "utf8");
        const prefixes: Record<string, string> = { "/work": work, "/opt": opt, "/tmp": scratch };
        // Rewrite only sandbox roots, in one pass; no host /work or /opt writes.
        const script = original.replace(/\/(?:work|opt|tmp)\b/g, prefix => prefixes[prefix] as string);
        const scriptPath = join(root, "compile.sh");
        await writeFile(scriptPath, script);
        await execute("sh", [scriptPath], {
          timeout: 10_000,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, LATEX_ENTRYPOINT: entrypoint, LATEX_OUTPUTS: outputs, TEST_PAGE_COUNT: String(pages) },
        });
        assert.equal(await readFile(join(work, "output/result.pdf"), "utf8"), "%PDF-1.4\n");
        assert.deepEqual((await readdir(join(work, "output/previews"))).sort(), Array.from({ length: pages }, (_, index) => `page-${index + 1}.png`).sort());
        if (outputs.includes("svg")) assert.equal(await readFile(join(work, "output/result.synctex.gz"), "utf8"), "map");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  for (const status of [0, 1]) {
    it(`preserves SyncTeX candidates and checks the query exit status (${status})`, async () => {
      const root = await mkdtemp(join(tmpdir(), "renderer-synctex-regression-"));
      try {
        const bin = join(root, "bin"), output = join(root, "svg"), metadata = join(root, "objects.meta");
        await writeFile(metadata, "OBJECT:1\nKIND:math\nSOURCE:main.tex\nLINE:5\nOBJECT:2\nKIND:math\nSOURCE:main.tex\nLINE:5\n");
        await executable(join(bin, "pdfinfo"), "console.log('Pages: 2');");
        await executable(join(bin, "pdftocairo"), "require('node:fs').writeFileSync(process.argv.at(-1), '<svg width=\"10pt\" height=\"10pt\"></svg>');");
        const response = "SyncTeX result begin\nOutput:result.pdf\nPage:2\nx:10\ny:100\nW:200\nOutput:result.pdf\nPage:3\nx:70\ny:190\nW:300\nSyncTeX result end\n";
        await executable(join(bin, "synctex"), `process.stdout.write(${JSON.stringify(response)}); process.exit(${status});`);
        const command = execute("perl", [fileURLToPath(new URL("../renderer/export-svg.pl", import.meta.url)), join(root, "capture.pdf"), metadata, join(root, "result.pdf"), output], {
          timeout: 10_000,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` },
        });
        if (status !== 0) {
          await assert.rejects(command, /synctex query failed/);
        } else {
          await command;
          const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { objects: Array<{ page: number; x: number; y: number }> };
          assert.deepEqual(manifest.objects.map(({ page, x, y }) => ({ page, x, y })), [{ page: 2, x: 10, y: 90 }, { page: 3, x: 70, y: 180 }]);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
