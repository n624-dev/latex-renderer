#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { RendererClient } from "@latex-renderer/api-client";
import {
  downloadJobArtifacts,
  getJob,
  renderProject,
  renderSource,
  requestJobAction,
  uploadProjectSource,
  type ClientCoreEvent,
  type RenderProjectResult,
} from "@latex-renderer/client-core";
import {
  AppError,
  CLIENT_VERSION,
  PUBLIC_ORIGIN,
} from "@latex-renderer/shared";
import {
  DEFAULT_DISTRIBUTION_URI,
  deleteCredential,
  doctorSetup,
  fetchDistribution,
  inspectSetup,
  installDistribution,
  loadCredential,
  removeSetup,
  repairSetup,
  saveCredential,
  type McpTarget,
  type SetupStatus,
  type SkillTarget,
} from "@latex-renderer/setup-core";
import { runSetupWeb } from "@latex-renderer/setup-web";
import { Command, CommanderError } from "commander";

const quietWriter = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

const program = new Command()
  .exitOverride()
  .configureOutput({
    writeErr: (value) => {
      if (!requestedJsonMode()) process.stderr.write(value);
    },
  })
  .name("latex-render")
  .version(CLIENT_VERSION)
  .option("--json", "write one structured JSON result to stdout");

const auth = program.command("auth");
const authLogin = auth.command("login").requiredOption("--api-key-stdin");
authLogin.action(async () => {
  const secret = (await readStdin()).trim();
  if (!/^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AppError("INVALID_API_KEY", "Input is not a render API key", 400);
  await saveCredential(secret);
  emitSuccess("auth.login", { stored: true }, () => {
    process.stdout.write("Credential stored.\n");
  });
});

auth.command("status").action(async () => {
  await loadCredential();
  emitSuccess("auth.status", { configured: true }, () => {
    process.stdout.write("Credential is configured.\n");
  });
});

auth
  .command("logout")
  .description("remove the stored API key")
  .action(async () => {
    await deleteCredential();
    emitSuccess("auth.logout", { removed: true }, () => {
      process.stdout.write("Credential removed.\n");
    });
  });

interface SetupCommandOptions {
  baseUri?: string;
  installDirectory?: string;
  binDirectory?: string;
  skillTarget?: SkillTarget;
  mcpTarget?: McpTarget;
  apiKeyStdin?: boolean;
  keepCredential?: boolean;
  keepSkills?: boolean;
  gui?: boolean;
}

const setup = program
  .command("setup")
  .description("install or update the managed cross-platform client")
  .option("--base-uri <url>", "client distribution base URL")
  .option("--install-directory <path>", "managed installation directory")
  .option("--bin-directory <path>", "command launcher directory")
  .option("--skill-target <target>", "both, codex, claude, or none")
  .option("--mcp-target <target>", "both, codex, claude, or none")
  .option("--api-key-stdin", "store a render API key read from standard input")
  .option("--gui", "open the loopback-only Local Setup Web UI")
  .action(async (options: SetupCommandOptions) => {
    if (options.gui === true) {
      if (isJsonMode())
        throw new AppError(
          "INTERACTIVE_JSON_CONFLICT",
          "setup --gui cannot be combined with --json",
          400,
        );
      if (options.apiKeyStdin === true)
        throw new AppError(
          "INTERACTIVE_STDIN_CONFLICT",
          "setup --gui cannot be combined with --api-key-stdin",
          400,
        );
      await runSetupWeb({
        ...setupCoreOptions(options),
        distributionBaseUri: options.baseUri ?? DEFAULT_DISTRIBUTION_URI,
        rendererBaseUrl:
          process.env.LATEX_RENDER_BASE_URL ??
          process.env.LATEX_RENDER_RENDERER_URL ??
          process.env.LATEX_RENDER_GATEWAY_URL ??
          PUBLIC_ORIGIN,
      });
      return;
    }
    const distribution = await fetchDistribution({
      baseUri: options.baseUri ?? DEFAULT_DISTRIBUTION_URI,
    });
    const result = await installDistribution({
      ...distribution,
      ...setupCoreOptions(options),
      skillTarget: parseTarget(options.skillTarget ?? "both", "skill target"),
      mcpTarget: parseTarget(options.mcpTarget ?? "both", "MCP target"),
      ...(isJsonMode() ? { output: quietWriter, warning: quietWriter } : {}),
    });
    if (options.apiKeyStdin === true)
      await saveCredential((await readStdin()).trim());
    emitSuccess("setup", result, () => {
      process.stdout.write(
        `Setup ${result.action}: ${result.installDirectory} (${result.version})\n`,
      );
      printSetupStatus(result.status);
    });
  });

setup
  .command("status")
  .description("inspect the managed client without changing it")
  .action(async (options: SetupCommandOptions) => {
    const result = await inspectSetup(
      setupCoreOptions(setupSubcommandOptions(options)),
    );
    emitSuccess("setup.status", result, () => printSetupStatus(result));
    if (result.status !== "healthy") process.exitCode = 2;
  });

setup
  .command("repair")
  .description("repair only settings owned by this installation")
  .action(async (options: SetupCommandOptions) => {
    const merged = setupSubcommandOptions(options);
    const result = await repairSetup({
      ...setupCoreOptions(merged),
      ...(merged.skillTarget
        ? { skillTarget: parseTarget(merged.skillTarget, "skill target") }
        : {}),
      ...(merged.mcpTarget
        ? { mcpTarget: parseTarget(merged.mcpTarget, "MCP target") }
        : {}),
      ...(isJsonMode() ? { output: quietWriter, warning: quietWriter } : {}),
    });
    if (merged.apiKeyStdin === true)
      await saveCredential((await readStdin()).trim());
    emitSuccess("setup.repair", result, () => {
      process.stdout.write(
        `Repaired ${result.repaired.length} managed item(s).\n`,
      );
      if (result.preserved.length > 0)
        process.stdout.write(
          `Preserved ${result.preserved.length} unowned or modified item(s).\n`,
        );
      printSetupStatus(result.status);
    });
  });

setup
  .command("remove")
  .description("remove the managed client and owned integrations")
  .requiredOption("--yes", "confirm removal")
  .option("--keep-credential", "keep the stored render API key")
  .option("--keep-skills", "keep installed Codex and Claude skills")
  .action(async (options: SetupCommandOptions) => {
    const merged = setupSubcommandOptions(options);
    const result = await removeSetup({
      ...setupCoreOptions(merged),
      keepCredential: merged.keepCredential === true,
      keepSkills: merged.keepSkills === true,
      ...(isJsonMode() ? { output: quietWriter, warning: quietWriter } : {}),
    });
    emitSuccess("setup.remove", result, () => {
      if (!result.removed)
        process.stdout.write("Managed client is not installed.\n");
      if (result.preserved.length > 0)
        process.stdout.write(
          `Preserved ${result.preserved.length} unowned or modified item(s).\n`,
        );
    });
  });

program
  .command("doctor")
  .description(
    "diagnose runtime, installation, credential, Skill, and MCP setup",
  )
  .option("--install-directory <path>", "managed installation directory")
  .option("--bin-directory <path>", "command launcher directory")
  .action(async (options: SetupCommandOptions) => {
    const result = await doctorSetup(setupCoreOptions(options));
    emitSuccess("doctor", result, () => printSetupStatus(result));
    if (result.status !== "healthy") process.exitCode = 2;
  });

program
  .command("render")
  .argument("[path]", "project directory or ZIP")
  .option("--source <id>", "reuse an uploaded Source")
  .option("--entrypoint <path>", "TeX entrypoint", "main.tex")
  .option("--output <directory>", "output directory")
  .option("--svg", "also export each outermost math and TikZ object as SVG")
  .option("--open", "open the PDF after success")
  .action(async (path: string | undefined, options: { open?: boolean; svg?: boolean; source?: string; entrypoint: string; output?: string }) => {
    if (options.source !== undefined && path !== undefined)
      throw new AppError(
        "CLI_USAGE_ERROR",
        "Specify either a project path or --source, not both",
        400,
      );
    const client = await configuredClient(),
      renderOptions = {
        entrypoint: options.entrypoint,
        outputs: options.svg === true ? (["pdf", "svg"] as const) : (["pdf"] as const),
        ...(options.output === undefined
          ? {}
          : { outputDirectory: options.output }),
        ...(isJsonMode() ? {} : { onEvent: humanRenderEvent }),
      },
      result =
        options.source === undefined
          ? await renderProject(client, path ?? ".", renderOptions)
          : await renderSource(client, options.source, renderOptions);
    const pdf = result.artifacts.pdf;
    if (options.open === true && pdf !== undefined) openFile(pdf);
    if (result.job.status === "succeeded") {
      emitSuccess("render", result, () => undefined);
      return;
    }
    emitRenderFailure(result);
    process.exitCode = 2;
  });

const sources = program.command("source");
sources
  .command("upload")
  .argument("<path>", "project directory or ZIP")
  .action(async (path: string) => {
    const result = await uploadProjectSource(
      await configuredClient(),
      path,
      isJsonMode() ? {} : { onEvent: humanRenderEvent },
    );
    emitSuccess("source.upload", result, () => {
      process.stdout.write(
        `${result.sourceId}${result.uploadRequired ? " uploaded" : " reused"}.\n`,
      );
    });
  });

const jobs = program.command("jobs");
jobs
  .command("get")
  .argument("<id>")
  .action(async (id: string) => {
    const job = await getJob(await configuredClient(), id);
    emitSuccess("jobs.get", { job }, () => {
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    });
  });

jobs
  .command("cancel")
  .argument("<id>")
  .action(async (id: string) => {
    const result = await requestJobAction(
      await configuredClient(),
      id,
      "cancel",
    );
    emitSuccess("jobs.cancel", result, () => {
      process.stdout.write(`Cancel requested for ${id}.\n`);
    });
  });

jobs
  .command("delete")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) => {
    const result = await requestJobAction(
      await configuredClient(),
      id,
      "delete",
    );
    emitSuccess("jobs.delete", result, () => {
      process.stdout.write(`Delete requested for ${id}.\n`);
    });
  });

