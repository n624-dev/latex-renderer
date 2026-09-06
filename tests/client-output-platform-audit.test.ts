import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpile } from "typescript";
import { describe, expect, it } from "vitest";
import { AppError } from "@latex-renderer/shared";

const source = readFileSync(
  new URL("../packages/client-core/src/index.ts", import.meta.url),
  "utf8",
);
const helper = source.match(
  /async function ensureSecureDirectory\([\s\S]*?\n\}/,
)?.[0];
if (!helper) throw new Error("Missing actual output-directory guard");
function check(platform: string, mode: number, link = false, uid = 123) {
  if (!helper) throw new Error("Missing directory guard");
  return runInNewContext(
    transpile(helper + '\nensureSecureDirectory("test");', { target: 99 }),
    {
      AppError,
      process: {
        platform,
        ...(platform === "win32" ? {} : { getuid: () => 123 }),
      },
      mkdir: async () => {},
      lstat: () =>
        Promise.resolve({
          mode,
          uid,
          isDirectory: () => true,
          isSymbolicLink: () => link,
        }),
    },
  ) as Promise<void>;
}
describe("platform-specific output directory permissions", () => {
  it("accepts Windows writable mode bits while retaining link rejection", async () => {
    await expect(check("win32", 0o777)).resolves.toBeUndefined();
    await expect(check("win32", 0o777, true)).rejects.toMatchObject({
      code: "UNSAFE_OUTPUT_DIRECTORY",
    });
  });
  it("keeps POSIX ownership and group/world-write protections", async () => {
    await expect(check("linux", 0o700)).resolves.toBeUndefined();
    for (const mode of [0o777, 0o770, 0o707])
      await expect(check("linux", mode)).rejects.toMatchObject({
        code: "UNSAFE_OUTPUT_DIRECTORY",
      });
    await expect(check("linux", 0o700, false, 456)).rejects.toMatchObject({
      code: "UNSAFE_OUTPUT_DIRECTORY",
    });
  });
});
