import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  doctorSetup,
  installDistribution,
  removeSetup,
  repairSetup,
  resolveSetupPaths,
  saveCredential,
  type ClientManifest,
  type CommandRunner,
} from "@latex-renderer/setup-core";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("setup-core", () => {
  it("installs once, persists managed state, and treats the same archive as current", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    const distribution = await clientDistribution();

    const first = await installDistribution({
      ...distribution,
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });
    const second = await installDistribution({
      ...distribution,
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });

    expect(first.action).toBe("installed");
    expect(second.action).toBe("current");
    expect(second.backup).toBeUndefined();
    const state = JSON.parse(
      await readFile(
        join(paths.installDirectory, ".install-state.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(state).toMatchObject({
      format: 2,
      product: "latex-renderer-client",
      archiveSha256: distribution.manifest.sha256,
      skillTarget: "none",
      mcpTarget: "none",
    });
    expect(
      (await lstat(join(paths.binDirectory, "latex-render"))).isSymbolicLink(),
    ).toBe(true);
  });

  it("refuses to replace a directory without valid managed ownership", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    await mkdir(paths.installDirectory, { recursive: true });
    await writeFile(
      join(paths.installDirectory, "unrelated.txt"),
      "owned by user",
    );

    await expect(
      installDistribution({
        ...(await clientDistribution()),
        ...paths,
        skillTarget: "none",
        mcpTarget: "none",
        output: sink,
        warning: sink,
      }),
    ).rejects.toMatchObject({ code: "UNMANAGED_INSTALLATION" });
    await expect(
      readFile(join(paths.installDirectory, "unrelated.txt"), "utf8"),
    ).resolves.toBe("owned by user");
  });

  it("refuses lifecycle mutations when managed state is writable by others", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    await installDistribution({
      ...(await clientDistribution()),
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });
    await chmod(join(paths.installDirectory, ".install-state.json"), 0o666);

    await expect(
      removeSetup({
        ...paths,
        keepCredential: true,
        keepSkills: true,
        output: sink,
        warning: sink,
      }),
    ).rejects.toMatchObject({ code: "MANAGED_STATE_REQUIRED" });
    expect((await lstat(paths.installDirectory)).isDirectory()).toBe(true);
  });

  it("preserves conflicting launchers and MCP registrations", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    await installDistribution({
      ...(await clientDistribution()),
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });
    await rm(join(paths.binDirectory, "latex-render"), { force: true });
    await writeFile(join(paths.binDirectory, "latex-render"), "user launcher");
    const runner: CommandRunner = (_command, args) => {
      if (args[0] === "--version")
        return { status: 0, stdout: "1.0.0", stderr: "" };
      if (args[0] === "mcp" && args[1] === "get")
        return { status: 0, stdout: "command: another-server", stderr: "" };
      return { status: 1, stdout: "", stderr: "unexpected mutation" };
    };

    const result = await repairSetup({
      ...paths,
      mcpTarget: "codex",
      runner,
      output: sink,
      warning: sink,
    });

    expect(result.preserved).toContain("launcher:latex-render");
    expect(result.preserved).toContain("mcp:codex:conflict");
    await expect(
      readFile(join(paths.binDirectory, "latex-render"), "utf8"),
    ).resolves.toBe("user launcher");
  });

  it("registers and later removes only an MCP entry created by setup", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    let registered = false;
    const runner: CommandRunner = (_command, args) => {
      if (args[0] === "--version")
        return { status: 0, stdout: "1.0.0", stderr: "" };
      if (args[0] === "mcp" && args[1] === "get")
        return registered
          ? {
              status: 0,
              stdout: join(paths.installDirectory, "bin", "latex-renderer-mcp"),
              stderr: "",
            }
          : { status: 1, stdout: "", stderr: "not found" };
      if (args[0] === "mcp" && args[1] === "add") {
        registered = true;
        return { status: 0, stdout: "added", stderr: "" };
      }
      if (args[0] === "mcp" && args[1] === "remove") {
        registered = false;
        return { status: 0, stdout: "removed", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    };

    const installed = await installDistribution({
      ...(await clientDistribution()),
      ...paths,
      skillTarget: "none",
      mcpTarget: "codex",
      runner,
      output: sink,
      warning: sink,
    });
    expect(installed.status.status).toBe("healthy");
    expect(installed.status.state?.managedMcpClients).toEqual(["codex"]);
    expect(registered).toBe(true);

    await removeSetup({
      ...paths,
      runner,
      keepCredential: true,
      keepSkills: true,
      output: sink,
      warning: sink,
    });
    expect(registered).toBe(false);
  });

  it("removes only managed launchers and preserves modified ones", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    await installDistribution({
      ...(await clientDistribution()),
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });
    await rm(join(paths.binDirectory, "latex-renderer-mcp"), { force: true });
    await writeFile(join(paths.binDirectory, "latex-renderer-mcp"), "custom");

    const result = await removeSetup({
      ...paths,
      keepCredential: true,
      keepSkills: true,
      output: sink,
      warning: sink,
    });

    expect(result.removed).toBe(true);
    expect(result.preserved).toContain("launcher:latex-renderer-mcp");
    await expect(lstat(paths.installDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(paths.binDirectory, "latex-renderer-mcp"), "utf8"),
    ).resolves.toBe("custom");
  });

  it("stores a mode-0600 credential and never includes it in doctor JSON", async () => {
    const root = await temporaryRoot();
    const paths = testPaths(root);
    await installDistribution({
      ...(await clientDistribution()),
      ...paths,
      skillTarget: "none",
      mcpTarget: "none",
      output: sink,
      warning: sink,
    });
    const secret = `lrk_${"a".repeat(32)}_${"B".repeat(43)}`;
    await saveCredential(secret, {
      platform: "linux",
      home: root,
      env: { XDG_CONFIG_HOME: join(root, "config") },
    });
    const credential = resolveSetupPaths({
      platform: "linux",
      home: root,
      env: { XDG_CONFIG_HOME: join(root, "config") },
    }).credentialPath;
    expect((await lstat(credential)).mode & 0o777).toBe(0o600);

    const report = await doctorSetup({
      ...paths,
      env: {
        XDG_CONFIG_HOME: join(root, "config"),
        PATH: paths.binDirectory,
      },
    });
    expect(report.status).toBe("healthy");
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(
      report.checks.find((check) => check.id === "credential")?.status,
    ).toBe("pass");
  });
});

