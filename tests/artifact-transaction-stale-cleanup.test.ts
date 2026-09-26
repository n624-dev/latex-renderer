import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneGeneratedArtifacts } from "../packages/client-core/src/artifact-cleanup.js";
import { publishArtifactSet } from "../packages/client-core/src/artifact-transaction.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("stale artifacts on the host filesystem", () => {
  it("replaces a three-page result with one page without deleting user files", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-stale-cleanup-"));
    roots.push(root);
    const output = join(root, ".render");
    await mkdir(join(output, "previews"), { recursive: true });
    await writeFile(join(output, "result.pdf"), "old-pdf");
    await writeFile(join(output, "notes.txt"), "user-notes");
    for (let page = 1; page <= 3; page += 1)
      await writeFile(
        join(output, "previews", `page-${page}.png`),
        `old-${page}`,
      );
    await writeFile(
      join(output, "job.json"),
      JSON.stringify({
        artifacts: [{ relativePath: "result.pdf" }],
        previews: [1, 2, 3].map((page) => ({
          relativePath: `previews/page-${page}.png`,
        })),
      }),
    );

    await publishArtifactSet(output, async (stage) => {
      await pruneGeneratedArtifacts(
        stage,
        new Set(["result.pdf", "previews/page-1.png"]),
      );
      await writeFile(join(stage, "result.pdf"), "new-pdf");
      await writeFile(join(stage, "previews", "page-1.png"), "new-1");
      await writeFile(
        join(stage, "job.json"),
        JSON.stringify({
          artifacts: [{ relativePath: "result.pdf" }],
          previews: [{ relativePath: "previews/page-1.png" }],
        }),
      );
    });

    expect(await readFile(join(output, "result.pdf"), "utf8")).toBe("new-pdf");
    expect(await readFile(join(output, "previews", "page-1.png"), "utf8")).toBe(
      "new-1",
    );
    expect(await readdir(join(output, "previews"))).toEqual(["page-1.png"]);
    expect(await readFile(join(output, "notes.txt"), "utf8")).toBe(
      "user-notes",
    );
    expect(await readdir(`${output}.latex-renderer-state`)).toEqual([]);
  });
});
