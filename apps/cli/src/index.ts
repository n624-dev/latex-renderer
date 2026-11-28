#!/usr/bin/env node
import { humanText, humanDiagnostic, humanJobStatus } from "./messages.js";
import { connectionMenu } from "./connection-menu.js";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { RendererClient } from "@latex-renderer/api-client";
import {
  acceptedJobRecovery,
  compileProjectPdf,
  downloadJobArtifacts,
  openLocalTarget,
  getJob,
  renderProject,
  renderEngineSchema,
  renderSource,
  requestJobAction,
  retrySvgJob,
  uploadProjectSource,
  withClientOperationDeadline,
  type ClientCoreEvent,
  type RenderProjectResult,
  type RenderEngine,
} from "@latex-renderer/client-core";
import { stripVTControlCharacters } from "node:util";
import {
  AppError,
  CLIENT_VERSION,
  clientRendererBaseUrl,
} from "@latex-renderer/shared";
import {
  DEFAULT_DISTRIBUTION_URI,
  clientConnections,
  configurePackageIntegrations,
  deleteCredential,
  doctorSetup,
  fetchDistribution,
  inspectSetup,
  installDistribution,
  removeSetup,
  repairSetup,
  type McpTarget,
  type SetupStatus,
  type SkillTarget,
  type SystemClientPackage,
} from "@latex-renderer/setup-core";
import { createSetupWebActions, runSetupWeb } from "@latex-renderer/setup-web";
import { Command, CommanderError } from "commander";

const quietWriter = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

const publicCommand = process.env.N624_LATEX_COMMAND === "1";
const commandName = publicCommand ? "n624-latex" : "latex-render";
const packageManager = (["apt", "winget", "homebrew"] as const).find(
  (manager) => manager === process.env.N624_LATEX_PACKAGE,
);

function packageManagedError(): AppError {
  return new AppError(
    packageManager === "apt" ? "APT_MANAGED_CLIENT" : "PACKAGE_MANAGED_CLIENT",
    `Manage the installed client with ${packageManager === "apt" ? "APT" : packageManager === "winget" ? "WinGet" : "Homebrew"} (n624-latex)`,
    400,
  );
}

const program = new Command()
  .exitOverride()
  .configureOutput({
    writeErr: (value) => {
      if (!requestedJsonMode()) process.stderr.write(value);
    },
  })
  .name(commandName)
  .version(CLIENT_VERSION)
  .option("--json", humanText("writeOneStructuredJsonResultTo"))
  .option("--profile <name>", "use a saved Renderer connection for this command");

if (publicCommand) {
  program.addHelpText("after", "\n" + humanText("compileADocumentN624LatexMain"));
  const compile = (name: string, engine?: RenderEngine) => program
    .command(name, { hidden: engine === undefined })
    .description(humanText("compileATexDocumentWithThis"))
    .argument("<file>")
    .option("-o, --output <file>", humanText("writeThePdfToThisPath"))
    .action(async (input: string, options: { output?: string }) => {
      let client: RendererClient;
      try {
        client = await configuredClient();
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === "ENOENT" ||
          (error as NodeJS.ErrnoException).code === "CREDENTIAL_NOT_FOUND"
        )
          throw new AppError(
            "CREDENTIAL_REQUIRED",
            "Run n624-latex setup to configure the renderer client",
            401,
          );
        throw error;
      }
      const result = await runLocalRenderOperation((signal) =>
        compileProjectPdf(client, input, { ...options, engine, signal }),
      );
      if (result.pdf !== undefined) {
        emitSuccess("compile", { jobId: result.job.id, pdf: result.pdf }, () =>
          process.stdout.write(`${result.pdf}\n`),
        );
        return;
      }
      const error = {
        code: result.job.errorCode ?? "RENDER_FAILED",
        message:
          result.job.errorMessage ?? `Render ended with ${result.job.status}`,
      };
      if (isJsonMode())
        writeJson({ success: false, command: "compile", result, error });
      else {
        const terminalText = (value: string) =>
          stripVTControlCharacters(value).replaceAll(/\s+/g, " ").slice(0, 500);
        const message = humanDiagnostic(
          result.job.errorMessage ?? humanText("renderEnded", {
            status: humanJobStatus(result.job.status),
          }),
        );
        process.stderr.write(`${terminalText(message)} (${result.job.id})\n`);
        for (const item of result.diagnostics?.errors.slice(0, 10) ?? [])
          process.stderr.write(
            `${terminalText(item.file)}${item.line === null ? "" : `:${item.line}`}: ${terminalText(item.message)}\n`,
          );
      }
      process.exitCode = 2;
    });
  compile("compile");
  for (const engine of renderEngineSchema.options) compile(engine, engine);
}

