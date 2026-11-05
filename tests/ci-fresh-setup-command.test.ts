import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("keeps CI paths and arguments literal even when call options request a shell", () => {
  const source = readFileSync("deploy/ci/fresh-setup-preflight.mjs", "utf8");
  const declaration = source.slice(
    source.indexOf("const run ="),
    source.indexOf("assert.equal(", source.indexOf("const run =")),
  );
  const run = runInNewContext(`${declaration};run`, { execFileSync }) as (
    command: string,
    args: string[],
    options: ExecFileSyncOptions,
  ) => string;
  const directory = mkdtempSync(join(tmpdir(), "ci path ; "));
  try {
    const marker = join(directory, "unexpected"),
      argument = `$(touch "${marker}") ; printf injected`;
    expect(
      run(
        process.execPath,
        ["-e", "process.stdout.write(process.argv[1])", argument],
        { cwd: directory, encoding: "utf8", stdio: "pipe", shell: true },
      ),
    ).toBe(argument);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
