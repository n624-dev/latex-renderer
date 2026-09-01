#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { acquireMutationLock } from "./mutation-lock.mjs";
import {
  boundedIntegerEnvironment,
  positiveBytesEnvironment,
} from "./environment.mjs";
import { assembleBuildArtifacts } from "./release-assembly.mjs";
import { validateReleaseArchive } from "./release-archive.mjs";
import { rendererRuntimeFingerprint } from "./runtime-image-identity.mjs";

if (process.getuid?.() === 0)
  throw new Error("Update Manager controller must not run as root");

const repository = process.env.UPDATE_REPOSITORY ?? "n624-dev/latex-renderer";
if (repository !== "n624-dev/latex-renderer") {
  throw new Error(
    "UPDATE_REPOSITORY is fixed to the trusted public repository",
  );
}
const socketPath =
  process.env.UPDATE_MANAGER_SOCKET ??
  "/run/latex-renderer/update-manager.sock";
const tokenFile =
  process.env.UPDATE_MANAGER_TOKEN_FILE ??
  "/etc/latex-renderer/secrets/update-manager-token";
const stateRoot =
  process.env.UPDATE_MANAGER_STATE_ROOT ??
  "/var/lib/latex-renderer/update-manager";
const stagingRoot = "/var/lib/latex-renderer/update-manager/staging";
const releaseRoot =
  process.env.UPDATE_RELEASE_ROOT ?? "/opt/latex-renderer/releases";
const currentLink =
  process.env.UPDATE_CURRENT_LINK ?? "/opt/latex-renderer/current";
const privilegedHelper = "/usr/local/libexec/latex-renderer-update-helper";
const maxBundleBytes = boundedIntegerEnvironment(process.env, "UPDATE_MAX_BUNDLE_BYTES", 1024 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024);
const maxArchiveEntries = boundedIntegerEnvironment(process.env, "UPDATE_MAX_ARCHIVE_ENTRIES", 50_000, 1, 100_000);
const maxExpandedBytes = boundedIntegerEnvironment(process.env, "UPDATE_MAX_EXPANDED_BYTES", 2 * 1024 * 1024 * 1024, 1024 * 1024, 8 * 1024 * 1024 * 1024);
const maxExpandedFileBytes = positiveBytesEnvironment(process.env, "UPDATE_MAX_EXPANDED_FILE_BYTES", 256 * 1024 * 1024, maxExpandedBytes);
const maxOperationLogBytes = boundedIntegerEnvironment(process.env, "UPDATE_MAX_OPERATION_LOG_BYTES", 4 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
// Release SHA-256 values protect the transport, while the keyless Sigstore
// attestation binds the artifact to this repository's protected workflow.
// Keep verification enabled by default; an explicit false is an operator
// decision for legacy hosts that have not installed a recent GitHub CLI.
const githubCli = "/usr/local/bin/gh";
if (
  !socketPath.startsWith("/run/latex-renderer/") ||
  !socketPath.endsWith(".sock")
) {
  throw new Error(
    "UPDATE_MANAGER_SOCKET must be a fixed path below /run/latex-renderer",
  );
}
if (stateRoot !== "/var/lib/latex-renderer/update-manager") {
  throw new Error(
    "UPDATE_MANAGER_STATE_ROOT is fixed to /var/lib/latex-renderer/update-manager",
  );
}
if (releaseRoot !== "/opt/latex-renderer/releases") {
  throw new Error(
    "UPDATE_RELEASE_ROOT is fixed to /opt/latex-renderer/releases",
  );
}
if (currentLink !== "/opt/latex-renderer/current") {
  throw new Error(
    "UPDATE_CURRENT_LINK is fixed to /opt/latex-renderer/current",
  );
}
const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Update Manager token is too short");

await mkdir(stateRoot, { recursive: true, mode: 0o750 });
await mkdir(join(stateRoot, "operations"), { recursive: true, mode: 0o750 });
await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
const stagingRootInfo = await lstat(stagingRoot);
if (!stagingRootInfo.isDirectory() || stagingRootInfo.uid !== process.getuid()) {
  throw new Error("Update staging root must be owned by the controller");
}
await chmod(stagingRoot, 0o700);
const statePath = join(stateRoot, "state.json");
const operationsRoot = join(stateRoot, "operations");
const emptyState = () => ({
  version: 1,
  policy: { channel: "stable", mode: "notify" },
  available: null,
  previousReleaseId: null,
  previousRollbackCompatible: false,
  lastOperationId: null,
  lastError: null,
  updatedAt: new Date().toISOString(),
});
let state = await loadState();
let activeOperation = null;
await recoverInterruptedOperation();
await cleanupStagingRoot();

async function cleanupStagingRoot() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^(?:v\d+\.\d+\.\d+|rollback-[A-Za-z0-9._-]+)-[A-Za-z0-9]{6}$/.test(
        entry.name,
      )
    )
      continue;
    const candidate = join(stagingRoot, entry.name);
    const info = await lstat(candidate);
    if (info.isDirectory() && info.mtimeMs < cutoff) {
      await rm(candidate, { recursive: true, force: true });
    }
  }
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return {
      ...emptyState(),
      ...parsed,
      policy: { ...emptyState().policy, ...(parsed.policy ?? {}) },
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const initial = emptyState();
    await writeAtomic(statePath, `${JSON.stringify(initial, null, 2)}\n`);
    return initial;
  }
}

