import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishArtifactSet } from "../packages/client-core/src/artifact-transaction.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockReset();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("artifact set filesystem failures", () => {
  it.each(["backup", "publish", "commit", "commit-flush"])(
    "restores the old set after an ordinary %s failure",
    async (phase) => {
      const root = await mkdtemp(join(tmpdir(), "artifact-transaction-fault-"));
      roots.push(root);
      const output = join(root, ".render");
      await mkdir(output, { mode: 0o700 });
      await writeFile(join(output, "result.pdf"), "old-pdf");
      await writeFile(join(output, "job.json"), "old-job");
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let failed = false;
      vi.mocked(rename).mockImplementation(async (from, to) => {
        const target = String(to),
          source = String(from);
        if (
          !failed &&
          (phase === "backup"
            ? basename(target) === "backup"
            : phase === "publish"
              ? basename(target) === ".render" && basename(source) === "stage"
              : basename(target) === "committed.json")
        ) {
          failed = true;
          if (phase === "commit-flush") await actual.rename(from, to);
          throw Object.assign(new Error("filesystem failure"), {
            code: phase === "commit" ? "ENOSPC" : "EACCES",
          });
        }
        return actual.rename(from, to);
      });
      await expect(
        publishArtifactSet(output, async (stage) => {
          await writeFile(join(stage, "result.pdf"), "new-pdf");
          await writeFile(join(stage, "job.json"), "new-job");
        }),
      ).rejects.toThrow("filesystem failure");
      expect(failed).toBe(true);
      expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
        "old-pdf",
      );
      expect(await readFile(join(output, "job.json"), "utf8")).toBe("old-job");
      expect(await readdir(`${output}.latex-renderer-state`)).toEqual([]);
    },
  );
});
