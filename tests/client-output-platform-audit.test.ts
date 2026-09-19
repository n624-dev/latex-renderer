import type { Stats } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOutputDirectory } from "../packages/client-core/src/output-safety.js";

afterEach(() => vi.unstubAllGlobals());
function check(platform: string, mode: number, link = false, uid = 123) {
  vi.stubGlobal("process", {
    ...process,
    platform,
    getuid: platform === "win32" ? undefined : () => 123,
  });
  assertOutputDirectory({
    mode,
    uid,
    isDirectory: () => true,
    isSymbolicLink: () => link,
  } as Stats);
}
describe("platform-specific output directory permissions", () => {
  it("accepts Windows writable mode bits while retaining link rejection", () => {
    expect(() => check("win32", 0o777)).not.toThrow();
    expect(() => check("win32", 0o777, true)).toThrow(
      expect.objectContaining({ code: "UNSAFE_OUTPUT_DIRECTORY" }),
    );
  });
  it("keeps POSIX ownership and group/world-write protections", () => {
    expect(() => check("linux", 0o700)).not.toThrow();
    for (const mode of [0o777, 0o770, 0o707])
      expect(() => check("linux", mode)).toThrow(
        expect.objectContaining({ code: "UNSAFE_OUTPUT_DIRECTORY" }),
      );
    expect(() => check("linux", 0o700, false, 456)).toThrow(
      expect.objectContaining({ code: "UNSAFE_OUTPUT_DIRECTORY" }),
    );
  });
});