async function writeAtomic(path, contents, mode = 0o640) {
  const temporary = `${path}.part-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(temporary, contents, { mode, flag: "wx" });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function persistState() {
  state.updatedAt = new Date().toISOString();
  await writeAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function safeToken(received) {
  const left = Buffer.from(received ?? "");
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function runCapture(command, args, options = {}) {
  const { maxOutputBytes = 32 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      capturedBytes = 0,
      captureError = null;
    const capture = (target, chunk) => {
      if (captureError) return target;
      capturedBytes += chunk.length;
      if (capturedBytes > maxOutputBytes) {
        captureError = new Error(
          `${command} output exceeds the configured capture limit`,
        );
        child.kill("SIGKILL");
        return target;
      }
      return target + String(chunk);
    };
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (captureError) return reject(captureError);
      return code === 0
        ? resolvePromise(stdout)
        : reject(
            new Error(`${command} exited ${code}: ${redact(stderr.trim())}`),
          );
    });
  });
}

function redact(value) {
  return String(value)
    .replace(
      /((?:authorization|password|secret|token|credential)[=:][ \t]*)[^\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:gh[oprsu]_|github_pat_)[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function appendLog(operation, value) {
  const write = (operation.logWrite ?? Promise.resolve()).then(async () => {
    const marker = Buffer.from("\n[LOG_LIMIT_REACHED]\n");
    const bytes = Buffer.from(redact(value));
    const handle = await open(operation.logPath, "a+", 0o640);
    try {
      const current = (await handle.stat()).size;
      if (current >= maxOperationLogBytes) return;
      const remaining = maxOperationLogBytes - current;
      if (bytes.length <= remaining) {
        await handle.write(bytes);
        return;
      }
      const prefixLength = Math.max(0, remaining - marker.length);
      if (prefixLength > 0) await handle.write(bytes.subarray(0, prefixLength));
      await handle.write(marker.subarray(0, remaining - prefixLength));
    } finally {
      await handle.close();
    }
  });
  operation.logWrite = write.catch(() => {});
  return write;
}

async function runLogged(operation, command, args, options = {}) {
  await appendLog(operation, `$ ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const consume = async (stream) => {
    for await (const chunk of stream) await appendLog(operation, String(chunk));
  };
  const closed = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", resolvePromise);
  });
  try {
    const [code] = await Promise.all([
      closed,
      consume(child.stdout),
      consume(child.stderr),
    ]);
    if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function runPrivileged(operation, request) {
  await appendLog(
    operation,
    "$ sudo -n -- /usr/local/libexec/latex-renderer-update-helper\n",
  );
  const child = spawn(
    "/usr/bin/sudo",
    ["-n", "--", privilegedHelper],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin.end(`${JSON.stringify(request)}\n`);
  let stderr = "";
  const consume = async (stream, isError) => {
    for await (const chunk of stream) {
      const value = String(chunk);
      if (isError) stderr = `${stderr}${value}`.slice(-8192);
      await appendLog(operation, value);
    }
  };
  const closed = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", resolvePromise);
  });
  try {
    const [code] = await Promise.all([
      closed,
      consume(child.stdout, false),
      consume(child.stderr, true),
    ]);
    if (code !== 0) {
      const detail = redact(stderr.trim());
      throw new Error(
        `Privileged Update Manager helper exited with code ${code}${detail ? `: ${detail}` : ""}`,
      );
    }
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

function operationView(operation) {
  return {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    requestedVersion: operation.requestedVersion ?? null,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt ?? null,
    error: operation.error ?? null,
  };
}

async function saveOperation(operation) {
  await writeAtomic(
    join(operationsRoot, `${operation.id}.json`),
    `${JSON.stringify(operationView(operation), null, 2)}\n`,
  );
}

async function recoverInterruptedOperation() {
  if (!state.lastOperationId) return;
  const path = join(operationsRoot, `${state.lastOperationId}.json`);
  try {
    const operation = JSON.parse(await readFile(path, "utf8"));
    if (operation.status !== "running") return;
    operation.status = "failed";
    operation.error =
      "Update Manager restarted while this operation was running; inspect the active release before retrying";
    operation.finishedAt = new Date().toISOString();
    state.lastError = operation.error;
    await writeAtomic(path, `${JSON.stringify(operation, null, 2)}\n`);
    await persistState();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function operationWithLog(id) {
  let operation = activeOperation?.id === id ? activeOperation : null;
  if (!operation) {
    try {
      operation = JSON.parse(
        await readFile(join(operationsRoot, `${id}.json`), "utf8"),
      );
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  let log = "";
  try {
    const path = join(operationsRoot, `${id}.log`);
    const info = await stat(path);
    const handle = await open(path, "r");
    try {
      const length = Math.min(info.size, 100_000);
      const buffer = Buffer.alloc(length);
      const result = await handle.read(
        buffer,
        0,
        length,
        Math.max(0, info.size - length),
      );
      log = buffer.subarray(0, result.bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { ...operationView(operation), log };
}

async function installedRelease() {
  try {
    const current = await readlink(currentLink);
    const absolute = resolve(dirname(currentLink), current);
    if (dirname(absolute) !== releaseRoot) {
      throw new Error(
        "Current release link points outside the allowlisted release root",
      );
    }
    const packageJson = JSON.parse(
      await readFile(join(absolute, "package.json"), "utf8"),
    );
    const releaseId = absolute.slice(releaseRoot.length + 1);
    if (!/^[A-Za-z0-9._-]+$/.test(releaseId))
      throw new Error("Current release identifier is invalid");
    return {
      version: validVersion(packageJson.version),
      releaseId,
      path: absolute,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validVersion(value) {
  if (
    typeof value !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  ) {
    throw new Error("Release version is invalid");
  }
  return value;
}

function validStableVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("Stable release version must use X.Y.Z");
  }
  return value;
}

function compareVersions(left, right) {
  const parse = (value) =>
    validVersion(value).split("-")[0].split(".").map(Number);
  const a = parse(left),
    b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function fetchRelease(
  requestedVersion = null,
  requireInstallable = false,
) {
  const version =
    requestedVersion === null
      ? null
      : validStableVersion(requestedVersion.replace(/^v/, ""));
  const endpoint = version
    ? `https://api.github.com/repos/${repository}/releases/tags/v${version}`
    : `https://api.github.com/repos/${repository}/releases/latest`;
  const response = await globalThis.fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "latex-renderer-update-manager",
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
  const release = await response.json();
  if (release?.draft === true || release?.prerelease === true)
    throw new Error("Only published stable releases can be installed");
  const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
  const releaseVersion = validStableVersion(tag.replace(/^v/, ""));
  if (tag !== `v${releaseVersion}` || (version && version !== releaseVersion)) {
    throw new Error(
      "GitHub release tag does not match the requested semantic version",
    );
  }
  const commit = await resolveTagCommit(tag);
  const assetName = `latex-renderer-server-${releaseVersion}.tar.gz`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry) => entry?.name === assetName)
    : null;
  const expectedUrl = `https://github.com/${repository}/releases/download/v${releaseVersion}/${assetName}`;
  let unavailableReason = null;
  if (release?.immutable !== true)
    unavailableReason = `Release v${releaseVersion} is mutable`;
  else if (!asset || typeof asset.browser_download_url !== "string")
    unavailableReason = `Release v${releaseVersion} has no ${assetName} asset`;
  else if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ""))
    unavailableReason = "GitHub release asset has no valid SHA-256 digest";
  else if (asset.browser_download_url !== expectedUrl)
    unavailableReason = "Release asset URL is outside the trusted repository";
  else if (
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > maxBundleBytes
  )
    unavailableReason =
      "Release bundle size is invalid or exceeds the configured limit";
  if (requireInstallable && unavailableReason) {
    throw new Error(`${unavailableReason}; refusing a privileged installation`);
  }
  return {
    version: releaseVersion,
    tag,
    name: assetName,
    url: unavailableReason ? null : expectedUrl,
    digest: unavailableReason ? null : asset.digest,
    size: unavailableReason ? null : asset.size,
    publishedAt: release.published_at ?? null,
    htmlUrl: release.html_url ?? null,
    commit,
    installable: unavailableReason === null,
    unavailableReason,
  };
}

async function resolveTagCommit(tag) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "latex-renderer-update-manager",
  };
  let response = await globalThis.fetch(
    `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
    {
      headers,
      signal: globalThis.AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub release tag lookup failed: HTTP ${response.status}`,
    );
  let object = (await response.json())?.object;
  for (let depth = 0; object?.type === "tag" && depth < 4; depth += 1) {
    if (!/^[a-f0-9]{40}$/.test(object.sha ?? ""))
      throw new Error("GitHub annotated tag object is invalid");
    response = await globalThis.fetch(
      `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
      {
        headers,
        signal: globalThis.AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub annotated tag lookup failed: HTTP ${response.status}`,
      );
    object = (await response.json())?.object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha ?? "")) {
    throw new Error("Immutable release tag does not resolve to a commit");
  }
  return object.sha;
}

async function checkRelease(
  requestedVersion = null,
  requireInstallable = false,
) {
  const release = await fetchRelease(requestedVersion, requireInstallable);
  state.available = release;
  state.lastError = null;
  await persistState();
  return release;
}

async function downloadBundle(operation, release, path) {
  const response = await globalThis.fetch(release.url, {
    redirect: "follow",
    headers: { "User-Agent": "latex-renderer-update-manager" },
    signal: globalThis.AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Release bundle download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBundleBytes)
    throw new Error("Release bundle exceeds the configured size limit");
  let bytes = 0;
  const hash = createHash("sha256");
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBundleBytes)
        return callback(
          new Error("Release bundle exceeds the configured size limit"),
        );
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const handle = await open(path, "wx", 0o600);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      handle.createWriteStream(),
    );
  } finally {
    await handle.close().catch(() => {});
  }
  if (bytes !== release.size)
    throw new Error(
      `Release bundle size mismatch: expected ${release.size}, received ${bytes}`,
    );
  const actual = `sha256:${hash.digest("hex")}`;
  if (actual !== release.digest)
    throw new Error(
      "Release bundle SHA-256 does not match the immutable GitHub asset digest",
    );
  {
    await appendLog(operation, "Verifying the Sigstore release attestation.\n");
    const ghRoot = dirname(path);
    await runLogged(operation, githubCli, [
      "attestation",
      "verify",
      path,
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/.github/workflows/server-release.yml`,
      "--source-ref",
      `refs/tags/${release.tag}`,
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--deny-self-hosted-runners",
    ], {
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: join(ghRoot, "gh-home"),
        GH_CONFIG_DIR: join(ghRoot, "gh-config"),
        GH_PROMPT_DISABLED: "1",
        XDG_CACHE_HOME: join(ghRoot, "gh-cache"),
      },
    });
  }
  await appendLog(operation, `Verified ${release.name}: ${actual}\n`);
}

async function validateArchive(bundle, topLevel) {
  await validateReleaseArchive({
    bundle,
    topLevel,
    maxEntries: maxArchiveEntries,
    maxExpandedBytes,
    maxExpandedFileBytes,
  });
}

async function prepareRelease(operation, release) {
  const stage = await mkdtemp(join(stagingRoot, `v${release.version}-`));
  const bundle = join(stage, release.name);
  const topLevel = `latex-renderer-server-${release.version}`;
  try {
    await chmod(stage, 0o700);
    await downloadBundle(operation, release, bundle);
    await validateArchive(bundle, topLevel);
    await chmod(bundle, 0o600);
    const verified = join(stage, "verified");
    await mkdir(verified, { mode: 0o700 });
    await runLogged(operation, "tar", [
      "-xzf",
      bundle,
      "--directory",
      verified,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    const verifiedSource = join(verified, topLevel);
    const manifest = JSON.parse(
      await readFile(
        join(verifiedSource, ".latex-renderer-release.json"),
        "utf8",
      ),
    );
    const packageJson = JSON.parse(
      await readFile(join(verifiedSource, "package.json"), "utf8"),
    );
    const stagedRendererFingerprint = await rendererRuntimeFingerprint(
      join(verifiedSource, "renderer"),
    );
    if (
      manifest?.version !== release.version ||
      manifest?.tag !== release.tag ||
      manifest?.commit !== release.commit ||
      manifest?.repository !== repository ||
      manifest?.schemaVersion !== 1 ||
      typeof manifest?.rollbackCompatible !== "boolean" ||
      typeof manifest?.minimumSourceVersion !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(manifest.minimumSourceVersion) ||
      manifest?.requiredNodeMajor !== 24 ||
      Number(process.versions.node.split(".")[0]) !==
        manifest.requiredNodeMajor ||
      manifest?.packageManager !== packageJson?.packageManager ||
      !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager ?? "") ||
      manifest?.rendererRuntimeFingerprint !== stagedRendererFingerprint ||
      packageJson?.version !== release.version
    )
      throw new Error(
        "Release bundle metadata does not match the immutable GitHub release",
      );
    const symlinks = (
      await runCapture("find", [verifiedSource, "-type", "l", "-print"])
    ).trim();
    if (symlinks)
      throw new Error("Release source bundle must not contain symbolic links");
    const prepared = await buildAndAssemble(
      operation,
      stage,
      verifiedSource,
      manifest.packageManager,
    );
    return { stage, ...prepared, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function buildAndAssemble(
  operation,
  stage,
  verifiedSource,
  packageManager,
) {
  const buildSource = join(stage, "build");
  await mkdir(buildSource, { mode: 0o700 });
  await runLogged(operation, "rsync", [
    "-a",
    `${verifiedSource}/`,
    `${buildSource}/`,
  ]);
  await chmod(buildSource, 0o700);

  const corepack = "/usr/local/bin/corepack";
  const toolingRoot = join(buildSource, ".update-tooling");
  const toolingHome = join(toolingRoot, "home");
  const corepackHome = join(toolingRoot, "corepack");
  const pnpmStore = join(toolingRoot, "store");
  const expectedPnpmVersion = packageManager.slice("pnpm@".length);
  if (!/^\d+\.\d+\.\d+$/.test(expectedPnpmVersion))
    throw new Error("Release package manager version is invalid");
  const deployEnvironment = {
    ...process.env,
    HOME: toolingHome,
    USER: process.env.USER ?? "latex-renderer-update",
    LOGNAME: process.env.LOGNAME ?? "latex-renderer-update",
    COREPACK_HOME: corepackHome,
    XDG_CACHE_HOME: join(toolingRoot, "cache"),
    XDG_DATA_HOME: join(toolingRoot, "data"),
    NPM_CONFIG_CACHE: join(toolingRoot, "npm-cache"),
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };
  await runLogged(operation, "install", [
    "-d",
    "-m",
    "0700",
    toolingHome,
    corepackHome,
    pnpmStore,
  ]);
  const pnpmVersion = (
    await runCapture(
      corepack,
      [packageManager, "--version"],
      { env: deployEnvironment },
    )
  ).trim();
  if (pnpmVersion !== expectedPnpmVersion)
    throw new Error(
      `Corepack did not activate required pnpm version ${expectedPnpmVersion}`,
    );
  await runLogged(operation, corepack, [
    packageManager,
    "--dir",
    buildSource,
    "install",
    "--frozen-lockfile",
    "--store-dir",
    pnpmStore,
  ], { env: deployEnvironment });
  for (const script of ["build:production-services", "build:client"])
    await runLogged(operation, corepack, [
      packageManager,
      "--dir",
      buildSource,
      script,
    ], { env: deployEnvironment });

  const assembly = join(stage, "assembly");
  await mkdir(assembly, { mode: 0o700 });
  await assembleBuildArtifacts({
    verifiedSource,
    buildSource,
    assembly,
    runCommand: (command, args) => runLogged(operation, command, args),
  });
  await chmod(assembly, 0o700);
  return { source: assembly, buildSource };
}

async function assertDiskSpace(path, requiredBytes, purpose) {
  const filesystem = await statfs(path, { bigint: true });
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < BigInt(requiredBytes)) {
    throw new Error(
      `${purpose} requires at least ${requiredBytes} free bytes; only ${availableBytes} are available`,
    );
  }
}

async function deployPrepared(operation, release, prepared) {
  const before = await installedRelease();
  const releaseId = `v${release.version}-${prepared.manifest.commit.slice(0, 12)}`;
  const stage = prepared.stage.slice(stagingRoot.length + 1);
  try {
    await runPrivileged(operation, {
      verb: "apply",
      version: release.version,
      stage,
    });
  } catch (deploymentError) {
    if (prepared.manifest.rollbackCompatible !== true) {
      throw new Error(
        `Deployment failed and this release declares its migration non-rollback-compatible; automatic code rollback was not attempted: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`,
        { cause: deploymentError },
      );
    }
    if (!before?.path || !before.releaseId) throw deploymentError;
    await appendLog(
      operation,
      "Deployment failed; attempting to restore the previous known-good release.\n",
    );
    try {
      await runPrivileged(operation, {
        verb: "rollback",
        releaseId: before.releaseId,
      });
    } catch (rollbackError) {
      throw new Error(
        `Deployment failed and automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}; original failure: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`,
        { cause: rollbackError },
      );
    }
    throw new Error(
      `Deployment failed and the previous release was restored: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`,
      { cause: deploymentError },
    );
  }
  const after = await installedRelease();
  if (after?.version !== release.version || after.releaseId !== releaseId) {
    throw new Error(
      "Deployment completed without activating the requested release",
    );
  }
  state.previousReleaseId = before?.releaseId ?? null;
  state.previousRollbackCompatible =
    prepared.manifest.rollbackCompatible === true;
  state.available = release;
  await persistState();
  return after;
}

async function applyRelease(operation, requestedVersion) {
  const release = await checkRelease(requestedVersion, true);
  const requiredBytes = Math.max(2 * 1024 * 1024 * 1024, release.size * 3);
  await assertDiskSpace(
    stagingRoot,
    requiredBytes,
    "Application update staging",
  );
  await assertDiskSpace(
    releaseRoot,
    requiredBytes,
    "Application release installation",
  );
  const installed = await installedRelease();
  if (installed?.version === release.version)
    throw new Error(`v${release.version} is already installed`);
  if (installed && compareVersions(release.version, installed.version) < 0) {
    throw new Error(
      "Application downgrades must use the explicit rollback operation",
    );
  }
  const prepared = await prepareRelease(operation, release);
  try {
    if (
      installed &&
      compareVersions(
        installed.version,
        prepared.manifest.minimumSourceVersion,
      ) < 0
    ) {
      throw new Error(
        `v${release.version} requires at least v${prepared.manifest.minimumSourceVersion}`,
      );
    }
    await deployPrepared(operation, release, prepared);
  } finally {
    await rm(prepared.stage, { recursive: true, force: true });
  }
}

async function rollbackRelease(operation) {
  const releaseId = state.previousReleaseId;
  if (!releaseId || !/^[A-Za-z0-9._-]+$/.test(releaseId))
    throw new Error("No previous known-good application release is available");
  if (state.previousRollbackCompatible !== true)
    throw new Error(
      "The active release does not declare its schema rollback-compatible",
    );
  const target = join(releaseRoot, releaseId);
  if (resolve(target) !== `${releaseRoot}/${releaseId}`)
    throw new Error("Rollback release path is invalid");
  const current = await installedRelease();
  await runPrivileged(operation, { verb: "rollback", releaseId });
  const after = await installedRelease();
  if (after?.releaseId !== releaseId)
    throw new Error("Rollback did not activate the requested release");
  state.previousReleaseId = current?.releaseId ?? null;
  state.previousRollbackCompatible = false;
  await persistState();
}

async function setPolicy(input) {
  const channel = input?.channel == null ? "stable" : String(input.channel);
  const mode = input?.mode == null ? "notify" : String(input.mode);
  if (channel !== "stable")
    throw httpError(
      400,
      "INVALID_UPDATE_CHANNEL",
      "Only the stable application channel is supported",
    );
  if (!["notify", "automatic"].includes(mode))
    throw httpError(
      400,
      "INVALID_UPDATE_MODE",
      "Update mode must be notify or automatic",
    );
  if (activeOperation)
    throw httpError(
      409,
      "UPDATE_OPERATION_ACTIVE",
      "Update policy cannot change while an operation is running",
    );
  state.policy = { channel, mode };
  await persistState();
  return state.policy;
}

async function refreshPolicy() {
  const release = await checkRelease();
  const installed = await installedRelease();
  if (!installed || compareVersions(release.version, installed.version) > 0) {
    if (!release.installable) {
      return {
        status: "unavailable",
        release,
        reason: release.unavailableReason,
      };
    }
    if (state.policy.mode === "automatic") {
      const operation = await startOperation(
        "automatic-apply",
        release.version,
        (value) => applyRelease(value, release.version),
      );
      return { status: "started", release, operation };
    }
    return { status: "available", release };
  }
  return { status: "up-to-date", release, installed };
}

async function startOperation(type, requestedVersion, task) {
  if (activeOperation)
    throw httpError(
      409,
      "UPDATE_OPERATION_ACTIVE",
      "Another application update operation is already running",
    );
  let mutationLock;
  try {
    mutationLock = await acquireMutationLock();
  } catch (error) {
    if (error?.code === "MUTATION_LOCK_BUSY") {
      throw httpError(409, "MUTATION_LOCK_BUSY", error.message);
    }
    throw error;
  }
  const previousLastOperationId = state.lastOperationId;
  const previousLastError = state.lastError;
  const operation = {
    id: `updop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    type,
    status: "running",
    requestedVersion,
    startedAt: new Date().toISOString(),
    logPath: "",
  };
  operation.logPath = join(operationsRoot, `${operation.id}.log`);
  activeOperation = operation;
  state.lastOperationId = operation.id;
  state.lastError = null;
  try {
    await saveOperation(operation);
    await persistState();
  } catch (error) {
    activeOperation = null;
    state.lastOperationId = previousLastOperationId;
    state.lastError = previousLastError;
    await rm(join(operationsRoot, `${operation.id}.json`), {
      force: true,
    }).catch(() => {});
    await rm(operation.logPath, { force: true }).catch(() => {});
    await persistState().catch(() => {});
    await mutationLock.release().catch(() => {});
    throw error;
  }
  void task(operation)
    .then(async () => {
      operation.status = "succeeded";
      operation.finishedAt = new Date().toISOString();
      state.lastError = null;
      await saveOperation(operation);
      await persistState();
    })
    .catch(async (error) => {
      operation.status = "failed";
      operation.error = error instanceof Error ? error.message : String(error);
      operation.finishedAt = new Date().toISOString();
      state.lastError = operation.error;
      await appendLog(operation, `\nERROR: ${operation.error}\n`).catch(
        () => {},
      );
      await saveOperation(operation).catch(() => {});
      await persistState().catch(() => {});
    })
    .finally(async () => {
      const restartForNewCode =
        operation.status === "succeeded" &&
        ["apply", "automatic-apply", "rollback"].includes(operation.type);
      activeOperation = null;
      if (restartForNewCode) {
        try {
          await runPrivileged(operation, {
            verb: "schedule-manager-restart",
          });
        } catch (error) {
          await appendLog(
            operation,
            `Could not schedule Update Manager restart: ${error instanceof Error ? error.message : String(error)}\n`,
          ).catch(() => {});
        }
      }
      await mutationLock.release().catch(() => {});
    });
  return operationView(operation);
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16 * 1024)
      throw httpError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "INVALID_JSON", "Request body must be JSON");
  }
}

