import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  installDistribution,
  repairSetup,
  removeSetup,
  type CommandRunner,
} from "@latex-renderer/setup-core";
import yazl from "yazl";

const roots: string[] = [];
const sink = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "windows-setup-layout-"));
  roots.push(root);
  const commands: string[] = [];
  const runner: CommandRunner = (command, args) => {
    commands.push(`${command} ${args.join(" ")}`);
    return {
      status: command === "powershell.exe" ? 10 : 1,
      stdout: "",
      stderr: "",
    };
  };
  const archive = new yazl.ZipFile();
  for (const name of [
    "app/latex-render.cjs",
    "app/latex-renderer-mcp.cjs",
    "bin/latex-render.cmd",
    "bin/latex-renderer-mcp.cmd",
    "skill/scripts/install-skill.mjs",
  ])
    archive.addBuffer(Buffer.from("fixture"), `latex-renderer-client/${name}`);
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  return {
    root,
    commands,
    options: {
      platform: "win32" as const,
      home: root,
      env: { LOCALAPPDATA: join(root, "local"), APPDATA: join(root, "config") },
      installDirectory: join(root, "custom install"),
      output: sink,
      warning: sink,
      runner,
    },
    distribution: {
      archive: bytes,
      manifest: {
        version: "0.2.0",
        archive: "latex-renderer-client-0.2.0.zip",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
      },
    },
  };
}

describe.runIf(process.platform === "win32")(
  "Windows setup filesystem integration (no registry mutations)",
  () => {
    it("uses the requested bin for actual launchers, PATH, state, repair and removal", async () => {
      const f = await fixture(),
        options = {
          ...f.options,
          binDirectory: join(f.root, "custom commands"),
        };
      const installed = await installDistribution({
        ...options,
        ...f.distribution,
        skillTarget: "none",
        mcpTarget: "none",
      });
      expect(installed.status.paths.cliLauncher).toBe(
        join(options.binDirectory, "latex-render.cmd"),
      );
      expect(installed.status.state?.binDirectory).toBe(options.binDirectory);
      expect(
        await readFile(installed.status.paths.cliLauncher, "utf8"),
      ).toContain("managed external launcher v1");
      expect(
        f.commands.some((command) => command.includes(options.binDirectory)),
      ).toBe(true);
      expect((await repairSetup(options)).preserved).toEqual([]);
      await removeSetup({ ...options, keepCredential: true, keepSkills: true });
      await expect(
        readFile(installed.status.paths.cliLauncher),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("repairs pre-fix state without deleting a previous PATH entry", async () => {
      const f = await fixture();
      const installed = await installDistribution({
        ...f.options,
        ...f.distribution,
        skillTarget: "none",
        mcpTarget: "none",
      });
      const path = installed.status.paths.statePath;
      const legacy = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      delete legacy.windowsLauncherLayout;
      legacy.binDirectory = join(f.root, "old-default/bin");
      legacy.windowsUserPathAdded = true;
      await writeFile(path, JSON.stringify(legacy));
      f.commands.length = 0;
      const result = await repairSetup(f.options);
      expect(result.status.state?.binDirectory).toBe(
        join(f.options.installDirectory, "bin"),
      );
      expect(result.status.state?.windowsLauncherLayout).toBe(1);
      expect(
        f.commands.some((command) =>
          command.includes(String(legacy.binDirectory)),
        ),
      ).toBe(false);
    });
    it("preserves a conflicting custom launcher and reports degraded status", async () => {
      const f = await fixture(),
        binDirectory = join(f.root, "commands");
      await mkdir(binDirectory);
      await writeFile(join(binDirectory, "latex-render.cmd"), "user command");
      const result = await installDistribution({
        ...f.options,
        binDirectory,
        ...f.distribution,
        skillTarget: "none",
        mcpTarget: "none",
      });
      expect(
        result.status.checks.find((check) => check.id === "launcher.cli")
          ?.status,
      ).toBe("fail");
      expect(
        await readFile(join(binDirectory, "latex-render.cmd"), "utf8"),
      ).toBe("user command");
    });
  },
);
