import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createProjectArchive } from "../packages/client-core/src/index.js";
import {
  validateAndExtract,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";

it("shares BST filename and archive validation between client upload and Worker extraction", async () => {
  const root = await mkdtemp(join(tmpdir(), "bibliography-source-"));
  try {
    const project = join(root, "project"),
      archive = join(root, "project.zip");
    await mkdir(join(project, "styles"), { recursive: true });
    await writeFile(join(project, "main.tex"), "fixture");
    await writeFile(
      join(project, "styles", "fixture.BST"),
      "fixture bibliography style",
    );
    expect(validateSourceFilePath("styles/fixture.BST")).toBe(
      "styles/fixture.BST",
    );
    const prepared = await createProjectArchive(project, archive);
    expect(prepared.files).toBe(2);
    const extracted = await validateAndExtract(
      archive,
      join(root, "extracted"),
      {
        maxExtractedBytes: 4096,
        maxFileBytes: 1024,
        maxEntries: 10,
        maxFiles: 10,
        maxDepth: 10,
        maxNameLength: 200,
      },
    );
    expect(extracted.paths).toContain("styles/fixture.BST");
    for (const path of ["../outside.bst", "/outside.bst", "styles/tool.sh"])
      expect(() => validateSourceFilePath(path)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
