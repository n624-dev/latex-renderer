import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectRunnerOpenSSL } from "../client/select-mcpb-openssl.mjs";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mcpb-openssl-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function installation(name = "OpenSSL-Win64") {
  const directory = join(root, name, "bin");
  mkdirSync(directory, { recursive: true });
  const executable = join(directory, "openssl.exe");
  writeFileSync(executable, "fixture executable");
  return { directory, executable };
}

function commandRunner(version = "OpenSSL 3.6.4 25 Aug 2026", commands = "cms req x509") {
  return vi.fn((_executable: string, args: string[]) =>
    args[0] === "version" ? version : commands,
  );
}

describe("Windows MCPB runner OpenSSL selection", () => {
  it.each(["OpenSSL", "OpenSSL-Win64"])("selects the exact verified %s executable", (name) => {
    const expected = installation(name);
    const run = commandRunner();
    expect(selectRunnerOpenSSL(root, run)).toEqual({
      ...expected,
      version: "OpenSSL 3.6.4 25 Aug 2026",
    });
    expect(run.mock.calls).toEqual([
      [expected.executable, ["version"]],
      [expected.executable, ["list", "-commands"]],
    ]);
  });

  it.each([undefined, "relative-path", "/bad\npath", "/bad\rpath"])(
    "rejects an invalid ProgramFiles path (%s)", (value) => {
      const run = commandRunner();
      expect(() => selectRunnerOpenSSL(value, run)).toThrow("absolute ProgramFiles");
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("fails rather than selecting an unrelated PATH executable or downloading a fallback", () => {
    installation("UntrustedOpenSSL");
    const run = commandRunner();
    expect(() => selectRunnerOpenSSL(root, run)).toThrow("exactly one");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects ambiguous installations instead of choosing filesystem enumeration order", () => {
    installation("OpenSSL");
    installation("OpenSSL-Win64");
    expect(() => selectRunnerOpenSSL(root, commandRunner())).toThrow("exactly one");
  });

  it.each([
    "OpenSSL 3.6.3 20 Jul 2026",
    "OpenSSL 4.0.2 1 Sep 2026",
    "OpenSSL 3.6.40 1 Sep 2026",
    "OpenSSL 3.6.4-beta1 1 Sep 2026",
    "LibreSSL 3.6.4",
  ])("rejects an unexpected version: %s", (version) => {
    installation();
    const run = commandRunner(version);
    expect(() => selectRunnerOpenSSL(root, run)).toThrow("Expected OpenSSL 3.6.4");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["cms", "req", "x509"])("requires the %s command", (missing) => {
    installation();
    const commands = ["cms", "req", "x509"].filter((value) => value !== missing).join(" ");
    expect(() => selectRunnerOpenSSL(root, commandRunner(undefined, commands)))
      .toThrow(`does not provide ${missing}`);
  });

  it("propagates a failed OpenSSL invocation", () => {
    installation();
    expect(() => selectRunnerOpenSSL(root, () => { throw new Error("exit 1"); }))
      .toThrow("exit 1");
  });

  it("rejects a missing executable", () => {
    const { executable } = installation();
    rmSync(executable);
    const run = commandRunner();
    expect(() => selectRunnerOpenSSL(root, run)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("does not follow an external executable symlink", () => {
    const { executable } = installation();
    const outside = join(root, "outside.exe");
    writeFileSync(outside, "external fixture");
    rmSync(executable);
    symlinkSync(outside, executable);
    expect(() => selectRunnerOpenSSL(root, commandRunner())).toThrow("regular executable");
  });
});