const auth = program.command("auth");
const authLogin = auth.command("login").requiredOption("--api-key-stdin").option("--url <url>");
authLogin.action(async (options: { url?: string }) => {
  const secret = (await readStdin()).trim();
  if (!/^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AppError("INVALID_API_KEY", "Input is not a render API key", 400);
  await saveConnectionCredential(secret, options.url);
  emitSuccess("auth.login", { stored: true }, () => {
    process.stdout.write(humanText("credentialStored") + "\n");
  });
});

auth.command("status").action(async () => {
  try {
    const { origin, credentialSource, name } =
      await clientConnections().resolve(activeProfile());
    const environmentVariable = "LATEX_RENDER_API_KEY";
    const result = {
      configured: true,
      origin,
      credentialSource,
      ...(credentialSource === "profile"
        ? { profile: name }
        : { environmentVariable }),
    };
    emitSuccess("auth.status", result, () => {
      process.stdout.write(
        humanText("credentialIsConfigured") +
          "\n" +
          humanConnectionStatus(origin, name ?? environmentVariable),
      );
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "CREDENTIAL_NOT_FOUND")
      throw error;
    const parsed = URL.parse(clientRendererBaseUrl(process.env));
    const origin =
      parsed && ["https:", "http:"].includes(parsed.protocol)
        ? parsed.origin
        : null;
    const result = { configured: false, origin, credentialSource: "none" };
    if (isJsonMode())
      writeJson({
        success: false,
        command: "auth.status",
        error: normalizeError(error),
        result,
      });
    else
      process.stderr.write(
        `${commandName}: ${humanDiagnostic(error.message)}\n` +
          humanConnectionStatus(origin, humanText("noCredentialSource")),
      );
    process.exitCode = 1;
  }
});

function humanConnectionStatus(origin: string | null, source: string): string {
  return (
    humanText("connectionStatus", { origin: origin ?? "—", source }) + "\n"
  );
}

auth
  .command("logout")
  .description(humanText("removeTheStoredApiKey"))
  .action(async () => {
    const store = clientConnections();
    const name = activeProfile() ?? process.env.LATEX_RENDER_PROFILE ?? await store.defaultName();
    if (name) await store.remove(name);
    else await deleteCredential();
    emitSuccess("auth.logout", { removed: true }, () => {
      process.stdout.write(humanText("credentialRemoved") + "\n");
    });
  });

const connection = program.command("connection").description("Manage Renderer connections");
connection.action(async () => {
  if (isJsonMode()) throw new AppError("CLI_USAGE_ERROR", "Choose a connection subcommand for JSON output", 400);
  await connectionMenu();
});
connection.command("list").action(async () => {
  const connections = await clientConnections().list();
  emitSuccess("connection.list", { connections }, () => {
    for (const item of connections)
      process.stdout.write(`${item.default ? "*" : " "} ${item.name}  ${item.origin}\n`);
  });
});
connection.command("add").argument("<name>").argument("<url>").requiredOption("--api-key-stdin")
  .action(async (name: string, url: string) => {
    await clientConnections().save(name, url, (await readStdin()).trim());
    emitSuccess("connection.add", { name }, () => process.stdout.write(humanText("credentialStored") + "\n"));
  });
connection.command("use").argument("<name>").action(async (name: string) => {
  await clientConnections().select(name);
  emitSuccess("connection.use", { name }, () => process.stdout.write(name + "\n"));
});
connection.command("remove").argument("<name>").requiredOption("--yes").action(async (name: string) => {
  await clientConnections().remove(name);
  emitSuccess("connection.remove", { name }, () => process.stdout.write(humanText("credentialRemoved") + "\n"));
});
connection.command("migrate").argument("<name>").argument("<url>").requiredOption("--confirm-origin")
  .action(async (name: string, url: string) => {
    await clientConnections().migrate(name, url);
    emitSuccess("connection.migrate", { name }, () => process.stdout.write(humanText("credentialStored") + "\n"));
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
  .description(humanText("installOrUpdateTheManagedCross"))
  .option("--base-uri <url>", humanText("clientDistributionBaseUrl"))
  .option("--install-directory <path>", humanText("managedInstallationDirectory"))
  .option("--bin-directory <path>", humanText("commandLauncherDirectory"))
  .option("--skill-target <target>", "both, codex, claude, or none")
  .option("--mcp-target <target>", "both, codex, claude, or none")
  .option("--api-key-stdin", humanText("storeARenderApiKeyRead"))
  .option("--gui", humanText("openTheLoopbackOnlyLocalSetup"))
  .action(async (options: SetupCommandOptions) => {
    if (
      packageManager &&
      options.apiKeyStdin === true &&
      options.gui !== true
    ) {
      await saveConnectionCredential((await readStdin()).trim());
      emitSuccess("setup", { configured: true }, () =>
        process.stdout.write(humanText("credentialStored") + "\n"),
      );
      return;
    }
    const interactiveDefault =
      publicCommand &&
      process.stdin.isTTY &&
      !isJsonMode() &&
      Object.keys(options).length === 0;
    if (
      options.gui === true ||
      (packageManager && !isJsonMode()) ||
      interactiveDefault
    ) {
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
      const webOptions = {
        ...setupCoreOptions(options),
        distributionBaseUri: options.baseUri ?? DEFAULT_DISTRIBUTION_URI,
        ...(activeProfile() ? { profile: activeProfile() } : {}),
      };
      if (packageManager) {
        const core = setupCoreOptions(options);
        const actions = createSetupWebActions(webOptions);
        actions.status = () => inspectSetup(core);
        actions.doctor = () => doctorSetup(core);
        actions.update = () => Promise.reject(packageManagedError());
        actions.repair = (targets) =>
          packageManager === "apt" || !core.systemPackage
            ? Promise.reject(packageManagedError())
            : configurePackageIntegrations({
                ...core,
                systemPackage: core.systemPackage,
                ...targets,
                output: quietWriter,
                warning: quietWriter,
              });
        await runSetupWeb({ ...webOptions, actions, packageManager });
      } else await runSetupWeb(webOptions);
      return;
    }
    if (packageManager) throw packageManagedError();
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
      await saveConnectionCredential((await readStdin()).trim());
    emitSuccess("setup", result, () => {
      process.stdout.write(
        `Setup ${result.action}: ${result.installDirectory} (${result.version})\n`,
      );
      printSetupStatus(result.status);
    });
  });

setup
  .command("integrations")
  .description(
    humanText("configureAiIntegrationsForAWinget"),
  )
  .action(async (options: SetupCommandOptions) => {
    const merged = setupSubcommandOptions(options);
    const core = setupCoreOptions(merged);
    if (!core.systemPackage || packageManager === "apt")
      throw new AppError(
        "DESKTOP_PACKAGE_REQUIRED",
        "This command is for WinGet or Homebrew installations",
        400,
      );
    const result = await configurePackageIntegrations({
      ...core,
      systemPackage: core.systemPackage,
      skillTarget: parseTarget(merged.skillTarget ?? "both", "skill target"),
      mcpTarget: parseTarget(merged.mcpTarget ?? "both", "MCP target"),
      ...(isJsonMode() ? { output: quietWriter, warning: quietWriter } : {}),
    });
    emitSuccess("setup.integrations", result, () => {
      for (const item of result.repaired)
        process.stdout.write(humanText("configuredIntegration", { item }) + "\n");
      for (const item of result.preserved)
        process.stdout.write(humanText("preservedIntegration", { item }) + "\n");
    });
  });

setup
  .command("status")
  .description(humanText("inspectTheManagedClientWithoutChanging"))
  .action(async (options: SetupCommandOptions) => {
    const result = await inspectSetup(
      setupCoreOptions(setupSubcommandOptions(options)),
    );
    emitSuccess("setup.status", result, () => printSetupStatus(result));
    if (result.status !== "healthy") process.exitCode = 2;
  });

setup
  .command("repair")
  .description(humanText("repairOnlySettingsOwnedByThis"))
  .action(async (options: SetupCommandOptions) => {
    if (packageManager) throw packageManagedError();
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
      await saveConnectionCredential((await readStdin()).trim());
    emitSuccess("setup.repair", result, () => {
      process.stdout.write(
        humanText("repairedItems", { count: result.repaired.length }) + "\n",
      );
      if (result.preserved.length > 0)
        process.stdout.write(
          humanText("preservedItems", { count: result.preserved.length }) + "\n",
        );
      printSetupStatus(result.status);
    });
  });

setup
  .command("remove")
  .description(humanText("removeTheManagedClientAndOwned"))
  .requiredOption("--yes", humanText("confirmRemoval"))
  .option("--keep-credential", humanText("keepTheStoredRenderApiKey"))
  .option("--keep-skills", humanText("keepInstalledCodexAndClaudeSkills"))
  .action(async (options: SetupCommandOptions) => {
    if (packageManager) throw packageManagedError();
    const merged = setupSubcommandOptions(options);
    const result = await removeSetup({
      ...setupCoreOptions(merged),
      keepCredential: merged.keepCredential === true,
      keepSkills: merged.keepSkills === true,
      ...(isJsonMode() ? { output: quietWriter, warning: quietWriter } : {}),
    });
    emitSuccess("setup.remove", result, () => {
      if (!result.removed)
        process.stdout.write(humanText("managedClientIsNotInstalled") + "\n");
      if (result.preserved.length > 0)
        process.stdout.write(
          humanText("preservedItems", { count: result.preserved.length }) + "\n",
        );
    });
  });

program
  .command("doctor")
  .description(
    humanText("diagnoseRuntimeInstallationCredentialSkillAnd"),
  )
  .option("--install-directory <path>", humanText("managedInstallationDirectory"))
  .option("--bin-directory <path>", humanText("commandLauncherDirectory"))
  .action(async (options: SetupCommandOptions) => {
    const result = await doctorSetup(setupCoreOptions(options));
    emitSuccess("doctor", result, () => printSetupStatus(result));
    if (result.status !== "healthy") process.exitCode = 2;
  });

program
  .command("render")
  .argument("[path]", humanText("projectDirectoryOrZip"))
  .option("--source <id>", humanText("reuseAnUploadedSource"))
  .option("--entrypoint <path>", humanText("texEntrypoint"), "main.tex")
  .option("--output <directory>", humanText("outputDirectory"))
  .option("--svg", humanText("alsoExportEachOutermostMathAnd"))
  .option("--open", humanText("openThePdfAfterSuccess"))
  .action(
    async (
      path: string | undefined,
      options: {
        open?: boolean;
        svg?: boolean;
        source?: string;
        entrypoint: string;
        output?: string;
      },
    ) => {
      if (options.source !== undefined && path !== undefined)
        throw new AppError(
          "CLI_USAGE_ERROR",
          "Specify either a project path or --source, not both",
          400,
        );
      const client = await configuredClient(),
        renderOptions = {
          entrypoint: options.entrypoint,
          outputs:
            options.svg === true
              ? (["pdf", "svg"] as const)
              : (["pdf"] as const),
          ...(options.output === undefined
            ? {}
            : { outputDirectory: options.output }),
          ...(isJsonMode() ? {} : { onEvent: humanRenderEvent }),
        },
        result = await runLocalRenderOperation((signal) =>
          options.source === undefined
            ? renderProject(client, path ?? ".", { ...renderOptions, signal })
            : renderSource(client, options.source, { ...renderOptions, signal }),
        );
      const pdf = result.artifacts.pdf;
      if (
        options.open === true &&
        pdf !== undefined &&
        !(await openLocalTarget(pdf))
      )
        process.stderr.write(
          humanText("pdfWasSavedButOpeningIt") + "\n",
        );
      if (result.job.status === "succeeded") {
        emitSuccess("render", result, () => undefined);
        return;
      }
      emitRenderFailure(result);
      process.exitCode = 2;
    },
  );

const sources = program.command("source");
sources
  .command("upload")
  .argument("<path>", humanText("projectDirectoryOrZip"))
  .action(async (path: string) => {
    const result = await runLocalRenderOperation(async (signal) =>
      uploadProjectSource(await configuredClient(), path, {
        signal,
        ...(isJsonMode() ? {} : { onEvent: humanRenderEvent }),
      }),
    );
    emitSuccess("source.upload", result, () => {
      process.stdout.write(
        humanText(result.uploadRequired ? "inputUploaded" : "inputReused", {
          id: result.sourceId,
        }) + "\n",
      );
    });
  });

const projects = program
  .command("projects")
  .description(humanText("manageSavedProjectsSharedWithWeb"));
projects
  .command("list")
  .option("--cursor <cursor>")
  .action(async (options: { cursor?: string }) => {
    const result = await (await configuredClient()).listProjects(options);
    emitSuccess("projects.list", result, () =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    );
  });
projects
  .command("get")
  .argument("<id>")
  .option("--cursor <cursor>")
  .action(async (id: string, options: { cursor?: string }) => {
    const result = await (await configuredClient()).getProject(id, options);
    emitSuccess("projects.get", result, () =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    );
  });
projects
  .command("jobs")
  .argument("<project-id>")
  .argument("<revision-id>")
  .option("--cursor <cursor>")
  .action(
    async (
      projectId: string,
      revisionId: string,
      options: { cursor?: string },
    ) => {
      const result = await (
        await configuredClient()
      ).listProjectRevisionJobs(projectId, revisionId, options);
      emitSuccess("projects.jobs", result, () =>
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
      );
    },
  );
projects
  .command("create")
  .argument("<name>")
  .action(async (name: string) => {
    const result = await (await configuredClient()).createProject(name);
    emitSuccess("projects.create", result, () =>
      process.stdout.write(`${result.id}\n`),
    );
  });
projects
  .command("rename")
  .argument("<id>")
  .argument("<name>")
  .action(async (id: string, name: string) => {
    const result = await (await configuredClient()).renameProject(id, name);
    emitSuccess("projects.rename", result, () =>
      process.stdout.write(`${result.id}: ${result.displayName}\n`),
    );
  });
projects
  .command("delete")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) => {
    await (await configuredClient()).deleteProject(id);
    emitSuccess("projects.delete", { id, deleted: true }, () =>
    process.stdout.write(humanText("projectDeleted", { id }) + "\n"),
    );
  });
projects
  .command("save")
  .description(humanText("uploadALocalSourceAndAttach"))
  .argument("<project-id>")
  .argument("<path>")
  .option("--entrypoint <path>", humanText("texEntrypoint"), "main.tex")
  .option("--name <name>", humanText("revisionDisplayName"))
  .option("--svg", humanText("usePdfAndSvgAsInitial"))
  .action(
    async (
      projectId: string,
      path: string,
      options: { entrypoint: string; name?: string; svg?: boolean },
    ) => {
      const { source, revision } = await runLocalRenderOperation(async (signal) => {
        const client = await configuredClient();
        const source = await uploadProjectSource(client, path, { signal });
        const filename = basename(resolve(path));
        const revision = await client.attachProjectRevision({
          projectId,
          sourceId: source.sourceId,
          entrypoint: options.entrypoint,
          displayName: options.name ?? filename,
          originalFilename: filename,
          outputs: options.svg ? ["pdf", "svg"] : ["pdf"],
        }, { signal });
        return { source, revision };
      });
      emitSuccess("projects.save", { source, revision }, () =>
        process.stdout.write(`${revision.id} (${source.sourceId})\n`),
      );
    },
  );
projects
  .command("render")
  .description(humanText("queueAJobForAnExact"))
  .argument("<project-id>")
  .argument("<revision-id>")
  .option("--svg", humanText("usePdfAndSvgInsteadOf"))
  .action(
    async (
      projectId: string,
      revisionId: string,
      options: { svg?: boolean },
    ) => {
      const result = await (
        await configuredClient()
      ).renderProjectRevision(
        projectId,
        revisionId,
        randomUUID(),
        options.svg ? ["pdf", "svg"] : undefined,
      );
      emitSuccess(
        "projects.render",
        { projectId, revisionId, jobId: result.jobId },
        () => process.stdout.write(`${result.jobId}\n`),
      );
    },
  );

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
      process.stdout.write(humanText("cancelRequested", { id: id }) + "\n");
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
      process.stdout.write(humanText("deleteRequested", { id: id }) + "\n");
    });
  });

