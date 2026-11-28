import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { clientConnections } from "../packages/setup-core/src/index.js";
import { PUBLIC_ORIGIN } from "../packages/shared/src/index.js";

const environmentCredential = {
  configured: true,
  origin: PUBLIC_ORIGIN,
  credentialSource: "environment",
  environmentVariable: "LATEX_RENDER_API_KEY",
};

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
      result: environmentCredential,
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
    expect(result.stdout).toBe(
      `Credential is configured.\nConnection origin: ${PUBLIC_ORIGIN}\nCredential source: LATEX_RENDER_API_KEY\n`,
    );
  });

  it("localizes human-readable output and retains English JSON diagnostics", () => {
    const french = { LC_ALL: "fr_FR.UTF-8", LANGUAGE: "" };
    const status = run(["auth", "status"], undefined, french);
    const failure = run(
      ["auth", "login", "--api-key-stdin", "--json"],
      "not-a-key\n",
      french,
    );
    const fallback = run(["auth", "status"], undefined, {
      LC_ALL: "ar_EG.UTF-8",
      LANGUAGE: "",
    });

    expect(status.status).toBe(0);
    expect(status.stdout).toBe(
      `Identifiant d’accès : configuration effectuée.\nOrigine de la connexion : ${PUBLIC_ORIGIN}\nSource de l’identifiant : LATEX_RENDER_API_KEY\n`,
    );
    expect(JSON.parse(failure.stdout)).toMatchObject({
      error: {
        code: "INVALID_API_KEY",
        message: "Input is not a render API key",
      },
    });
    expect(fallback.stdout).toBe(
      `Credential is configured.\nConnection origin: ${PUBLIC_ORIGIN}\nCredential source: LATEX_RENDER_API_KEY\n`,
    );
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

  it.skipIf(process.platform === "win32")(
    "selects, replaces and removes a saved connection with CLI commands",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cli-profiles-"));
      const env = {
        HOME: home,
        XDG_CONFIG_HOME: home,
        LATEX_RENDER_BASE_URL: undefined,
        LATEX_RENDER_RENDERER_URL: undefined,
        LATEX_RENDER_GATEWAY_URL: undefined,
        LATEX_RENDER_PROFILE: undefined,
        LATEX_RENDER_API_KEY: undefined,
      };
      const first = `lrk_${"a".repeat(32)}_${"A".repeat(43)}`;
      const replacement = `lrk_${"b".repeat(32)}_${"B".repeat(43)}`;
      const origin = "https://work.example";
      const command = (args: string[], input?: string) => {
        const result = run(["--json", ...args], input, env);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toMatch(/lrk_/);
        return result;
      };
      try {
        expect(
          command(
            ["connection", "add", "work", origin, "--api-key-stdin"],
            first,
          ).status,
        ).toBe(0);
        expect(
          command(
            [
              "connection",
              "add",
              "home",
              "https://home.example",
              "--api-key-stdin",
            ],
            first,
          ).status,
        ).toBe(0);
        expect(command(["connection", "use", "home"]).status).toBe(0);
        expect(
          command(
            ["--profile", "work", "auth", "login", "--api-key-stdin"],
            replacement,
          ).status,
        ).toBe(0);
        expect(
          JSON.parse(command(["connection", "list"]).stdout),
        ).toMatchObject({
          result: {
            connections: [
              { name: "home", origin: "https://home.example", default: true },
              { name: "work", origin, default: false },
            ],
          },
        });
        await expect(
          clientConnections({ home, env }).resolve("work"),
        ).resolves.toMatchObject({
          origin,
          apiKey: replacement,
        });
        expect(
          JSON.parse(command(["--profile", "work", "auth", "status"]).stdout),
        ).toMatchObject({
          result: {
            configured: true,
            origin,
            credentialSource: "profile",
            profile: "work",
          },
        });
        const human = run(
          ["--profile", "work", "auth", "status"],
          undefined,
          env,
        );
        expect(human.status).toBe(0);
        expect(human.stdout).toContain(
          `Connection origin: ${origin}\nCredential source: work\n`,
        );
        expect(human.stdout).not.toContain(replacement);
        expect(command(["--profile", "work", "auth", "logout"]).status).toBe(0);
        const removed = command(["--profile", "work", "auth", "status"]);
        expect(removed.status).toBe(1);
        expect(JSON.parse(removed.stdout)).toMatchObject({
          error: { code: "CONNECTION_NOT_FOUND" },
        });
        expect(command(["auth", "status"]).status).toBe(0);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  it("reports the effective origin and credential source in CLI auth status", () => {
    const origin = "https://work.example";
    const result = run(["auth", "status", "--json"], undefined, {
      LATEX_RENDER_BASE_URL: origin,
      LATEX_RENDER_PROFILE: undefined,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("test-only-key");
    expect(JSON.parse(result.stdout)).toMatchObject({
      result: { configured: true, origin, credentialSource: "environment" },
    });
  });

  it("reports the origin and absence of a credential while preserving the failure", async () => {
    const home = await mkdtemp(join(tmpdir(), "cli-auth-unconfigured-"));
    try {
      const origin = "https://work.example";
      const env = {
        HOME: home,
        XDG_CONFIG_HOME: home,
        LATEX_RENDER_BASE_URL: origin,
        LATEX_RENDER_PROFILE: undefined,
        LATEX_RENDER_API_KEY: undefined,
      };
      const json = run(["auth", "status", "--json"], undefined, env);
      expect(json.status).toBe(1);
      expect(JSON.parse(json.stdout)).toMatchObject({
        success: false,
        command: "auth.status",
        error: { code: "CREDENTIAL_NOT_FOUND" },
        result: { configured: false, origin, credentialSource: "none" },
      });
      const human = run(["auth", "status"], undefined, env);
      expect(human.status).toBe(1);
      expect(human.stderr).toContain(
        `Connection origin: ${origin}\nCredential source: none\n`,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("inherits setup path options without leaking human removal output", () => {
    const installDirectory = join(tmpdir(), "latex-renderer-cli-json-missing");
    const result = run([
      "setup",
      "remove",
      "--yes",
      "--install-directory",
      installDirectory,
      "--bin-directory",
      join(tmpdir(), "latex-renderer-cli-json-bin"),
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
        installDirectory,
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
  environment: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "latex-cli-stdio-"));
  const stdin = join(root, "stdin"),
    stdout = join(root, "stdout"),
    stderr = join(root, "stderr");
  const descriptors: number[] = [];
  try {
    // File descriptors keep the real CLI test usable without subprocess sockets.
    writeFileSync(stdin, input ?? "", { mode: 0o600 });
    for (const [path, flags] of [
      [stdin, "r"],
      [stdout, "w"],
      [stderr, "w"],
    ] as const)
      descriptors.push(openSync(path, flags, 0o600));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "apps/cli/src/index.ts", ...args],
      {
        cwd: new URL("..", import.meta.url),
        stdio: descriptors,
        env: {
          ...process.env,
          LATEX_RENDER_BASE_URL: undefined,
          LATEX_RENDER_RENDERER_URL: undefined,
          LATEX_RENDER_GATEWAY_URL: undefined,
          LATEX_RENDER_PROFILE: undefined,
          LATEX_RENDER_API_KEY: "test-only-key",
          ...environment,
        },
      },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: readFileSync(stdout, "utf8"),
      stderr: readFileSync(stderr, "utf8"),
    };
  } finally {
    for (const fd of descriptors) closeSync(fd);
    rmSync(root, { recursive: true, force: true });
  }
}
