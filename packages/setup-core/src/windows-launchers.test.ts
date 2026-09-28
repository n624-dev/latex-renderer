import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  manageWindowsLaunchers,
  windowsLauncherContents,
} from "./windows-launchers.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "windows-launcher-test-"));
  roots.push(root);
  return { root, install: join(root, "renderer"), bin: join(root, "commands") };
}
function legacyLauncherContents(
  install: string,
  bin: string,
  name: "latex-render" | "latex-renderer-mcp",
): string {
  return windowsLauncherContents(install, bin, name)
    .replace("managed external launcher v2", "managed external launcher v1")
    .replace(
      "process.argv.splice(1,0,c.entry)",
      "process.env.LATEX_RENDER_BASE_URL||='https://latex-render.n624.jp';process.argv.splice(1,0,c.entry)",
    );
}
describe("managed custom Windows launchers", () => {
  it("keeps arbitrary install paths as encoded data, not CMD or JavaScript source", () => {
    const install = "D:\\日本語 & 100% !test! 'app'",
      bin = "D:\\command path";
    const launcher = windowsLauncherContents(install, bin, "latex-render");
    expect(Buffer.from(launcher).every((byte) => byte < 128)).toBe(true);
    expect(launcher).not.toContain(install);
    expect(launcher).not.toContain("LATEX_RENDER_BASE_URL");
    expect(launcher).toContain("DisableDelayedExpansion");
    const encoded = /Buffer\.from\('([^']+)'/.exec(launcher)?.[1];
    expect(
      JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8")),
    ).toEqual({
      install,
      bin,
      entry: win32.join(install, "app/latex-render.cjs"),
      cli: win32.join(bin, "latex-render.cmd"),
    });
  });
  it("installs and removes only exact owned launchers, preserving conflicts", async () => {
    const { install, bin } = await fixture();
    expect((await manageWindowsLaunchers(install, bin)).repaired).toHaveLength(
      2,
    );
    expect((await manageWindowsLaunchers(install, bin)).repaired).toHaveLength(
      0,
    );
    await writeFile(join(bin, "latex-renderer-mcp.cmd"), "user launcher");
    expect((await manageWindowsLaunchers(install, bin)).preserved).toEqual([
      "launcher:latex-renderer-mcp",
    ]);
    expect(
      (await manageWindowsLaunchers(install, bin, true)).preserved,
    ).toEqual(["launcher:latex-renderer-mcp"]);
    await expect(readFile(join(bin, "latex-render.cmd"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    expect(await readFile(join(bin, "latex-renderer-mcp.cmd"), "utf8")).toBe(
      "user launcher",
    );
  });
  it("upgrades exact legacy launchers and preserves modified ones", async () => {
    const { install, bin } = await fixture();
    await mkdir(bin, { recursive: true });
    for (const name of ["latex-render", "latex-renderer-mcp"] as const)
      await writeFile(
        join(bin, `${name}.cmd`),
        legacyLauncherContents(install, bin, name),
      );
    expect((await manageWindowsLaunchers(install, bin)).repaired).toEqual([
      "launcher:latex-render",
      "launcher:latex-renderer-mcp",
    ]);
    expect((await manageWindowsLaunchers(install, bin)).repaired).toEqual([]);
    for (const name of ["latex-render", "latex-renderer-mcp"] as const)
      expect(await readFile(join(bin, `${name}.cmd`), "utf8")).toBe(
        windowsLauncherContents(install, bin, name),
      );
    await writeFile(
      join(bin, "latex-render.cmd"),
      `${legacyLauncherContents(install, bin, "latex-render")}@rem custom\r\n`,
    );
    expect((await manageWindowsLaunchers(install, bin)).preserved).toEqual([
      "launcher:latex-render",
    ]);
    expect(
      (await manageWindowsLaunchers(install, bin, true)).preserved,
    ).toEqual(["launcher:latex-render"]);
  });
  it("never replaces payload launchers when bin is already inside the install", async () => {
    const { install } = await fixture(),
      bin = join(install, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "latex-render.cmd"), "payload launcher");
    expect(await manageWindowsLaunchers(install, bin)).toEqual({
      repaired: [],
      preserved: [],
    });
    expect(await manageWindowsLaunchers(install, bin, true)).toEqual({
      repaired: [],
      preserved: [],
    });
    expect(await readFile(join(bin, "latex-render.cmd"), "utf8")).toBe(
      "payload launcher",
    );
  });
  it.runIf(process.platform === "win32")(
    "executes an actual custom CMD launcher with correct argv and environment",
    async () => {
      const { root, bin } = await fixture(),
        install = join(root, "日本語 & 100% !test! 'app'");
      await mkdir(join(install, "app"), { recursive: true });
      await writeFile(
        join(install, "app/latex-render.cjs"),
        "console.log(JSON.stringify({args:process.argv.slice(2),install:process.env.LATEX_RENDER_INSTALL_DIRECTORY,bin:process.env.LATEX_RENDER_BIN_DIRECTORY,base:process.env.LATEX_RENDER_BASE_URL??null,renderer:process.env.LATEX_RENDER_RENDERER_URL??null}));process.exitCode=7;",
      );
      await manageWindowsLaunchers(install, bin);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        LATEX_RENDER_RENDERER_URL: "https://renderer.test",
      };
      delete env.LATEX_RENDER_BASE_URL;
      const result = spawnSync(
        "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          `""${join(bin, "latex-render.cmd")}" --version "two words""`,
        ],
        {
          encoding: "utf8",
          env,
          windowsVerbatimArguments: true,
          timeout: 15_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
      expect(JSON.parse(result.stdout)).toEqual({
        args: ["--version", "two words"],
        install,
        bin,
        base: null,
        renderer: "https://renderer.test",
      });
    },
  );
});
