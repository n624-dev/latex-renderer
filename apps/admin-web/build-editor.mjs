import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { build } from "esbuild";
import { styles } from "./dist/assets/styles.js";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "dist", "editor-assets");
const require = createRequire(import.meta.url);
const pdf = dirname(require.resolve("pdfjs-dist/package.json"));
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "pdf"), { recursive: true });
for (const filename of ["pdf.mjs", "pdf.worker.mjs"]) {
  const minified = filename.replace(/\.mjs$/, ".min.mjs");
  await cp(
    join(pdf, "legacy", "build", minified),
    join(output, "pdf", filename),
  );
}
for (const directory of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
  await cp(join(pdf, directory), join(output, "pdf", directory), {
    recursive: true,
  });
}
const browserBuild = {
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  legalComments: "eof",
};
await build({
  ...browserBuild,
  entryPoints: ["admin-render", "login", "site"].map((name) => ({
    in: join(root, "src/browser", name + ".ts"),
    out: name,
  })),
  outdir: join(root, "dist/browser-assets"),
});
await build({
  ...browserBuild,
  entryPoints: [join(root, "src/assets/app-script.ts")],
  outfile: join(root, "dist/browser-assets/app.js"),
  globalName: "rendererAppController",
});
const editor = join(root, "src", "editor");
const localeSources = join(editor, "locales");
const locales = (await readdir(localeSources)).filter((name) =>
  name.endsWith(".ts"),
);
await build({
  entryPoints: [
    { in: join(editor, "index.ts"), out: "editor" },
    ...locales.map((name) => ({
      in: join(localeSources, name),
      out: `locales/${name.slice(0, -3)}`,
    })),
  ],
  outdir: output,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  legalComments: "eof",
});
for (const filename of [
  "editor.js",
  "pdf/pdf.mjs",
  "pdf/pdf.worker.mjs",
  ...locales.map((name) => `locales/${name.slice(0, -3)}.js`),
]) {
  const path = join(output, filename);
  await pipeline(
    createReadStream(path),
    createGzip(),
    createWriteStream(path + ".gz"),
  );
}
await writeFile(join(output, "styles.css"), styles);

// Include dependency files, dictionaries and their wire encodings in the URL.
const version = createHash("sha256");
async function hashAssets(directory = "") {
  const entries = await readdir(join(output, directory), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) =>
    a.name < b.name ? -1 : Number(a.name > b.name),
  )) {
    const name = directory + entry.name;
    if (entry.isDirectory()) {
      await hashAssets(name + "/");
    } else {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(join(output, name)))
        hash.update(chunk);
      version.update(name + "\0" + hash.digest("hex") + "\n");
    }
  }
}
await hashAssets();
await writeFile(join(output, "version.txt"), version.digest("hex") + "\n");
