import { constants, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Script } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(
    new URL("../deploy/scripts/server-install-store.mjs", import.meta.url),
    "utf8",
  ),
  start = source.indexOf("  async write(slot, contents) {"),
  end = source.indexOf("\n  journalSlot()", start);
if (start < 0 || end < start)
  throw new Error("Missing installation write method");
const writeSource = source
  .slice(start, end)
  .trim()
  .replace(/^async write/, "async function");

it.each([
  { name: "pre-chown", gid: 10, mode: 0o640, size: 0, safe: true },
  { name: "pre-chmod", gid: 20, mode: 0o600, size: 0, safe: true },
  { name: "restrictive umask", gid: 10, mode: 0, size: 0, safe: true },
  { name: "complete preparation", gid: 20, mode: 0o640, size: 4, safe: true },
  { name: "partial pre-chown", gid: 10, mode: 0o640, size: 4, safe: false },
  { name: "foreign group", gid: 30, mode: 0o640, size: 0, safe: false },
  { name: "broad permissions", gid: 10, mode: 0o666, size: 0, safe: false },
  {
    name: "special permission bits",
    gid: 10,
    mode: 0o4640,
    size: 0,
    safe: false,
  },
  {
    name: "foreign owner",
    gid: 10,
    mode: 0o640,
    size: 0,
    uid: 2000,
    safe: false,
  },
  {
    name: "extra hardlink",
    gid: 10,
    mode: 0o640,
    size: 0,
    nlink: 2,
    safe: false,
  },
  {
    name: "symlink",
    gid: 10,
    mode: 0o640,
    size: 0,
    regular: false,
    safe: false,
  },
  { name: "oversized", gid: 20, mode: 0o640, size: 2048, safe: false },
])(
  "handles the exact $name temporary state without root filesystem access",
  async (fixture) => {
    const handle = {
        chown: vi.fn().mockResolvedValue(undefined),
        chmod: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        sync: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      },
      unlink = vi.fn().mockResolvedValue(undefined),
      rename = vi.fn().mockResolvedValue(undefined),
      open = vi.fn().mockResolvedValue(handle),
      context = {
        uid: 1000,
        read: () => Promise.resolve(null),
        sync: () => Promise.resolve(),
      },
      slot = {
        path: "/trusted/environment",
        gid: 20,
        mode: 0o640,
        maximum: 1024,
      };
    const write = new Script("(" + writeSource + ")").runInNewContext({
      constants,
      Buffer,
      dirname,
      unlink,
      rename,
      open,
      process: { getgid: () => 10 },
      lstat: () =>
        Promise.resolve({
          isFile: () => fixture.regular !== false,
          nlink: fixture.nlink ?? 1,
          uid: fixture.uid ?? 1000,
          gid: fixture.gid,
          mode: fixture.mode,
          size: fixture.size,
        }),
    }) as (
      this: typeof context,
      target: typeof slot,
      contents: string,
    ) => Promise<void>;
    if (fixture.safe) {
      await write.call(context, slot, "recovered");
      expect(unlink).toHaveBeenCalledExactlyOnceWith(
        slot.path + ".server-setup-tmp",
      );
      expect(handle.chown).toHaveBeenCalledExactlyOnceWith(1000, 20);
      expect(handle.chmod).toHaveBeenCalledExactlyOnceWith(0o640);
      expect(handle.writeFile).toHaveBeenCalledExactlyOnceWith("recovered");
      expect(rename).toHaveBeenCalledExactlyOnceWith(
        slot.path + ".server-setup-tmp",
        slot.path,
      );
    } else {
      await expect(write.call(context, slot, "recovered")).rejects.toThrow(
        "Unsafe installation temporary entry",
      );
      expect(unlink).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
    }
  },
);
