import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve, win32 } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { AppError } from "@latex-renderer/shared";

export const DEFAULT_DISTRIBUTION_URI =
  "https://latex-render.n624.jp/downloads/client/";
const PAYLOAD_NAME = "latex-renderer-client";
const STATE_FILE = ".install-state.json";
const MAXIMUM_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAXIMUM_EXPANDED_BYTES = 100 * 1024 * 1024;
const MCP_SERVER_NAME = "latex-renderer";

export type SkillTarget = "both" | "codex" | "claude" | "none";
export type McpTarget = "both" | "codex" | "claude" | "none";
export type SetupPlatform = "win32" | "darwin" | "linux";

export interface ClientManifest {
  readonly version: string;
  readonly archive: string;
  readonly sha256: string;
  readonly size: number;
}

export interface SetupPaths {
  readonly platform: SetupPlatform;
  readonly home: string;
  readonly installDirectory: string;
  readonly binDirectory: string;
  readonly statePath: string;
  readonly credentialPath: string;
  readonly cliLauncher: string;
  readonly mcpLauncher: string;
  readonly skillRoot: string;
}

export interface ManagedSetupState {
  readonly format: 2;
  readonly product: "latex-renderer-client";
  readonly version: string;
  readonly archiveSha256: string;
  readonly platform: SetupPlatform;
  readonly installDirectory: string;
  readonly binDirectory: string;
  readonly skillTarget: SkillTarget;
  readonly mcpTarget: McpTarget;
  readonly managedMcpClients: readonly ("codex" | "claude")[];
  readonly windowsUserPathAdded: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface DiagnosticCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message: string;
  readonly path?: string;
}

export interface SetupStatus {
  readonly status: "not_installed" | "healthy" | "degraded";
  readonly version?: string;
  readonly platform: SetupPlatform;
  readonly paths: SetupPaths;
  readonly checks: readonly DiagnosticCheck[];
  readonly state?: ManagedSetupState;
}

export interface SetupResult {
  readonly action: "installed" | "updated" | "current";
  readonly version: string;
  readonly installDirectory: string;
  readonly binDirectory: string;
  readonly backup?: string;
  readonly status: SetupStatus;
}

export interface RepairResult {
  readonly repaired: readonly string[];
  readonly preserved: readonly string[];
  readonly status: SetupStatus;
}