jobs
  .command("download")
  .argument("<id>")
  .option("--output <directory>", humanText("outputDirectory"), ".render")
  .option("--pdf-only", humanText("downloadTheCommittedPdfWithoutWaiting"))
  .option(
    "--preview-page <pages...>",
    humanText("generateSelectedPreviewPages1100"),
  )
  .action(
    async (
      id: string,
      options: { output: string; pdfOnly?: boolean; previewPage?: string[] },
    ) => {
      const result = await runLocalRenderOperation(async (signal) =>
        downloadJobArtifacts(await configuredClient(), id, options.output, {
          signal,
          ...(isJsonMode() ? {} : { onEvent: humanRenderEvent }),
          ...(options.pdfOnly === true ? { pdfOnly: true } : {}),
          ...(options.previewPage === undefined
            ? {}
            : { previewPages: options.previewPage.map(Number) }),
        }),
      );
      emitSuccess("jobs.download", result, () => {
        process.stdout.write(
          humanText("downloadComplete", { directory: result.outputDirectory }) + "\n",
        );
      });
    },
  );

jobs
  .command("retry-svg")
  .argument("<id>")
  .option("--output <directory>", humanText("outputDirectory"), ".render")
  .action(async (id: string, options: { output: string }) => {
    const result = await runLocalRenderOperation(async (signal) =>
      retrySvgJob(await configuredClient(), id, options.output, {
        signal,
        ...(isJsonMode() ? {} : { onEvent: humanRenderEvent }),
      }),
    );
    emitSuccess("jobs.retry-svg", result, () => {
      process.stdout.write(
        result.job.status === "succeeded"
          ? humanText("svgRetrySucceededOriginalPdfRetained") + "\n"
          : humanText("partialSuccessOriginalPdfRetainedSvg") + "\n",
      );
    });
    if (result.job.status !== "succeeded") process.exitCode = 2;
  });

