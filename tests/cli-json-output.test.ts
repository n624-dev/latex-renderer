import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("CLI structured output", () => {
  it.each([
    ["render", "/missing-project", "--json"],
    ["--json", "render", "--output", "/output-value", "/missing-project"],
    ["render", "/missing-project", "--output", "/output-value", "--json"],
    ["source", "upload", "/missing-project", "--json"],
    ["jobs", "get", "invalid-job", "--json"],
  ])(
    "keeps positional and option values out of operation names: %j",
    (...args) => {
      const result = run(args);
      expect(result.status).not.toBe(0);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        success: false,
        command: args.includes("render")
          ? "render"
          : args.includes("upload")
            ? "source.upload"
            : "jobs.get",
      });
      expect(result.stderr).toBe("");
    },
  );
  it("identifies render consistently after a real loopback connection failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-cli-network-test-"));
    const listener = createServer();
    try {
      await writeFile(
        join(root, "main.tex"),
        "\\documentclass{article}\\begin{document}fixture\\end{document}",
      );
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const address = listener.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
      const result = run(["render", root, "--json"], undefined, {
        LATEX_RENDER_BASE_URL: `https://127.0.0.1:${address.port}`,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        success: false,
        command: "render",
        error: { code: "INTERNAL_ERROR", message: "fetch failed" },
      });
    } finally {
      if (listener.listening)
        await new Promise<void>((resolve) => listener.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
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
  it("advertises early PDF download and independent SVG retry", () => {
    const help = run(["jobs", "download", "--help"]),
      retry = run(["jobs", "retry-svg", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--pdf-only");
    expect(retry.status).toBe(0);
    expect(retry.stdout).toContain("--output <directory>");
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
  environment: Record<string, string> = {},
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
        ...environment,
      },
    },
  );
  return { ...result, stdout: result.stdout, stderr: result.stderr };
}
