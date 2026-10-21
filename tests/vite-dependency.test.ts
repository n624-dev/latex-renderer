import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, type Context } from "node:vm";
import { expect, it } from "vitest";

const root = createRequire(join(process.cwd(), "package.json"));
const vitest = createRequire(root.resolve("vitest/package.json"));
const vitePackage = vitest.resolve("vite/package.json");
const bundle = readFileSync(
  join(dirname(vitePackage), "dist/node/chunks/config.js"),
  "utf8",
);

type Response = { statusCode: number; end: () => void };
type Failure = (file: string, message: string | null) => void;
type BundleApi = {
  launcher: (file: string, editor: string, failure: Failure) => void;
  middleware: (
    editor: string,
    directory: string,
    failure: Failure,
  ) => (request: { url: string }, response: Response) => void;
};

// Evaluate only the shipped editor module factories. Every OS, filesystem and
// process dependency is mocked; this must never start an editor, shell or server.
function editorHarness(
  platform: "win32" | "linux" | "darwin",
  options: { wsl?: boolean; exists?: (file: string) => boolean } = {},
) {
  const cwd = platform === "win32" ? "C:\\work" : "/mnt/c/work";
  const paths = platform === "win32" ? win32 : posix;
  const filesystemChecks: string[] = [];
  const failures: string[] = [];
  const calls: { kind: "exec" | "spawn"; command: string; args: string[] }[] =
    [];
  type Child = { on: () => Child; kill: () => void };
  const child: Child = { on: () => child, kill: () => undefined };
  const dependencies = new Map<string, unknown>([
    [
      "fs",
      {
        existsSync(file: string) {
          filesystemChecks.push(file);
          return options.exists?.(file) ?? file.length > 0;
        },
      },
    ],
    [
      "path",
      {
        ...paths,
        resolve: (...parts: string[]) => paths.resolve(cwd, ...parts),
        relative: (from: string, to: string) =>
          paths.relative(paths.resolve(cwd, from), paths.resolve(cwd, to)),
      },
    ],
    ["os", { release: () => (options.wsl ? "Microsoft WSL2" : "fixture OS") }],
    [
      "url",
      {
        fileURLToPath: (file: string) =>
          fileURLToPath(file, { windows: platform === "win32" }),
      },
    ],
    [
      "child_process",
      {
        exec(command: string) {
          calls.push({ kind: "exec", command, args: [] });
          return child;
        },
        spawn(command: string, args: unknown[]) {
          calls.push({
            kind: "spawn",
            command,
            args: Array.from(args, String),
          });
          return child;
        },
      },
    ],
  ]);
  const modules = [
    "launch-editor/get-args.js",
    "launch-editor/construct-windows-launch-command.js",
    "launch-editor/parse-file.js",
    "launch-editor/index.js",
    "launch-editor-middleware/index.js",
  ];
  const selected = bundle.split(/^\/\/#region /m).flatMap((block) => {
    const newline = block.indexOf("\n");
    const header = block.slice(0, newline);
    if (!modules.some((name) => header.endsWith(`/node_modules/${name}`)))
      return [];
    const end = block.indexOf("\n//#endregion", newline);
    assert(end > newline, "Embedded module boundary changed");
    return [block.slice(newline + 1, end)];
  });
  assert(selected.length >= 3, "Installed Vite editor modules are missing");
  const context = createContext({
    URL,
    console: { log: () => undefined },
    process: { platform, cwd: () => cwd, env: {} },
    __require(name: string) {
      assert(dependencies.has(name), `Unmocked editor dependency: ${name}`);
      return dependencies.get(name);
    },
    __commonJSMin(
      factory: (exports: unknown, module: { exports: unknown }) => void,
    ) {
      let cached: { exports: unknown } | undefined;
      return () => {
        if (cached === undefined) {
          cached = { exports: {} };
          factory(cached.exports, cached);
        }
        return cached.exports;
      };
    },
    require_guess: () => (editor: string) => [editor],
    require_picocolors: () => ({ red: (text: string) => text }),
  }) as Context & BundleApi;
  runInContext(
    selected.join("\n") +
      "\nglobalThis.launcher = require_launch_editor();" +
      "\nglobalThis.middleware = require_launch_editor_middleware();",
    context,
    { timeout: 1_000 },
  );
  const failure: Failure = (_file, message) => failures.push(message ?? "");
  return {
    calls,
    failures,
    filesystemChecks,
    launch: (file: string, editor = "code.cmd") =>
      context.launcher(file, editor, failure),
    request(file: string, editor = "code.cmd") {
      let ended = false;
      const response = { statusCode: 200, end: () => (ended = true) };
      context.middleware(
        editor,
        cwd,
        failure,
      )(
        { url: `/__open-in-editor?file=${encodeURIComponent(file)}` },
        response,
      );
      assert(ended);
      assert.equal(response.statusCode, 200);
    },
  };
}

