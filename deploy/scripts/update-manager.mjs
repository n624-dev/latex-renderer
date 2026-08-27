#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  mkdtemp,
  open,
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
import { rendererRuntimeFingerprint } from "./runtime-image-identity.mjs";

if (process.getuid?.() !== 0) throw new Error("Update Manager must run as root");

const repository = process.env.UPDATE_REPOSITORY ?? "n624-dev/latex-renderer";
if (repository !== "n624-dev/latex-renderer") {
  throw new Error("UPDATE_REPOSITORY is fixed to the trusted public repository");
}
const socketPath = process.env.UPDATE_MANAGER_SOCKET ?? "/run/latex-renderer/update-manager.sock";
const tokenFile = process.env.UPDATE_MANAGER_TOKEN_FILE ?? "/etc/latex-renderer/secrets/update-manager-token";
const stateRoot = process.env.UPDATE_MANAGER_STATE_ROOT ?? "/var/lib/latex-renderer/update-manager";
const releaseRoot = process.env.UPDATE_RELEASE_ROOT ?? "/opt/latex-renderer/releases";
const currentLink = process.env.UPDATE_CURRENT_LINK ?? "/opt/latex-renderer/current";
const deployUser = process.env.UPDATE_DEPLOY_USER ?? "ubuntu";
const maxBundleBytes = Number(process.env.UPDATE_MAX_BUNDLE_BYTES ?? String(1024 * 1024 * 1024));
if (!socketPath.startsWith("/run/latex-renderer/") || !socketPath.endsWith(".sock")) {
  throw new Error("UPDATE_MANAGER_SOCKET must be a fixed path below /run/latex-renderer");
}
if (stateRoot !== "/var/lib/latex-renderer/update-manager") {
  throw new Error("UPDATE_MANAGER_STATE_ROOT is fixed to /var/lib/latex-renderer/update-manager");
}
if (releaseRoot !== "/opt/latex-renderer/releases") {
  throw new Error("UPDATE_RELEASE_ROOT is fixed to /opt/latex-renderer/releases");
}
if (currentLink !== "/opt/latex-renderer/current") {
  throw new Error("UPDATE_CURRENT_LINK is fixed to /opt/latex-renderer/current");
}
if (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 1024 || maxBundleBytes > 2 * 1024 * 1024 * 1024) {
  throw new Error("UPDATE_MAX_BUNDLE_BYTES is invalid");
}
if (deployUser === "root" || !/^[a-z_][a-z0-9_-]{0,31}$/.test(deployUser)) {
  throw new Error("UPDATE_DEPLOY_USER must be a valid non-root account");
}

const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Update Manager token is too short");
const deployHome = (await runCapture("getent", ["passwd", deployUser])).trim().split(":")[5];
if (!deployHome?.startsWith("/")) throw new Error("Could not resolve update deployment user home");
const appGroupGid = Number((await runCapture("getent", ["group", "latex-renderer"])).trim().split(":")[2]);
if (!Number.isSafeInteger(appGroupGid) || appGroupGid < 1) throw new Error("Could not resolve latex-renderer group");

await mkdir(stateRoot, { recursive: true, mode: 0o750 });
await mkdir(join(stateRoot, "operations"), { recursive: true, mode: 0o750 });
await mkdir(join(stateRoot, "staging"), { recursive: true, mode: 0o750 });
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

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return { ...emptyState(), ...parsed, policy: { ...emptyState().policy, ...(parsed.policy ?? {}) } };
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
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise(stdout)
      : reject(new Error(`${command} exited ${code}: ${redact(stderr.trim())}`)));
  });
}

function redact(value) {
  return String(value)
    .replace(/((?:authorization|password|secret|token|credential)[=:][ \t]*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:gh[oprsu]_|github_pat_)[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

async function appendLog(operation, value) {
  await writeFile(operation.logPath, redact(value), { flag: "a", mode: 0o640 });
}

function runLogged(operation, command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    void appendLog(operation, `$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { void appendLog(operation, String(chunk)); });
    child.stderr.on("data", (chunk) => { void appendLog(operation, String(chunk)); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with code ${code}`)));
  });
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
  await writeAtomic(join(operationsRoot, `${operation.id}.json`), `${JSON.stringify(operationView(operation), null, 2)}\n`);
}