const userArgs = process.argv.slice(2);
if (publicCommand && userArgs[0] === "admin") {
  const entry = join(dirname(process.argv[1] ?? ""), "latex-render-admin.mjs");
  if (!existsSync(entry)) {
    process.stderr.write(humanText("thisInstallationDoesNotContainThe") + "\n");
    process.exitCode = 1;
  } else {
    const child = spawnSync(process.execPath, [entry, ...userArgs.slice(1)], {
      stdio: "inherit",
    });
    if (child.error !== undefined)
      process.stderr.write(`${child.error.message}\n`);
    process.exitCode = child.status ?? 1;
  }
} else {
  let first = 0;
  while (first < userArgs.length) {
    const value = userArgs[first];
    if (value === "--profile") first += 2;
    else if (value === "--json" || value?.startsWith("--profile=")) first++;
    else break;
  }
  const input = userArgs[first];
  if (
    publicCommand &&
    input !== undefined &&
    !input.startsWith("-") &&
    /\.tex$/i.test(input)
  )
    userArgs.splice(first, 0, "compile");
  void program
    .parseAsync(userArgs, { from: "user" })
    .catch((error: unknown) => {
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
          command: parsedCommandName(program),
          error: normalized,
        });
      } else if (!(error instanceof CommanderError)) {
        process.stderr.write(
          `${commandName}: ${error instanceof Error ? humanDiagnostic(error.message) : humanDiagnostic("Unknown error")}\n`,
        );
      }
      process.exitCode =
        error instanceof CommanderError
          ? error.exitCode
          : error instanceof AppError && error.code === "CLIENT_OPERATION_INTERRUPTED"
            ? 130
            : 1;
    });
}

