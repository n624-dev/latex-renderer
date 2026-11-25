import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectEngineConfig, resolveLocalTexEngine } from "./tex-engine.js";
import { createProjectArchive } from "./index.js";
import { shouldExcludeProjectPath } from "./project-files.js";

describe("local engine preferences", () => {
  it("uses the document program above the project default and recognizes both editor forms", async () => {
    const work = await mkdtemp(join(tmpdir(), "latex-engine-"));
    const root = join(work, "project");
    const zip = join(work, "source.zip");
    const archive = async () => {
      await rm(zip, { force: true });
      await createProjectArchive(root, zip);
    };
    const engine = () => resolveLocalTexEngine(root, zip, "main.tex");
    try {
      await mkdir(root);
      const file = join(root, "main.tex");
      await writeFile(join(root, projectEngineConfig), '{"engine":"platex"}');
      expect(shouldExcludeProjectPath(projectEngineConfig)).toBe(true);
      await writeFile(file, "\\documentclass{article}\n");
      await archive();
      await expect(engine()).resolves.toBe("platex");
      await writeFile(
        file,
        "% !TeX program = XeLaTeX\r\n\\documentclass{article}\r\n",
      );
      await archive();
      await writeFile(
        file,
        "% !TEX TS-program = uplatex\n\\documentclass{article}\n",
      );
      await expect(engine()).resolves.toBe("xelatex");
      await archive();
      await expect(engine()).resolves.toBe("uplatex");
      await writeFile(
        file,
        "% !TeX program = pdflatex\n% !TEX TS-program = lualatex\n",
      );
      await archive();
      await expect(engine()).rejects.toMatchObject({
        code: "CONFLICTING_TEX_ENGINE",
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
