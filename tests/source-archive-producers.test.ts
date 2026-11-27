import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { zipStoredFiles } from "../apps/admin-web/src/assets/render-script.js";
import { createProjectArchive } from "../packages/client-core/src/index.js";
import {
  zipFiles,
  writeZipFiles,
} from "../packages/renderer-core/src/source-archive.js";
import { validateAndExtract } from "../packages/zip-validation/src/index.js";

const limits = {
  maxArchiveBytes: 1024 * 1024,
  maxExtractedBytes: 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxFiles: 10,
  maxEntries: 10,
  maxDepth: 10,
  maxNameLength: 200,
};

it("preserves the same document files through Web, CLI and MCP ZIP producers", async () => {
  const root = await mkdtemp(join(tmpdir(), "source-archive-producers-"));
  try {
    const files = [
      {
        path: "素材/figure.png",
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRkQAAAAASUVORK5CYII=",
          "base64",
        ),
      },
      {
        path: "report/main.tex",
        bytes: Buffer.from("% 日本語\n".repeat(1024)),
      },
      { path: "report/notes.tex", bytes: Buffer.alloc(0) },
    ];
    const project = join(root, "project");
    for (const { path, bytes } of files) {
      const file = join(project, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const web = join(root, "web.zip"),
      cli = join(root, "cli.zip"),
      mcp = join(root, "mcp.zip");
    await writeFile(
      web,
      zipStoredFiles(files.map(({ path: name, bytes }) => ({ name, bytes }))),
    );
    await createProjectArchive(project, cli, "report/main.tex");
    await writeZipFiles(files, mcp, limits);
    expect(await readFile(mcp)).toEqual(
      await zipFiles([...files].reverse(), limits),
    );
    for (const [producer, archive] of [
      ["web", web],
      ["cli", cli],
      ["mcp", mcp],
    ] as const) {
      const extracted = join(root, producer);
      const result = await validateAndExtract(
        archive,
        extracted,
        limits,
        "report/main.tex",
      );
      expect(result.paths.toSorted()).toEqual(files.map(({ path }) => path).sort());
      for (const { path, bytes } of files)
        expect(await readFile(join(extracted, path))).toEqual(bytes);
    }
    await expect(writeZipFiles(files, web, limits)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(readFile(web)).resolves.toEqual(
      Buffer.from(
        zipStoredFiles(files.map(({ path: name, bytes }) => ({ name, bytes }))),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