export interface RemoveResult {
  readonly removed: boolean;
  readonly preserved: readonly string[];
  readonly installDirectory: string;
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => CommandResult;

interface SkillInstallerModule {
  installSkillTargets(options: {
    target: Exclude<SkillTarget, "none">;
    source: string;
    previousSource?: string;
    home: string;
    output: NodeJS.WritableStream;
    warning: NodeJS.WritableStream;
  }): Promise<readonly { status: string; destination: string }[]>;
  removeSkillTargets(options: {
    target: "both";
    source: string;
    home: string;
    output: NodeJS.WritableStream;
    warning: NodeJS.WritableStream;
  }): Promise<readonly { status: string; destination: string }[]>;
}

interface CoreOptions {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly installDirectory?: string;
  readonly binDirectory?: string;
  readonly runner?: CommandRunner;
  readonly output?: NodeJS.WritableStream;
  readonly warning?: NodeJS.WritableStream;
}

export function supportedPlatform(
  platform: NodeJS.Platform = process.platform,
): SetupPlatform {
  if (platform === "win32" || platform === "darwin" || platform === "linux")
    return platform;
  throw new AppError(
    "UNSUPPORTED_PLATFORM",
    `Unsupported client platform: ${platform}`,
    400,
  );
}

export function defaultInstallDirectory({
  platform = process.platform,
  home = homedir(),
  env = process.env,
}: {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const checked = supportedPlatform(platform);
  const pathApi = checked === "win32" ? win32 : posix;
  if (checked === "win32")
    return pathApi.join(
      env.LOCALAPPDATA ?? pathApi.join(home, "AppData", "Local"),
      "LaTeXRenderer",
    );
  if (checked === "darwin")
    return pathApi.join(
      home,
      "Library",
      "Application Support",
      "LaTeXRenderer",
    );
  return pathApi.join(
    env.XDG_DATA_HOME ?? pathApi.join(home, ".local", "share"),
    "latex-renderer",
  );
}

export function defaultBinDirectory({
  platform = process.platform,
  home = homedir(),
  env = process.env,
}: {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const checked = supportedPlatform(platform);
  if (checked === "win32")
    return win32.join(defaultInstallDirectory({ platform, home, env }), "bin");
  return posix.join(env.XDG_BIN_HOME ?? posix.join(home, ".local", "bin"));
}

export function credentialPath({
  platform = process.platform,
  home = homedir(),
  env = process.env,
}: {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const checked = supportedPlatform(platform);
  if (checked === "win32")
    return win32.join(env.APPDATA ?? home, "latex-renderer", "credential.bin");
  return posix.join(
    env.XDG_CONFIG_HOME ?? posix.join(home, ".config"),
    "latex-renderer",
    "credential",
  );
}

export function resolveSetupPaths(options: CoreOptions = {}): SetupPaths {
  const platform = supportedPlatform(options.platform);
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const installDirectory =
    options.installDirectory ??
    env.LATEX_RENDER_INSTALL_DIRECTORY ??
    defaultInstallDirectory({ platform, home, env });
  const binDirectory =
    options.binDirectory ??
    env.LATEX_RENDER_BIN_DIRECTORY ??
    defaultBinDirectory({ platform, home, env });
  const pathApi = platform === "win32" ? win32 : posix;
  return {
    platform,
    home,
    installDirectory,
    binDirectory,
    statePath: pathApi.join(installDirectory, STATE_FILE),
    credentialPath: credentialPath({ platform, home, env }),
    cliLauncher:
      platform === "win32"
        ? pathApi.join(installDirectory, "bin", "latex-render.cmd")
        : pathApi.join(binDirectory, "latex-render"),
    mcpLauncher: pathApi.join(
      platform === "win32"
        ? pathApi.join(installDirectory, "bin")
        : binDirectory,
      platform === "win32" ? "latex-renderer-mcp.cmd" : "latex-renderer-mcp",
    ),
    skillRoot: pathApi.join(installDirectory, "skill"),
  };
}

export async function fetchDistribution({
  baseUri = DEFAULT_DISTRIBUTION_URI,
  fetchImpl = globalThis.fetch,
}: {
  baseUri?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<{ manifest: ClientManifest; archive: Buffer }> {
  const base = new URL(baseUri.endsWith("/") ? baseUri : `${baseUri}/`);
  const fresh = randomUUID();
  const manifestResponse = await fetchImpl(
    new URL(`manifest.json?fresh=${fresh}`, base),
    { cache: "no-store", redirect: "error" },
  );
  if (!manifestResponse.ok)
    throw new Error(
      `Manifest download failed: HTTP ${manifestResponse.status}`,
    );
  const manifest = validateManifest(await manifestResponse.json());
  const archiveResponse = await fetchImpl(
    new URL(`${manifest.archive}?fresh=${fresh}`, base),
    { cache: "no-store", redirect: "error" },
  );
  if (!archiveResponse.ok)
    throw new Error(`Archive download failed: HTTP ${archiveResponse.status}`);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  verifyArchive(manifest, archive);
  return { manifest, archive };
}

export async function installDistribution({
  manifest,
  archive,
  skillTarget = "both",
  mcpTarget = "both",
  ...options
}: CoreOptions & {
  manifest: ClientManifest;
  archive: Uint8Array;
  skillTarget?: SkillTarget;
  mcpTarget?: McpTarget;
}): Promise<SetupResult> {
  validateTarget(skillTarget, "skillTarget");
  validateTarget(mcpTarget, "mcpTarget");
  const checkedManifest = validateManifest(manifest);
  const bytes = Buffer.from(archive);
  verifyArchive(checkedManifest, bytes);
  const paths = resolveSetupPaths(options);
  const output = options.output ?? process.stdout;
  const warning = options.warning ?? process.stderr;
  const existingState = await readManagedState(paths);
  const installExists = await exists(paths.installDirectory);
  if (installExists && existingState.kind !== "managed")
    throw new AppError(
      "UNMANAGED_INSTALLATION",
      `Refusing to replace installation directory without valid managed state: ${paths.installDirectory}`,
      409,
    );

  if (
    existingState.kind === "managed" &&
    existingState.state.archiveSha256 === checkedManifest.sha256 &&
    (await payloadIsComplete(paths.installDirectory, paths.platform))
  ) {
    const repaired = await repairSetup({
      ...options,
      skillTarget,
      mcpTarget,
    });
    output.write(
      `LaTeX Renderer client ${checkedManifest.version} is current at ${paths.installDirectory}\n`,
    );
    return {
      action: "current",
      version: checkedManifest.version,
      installDirectory: paths.installDirectory,
      binDirectory: paths.binDirectory,
      status: repaired.status,
    };
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "latex-renderer-client-"));
  let backup: string | undefined;
  try {
    await extractClientArchive(bytes, temporaryRoot);
    const payload = join(temporaryRoot, PAYLOAD_NAME);
    if (!(await payloadIsComplete(payload, paths.platform)))
      throw new Error("Client archive payload is incomplete");
    const staging = `${paths.installDirectory}.staging-${process.pid}-${Date.now()}`;
    await mkdir(dirname(paths.installDirectory), { recursive: true });
    await rm(staging, { recursive: true, force: true });
    await cp(payload, staging, { recursive: true, errorOnExist: true });
    if (installExists) {
      backup = `${paths.installDirectory}.backup-${timestamp()}`;
      await rename(paths.installDirectory, backup);
    }
    try {
      await rename(staging, paths.installDirectory);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (backup && !(await exists(paths.installDirectory)))
        await rename(backup, paths.installDirectory);
      throw error;
    }

    const now = new Date().toISOString();
    const previous =
      existingState.kind === "managed" ? existingState.state : undefined;
    const baseState: ManagedSetupState = {
      format: 2,
      product: "latex-renderer-client",
      version: checkedManifest.version,
      archiveSha256: checkedManifest.sha256,
      platform: paths.platform,
      installDirectory: paths.installDirectory,
      binDirectory: paths.binDirectory,
      skillTarget,
      mcpTarget,
      managedMcpClients: previous?.managedMcpClients ?? [],
      windowsUserPathAdded: previous?.windowsUserPathAdded ?? false,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
    };
    await writeManagedState(paths, baseState);
    const repair = await repairSetup({
      ...options,
      skillTarget,
      mcpTarget,
      ...(backup ? { previousSkillSource: join(backup, "skill") } : {}),
    });
    output.write(
      `LaTeX Renderer client ${checkedManifest.version} ${
        installExists ? "updated" : "installed"
      } at ${paths.installDirectory}\n`,
    );
    if (paths.platform !== "win32")
      output.write(`Command launchers: ${paths.binDirectory}\n`);
    output.write(
      "Register an API key with: latex-render auth login --api-key-stdin\n",
    );
    return {
      action: installExists ? "updated" : "installed",
      version: checkedManifest.version,
      installDirectory: paths.installDirectory,
      binDirectory: paths.binDirectory,
      ...(backup ? { backup } : {}),
      status: repair.status,
    };
  } catch (error) {
    if (backup && (await exists(backup))) {
      await rm(paths.installDirectory, { recursive: true, force: true });
      await rename(backup, paths.installDirectory);
      warning.write("Installation failed; the previous client was restored.\n");
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function inspectSetup(
  options: CoreOptions = {},
): Promise<SetupStatus> {
  const paths = resolveSetupPaths(options);
  const stateResult = await readManagedState(paths);
  if (stateResult.kind === "absent") {
    const unmanagedDirectory = await exists(paths.installDirectory);
    return {
      status: unmanagedDirectory ? "degraded" : "not_installed",
      platform: paths.platform,
      paths,
      checks: [
        {
          id: "installation.state",
          status: unmanagedDirectory ? "fail" : "warn",
          message: unmanagedDirectory
            ? "Installation directory exists without managed state and will be preserved"
            : "Managed installation state was not found",
          path: paths.statePath,
        },
      ],
    };
  }
  if (stateResult.kind === "invalid")
    return {
      status: "degraded",
      platform: paths.platform,
      paths,
      checks: [
        {
          id: "installation.state",
          status: "fail",
          message: stateResult.message,
          path: paths.statePath,
        },
      ],
    };

  const state = stateResult.state;
  const checks: DiagnosticCheck[] = [
    {
      id: "installation.state",
      status: "pass",
      message: `Managed state format ${state.format} is valid`,
      path: paths.statePath,
    },
  ];
  for (const [id, file] of [
    ["client.cli", join(paths.installDirectory, "app", "latex-render.cjs")],
    [
      "client.mcp",
      join(paths.installDirectory, "app", "latex-renderer-mcp.cjs"),
    ],
  ] as const) {
    checks.push(
      (await isFile(file))
        ? {
            id,
            status: "pass",
            message: "Installed payload is present",
            path: file,
          }
        : {
            id,
            status: "fail",
            message: "Installed payload is missing",
            path: file,
          },
    );
  }
  checks.push(await inspectLauncher(paths, "cli"));
  checks.push(await inspectLauncher(paths, "mcp"));
  checks.push(await inspectCredential(paths, options.env ?? process.env));
  checks.push(...(await inspectSkillTargets(paths, state.skillTarget)));
  checks.push(
    ...inspectMcpTargets(
      paths,
      state.mcpTarget,
      state.managedMcpClients,
      options.runner ?? defaultCommandRunner,
    ),
  );
  return {
    status: checks.some((check) => check.status === "fail")
      ? "degraded"
      : "healthy",
    version: state.version,
    platform: paths.platform,
    paths,
    checks,
    state,
  };
}

export async function doctorSetup(
  options: CoreOptions = {},
): Promise<SetupStatus> {
  const status = await inspectSetup(options);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const runtime: DiagnosticCheck[] = [
    {
      id: "runtime.platform",
      status: "pass",
      message: `Supported platform: ${status.platform}`,
    },
    Number.isSafeInteger(nodeMajor) && nodeMajor >= 24
      ? {
          id: "runtime.node",
          status: "pass",
          message: `Node.js ${process.versions.node}`,
        }
      : {
          id: "runtime.node",
          status: "fail",
          message: `Node.js 24 or newer is required; found ${process.versions.node}`,
        },
    inspectPathEnvironment(status.paths, options.env ?? process.env),
  ];
  const checks = [...runtime, ...status.checks];
  return {
    ...status,
    status:
      status.status === "not_installed"
        ? "not_installed"
        : checks.some((check) => check.status === "fail")
          ? "degraded"
          : "healthy",
    checks,
  };
}

export async function repairSetup({
  skillTarget,
  mcpTarget,
  previousSkillSource,
  ...options
}: CoreOptions & {
  skillTarget?: SkillTarget;
  mcpTarget?: McpTarget;
  previousSkillSource?: string;
} = {}): Promise<RepairResult> {
  const paths = resolveSetupPaths(options);
  const stateResult = await readManagedState(paths);
  if (stateResult.kind !== "managed")
    throw new AppError(
      "MANAGED_STATE_REQUIRED",
      stateResult.kind === "invalid"
        ? stateResult.message
        : "Managed installation state was not found",
      409,
    );
  if (!(await payloadIsComplete(paths.installDirectory, paths.platform)))
    throw new AppError(
      "INSTALLATION_INCOMPLETE",
      "Installed client payload is incomplete; run setup to reinstall it",
      409,
    );
  const output = options.output ?? process.stdout;
  const warning = options.warning ?? process.stderr;
  const selectedSkill = skillTarget ?? stateResult.state.skillTarget;
  const selectedMcp = mcpTarget ?? stateResult.state.mcpTarget;
  validateTarget(selectedSkill, "skillTarget");
  validateTarget(selectedMcp, "mcpTarget");
  const repaired: string[] = [];
  const preserved: string[] = [];

  if (paths.platform === "win32") {
    const pathResult = ensureWindowsUserPath(
      paths.binDirectory,
      options.runner ?? defaultCommandRunner,
    );
    if (pathResult === "added") repaired.push("path.windows_user");
    else if (pathResult === "failed") preserved.push("path.windows_user");
  } else {
    const launchers = await installUnixLaunchers(paths, output, warning);
    repaired.push(...launchers.repaired);
    preserved.push(...launchers.preserved);
  }

  if (selectedSkill !== "none") {
    const skill = await loadSkillInstaller(paths);
    const results = await skill.installSkillTargets({
      target: selectedSkill,
      source: paths.skillRoot,
      ...(previousSkillSource ? { previousSource: previousSkillSource } : {}),
      home: paths.home,
      output,
      warning,
    });
    for (const result of results) {
      if (result.status.startsWith("preserved"))
        preserved.push(`skill:${result.destination}`);
      else repaired.push(`skill:${result.destination}`);
    }
  }

  const mcp = repairMcpTargets(
    paths,
    selectedMcp,
    stateResult.state.managedMcpClients,
    options.runner ?? defaultCommandRunner,
  );
  repaired.push(...mcp.repaired);
  preserved.push(...mcp.preserved);
  const windowsPathAdded =
    stateResult.state.windowsUserPathAdded ||
    repaired.includes("path.windows_user");
  const nextState: ManagedSetupState = {
    ...stateResult.state,
    skillTarget: selectedSkill,
    mcpTarget: selectedMcp,
    managedMcpClients: mcp.managed,
    windowsUserPathAdded: windowsPathAdded,
    updatedAt: new Date().toISOString(),
  };
  await writeManagedState(paths, nextState);
  return { repaired, preserved, status: await inspectSetup(options) };
}

export async function removeSetup({
  keepCredential = false,
  keepSkills = false,
  ...options
}: CoreOptions & {
  keepCredential?: boolean;
  keepSkills?: boolean;
} = {}): Promise<RemoveResult> {
  const paths = resolveSetupPaths(options);
  const stateResult = await readManagedState(paths);
  if (stateResult.kind === "absent")
    return {
      removed: false,
      preserved: [],
      installDirectory: paths.installDirectory,
    };
  if (stateResult.kind === "invalid")
    throw new AppError("MANAGED_STATE_REQUIRED", stateResult.message, 409);
  const state = stateResult.state;
  const output = options.output ?? process.stdout;
  const warning = options.warning ?? process.stderr;
  const preserved: string[] = [];

  if (!keepSkills) {
    const skill = await loadSkillInstaller(paths);
    const results = await skill.removeSkillTargets({
      target: "both",
      source: paths.skillRoot,
      home: paths.home,
      output,
      warning,
    });
    for (const result of results)
      if (result.status.startsWith("preserved"))
        preserved.push(`skill:${result.destination}`);
  }
  preserved.push(
    ...removeMcpTargets(
      paths,
      state.managedMcpClients,
      options.runner ?? defaultCommandRunner,
    ),
  );
  if (paths.platform !== "win32")
    preserved.push(...(await removeUnixLaunchers(paths, output, warning)));
  else if (state.windowsUserPathAdded)
    removeWindowsUserPath(
      paths.binDirectory,
      options.runner ?? defaultCommandRunner,
    );

  await rm(paths.installDirectory, { recursive: true, force: true });
  if (!keepCredential) {
    await rm(paths.credentialPath, { force: true });
    await removeIfEmpty(dirname(paths.credentialPath));
  }
  output.write("LaTeX Renderer client was removed.\n");
  return { removed: true, preserved, installDirectory: paths.installDirectory };
}

export async function saveCredential(
  secret: string,
  options: Pick<CoreOptions, "platform" | "home" | "env"> = {},
): Promise<void> {
  const paths = resolveSetupPaths(options);
  if (!/^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AppError("INVALID_API_KEY", "Input is not a render API key", 400);
  await mkdir(dirname(paths.credentialPath), { recursive: true, mode: 0o700 });
  if (paths.platform === "win32") {
    const script =
      `$ErrorActionPreference='Stop';try{$p=$env:LR_CREDENTIAL_PATH;$d=Split-Path -Parent $p;` +
      `New-Item -ItemType Directory -Path $d -Force|Out-Null;$s=[Console]::In.ReadToEnd().Trim();if(!$s){throw 'Credential input is empty'};` +
      `$v=ConvertTo-SecureString -String $s -AsPlainText -Force;$e=ConvertFrom-SecureString -SecureString $v;` +
      `Set-Content -LiteralPath $p -Value $e -Encoding ASCII -NoNewline -Force;exit 0}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        input: secret,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...(options.env ?? process.env),
          LR_CREDENTIAL_PATH: paths.credentialPath,
        },
      },
    );
    if (result.status !== 0)
      throw new AppError(
        "CREDENTIAL_STORE_FAILED",
        credentialError("Windows DPAPI credential storage failed", result),
      );
    return;
  }
  const temporary = `${paths.credentialPath}.part-${randomUUID()}`;
  try {
    await writeFile(temporary, secret, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, paths.credentialPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function loadCredential(
  options: Pick<CoreOptions, "platform" | "home" | "env"> = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const fromEnvironment = env.LATEX_RENDER_API_KEY;
  if (fromEnvironment !== undefined) return fromEnvironment;
  const paths = resolveSetupPaths({ ...options, env });
  if (paths.platform === "win32") {
    const script =
      `$ErrorActionPreference='Stop';try{$p=$env:LR_CREDENTIAL_PATH;$e=(Get-Content -LiteralPath $p -Raw).Trim();` +
      `$v=ConvertTo-SecureString -String $e;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($v);` +
      `try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{if($b -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}}` +
      `}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...env, LR_CREDENTIAL_PATH: paths.credentialPath },
      },
    );
    if (result.status !== 0)
      throw new AppError(
        "CREDENTIAL_NOT_FOUND",
        credentialError("No usable DPAPI credential was found", result),
        401,
      );
    return result.stdout;
  }
  const info = await lstat(paths.credentialPath);
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== (process.geteuid?.() ?? info.uid)
  )
    throw new AppError(
      "CREDENTIAL_PERMISSIONS",
      "Credential file must be a regular file owned by the current user with mode 0600",
      401,
    );
  return (await readFile(paths.credentialPath, "utf8")).trim();
}

export async function deleteCredential(
  options: Pick<CoreOptions, "platform" | "home" | "env"> = {},
): Promise<void> {
  await rm(resolveSetupPaths(options).credentialPath, { force: true });
}

export async function extractClientArchive(
  archive: Uint8Array,
  destination: string,
): Promise<void> {
  const bytes = Buffer.from(archive);
  const eocd = findEndOfCentralDirectory(bytes);
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (
    bytes.readUInt16LE(eocd + 4) !== 0 ||
    bytes.readUInt16LE(eocd + 6) !== 0 ||
    bytes.readUInt16LE(eocd + 8) !== entries ||
    centralOffset + centralSize > eocd
  )
    throw new Error("Multi-disk or malformed ZIP archives are not supported");
  if (entries > 200) throw new Error("Client archive has too many entries");
  const seen = new Set<string>();
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Client archive central directory is malformed");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const expandedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length)
      throw new Error("Client archive entry is truncated");
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    validateEntryName(name, seen);
    cursor = end;
    if (name.endsWith("/")) continue;
    if ((flags & 1) !== 0)
      throw new Error("Encrypted ZIP entries are not supported");
    if (method !== 0 && method !== 8)
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    if (
      localOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    )
      throw new Error("Client archive local header is malformed");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes
      .subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString("utf8");
    if (
      localName !== name ||
      bytes.readUInt16LE(localOffset + 6) !== flags ||
      bytes.readUInt16LE(localOffset + 8) !== method
    )
      throw new Error("Client archive local and central headers do not match");
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > bytes.length)
      throw new Error("Client archive data is truncated");
    const compressed = bytes.subarray(dataOffset, dataEnd);
    const content =
      method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    expandedBytes += content.byteLength;
    if (
      content.byteLength !== expandedSize ||
      expandedBytes > MAXIMUM_EXPANDED_BYTES
    )
      throw new Error("Client archive expanded size is invalid");
    if (crc32(content) >>> 0 !== expectedCrc)
      throw new Error(`Client archive CRC check failed: ${name}`);
    const destinationPath = join(destination, ...name.split("/"));
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, content, { mode: 0o644, flag: "wx" });
  }
  if (cursor !== centralOffset + centralSize)
    throw new Error("Client archive central directory size is invalid");
}

export const defaultCommandRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error ? { error: result.error.message } : {}),
  };
};