async function recoverInterruptedOperation() {
  if (!state.lastOperationId) return;
  const path = join(operationsRoot, `${state.lastOperationId}.json`);
  try {
    const operation = JSON.parse(await readFile(path, "utf8"));
    if (operation.status !== "running") return;
    operation.status = "failed";
    operation.error = "Update Manager restarted while this operation was running; inspect the active release before retrying";
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
      operation = JSON.parse(await readFile(join(operationsRoot, `${id}.json`), "utf8"));
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
      const result = await handle.read(buffer, 0, length, Math.max(0, info.size - length));
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
      throw new Error("Current release link points outside the allowlisted release root");
    }
    const packageJson = JSON.parse(await readFile(join(absolute, "package.json"), "utf8"));
    const releaseId = absolute.slice(releaseRoot.length + 1);
    if (!/^[A-Za-z0-9._-]+$/.test(releaseId)) throw new Error("Current release identifier is invalid");
    return { version: validVersion(packageJson.version), releaseId, path: absolute };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
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
  const parse = (value) => validVersion(value).split("-")[0].split(".").map(Number);
  const a = parse(left), b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function fetchRelease(requestedVersion = null, requireInstallable = false) {
  const version = requestedVersion === null ? null : validStableVersion(requestedVersion.replace(/^v/, ""));
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
  if (!response.ok) throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
  const release = await response.json();
  if (release?.draft === true || release?.prerelease === true) throw new Error("Only published stable releases can be installed");
  const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
  const releaseVersion = validStableVersion(tag.replace(/^v/, ""));
  if (tag !== `v${releaseVersion}` || (version && version !== releaseVersion)) {
    throw new Error("GitHub release tag does not match the requested semantic version");
  }
  const commit = await resolveTagCommit(tag);
  const assetName = `latex-renderer-server-${releaseVersion}.tar.gz`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry) => entry?.name === assetName)
    : null;
  const expectedUrl = `https://github.com/${repository}/releases/download/v${releaseVersion}/${assetName}`;
  let unavailableReason = null;
  if (release?.immutable !== true) unavailableReason = `Release v${releaseVersion} is mutable`;
  else if (!asset || typeof asset.browser_download_url !== "string") unavailableReason = `Release v${releaseVersion} has no ${assetName} asset`;
  else if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) unavailableReason = "GitHub release asset has no valid SHA-256 digest";
  else if (asset.browser_download_url !== expectedUrl) unavailableReason = "Release asset URL is outside the trusted repository";
  else if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maxBundleBytes) unavailableReason = "Release bundle size is invalid or exceeds the configured limit";
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
  let response = await globalThis.fetch(`https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, {
    headers,
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub release tag lookup failed: HTTP ${response.status}`);
  let object = (await response.json())?.object;
  for (let depth = 0; object?.type === "tag" && depth < 4; depth += 1) {
    if (!/^[a-f0-9]{40}$/.test(object.sha ?? "")) throw new Error("GitHub annotated tag object is invalid");
    response = await globalThis.fetch(`https://api.github.com/repos/${repository}/git/tags/${object.sha}`, {
      headers,
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub annotated tag lookup failed: HTTP ${response.status}`);
    object = (await response.json())?.object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha ?? "")) {
    throw new Error("Immutable release tag does not resolve to a commit");
  }
  return object.sha;
}

async function checkRelease(requestedVersion = null, requireInstallable = false) {
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
  if (!response.ok || !response.body) throw new Error(`Release bundle download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBundleBytes) throw new Error("Release bundle exceeds the configured size limit");
  let bytes = 0;
  const hash = createHash("sha256");
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBundleBytes) return callback(new Error("Release bundle exceeds the configured size limit"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const handle = await open(path, "wx", 0o600);
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, handle.createWriteStream());
  } finally {
    await handle.close().catch(() => {});
  }
  if (bytes !== release.size) throw new Error(`Release bundle size mismatch: expected ${release.size}, received ${bytes}`);
  const actual = `sha256:${hash.digest("hex")}`;
  if (actual !== release.digest) throw new Error("Release bundle SHA-256 does not match the immutable GitHub asset digest");
  await appendLog(operation, `Verified ${release.name}: ${actual}\n`);
}

