import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("CLI structured output", () => {
  it("returns one JSON success envelope without human text", () => {
    const result = run(["auth", "status", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      success: true,
      command: "auth.status",
      result: { configured: true },
    });
  });

  it("returns one JSON error envelope and a non-zero exit code", () => {
    const result = run(
      ["--json", "auth", "login", "--api-key-stdin"],
      "not-a-key\n",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      success: false,
      command: "auth.login",
      error: {
        code: "INVALID_API_KEY",
        message: "Input is not a render API key",
        status: 400,
      },
    });
  });

  it("retains the existing human-readable mode", () => {
    const result = run(["auth", "status"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Credential is configured.\n");
  });

  it("advertises Source reuse and arbitrary entrypoints", () => {
    const renderHelp = run(["render", "--help"]),
      sourceHelp = run(["source", "upload", "--help"]);

    expect(renderHelp.status).toBe(0);
    expect(renderHelp.stdout).toContain("--source <id>");
    expect(renderHelp.stdout).toContain("--entrypoint <path>");
    expect(sourceHelp.status).toBe(0);
    expect(sourceHelp.stdout).toContain("project directory or ZIP");
  });

  it("keeps command-line usage errors structured in JSON mode", () => {
    const result = run(["auth", "status", "--json", "--unknown"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: false,
      command: "auth.status",
      error: { code: "CLI_USAGE_ERROR", status: 400 },
    });
  });

  it("returns a secret-free doctor report with a diagnostic exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-cli-doctor-test-"));
    try {
      const result = run([
        "doctor",
        "--install-directory",
        join(root, "missing"),
        "--bin-directory",
        join(root, "bin"),
        "--json",
      ]);
      const output = JSON.parse(result.stdout) as {
        success: boolean;
        command: string;
        result: { status: string };
      };
      expect(result.status).toBe(2);
      expect(output).toMatchObject({
        success: true,
        command: "doctor",
        result: { status: "not_installed" },
      });
      expect(result.stdout).not.toMatch(/lrk_|uploadTicket|jobTicket/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inherits setup path options without leaking human removal output", () => {
    const result = run([
      "setup",
      "remove",
      "--yes",
      "--install-directory",
      "/tmp/latex-renderer-cli-json-missing",
      "--bin-directory",
      "/tmp/latex-renderer-cli-json-bin",
      "--keep-credential",
      "--keep-skills",
      "--json",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      success: true,
      command: "setup.remove",
      result: {
        removed: false,
        installDirectory: "/tmp/latex-renderer-cli-json-missing",
      },
    });
  });

  it("rejects the interactive setup UI in JSON mode without starting a server", () => {
    const result = run(["setup", "--gui", "--json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      success: false,
      command: "setup",
      error: {
        code: "INTERACTIVE_JSON_CONFLICT",
        message: "setup --gui cannot be combined with --json",
        status: 400,
      },
    });
  });
});

function run(
  args: readonly string[],
  input?: string,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "apps/cli/src/index.ts", ...args],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        LATEX_RENDER_API_KEY: "test-only-key",
      },
    },
  );
  return { ...result, stdout: result.stdout, stderr: result.stderr };
}