async function readManagedState(
  paths: SetupPaths,
): Promise<
  | { kind: "absent" }
  | { kind: "invalid"; message: string }
  | { kind: "managed"; state: ManagedSetupState }
> {
  const info = await lstat(paths.statePath).catch((error: unknown) => {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info === undefined) return { kind: "absent" };
  if (!info.isFile())
    return {
      kind: "invalid",
      message: "Managed installation state is not a regular file",
    };
  if (
    paths.platform !== "win32" &&
    ((info.mode & 0o022) !== 0 ||
      info.uid !== (process.geteuid?.() ?? info.uid))
  )
    return {
      kind: "invalid",
      message:
        "Managed installation state must be owned by the current user and not group/world writable",
    };
  const raw = await readFile(paths.statePath, "utf8").catch(
    (error: unknown) => {
      if (isErrnoException(error) && error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (raw === undefined) return { kind: "absent" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      kind: "invalid",
      message: "Managed installation state is not valid JSON",
    };
  }
  const normalized = normalizeState(value, paths);
  return normalized
    ? { kind: "managed", state: normalized }
    : {
        kind: "invalid",
        message: "Managed installation state has an unsupported format",
      };
}

function normalizeState(
  value: unknown,
  paths: SetupPaths,
): ManagedSetupState | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.format === 2 &&
    value.product === "latex-renderer-client" &&
    typeof value.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(value.version) &&
    typeof value.archiveSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.archiveSha256) &&
    value.platform === paths.platform &&
    typeof value.installDirectory === "string" &&
    normalizePath(value.installDirectory, paths.platform) ===
      normalizePath(paths.installDirectory, paths.platform) &&
    typeof value.binDirectory === "string" &&
    normalizePath(value.binDirectory, paths.platform) ===
      normalizePath(paths.binDirectory, paths.platform) &&
    isTarget(value.skillTarget) &&
    isTarget(value.mcpTarget) &&
    Array.isArray(value.managedMcpClients) &&
    value.managedMcpClients.every(
      (item) => item === "codex" || item === "claude",
    ) &&
    typeof value.windowsUserPathAdded === "boolean" &&
    typeof value.installedAt === "string" &&
    typeof value.updatedAt === "string"
  )
    return value as unknown as ManagedSetupState;
  if (
    value.format === 1 &&
    typeof value.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(value.version) &&
    value.platform === paths.platform &&
    typeof value.installedAt === "string"
  )
    return {
      format: 2,
      product: "latex-renderer-client",
      version: value.version,
      archiveSha256: "0".repeat(64),
      platform: paths.platform,
      installDirectory: paths.installDirectory,
      binDirectory: paths.binDirectory,
      skillTarget: "both",
      mcpTarget: "both",
      managedMcpClients: [],
      windowsUserPathAdded: false,
      installedAt: value.installedAt,
      updatedAt: value.installedAt,
    };
  return undefined;
}

