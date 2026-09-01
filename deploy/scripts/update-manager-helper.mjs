#!/usr/bin/env node

/*
 * Privileged side of the application updater.
 *
 * This program is intentionally not a daemon.  The non-root Update Manager
 * invokes it through the fixed sudoers entry installed by install-host.sh.
 * Input is one bounded JSON request on stdin; only the verbs below are
 * accepted and every path is derived from a fixed host directory.  Keeping
 * the privileged code short-lived means a compromised controller cannot keep
 * a root process alive or choose an arbitrary command/path.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleBuildArtifacts,
  assertContainedSymlinks,
} from "./release-assembly.mjs";
import { validateReleaseArchive } from "./release-archive.mjs";
import { rendererRuntimeFingerprint } from "./runtime-image-identity.mjs";

if (process.getuid?.() !== 0) throw new Error("Update helper must run as root");

const repository = "n624-dev/latex-renderer";
const stateRoot = "/var/lib/latex-renderer/update-manager";
const controllerStagingRoot = join(stateRoot, "staging");
const privilegedStagingRoot = "/opt/latex-renderer/update-staging";
const releaseRoot = "/opt/latex-renderer/releases";
const currentLink = "/opt/latex-renderer/current";
const deploymentDriver = join(
  dirname(fileURLToPath(import.meta.url)),
  "deploy-production-release.sh",
);
const maxBundleBytes = positiveInteger(
  process.env.UPDATE_MAX_BUNDLE_BYTES,
  1024 * 1024 * 1024,
  1024,
  2 * 1024 * 1024 * 1024,
);
const maxArchiveEntries = positiveInteger(
  process.env.UPDATE_MAX_ARCHIVE_ENTRIES,
  50_000,
  1,
  100_000,
);
const maxExpandedBytes = positiveInteger(
  process.env.UPDATE_MAX_EXPANDED_BYTES,
  2 * 1024 * 1024 * 1024,
  1024 * 1024,
  8 * 1024 * 1024 * 1024,
);
const maxExpandedFileBytes = positiveInteger(
  process.env.UPDATE_MAX_EXPANDED_FILE_BYTES,
  256 * 1024 * 1024,
  1,
  maxExpandedBytes,
);
const maxOutputBytes = positiveInteger(
  process.env.UPDATE_MAX_OPERATION_LOG_BYTES,
  4 * 1024 * 1024,
  64 * 1024,
  64 * 1024 * 1024,
);
const githubCli = "/usr/local/bin/gh";

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = value == null ? fallback : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum ||
    (value != null && !/^(?:0|[1-9]\d*)$/.test(String(value)))
  ) {
    throw new Error("Invalid Update Manager helper limit");
  }
  return parsed;
}

function validStableVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value))
    throw new Error("Stable release version must use X.Y.Z");
  return value;
}

function validReleaseId(value) {
  if (
    typeof value !== "string" ||
    !/^v\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(value)
  )
    throw new Error("Release identifier is invalid");
  return value;
}

function validStageName(value, version) {
  const versionPattern = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    typeof value !== "string" ||
    !new RegExp(`^v${versionPattern}-[A-Za-z0-9]{6}$`).test(value)
  ) {
    throw new Error("Update staging identifier is invalid");
  }
  return value;
}

function redact(value) {
  return String(value)
    .replace(
      /((?:authorization|password|secret|token|credential)[=:][ \t]*)[^\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:gh[oprsu]_|github_pat_)[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

let outputBytes = 0;
let outputLimitReached = false;
async function writeOutput(value) {
  if (outputLimitReached) return;
  const bytes = Buffer.from(redact(value));
  const remaining = maxOutputBytes - outputBytes;
  if (remaining <= 0) {
    outputLimitReached = true;
    return;
  }
  const chunk = bytes.length <= remaining ? bytes : bytes.subarray(0, remaining);
  outputBytes += chunk.length;
  if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
  if (chunk.length < bytes.length) {
    outputLimitReached = true;
    if (!process.stdout.write("\n[LOG_LIMIT_REACHED]\n"))
      await once(process.stdout, "drain");
  }
}

function runCapture(command, args, options = {}) {
  const { maxCaptureBytes = 2 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let captureError = null;
    const capture = (target, chunk) => {
      if (captureError) return target;
      bytes += chunk.length;
      if (bytes > maxCaptureBytes) {
        captureError = new Error(`${command} output exceeds the capture limit`);
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
    child.once("error", reject);
    child.once("close", (code) => {
      if (captureError) return reject(captureError);
      if (code === 0) return resolvePromise(stdout);
      return reject(new Error(`${command} exited ${code}: ${redact(stderr.trim())}`));
    });
  });
}

async function runLogged(command, args, options = {}) {
  await writeOutput(`$ ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const consume = async (stream) => {
    for await (const chunk of stream) await writeOutput(String(chunk));
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

async function readRequest() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("Update helper request is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new Error("Update helper request is empty");
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("Update helper request must be an object");
  return request;
}

async function githubJson(url) {
  const response = await globalThis.fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "latex-renderer-update-helper",
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  return response.json();
}

async function resolveTagCommit(tag) {
  let object = (await githubJson(
    `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
  ))?.object;
  for (let depth = 0; object?.type === "tag" && depth < 4; depth += 1) {
    if (!/^[a-f0-9]{40}$/.test(object.sha ?? ""))
      throw new Error("GitHub annotated tag object is invalid");
    object = (
      await githubJson(
        `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
      )
    )?.object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha ?? ""))
    throw new Error("Immutable release tag does not resolve to a commit");
  return object.sha;
}

async function fetchRelease(requestedVersion) {
  const version = validStableVersion(requestedVersion);
  const tag = `v${version}`;
  const release = await githubJson(
    `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
  );
  if (release?.draft === true || release?.prerelease === true)
    throw new Error("Only published stable releases can be installed");
  if (release?.tag_name !== tag || release?.immutable !== true)
    throw new Error("Release is not an immutable stable release");
  const name = `latex-renderer-server-${version}.tar.gz`;
  const expectedUrl = `https://github.com/${repository}/releases/download/${tag}/${name}`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry) => entry?.name === name)
    : null;
  if (
    !asset ||
    asset.browser_download_url !== expectedUrl ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > maxBundleBytes
  ) {
    throw new Error("Immutable release asset is missing or invalid");
  }
  return {
    version,
    tag,
    name,
    url: expectedUrl,
    digest: asset.digest,
    size: asset.size,
    commit: await resolveTagCommit(tag),
  };
}

async function hashFile(path, expectedSize) {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== expectedSize)
    throw new Error("Staged release bundle has an unexpected file size/type");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > maxBundleBytes) throw new Error("Release bundle exceeds the size limit");
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function assertNoSymlinks(root) {
  const symlinks = (
    await runCapture("find", [root, "-xdev", "-type", "l", "-print", "-quit"])
  ).trim();
  if (symlinks) throw new Error(`Privileged release tree contains a symbolic link: ${symlinks}`);
}

async function verifyExtractedRelease(release, source) {
  await assertNoSymlinks(source);
  const manifest = JSON.parse(
    await readFile(join(source, ".latex-renderer-release.json"), "utf8"),
  );
  const packageJson = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const fingerprint = await rendererRuntimeFingerprint(join(source, "renderer"));
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
    !/^pnpm@\d+\.\d+\.\d+$/.test(manifest?.packageManager ?? "") ||
    manifest?.packageManager !== packageJson?.packageManager ||
    manifest?.rendererRuntimeFingerprint !== fingerprint ||
    packageJson?.version !== release.version
  ) {
    throw new Error("Privileged release metadata does not match GitHub");
  }
  return manifest;
}

function directChild(root, name) {
  const candidate = join(root, name);
  if (resolve(candidate) !== `${root}/${name}`) throw new Error("Path escaped fixed root");
  return candidate;
}

async function prepareTrustedSource(request, rootStage) {
  const release = await fetchRelease(request.version);
  const stageName = validStageName(request.stage, release.version);
  const controllerStage = directChild(controllerStagingRoot, stageName);
  const bundle = directChild(controllerStage, release.name);
  const bundleDigest = await hashFile(bundle, release.size);
  if (bundleDigest !== release.digest)
    throw new Error("Staged release bundle digest does not match GitHub");
  const trustedBundle = join(rootStage, release.name);
  await copyFile(bundle, trustedBundle);
  await chmod(trustedBundle, 0o600);
  if ((await hashFile(trustedBundle, release.size)) !== release.digest)
    throw new Error("Root-owned release bundle digest does not match GitHub");
  await writeOutput("Verifying the Sigstore release attestation in the root helper.\n");
  for (const directory of ["gh-home", "gh-config", "gh-cache"])
    await mkdir(join(rootStage, directory), { mode: 0o700 });
  await runLogged(
    githubCli,
    [
      "attestation",
      "verify",
      trustedBundle,
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/.github/workflows/server-release.yml`,
      "--source-ref",
      `refs/tags/${release.tag}`,
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--deny-self-hosted-runners",
    ],
    {
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: join(rootStage, "gh-home"),
        GH_CONFIG_DIR: join(rootStage, "gh-config"),
        GH_PROMPT_DISABLED: "1",
        XDG_CACHE_HOME: join(rootStage, "gh-cache"),
      },
    },
  );
  const topLevel = `latex-renderer-server-${release.version}`;
  await validateReleaseArchive({
    bundle: trustedBundle,
    topLevel,
    maxEntries: maxArchiveEntries,
    maxExpandedBytes,
    maxExpandedFileBytes,
  });
  const verified = join(rootStage, "verified");
  await mkdir(verified, { mode: 0o700 });
  await runLogged("tar", [
    "-xzf",
    trustedBundle,
    "--directory",
    verified,
    "--no-same-owner",
    "--no-same-permissions",
  ]);
  const source = join(verified, topLevel);
  const manifest = await verifyExtractedRelease(release, source);
  return { release, source, manifest, controllerStage };
}

async function ensureBuildSource(stage, version) {
  const stageInfo = await lstat(stage);
  if (!stageInfo.isDirectory()) throw new Error("Update staging entry is not a directory");
  const buildSource = directChild(stage, "build");
  const info = await lstat(buildSource);
  if (!info.isDirectory()) throw new Error("Build source is not a directory");
  const packagePath = join(buildSource, "package.json");
  if (!(await lstat(packagePath)).isFile())
    throw new Error("Build source package metadata is not a regular file");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageJson?.version !== version)
    throw new Error("Build source package version does not match release");
  return buildSource;
}

async function deploymentIdentity() {
  let deployUser = process.env.UPDATE_DEPLOY_USER;
  if (!deployUser) {
    try {
      const environment = await readFile(
        "/etc/latex-renderer/update-manager.env",
        "utf8",
      );
      deployUser = /^UPDATE_DEPLOY_USER=([^\n]+)$/m.exec(environment)?.[1];
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  deployUser ??= "ubuntu";
  if (deployUser === "root" || !/^[a-z_][a-z0-9_-]{0,31}$/.test(deployUser))
    throw new Error("UPDATE_DEPLOY_USER must be a valid non-root account");
  const uid = (await runCapture("id", ["-u", deployUser])).trim();
  const gid = (await runCapture("id", ["-g", deployUser])).trim();
  if (!/^[1-9]\d*$/.test(uid) || !/^[1-9]\d*$/.test(gid))
    throw new Error("UPDATE_DEPLOY_USER identity is invalid");
  return { deployUser, uid, gid };
}

async function prepareDeploymentTrees(rootStage, assembly) {
  const identity = await deploymentIdentity();
  // The deploy script is executed from the sealed, root-owned assembly.  It
  // also performs Cloudflare/client checks as the configured deployment user;
  // give that user a separate writable snapshot rather than exposing the
  // controller-owned build tree or making the control tree writable.
  const deploymentBuild = join(rootStage, "deployment-build");
  await mkdir(deploymentBuild, { mode: 0o700 });
  await runLogged("rsync", ["-a", `${assembly}/`, `${deploymentBuild}/`]);
  await runLogged("chown", ["-R", `${identity.uid}:${identity.gid}`, deploymentBuild]);
  await chmod(deploymentBuild, 0o700);

  await runLogged("chown", ["-R", `0:${identity.gid}`, assembly]);
  await runLogged("chmod", ["-R", "u=rwX,g=rX,o=", assembly]);
  await runLogged("chown", [`0:${identity.gid}`, rootStage]);
  await chmod(rootStage, 0o710);
  return { ...identity, deploymentBuild };
}

async function deployFromAssembly(assembly, deployment, releaseId) {
  await runLogged(
    "sh",
    [join(assembly, "deploy/scripts/deploy-production-release.sh"), releaseId],
    {
      env: {
        ...process.env,
        SUDO_USER: deployment.deployUser,
        LATEX_RENDERER_PARENT_MUTATION_LOCK: "application-update",
        LATEX_RENDERER_BUILD_ROOT: deployment.deploymentBuild,
      },
    },
  );
}

async function apply(request) {
  const rootStage = await mkdtemp(join(privilegedStagingRoot, "privileged-"));
  try {
    const prepared = await prepareTrustedSource(request, rootStage);
    const buildSource = await ensureBuildSource(
      prepared.controllerStage,
      prepared.release.version,
    );
    const assembly = join(rootStage, "assembly");
    await mkdir(assembly, { mode: 0o700 });
    await assembleBuildArtifacts({
      verifiedSource: prepared.source,
      buildSource,
      assembly,
      runCommand: (command, args) => runLogged(command, args),
    });
    await runLogged("chown", ["-R", "root:root", assembly]);
    const deployment = await prepareDeploymentTrees(rootStage, assembly);
    const releaseId = `v${prepared.release.version}-${prepared.manifest.commit.slice(0, 12)}`;
    await runLogged("systemctl", ["restart", "latex-renderer-backup.service"]);
    await deployFromAssembly(assembly, deployment, releaseId);
    await writeOutput(`${JSON.stringify({ ok: true, releaseId })}\n`);
  } finally {
    await rm(rootStage, { recursive: true, force: true });
  }
}

async function installedRelease() {
  const current = await readlink(currentLink);
  const absolute = resolve(dirname(currentLink), current);
  if (dirname(absolute) !== releaseRoot) throw new Error("Current release link escaped release root");
  const packageJson = JSON.parse(await readFile(join(absolute, "package.json"), "utf8"));
  return { path: absolute, releaseId: absolute.slice(releaseRoot.length + 1), version: packageJson.version };
}

async function rollback(request) {
  const releaseId = validReleaseId(request.releaseId);
  const target = directChild(releaseRoot, releaseId);
  const targetInfo = await lstat(target);
  if (!targetInfo.isDirectory()) throw new Error("Rollback release is not a directory");
  const unsafeTarget = (
    await runCapture("find", [
      target,
      "-xdev",
      "(",
      "!",
      "-user",
      "root",
      "-o",
      "-perm",
      "/022",
      ")",
      "-print",
      "-quit",
    ])
  ).trim();
  if (unsafeTarget)
    throw new Error(`Rollback release tree is not sealed: ${unsafeTarget}`);
  await assertContainedSymlinks(target, target);
  const current = await installedRelease();
  const rootStage = await mkdtemp(join(privilegedStagingRoot, "privileged-rollback-"));
  try {
    const verified = join(rootStage, "verified");
    await mkdir(verified, { mode: 0o700 });
    await runLogged("rsync", ["-a", "--exclude=.git", `${target}/`, `${verified}/`]);
    await assertContainedSymlinks(verified, verified);
    const trustedDriver = join(
      verified,
      "deploy/scripts/deploy-production-release.sh",
    );
    await rm(trustedDriver, { force: true });
    await copyFile(deploymentDriver, trustedDriver);
    await runLogged("chown", ["-R", "root:root", verified]);
    await assertContainedSymlinks(verified, verified);
    const assembly = join(rootStage, "assembly");
    await mkdir(assembly, { mode: 0o700 });
    await assembleBuildArtifacts({
      verifiedSource: verified,
      buildSource: target,
      assembly,
      runCommand: (command, args) => runLogged(command, args),
    });
    await runLogged("chown", ["-R", "root:root", assembly]);
    const deployment = await prepareDeploymentTrees(rootStage, assembly);
    await runLogged("systemctl", ["restart", "latex-renderer-backup.service"]);
    await deployFromAssembly(assembly, deployment, releaseId);
    const after = await installedRelease();
    if (after.releaseId !== releaseId) throw new Error("Rollback did not activate the requested release");
    await writeOutput(`${JSON.stringify({ ok: true, previousReleaseId: current.releaseId })}\n`);
  } finally {
    await rm(rootStage, { recursive: true, force: true });
  }
}

async function scheduleManagerRestart() {
  await runLogged("systemd-run", [
    "--quiet",
    "--collect",
    "--on-active=3s",
    `--unit=latex-renderer-update-manager-restart-${Date.now()}`,
    "/bin/systemctl",
    "restart",
    "latex-renderer-update-manager.service",
  ]);
  await writeOutput('{"ok":true}\n');
}

const request = await readRequest();
switch (request.verb) {
  case "apply":
    if (typeof request.version !== "string") throw new Error("Apply version is required");
    await apply({ version: validStableVersion(request.version.replace(/^v/, "")), stage: request.stage });
    break;
  case "rollback":
    await rollback(request);
    break;
  case "schedule-manager-restart":
    await scheduleManagerRestart();
    break;
  default:
    throw new Error("Update helper verb is not allowed");
}