function send(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const authorization = request.headers.authorization;
    if (
      !authorization?.startsWith("Bearer ") ||
      !safeToken(authorization.slice(7))
    ) {
      throw httpError(401, "UNAUTHORIZED", "Invalid Update Manager credential");
    }
    const url = new globalThis.URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/v1/state") {
      return send(response, 200, {
        ...state,
        installed: await installedRelease(),
        activeOperationId: activeOperation?.id ?? null,
      });
    }
    const operationMatch = /^\/v1\/operations\/(updop_[A-Za-z0-9_-]+)$/.exec(
      url.pathname,
    );
    if (request.method === "GET" && operationMatch) {
      const operation = await operationWithLog(operationMatch[1]);
      if (!operation)
        throw httpError(
          404,
          "UPDATE_OPERATION_NOT_FOUND",
          "Update operation was not found",
        );
      return send(response, 200, operation);
    }
    if (request.method === "POST" && url.pathname === "/v1/check") {
      const body = await readJson(request);
      const version =
        body.version == null || body.version === ""
          ? null
          : String(body.version);
      return send(response, 200, await checkRelease(version));
    }
    if (request.method === "POST" && url.pathname === "/v1/policy") {
      return send(response, 200, await setPolicy(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/v1/refresh") {
      await readJson(request);
      return send(response, 200, await refreshPolicy());
    }
    if (request.method === "POST" && url.pathname === "/v1/apply") {
      const body = await readJson(request);
      const version =
        body.version == null || body.version === ""
          ? null
          : String(body.version);
      if (version !== null) validVersion(version.replace(/^v/, ""));
      return send(
        response,
        202,
        await startOperation("apply", version, (operation) =>
          applyRelease(operation, version),
        ),
      );
    }
    if (request.method === "POST" && url.pathname === "/v1/rollback") {
      await readJson(request);
      return send(
        response,
        202,
        await startOperation("rollback", null, rollbackRelease),
      );
    }
    throw httpError(404, "NOT_FOUND", "Update Manager route not found");
  } catch (error) {
    send(response, Number.isInteger(error?.status) ? error.status : 500, {
      error: {
        code: error?.code ?? "UPDATE_MANAGER_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

try {
  const existing = await lstat(socketPath);
  if (!existing.isSocket())
    throw new Error("Refusing to replace a non-socket Update Manager path");
  await rm(socketPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolvePromise);
});
await chmod(socketPath, 0o660);
console.log(
  JSON.stringify({
    event: "update_manager.started",
    socketPath,
    repository,
    controllerUid: process.getuid?.(),
  }),
);