jobs
  .command("download")
  .argument("<id>")
  .option("--output <directory>", "output directory", ".render")
  .action(async (id: string, options: { output: string }) => {
    const result = await downloadJobArtifacts(
      await configuredClient(),
      id,
      options.output,
    );
    emitSuccess("jobs.download", result, () => {
      process.stdout.write(
        `Artifacts downloaded to ${result.outputDirectory}.\n`,
      );
    });
  });

void program.parseAsync().catch((error: unknown) => {
  if (
    error instanceof CommanderError &&
    ["commander.helpDisplayed", "commander.version"].includes(error.code)
  ) {
    process.exitCode = 0;
    return;
  }
  if (isJsonMode()) {
    const normalized = normalizeError(error);
    writeJson({
      success: false,
      command: commandNameFromArguments(process.argv.slice(2)),
      error: normalized,
    });
  } else if (!(error instanceof CommanderError)) {
    process.stderr.write(
      `latex-render: ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
  }
  process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
});

async function configuredClient(): Promise<RendererClient> {
  const base =
    process.env.LATEX_RENDER_BASE_URL ??
    process.env.LATEX_RENDER_RENDERER_URL ??
    process.env.LATEX_RENDER_GATEWAY_URL ??
    PUBLIC_ORIGIN;
  return new RendererClient(base, await loadCredential());
}

function humanRenderEvent(event: ClientCoreEvent): void {
  if (event.type === "source.ready") {
    process.stdout.write(
      `Source ${event.sourceId} ${event.uploadRequired ? "uploaded" : "reused"}.\n`,
    );
    return;
  }
  if (event.type === "job.queued") {
    process.stdout.write(`Job ${event.jobId} queued.\n`);
    return;
  }
  if (event.type !== "job.status") return;
  process.stdout.write(`\r${event.status.padEnd(12)}`);
  if (isTerminalStatus(event.status)) process.stdout.write("\n");
}

function emitSuccess(
  command: string,
  result: unknown,
  humanOutput: () => void,
): void {
  if (isJsonMode()) writeJson({ success: true, command, result });
  else humanOutput();
}

function emitRenderFailure(result: RenderProjectResult): void {
  const error = {
    code: result.job.errorCode ?? "RENDER_FAILED",
    message:
      result.job.errorMessage ?? `Render ended with ${result.job.status}`,
  };
  if (isJsonMode())
    writeJson({ success: false, command: "render", result, error });
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
  status?: number;
} {
  if (error instanceof AppError)
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  if (error instanceof CommanderError)
    return {
      code: "CLI_USAGE_ERROR",
      message: error.message,
      status: 400,
    };
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

function commandNameFromArguments(args: readonly string[]): string {
  return args
    .filter((argument) => argument !== "--json")
    .filter((argument) => !argument.startsWith("-"))
    .slice(0, 2)
    .join(".");
}

function isJsonMode(): boolean {
  return (
    program.opts<{ json?: boolean }>().json === true || requestedJsonMode()
  );
}

function requestedJsonMode(): boolean {
  return process.argv.includes("--json");
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function setupCoreOptions(options: SetupCommandOptions): {
  installDirectory?: string;
  binDirectory?: string;
} {
  return {
    ...(options.installDirectory
      ? { installDirectory: options.installDirectory }
      : {}),
    ...(options.binDirectory ? { binDirectory: options.binDirectory } : {}),
  };
}

function setupSubcommandOptions(
  options: SetupCommandOptions,
): SetupCommandOptions {
  return { ...setup.opts<SetupCommandOptions>(), ...options };
}

function parseTarget(value: string | undefined, label: string): SkillTarget {
  if (
    value === "both" ||
    value === "codex" ||
    value === "claude" ||
    value === "none"
  )
    return value;
  throw new AppError(
    "INVALID_SETUP_TARGET",
    `${label} must be both, codex, claude, or none`,
    400,
  );
}

function printSetupStatus(status: SetupStatus): void {
  process.stdout.write(`Setup status: ${status.status}\n`);
  for (const check of status.checks)
    process.stdout.write(
      `${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.message}${
        check.path ? ` (${check.path})` : ""
      }\n`,
    );
}

function isTerminalStatus(status: string): boolean {
  return [
    "succeeded",
    "failed",
    "timeout",
    "canceled",
    "rejected",
    "deleted",
    "expired",
  ].includes(status);
}

async function readStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
}

function openFile(path: string): void {
  if (process.platform === "win32")
    spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -LiteralPath $env:LATEX_RENDER_PDF",
      ],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, LATEX_RENDER_PDF: path },
      },
    ).unref();
  else if (process.platform === "darwin")
    spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
}