async function validateArchive(bundle, topLevel) {
  const listing = await runCapture("tar", ["-tzf", bundle]);
  const verboseListing = await runCapture("tar", ["-tvzf", bundle], {
    env: { ...process.env, LC_ALL: "C" },
  });
  const prefix = `${topLevel}/`;
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) throw new Error("Release bundle is empty");
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error("Release bundle contains a path outside its versioned top-level directory");
    }
  }
  for (const entry of verboseListing.split(/\r?\n/).filter(Boolean)) {
    if (entry[0] !== "-" && entry[0] !== "d") {
      throw new Error("Release bundle may contain only regular files and directories");
    }
  }
}

async function prepareRelease(operation, release) {
  const stage = await mkdtemp(join(stateRoot, "staging", `v${release.version}-`));
  const bundle = join(stage, release.name);
  const topLevel = `latex-renderer-server-${release.version}`;
  try {
    await downloadBundle(operation, release, bundle);
    await validateArchive(bundle, topLevel);
    await chown(stage, Number((await runCapture("id", ["-u", deployUser])).trim()), appGroupGid);
    await chown(bundle, Number((await runCapture("id", ["-u", deployUser])).trim()), appGroupGid);
    await chmod(bundle, 0o640);
    await runLogged(operation, "runuser", [
      "-u", deployUser, "--", "tar", "-xzf", bundle,
      "--directory", stage, "--no-same-owner", "--no-same-permissions",
    ]);
    const source = join(stage, topLevel);
    const manifest = JSON.parse(await readFile(join(source, ".latex-renderer-release.json"), "utf8"));
    const packageJson = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const stagedRendererFingerprint = await rendererRuntimeFingerprint(join(source, "renderer"));
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
      Number(process.versions.node.split(".")[0]) !== manifest.requiredNodeMajor ||
      manifest?.packageManager !== packageJson?.packageManager ||
      !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager ?? "") ||
      manifest?.rendererRuntimeFingerprint !== stagedRendererFingerprint ||
      packageJson?.version !== release.version
    ) throw new Error("Release bundle metadata does not match the immutable GitHub release");
    const symlinks = (await runCapture("find", [source, "-type", "l", "-print"])).trim();
    if (symlinks) throw new Error("Release source bundle must not contain symbolic links");
    const pnpm = join(deployHome, ".local/share/pnpm/bin/pnpm");
    const expectedPnpmVersion = manifest.packageManager.slice("pnpm@".length);
    let pnpmVersion = (await runCapture("runuser", [
      "-u", deployUser, "--", "env",
      `HOME=${deployHome}`, `USER=${deployUser}`, `LOGNAME=${deployUser}`,
      `PNPM_HOME=${dirname(pnpm)}`, `PATH=${dirname(pnpm)}:/usr/local/bin:/usr/bin:/bin`,
      pnpm, "--version",
    ])).trim();
    if (pnpmVersion !== expectedPnpmVersion) {
      await appendLog(operation, `Updating deployment-user pnpm from ${pnpmVersion} to ${expectedPnpmVersion}.\n`);
      await runLogged(operation, "runuser", [
        "-u", deployUser, "--", "env",
        `HOME=${deployHome}`, `USER=${deployUser}`, `LOGNAME=${deployUser}`,
        `PNPM_HOME=${dirname(pnpm)}`, `PATH=${dirname(pnpm)}:/usr/local/bin:/usr/bin:/bin`,
        pnpm, "self-update", expectedPnpmVersion,
      ]);
      pnpmVersion = (await runCapture("runuser", [
        "-u", deployUser, "--", "env",
        `HOME=${deployHome}`, `USER=${deployUser}`, `LOGNAME=${deployUser}`,
        `PNPM_HOME=${dirname(pnpm)}`, `PATH=${dirname(pnpm)}:/usr/local/bin:/usr/bin:/bin`,
        pnpm, "--version",
      ])).trim();
      if (pnpmVersion !== expectedPnpmVersion) {
        throw new Error(`pnpm self-update did not activate required version ${expectedPnpmVersion}`);
      }
    }
    await runLogged(operation, "runuser", [
      "-u", deployUser, "--", "env",
      `HOME=${deployHome}`, `USER=${deployUser}`, `LOGNAME=${deployUser}`,
      `PNPM_HOME=${dirname(pnpm)}`, `PATH=${dirname(pnpm)}:/usr/local/bin:/usr/bin:/bin`,
      pnpm, "--dir", source, "install", "--frozen-lockfile",
    ]);
    return { stage, source, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function assertDiskSpace(path, requiredBytes, purpose) {
  const filesystem = await statfs(path, { bigint: true });
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < BigInt(requiredBytes)) {
    throw new Error(`${purpose} requires at least ${requiredBytes} free bytes; only ${availableBytes} are available`);
  }
}