it("keeps every locked Vite copy on the patched 7.3 series", () => {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const versions = [...lock.matchAll(/^ {2}vite@(\d+)\.(\d+)\.(\d+):/gm)];
  expect(versions.length).toBeGreaterThan(0);
  for (const [, major, minor, patch] of versions) {
    expect(major).toBe("7");
    expect(minor).toBe("3");
    expect(Number(patch)).toBeGreaterThanOrEqual(7);
  }
  expect(bundle).toContain("/launch-editor@2.14.2/");
  expect(bundle).not.toContain("/launch-editor@2.14.1/");
});

it.each([
  "%FIXTURE%.tex",
  "report %CD%&fixture.tex",
  "line\nbreak.tex",
  "line\rbreak.tex",
])(
  "rejects Windows shell expansion and line breaks after query decoding: %j",
  (name) => {
    for (const route of ["launch", "request"] as const) {
      const editor = editorHarness("win32");
      editor[route](name);
      expect(editor.calls).toHaveLength(0);
      expect(editor.failures.join(" ")).toMatch(/%|line break/);
    }
  },
);

it("also rejects percent expansion hidden in a file URL and position suffix", () => {
  const editor = editorHarness("win32");
  editor.request("file:///C:/work/report%25FIXTURE%25.tex:12:3");
  expect(editor.calls).toHaveLength(0);
  expect(editor.failures.join(" ")).toContain("%");
});

it.each([
  "C:\\work\\missing%FIXTURE%\\..:12:3",
  "file:///C:/work/missing%25FIXTURE%25/..:12:3",
])(
  "normalizes after removing position suffixes and before existence checks: %s",
  (file) => {
    // Model the Windows parent-directory alias described by the advisory.
    // The nonexistent attacker component need not exist for its parent to do so.
    const editor = editorHarness("win32", {
      exists: (name) => win32.resolve("C:\\work", name) === "C:\\work",
    });
    editor.request(file);
    expect(editor.filesystemChecks).toEqual(["C:\\work"]);
    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.command).toContain("C:\\work:12:3");
    expect(editor.calls[0]?.command).not.toMatch(/%|missing/);
  },
);

it.each(["vim", "gvim", "mvim", "emacs", "emacsclient", "notepad++"])(
  "keeps WSL filenames separate from %s options, with and without positions",
  (name) => {
    for (const prefix of ["+fixture.tex", "-fixture.tex"]) {
      for (const position of ["", ":12:3"]) {
        const editor = editorHarness("linux", { wsl: true });
        editor.request(prefix + position, name);
        expect(editor.calls).toHaveLength(1);
        expect(editor.calls[0]?.kind).toBe("spawn");
        expect(editor.calls[0]?.args.at(-1)).toBe(`./${prefix}`);
      }
    }
  },
);

it("preserves ordinary Windows filenames, Unicode, file URLs and position options", () => {
  for (const file of [
    "日本語 report.tex:12:3",
    "[route](@name)+file.tex:12:3",
    "file:///C:/work/report%20name.tex:12:3",
  ]) {
    const editor = editorHarness("win32");
    editor.request(file);
    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.kind).toBe("exec");
    expect(editor.calls[0]?.command).toContain("code.cmd -r -g");
    expect(editor.calls[0]?.command).toContain(":12:3");
    expect(editor.failures).toEqual([]);
  }
  const unc = editorHarness("win32");
  unc.request("\\\\server\\share\\file.tex");
  expect(unc.calls).toHaveLength(0);
  expect(unc.failures.join(" ")).toContain("UNC");
  const absent = editorHarness("win32", { exists: () => false });
  absent.request("missing.tex");
  expect(absent.calls).toHaveLength(0);
});

it("preserves the real Vitest-to-Vite transform API", () => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import {createRequire} from "node:module";
      import {pathToFileURL} from "node:url";
      const root = createRequire(process.cwd() + "/package.json");
      const vitest = createRequire(root.resolve("vitest/package.json"));
      const vite = await import(pathToFileURL(vitest.resolve("vite")).href);
      const result = await vite.transformWithEsbuild("export const value: number = 2", "fixture.ts", {loader:"ts"});
      assert.match(result.code, /value = 2/);
      assert.doesNotMatch(result.code, /: number/);
    `,
    ],
    { timeout: 15_000, stdio: "pipe" },
  );
});