async function writeManagedState(
  paths: SetupPaths,
  state: ManagedSetupState,
): Promise<void> {
  const temporary = `${paths.statePath}.part-${randomUUID()}`;
  const previous = `${paths.statePath}.previous-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const existed = await exists(paths.statePath);
  try {
    if (existed) await rename(paths.statePath, previous);
    await rename(temporary, paths.statePath);
    if (paths.platform !== "win32") await chmod(paths.statePath, 0o600);
    if (existed) await rm(previous, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (existed && !(await exists(paths.statePath)) && (await exists(previous)))
      await rename(previous, paths.statePath);
    throw error;
  }
}

async function installUnixLaunchers(
  paths: SetupPaths,
  output: NodeJS.WritableStream,
  warning: NodeJS.WritableStream,
): Promise<{ repaired: string[]; preserved: string[] }> {
  await mkdir(paths.binDirectory, { recursive: true, mode: 0o755 });
  const repaired: string[] = [];
  const preserved: string[] = [];
  for (const name of ["latex-render", "latex-renderer-mcp"]) {
    const destination = join(paths.binDirectory, name);
    const target = join(paths.installDirectory, "bin", name);
    await chmod(target, 0o755);
    const info = await lstat(destination).catch(() => undefined);
    if (info === undefined) {
      await symlink(target, destination);
      output.write(`Installed command launcher: ${destination}\n`);
      repaired.push(`launcher:${name}`);
      continue;
    }
    if (info.isSymbolicLink()) {
      const current = resolve(
        dirname(destination),
        await readlink(destination),
      );
      if (current === resolve(target)) continue;
    }
    warning.write(`Preserved existing command launcher: ${destination}\n`);
    preserved.push(`launcher:${name}`);
  }
  return { repaired, preserved };
}

async function removeUnixLaunchers(
  paths: SetupPaths,
  output: NodeJS.WritableStream,
  warning: NodeJS.WritableStream,
): Promise<string[]> {
  const preserved: string[] = [];
  for (const name of ["latex-render", "latex-renderer-mcp"]) {
    const destination = join(paths.binDirectory, name);
    const info = await lstat(destination).catch(() => undefined);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      const current = resolve(
        dirname(destination),
        await readlink(destination),
      );
      const expected = resolve(paths.installDirectory, "bin", name);
      if (current === expected) {
        await rm(destination, { force: true });
        output.write(`Removed command launcher: ${destination}\n`);
        continue;
      }
    }
    warning.write(`Preserved existing command launcher: ${destination}\n`);
    preserved.push(`launcher:${name}`);
  }
  await removeIfEmpty(paths.binDirectory);
  return preserved;
}

async function inspectLauncher(
  paths: SetupPaths,
  type: "cli" | "mcp",
): Promise<DiagnosticCheck> {
  const name = type === "cli" ? "latex-render" : "latex-renderer-mcp";
  const destination =
    paths.platform === "win32"
      ? join(paths.installDirectory, "bin", `${name}.cmd`)
      : join(paths.binDirectory, name);
  const info = await lstat(destination).catch(() => undefined);
  if (!info)
    return {
      id: `launcher.${type}`,
      status: "fail",
      message: "Command launcher is missing",
      path: destination,
    };
  if (paths.platform === "win32" && info.isFile())
    return {
      id: `launcher.${type}`,
      status: "pass",
      message: "Command launcher is installed",
      path: destination,
    };
  if (info.isSymbolicLink()) {
    const current = resolve(dirname(destination), await readlink(destination));
    const expected = resolve(paths.installDirectory, "bin", name);
    if (current === expected)
      return {
        id: `launcher.${type}`,
        status: "pass",
        message: "Managed command launcher is current",
        path: destination,
      };
  }
  return {
    id: `launcher.${type}`,
    status: "fail",
    message: "Command launcher is not owned by this installation",
    path: destination,
  };
}

async function inspectCredential(
  paths: SetupPaths,
  env: NodeJS.ProcessEnv,
): Promise<DiagnosticCheck> {
  if (env.LATEX_RENDER_API_KEY !== undefined)
    return {
      id: "credential",
      status: "pass",
      message: "Render API credential is provided by the environment",
    };
  const info = await lstat(paths.credentialPath).catch(() => undefined);
  if (!info)
    return {
      id: "credential",
      status: "warn",
      message: "Render API credential is not configured",
      path: paths.credentialPath,
    };
  if (!info.isFile())
    return {
      id: "credential",
      status: "fail",
      message: "Credential path is not a regular file",
      path: paths.credentialPath,
    };
  if (paths.platform !== "win32" && (info.mode & 0o077) !== 0)
    return {
      id: "credential",
      status: "fail",
      message: "Credential file permissions must be 0600",
      path: paths.credentialPath,
    };
  return {
    id: "credential",
    status: "pass",
    message:
      paths.platform === "win32"
        ? "DPAPI credential file is present"
        : "Protected credential file is present",
    path: paths.credentialPath,
  };
}

async function inspectSkillTargets(
  paths: SetupPaths,
  target: SkillTarget,
): Promise<DiagnosticCheck[]> {
  if (target === "none") return [];
  const locations = {
    codex: join(paths.home, ".agents", "skills", MCP_SERVER_NAME),
    claude: join(paths.home, ".claude", "skills", MCP_SERVER_NAME),
  };
  const selected = selectedTargets(target);
  return Promise.all(
    selected.map(async (name) => {
      const destination = locations[name];
      if (!(await isDirectory(destination)))
        return {
          id: `skill.${name}`,
          status: "fail" as const,
          message: `${name} skill is missing`,
          path: destination,
        };
      if (await directoriesEqual(destination, paths.skillRoot))
        return {
          id: `skill.${name}`,
          status: "pass" as const,
          message: `${name} skill is current`,
          path: destination,
        };
      return {
        id: `skill.${name}`,
        status: "warn" as const,
        message: `${name} skill was modified and will be preserved`,
        path: destination,
      };
    }),
  );
}

async function loadSkillInstaller(
  paths: SetupPaths,
): Promise<SkillInstallerModule> {
  const installer = join(paths.skillRoot, "scripts", "install-skill.mjs");
  if (!(await isFile(installer)))
    throw new AppError(
      "SKILL_INSTALLER_MISSING",
      `Safe skill installer is missing: ${installer}`,
      409,
    );
  return (await import(pathToFileURL(installer).href)) as SkillInstallerModule;
}

function inspectMcpTargets(
  paths: SetupPaths,
  target: McpTarget,
  managed: readonly ("codex" | "claude")[],
  runner: CommandRunner,
): DiagnosticCheck[] {
  return selectedTargets(target).map((client) => {
    const inspection = inspectMcpTarget(paths, client, runner);
    const ownership = managed.includes(client) ? "managed" : "existing";
    if (inspection === "unavailable")
      return {
        id: `mcp.${client}`,
        status: "warn",
        message: `${client} CLI is unavailable; MCP registration was skipped`,
      };
    if (inspection === "missing")
      return {
        id: `mcp.${client}`,
        status: "fail",
        message: `${client} MCP registration is missing`,
      };
    if (inspection === "error")
      return {
        id: `mcp.${client}`,
        status: "warn",
        message: `${client} MCP registration could not be inspected and was preserved`,
      };
    if (inspection === "conflict")
      return {
        id: `mcp.${client}`,
        status: "fail",
        message: `${client} MCP registration exists with a different command and was preserved`,
      };
    return {
      id: `mcp.${client}`,
      status: "pass",
      message: `${client} MCP registration is current (${ownership})`,
    };
  });
}

function repairMcpTargets(
  paths: SetupPaths,
  target: McpTarget,
  previouslyManaged: readonly ("codex" | "claude")[],
  runner: CommandRunner,
): {
  repaired: string[];
  preserved: string[];
  managed: ("codex" | "claude")[];
} {
  const repaired: string[] = [];
  const preserved: string[] = [];
  const managed = [...previouslyManaged];
  for (const client of selectedTargets(target)) {
    const inspection = inspectMcpTarget(paths, client, runner);
    if (inspection === "unavailable") {
      preserved.push(`mcp:${client}:unavailable`);
      continue;
    }
    if (inspection === "conflict" || inspection === "error") {
      preserved.push(`mcp:${client}:${inspection}`);
      continue;
    }
    if (inspection === "current") continue;
    const command = mcpCommand(paths);
    const args =
      client === "codex"
        ? [
            "mcp",
            "add",
            MCP_SERVER_NAME,
            "--",
            command.command,
            ...command.args,
          ]
        : [
            "mcp",
            "add",
            "--scope",
            "user",
            MCP_SERVER_NAME,
            "--",
            command.command,
            ...command.args,
          ];
    const result = runner(client, args);
    if (result.status !== 0) {
      preserved.push(`mcp:${client}:failed`);
      continue;
    }
    repaired.push(`mcp:${client}`);
    if (!managed.includes(client)) managed.push(client);
  }
  return { repaired, preserved, managed };
}

function removeMcpTargets(
  paths: SetupPaths,
  managed: readonly ("codex" | "claude")[],
  runner: CommandRunner,
): string[] {
  const preserved: string[] = [];
  for (const client of managed) {
    const inspection = inspectMcpTarget(paths, client, runner);
    if (inspection === "missing" || inspection === "unavailable") continue;
    if (inspection !== "current") {
      preserved.push(`mcp:${client}:modified`);
      continue;
    }
    const result = runner(client, ["mcp", "remove", MCP_SERVER_NAME]);
    if (result.status !== 0) preserved.push(`mcp:${client}:remove_failed`);
  }
  return preserved;
}

function inspectMcpTarget(
  paths: SetupPaths,
  client: "codex" | "claude",
  runner: CommandRunner,
): "unavailable" | "missing" | "current" | "conflict" | "error" {
  const version = runner(client, ["--version"]);
  if (version.status !== 0) return "unavailable";
  const result = runner(client, [
    "mcp",
    "get",
    MCP_SERVER_NAME,
    ...(client === "codex" ? ["--json"] : []),
  ]);
  if (result.status !== 0)
    return /not found|no mcp server|does not exist|not configured|unknown server/i.test(
      `${result.stdout}\n${result.stderr}`,
    )
      ? "missing"
      : "error";
  const expected = mcpCommand(paths);
  const output = `${result.stdout}\n${result.stderr}`.replaceAll("\\\\", "\\");
  const tokens = [expected.command, ...expected.args].map((value) =>
    value.replaceAll("\\\\", "\\"),
  );
  return tokens.every((token) => output.includes(token))
    ? "current"
    : "conflict";
}

function mcpCommand(paths: SetupPaths): { command: string; args: string[] } {
  const launcher =
    paths.platform === "win32"
      ? join(paths.installDirectory, "bin", "latex-renderer-mcp.cmd")
      : join(paths.installDirectory, "bin", "latex-renderer-mcp");
  return paths.platform === "win32"
    ? { command: "cmd", args: ["/c", launcher] }
    : { command: launcher, args: [] };
}

function ensureWindowsUserPath(
  directory: string,
  runner: CommandRunner,
): "current" | "added" | "failed" {
  const escaped = directory.replaceAll("'", "''");
  const script = `$p=[Environment]::GetEnvironmentVariable('Path','User');$e=@($p -split ';'|?{$_});if($e|?{$_.TrimEnd('\\') -ieq '${escaped}'.TrimEnd('\\')}){exit 0};[Environment]::SetEnvironmentVariable('Path',(@($e)+'${escaped}') -join ';','User');exit 10`;
  const result = runner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return result.status === 0
    ? "current"
    : result.status === 10
      ? "added"
      : "failed";
}

function removeWindowsUserPath(directory: string, runner: CommandRunner): void {
  const escaped = directory.replaceAll("'", "''");
  const script = `$p=[Environment]::GetEnvironmentVariable('Path','User');$e=@($p -split ';'|?{$_ -and $_.TrimEnd('\\') -ine '${escaped}'.TrimEnd('\\')});[Environment]::SetEnvironmentVariable('Path',$e -join ';','User')`;
  runner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
}

function inspectPathEnvironment(
  paths: SetupPaths,
  env: NodeJS.ProcessEnv,
): DiagnosticCheck {
  const delimiter = paths.platform === "win32" ? ";" : ":";
  const pathValue = env.PATH ?? env.Path ?? "";
  const entries = pathValue
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => normalizePath(entry, paths.platform));
  const expected = normalizePath(paths.binDirectory, paths.platform);
  return entries.includes(expected)
    ? {
        id: "runtime.path",
        status: "pass",
        message: "Command directory is present in PATH",
        path: paths.binDirectory,
      }
    : {
        id: "runtime.path",
        status: "warn",
        message:
          "Command directory is not present in the current PATH; open a new terminal or add it",
        path: paths.binDirectory,
      };
}

function normalizePath(value: string, platform: SetupPlatform): string {
  const normalized = (platform === "win32" ? win32 : posix)
    .normalize(value)
    .replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function validateManifest(value: unknown): ClientManifest {
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value.version) ||
    typeof value.archive !== "string" ||
    !/^latex-renderer-client-\d+\.\d+\.\d+\.zip$/.test(value.archive) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) <= 0 ||
    (value.size as number) > MAXIMUM_ARCHIVE_BYTES
  )
    throw new Error("Client manifest is invalid");
  return value as unknown as ClientManifest;
}

function verifyArchive(manifest: ClientManifest, archive: Buffer): void {
  if (archive.byteLength !== manifest.size)
    throw new Error("Client archive size verification failed");
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== manifest.sha256)
    throw new Error("Client archive SHA-256 verification failed");
}

function validateEntryName(name: string, seen: Set<string>): void {
  if (
    !name.startsWith(`${PAYLOAD_NAME}/`) ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(`Unsafe client archive entry: ${name}`);
  if (seen.has(name))
    throw new Error(`Duplicate client archive entry: ${name}`);
  seen.add(name);
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    )
      return offset;
  }
  throw new Error("Client archive end record was not found");
}

function validateTarget(
  value: string,
  name: string,
): asserts value is SkillTarget {
  if (!isTarget(value))
    throw new Error(`${name} must be both, codex, claude, or none`);
}

function isTarget(value: unknown): value is SkillTarget {
  return (
    value === "both" ||
    value === "codex" ||
    value === "claude" ||
    value === "none"
  );
}

function selectedTargets(target: SkillTarget): ("codex" | "claude")[] {
  if (target === "both") return ["codex", "claude"];
  if (target === "none") return [];
  return [target];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function payloadIsComplete(
  root: string,
  platform: SetupPlatform,
): Promise<boolean> {
  return (
    (await isFile(join(root, "app", "latex-render.cjs"))) &&
    (await isFile(join(root, "app", "latex-renderer-mcp.cjs"))) &&
    (await isFile(join(root, "skill", "scripts", "install-skill.mjs"))) &&
    (await isFile(
      join(
        root,
        "bin",
        platform === "win32" ? "latex-render.cmd" : "latex-render",
      ),
    ))
  );
}

async function isFile(item: string): Promise<boolean> {
  return (await lstat(item).catch(() => undefined))?.isFile() === true;
}

async function isDirectory(item: string): Promise<boolean> {
  return (await lstat(item).catch(() => undefined))?.isDirectory() === true;
}

async function directoriesEqual(left: string, right: string): Promise<boolean> {
  if (!(await isDirectory(left)) || !(await isDirectory(right))) return false;
  return (await directoryDigest(left)) === (await directoryDigest(right));
}

async function directoryDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const item of await walkDirectory(root)) {
    hash.update(relative(root, item.path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(item.type);
    hash.update("\0");
    if (item.type === "file") hash.update(await readFile(item.path));
    else if (item.type === "symlink") hash.update(await readlink(item.path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function walkDirectory(
  directory: string,
): Promise<
  { path: string; type: "directory" | "file" | "symlink" | "special" }[]
> {
  const result: {
    path: string;
    type: "directory" | "file" | "symlink" | "special";
  }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push({ path: item, type: "directory" });
      result.push(...(await walkDirectory(item)));
    } else if (entry.isFile()) result.push({ path: item, type: "file" });
    else if (entry.isSymbolicLink())
      result.push({ path: item, type: "symlink" });
    else result.push({ path: item, type: "special" });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function exists(item: string): Promise<boolean> {
  return (await lstat(item).catch(() => undefined)) !== undefined;
}

async function removeIfEmpty(directory: string): Promise<void> {
  const entries = await readdir(directory).catch(() => undefined);
  if (entries?.length === 0) await rm(directory, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
}

function credentialError(
  prefix: string,
  result: ReturnType<typeof spawnSync>,
): string {
  const stderr =
    typeof result.stderr === "string"
      ? result.stderr
      : result.stderr.toString("utf8");
  const detail = result.error?.message ?? stderr;
  let normalized = "";
  for (const character of detail) {
    const code = character.codePointAt(0) ?? 0;
    normalized += code < 32 || code === 127 ? " " : character;
  }
  const safe = normalized.trim().slice(0, 500);
  return safe
    ? `${prefix}: ${safe}`
    : `${prefix} (PowerShell exit ${result.status ?? "unknown"})`;
}