async function deployPrepared(operation, release, prepared) {
  const before = await installedRelease();
  const releaseId = `v${release.version}-${prepared.manifest.commit.slice(0, 12)}`;
  await runLogged(operation, "systemctl", ["restart", "latex-renderer-backup.service"]);
  try {
    await runLogged(
      operation,
      "sh",
      [join(prepared.source, "deploy/scripts/deploy-production-release.sh"), releaseId],
      { env: { ...process.env, SUDO_USER: deployUser } },
    );
  } catch (deploymentError) {
    if (prepared.manifest.rollbackCompatible !== true) {
      throw new Error(`Deployment failed and this release declares its migration non-rollback-compatible; automatic code rollback was not attempted: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`);
    }
    if (!before?.path || !before.releaseId) throw deploymentError;
    await appendLog(operation, "Deployment failed; attempting to restore the previous known-good release.\n");
    try {
      await runLogged(
        operation,
        "sh",
        [join(before.path, "deploy/scripts/deploy-production-release.sh"), before.releaseId],
        { env: { ...process.env, SUDO_USER: deployUser } },
      );
    } catch (rollbackError) {
      throw new Error(
        `Deployment failed and automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}; original failure: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`,
      );
    }
    throw new Error(`Deployment failed and the previous release was restored: ${deploymentError instanceof Error ? deploymentError.message : String(deploymentError)}`);
  }
  const after = await installedRelease();
  if (after?.version !== release.version || after.releaseId !== releaseId) {
    throw new Error("Deployment completed without activating the requested release");
  }
  state.previousReleaseId = before?.releaseId ?? null;
  state.previousRollbackCompatible = prepared.manifest.rollbackCompatible === true;
  state.available = release;
  await persistState();
  return after;
}

async function applyRelease(operation, requestedVersion) {
  const release = await checkRelease(requestedVersion, true);
  const requiredBytes = Math.max(2 * 1024 * 1024 * 1024, release.size * 3);
  await assertDiskSpace(stateRoot, requiredBytes, "Application update staging");
  await assertDiskSpace(releaseRoot, requiredBytes, "Application release installation");
  const installed = await installedRelease();
  if (installed?.version === release.version) throw new Error(`v${release.version} is already installed`);
  if (installed && compareVersions(release.version, installed.version) < 0) {
    throw new Error("Application downgrades must use the explicit rollback operation");
  }
  const prepared = await prepareRelease(operation, release);
  try {
    if (installed && compareVersions(installed.version, prepared.manifest.minimumSourceVersion) < 0) {
      throw new Error(`v${release.version} requires at least v${prepared.manifest.minimumSourceVersion}`);
    }
    await deployPrepared(operation, release, prepared);
  } finally {
    await rm(prepared.stage, { recursive: true, force: true });
  }
}

async function rollbackRelease(operation) {
  const releaseId = state.previousReleaseId;
  if (!releaseId || !/^[A-Za-z0-9._-]+$/.test(releaseId)) throw new Error("No previous known-good application release is available");
  if (state.previousRollbackCompatible !== true) throw new Error("The active release does not declare its schema rollback-compatible");
  const target = join(releaseRoot, releaseId);
  if (resolve(target) !== `${releaseRoot}/${releaseId}`) throw new Error("Rollback release path is invalid");
  const current = await installedRelease();
  await runLogged(operation, "systemctl", ["restart", "latex-renderer-backup.service"]);
  await runLogged(
    operation,
    "sh",
    [join(target, "deploy/scripts/deploy-production-release.sh"), releaseId],
    { env: { ...process.env, SUDO_USER: deployUser } },
  );
  const after = await installedRelease();
  if (after?.releaseId !== releaseId) throw new Error("Rollback did not activate the requested release");
  state.previousReleaseId = current?.releaseId ?? null;
  state.previousRollbackCompatible = false;
  await persistState();
}