const sink = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

function testPaths(root: string): {
  platform: "linux";
  home: string;
  env: NodeJS.ProcessEnv;
  installDirectory: string;
  binDirectory: string;
} {
  return {
    platform: "linux",
    home: root,
    env: { XDG_CONFIG_HOME: join(root, "config") },
    installDirectory: join(root, "install"),
    binDirectory: join(root, "bin"),
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-setup-core-test-"));
  temporaryRoots.push(root);
  return root;
}

async function clientDistribution(): Promise<{
  manifest: ClientManifest;
  archive: Buffer;
}> {
  const archive = await zip([
    ["latex-renderer-client/app/latex-render.cjs", "cli"],
    ["latex-renderer-client/app/latex-renderer-mcp.cjs", "mcp"],
    ["latex-renderer-client/bin/latex-render", "#!/bin/sh\n"],
    ["latex-renderer-client/bin/latex-renderer-mcp", "#!/bin/sh\n"],
    [
      "latex-renderer-client/skill/scripts/install-skill.mjs",
      "export async function installSkillTargets(){return []} export async function removeSkillTargets(){return []}",
    ],
  ]);
  return {
    archive,
    manifest: {
      version: "0.2.0",
      archive: "latex-renderer-client-0.2.0.zip",
      sha256: createHash("sha256").update(archive).digest("hex"),
      size: archive.byteLength,
    },
  };
}

function zip(
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const [name, value] of entries)
    archive.addBuffer(Buffer.from(value), name, {
      mtime: new Date("1980-01-01T00:00:00Z"),
      mode: 0o644,
    });
  archive.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