async function runLocalRenderOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new AppError(
    "CLIENT_OPERATION_INTERRUPTED",
    "Local operation interrupted. Check the status of any accepted Job before submitting again.",
    499,
  ));
  process.once("SIGINT", interrupt);
  try {
    return await withClientOperationDeadline(operation, { signal: controller.signal });
  } finally {
    process.off("SIGINT", interrupt);
  }
}

async function configuredClient(): Promise<RendererClient> {
  const { origin, apiKey } = await clientConnections().resolve(activeProfile());
  return new RendererClient(origin, apiKey);
}

function activeProfile() {
  return program.opts<{ profile?: string }>().profile;
}

async function saveConnectionCredential(secret: string, url?: string): Promise<void> {
  const store = clientConnections();
  const { name, origin } = await store.target(activeProfile(), url);
  await store.save(name, origin, secret);
}

function humanRenderEvent(event: ClientCoreEvent): void {
  if (event.type === "source.ready") {
    process.stdout.write(
      humanText(event.uploadRequired ? "sourceUploaded" : "sourceReused", {
        id: event.sourceId,
      }) + "\n",
    );
    return;
  }
  if (event.type === "job.queued") {
    process.stdout.write(humanText("jobQueued", { id: event.jobId }) + "\n");
    return;
  }
  if (event.type !== "job.status") return;
  const wait = event.resourceWait
    ?.replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .slice(0, 300);
  process.stdout.write(
    `\r${`${humanJobStatus(event.status)}${wait ? ` — ${wait}` : ""}`.padEnd(160)}`,
  );
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
  else if (result.job.stages?.pdf.status === "succeeded")
    process.stderr.write(
      humanText("partialSuccessPdfAndPreviewsWere") + "\n",
    );
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
  status?: number;
  jobId?: string;
  lastStatus?: string | null;
} {
  if (error instanceof AppError)
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...acceptedJobRecovery(error),
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

function parsedCommandName(root: Command): string {
  const path: string[] = [];
  let current = root;
  for (;;) {
    // Commander has already consumed option values. Only registered children
    // can extend the operation name; positional data is never an identifier.
    const child = current.commands.find(
      (command) =>
        command.name() === current.args[0] ||
        command.aliases().includes(current.args[0] ?? ""),
    );
    if (child === undefined) return path.join(".");
    path.push(child.name());
    current = child;
  }
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
  systemPackage?: SystemClientPackage;
} {
  const directory =
    packageManager === "apt"
      ? "/usr/lib/n624-latex/client"
      : process.env.LATEX_RENDER_INSTALL_DIRECTORY;
  const binDirectory =
    packageManager === "apt"
      ? "/usr/bin"
      : process.env.LATEX_RENDER_BIN_DIRECTORY;
  if (
    packageManager &&
    (!directory ||
      !binDirectory ||
      !isAbsolute(directory) ||
      !isAbsolute(binDirectory))
  ) {
    throw new AppError(
      "PACKAGE_INSTALLATION_INVALID",
      "The package launcher must supply absolute paths",
      400,
    );
  }
  return {
    ...(options.installDirectory
      ? { installDirectory: options.installDirectory }
      : {}),
    ...(options.binDirectory ? { binDirectory: options.binDirectory } : {}),
    ...(packageManager && directory && binDirectory
      ? {
          systemPackage: {
            manager: packageManager,
            version: CLIENT_VERSION,
            directory,
            binDirectory,
          },
        }
      : {}),
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
  process.stdout.write(humanText("setupStatus", { status: status.status }) + "\n");
  for (const check of status.checks)
    process.stdout.write(
      `${check.status.toUpperCase().padEnd(4)} ${check.id}: ${humanDiagnostic(check.message)}${
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