async function setPolicy(input) {
  const channel = input?.channel == null ? "stable" : String(input.channel);
  const mode = input?.mode == null ? "notify" : String(input.mode);
  if (channel !== "stable") throw httpError(400, "INVALID_UPDATE_CHANNEL", "Only the stable application channel is supported");
  if (!["notify", "automatic"].includes(mode)) throw httpError(400, "INVALID_UPDATE_MODE", "Update mode must be notify or automatic");
  if (activeOperation) throw httpError(409, "UPDATE_OPERATION_ACTIVE", "Update policy cannot change while an operation is running");
  state.policy = { channel, mode };
  await persistState();
  return state.policy;
}

async function refreshPolicy() {
  const release = await checkRelease();
  const installed = await installedRelease();
  if (!installed || compareVersions(release.version, installed.version) > 0) {
    if (!release.installable) {
      return { status: "unavailable", release, reason: release.unavailableReason };
    }
    if (state.policy.mode === "automatic") {
      const operation = await startOperation("automatic-apply", release.version, (value) => applyRelease(value, release.version));
      return { status: "started", release, operation };
    }
    return { status: "available", release };
  }
  return { status: "up-to-date", release, installed };
}

async function startOperation(type, requestedVersion, task) {
  if (activeOperation) throw httpError(409, "UPDATE_OPERATION_ACTIVE", "Another application update operation is already running");
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
    await rm(join(operationsRoot, `${operation.id}.json`), { force: true }).catch(() => {});
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
      await appendLog(operation, `\nERROR: ${operation.error}\n`).catch(() => {});
      await saveOperation(operation).catch(() => {});
      await persistState().catch(() => {});
    })
    .finally(async () => {
      const restartForNewCode = operation.status === "succeeded" && ["apply", "automatic-apply", "rollback"].includes(operation.type);
      activeOperation = null;
      if (restartForNewCode) {
        const child = spawn("systemd-run", [
          "--quiet",
          "--collect",
          "--on-active=3s",
          `--unit=latex-renderer-update-manager-restart-${Date.now()}`,
          "/bin/systemctl",
          "restart",
          "latex-renderer-update-manager.service",
        ], { detached: true, stdio: "ignore" });
        child.on("error", (error) => {
          process.stderr.write(`Could not schedule Update Manager restart: ${error.message}\n`);
        });
        child.unref();
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
    if (size > 16 * 1024) throw httpError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw httpError(400, "INVALID_JSON", "Request body must be JSON"); }
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
    if (!authorization?.startsWith("Bearer ") || !safeToken(authorization.slice(7))) {
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
    const operationMatch = /^\/v1\/operations\/(updop_[A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "GET" && operationMatch) {
      const operation = await operationWithLog(operationMatch[1]);
      if (!operation) throw httpError(404, "UPDATE_OPERATION_NOT_FOUND", "Update operation was not found");
      return send(response, 200, operation);
    }
    if (request.method === "POST" && url.pathname === "/v1/check") {
      const body = await readJson(request);
      const version = body.version == null || body.version === "" ? null : String(body.version);
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
      const version = body.version == null || body.version === "" ? null : String(body.version);
      if (version !== null) validVersion(version.replace(/^v/, ""));
      return send(response, 202, await startOperation("apply", version, (operation) => applyRelease(operation, version)));
    }
    if (request.method === "POST" && url.pathname === "/v1/rollback") {
      await readJson(request);
      return send(response, 202, await startOperation("rollback", null, rollbackRelease));
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
  if (!existing.isSocket()) throw new Error("Refusing to replace a non-socket Update Manager path");
  await rm(socketPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolvePromise);
});
await chown(socketPath, 0, appGroupGid);
await chmod(socketPath, 0o660);
console.log(JSON.stringify({ event: "update_manager.started", socketPath, repository, deployUser }));
