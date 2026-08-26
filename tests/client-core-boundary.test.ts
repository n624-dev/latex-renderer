import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("client core boundary", () => {
  it("keeps transport and archive orchestration out of the CLI presentation", () => {
    const cli = read("apps/cli/src/index.ts");

    expect(cli).toContain('from "@latex-renderer/client-core"');
    expect(cli).not.toContain("createHash");
    expect(cli).not.toContain("createWriteStream");
    expect(cli).not.toContain("yazl");
    expect(cli).not.toContain("createSource(");
    expect(cli).not.toContain("uploadSource(");
    expect(cli).not.toContain(".download(");
  });

  it("owns ZIP, hash, Source, polling, and artifact operations", () => {
    const core = read("packages/client-core/src/index.ts");

    for (const operation of [
      "createProjectArchive",
      "hashFile",
      "createSource(",
      "uploadSource(",
      "createSourceJob(",
      "pollJob",
      "downloadArtifacts",
    ])
      expect(core).toContain(operation);
  });
});
