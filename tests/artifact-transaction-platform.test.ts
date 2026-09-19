import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishArtifactSet } from "../packages/client-core/src/artifact-transaction.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(open).mockReset();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("Windows artifact durability contract on every host", () => {
  it.each([false, true])(
    "requires writable file handles and preserves flush failures (failure: %s)",
    async (failFlush) => {
      const root = await mkdtemp(join(tmpdir(), "artifact-platform-test-"));
      roots.push(root);
      const output = join(root, ".render");
      await mkdir(output, { mode: 0o700 });
      await writeFile(join(output, "result.pdf"), "old-pdf");
      await writeFile(join(output, "notes.txt"), "user-notes");
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.stubGlobal("process", { ...process, platform: "win32" });
      const handles: {
        name: string;
        flags: string | number | undefined;
        sync: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      }[] = [];
      vi.mocked(open).mockImplementation(async (path, flags, mode) => {
        const handle = await actual.open(path, flags, mode);
        if ((await handle.stat()).isDirectory()) {
          await handle.close();
          throw new Error("Windows directory fsync is unsupported");
        }
        const name = basename(String(path));
        const sync = handle.sync.bind(handle);
        const syncSpy = vi
          .spyOn(handle, "sync")
          .mockImplementation(async () => {
            // Linux permits fsync on read-only descriptors. Enforce the Windows
            // FlushFileBuffers GENERIC_WRITE requirement on every CI platform.
            if (flags === "r")
              throw Object.assign(new Error("read-only flush denied"), {
                code: "EPERM",
              });
            if (failFlush && name === "result.pdf")
              throw Object.assign(new Error("file flush failed"), {
                code: "EIO",
              });
            await sync();
          });
        handles.push({
          name,
          flags,
          sync: syncSpy,
          close: vi.spyOn(handle, "close"),
        });
        return handle;
      });

      const result = publishArtifactSet(output, async (stage) => {
        await writeFile(join(stage, "result.pdf"), "new-pdf");
      });
      if (failFlush) await expect(result).rejects.toThrow("file flush failed");
      else await result;
      expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
        failFlush ? "old-pdf" : "new-pdf",
      );
      expect(await readFile(join(output, "notes.txt"), "utf8")).toBe(
        "user-notes",
      );
      expect(await readdir(`${output}.latex-renderer-state`)).toEqual([]);
      expect(
        handles
          .filter(({ flags }) => flags === "r+")
          .map(({ name }) => name)
          .sort(),
      ).toEqual(["notes.txt", "result.pdf"]);
      for (const handle of handles) {
        expect(handle.sync).toHaveBeenCalledOnce();
        expect(handle.close).toHaveBeenCalledOnce();
      }
    },
  );
});
