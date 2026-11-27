import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compareReleaseVersions, parseReleaseVersion } from "./release-version.mjs";

const hostRuntimeRoot = "/opt/latex-renderer/host-runtime/";
const aptRuntimeManifest = "/usr/lib/n624-latex/server/node-runtime.json";
const supportedNodeMajors = Object.freeze([24, 26]);

/** Report versions without invoking Node/Corepack or disclosing host paths. */
export async function serverToolchainStatus({
  nodePath = process.execPath,
  nodeVersion = process.versions.node,
  corepackPath = "/usr/local/bin/corepack",
  aptManifestPath = aptRuntimeManifest,
  managedRoot = hostRuntimeRoot,
  owner = 0,
} = {}) {
  const node = await realpath(nodePath).catch(() => null);
  const corepack = await realpath(corepackPath).catch(() => null);
  const nodeSource = source(node, managedRoot);
  const corepackSource = source(corepack, managedRoot);
  const corepackRelease = await corepackVersion(corepack, owner);
  const candidate =
    nodeSource === "managed-copy" && corepackSource === "managed-copy"
      ? await aptCandidate(aptManifestPath, owner, nodeVersion, corepackRelease)
      : undefined;
  return {
    node: {
      version: nodeVersion,
      source: nodeSource,
      compatible: supportedNodeMajors.includes(
        Number(nodeVersion.split(".")[0]),
      ),
      supportedMajors: supportedNodeMajors,
    },
    corepack: {
      version: corepackRelease,
      source: corepackSource,
    },
    ...(candidate && { apt: candidate }),
  };
}

function source(path, managedRoot) {
  if (path === null) return "unknown";
  return path.startsWith(managedRoot) ? "managed-copy" : "host";
}

async function corepackVersion(path, owner) {
  if (
    path === null ||
    basename(path) !== "corepack.js" ||
    basename(dirname(path)) !== "dist"
  )
    return null;
  const value = await readTrustedJson(
    join(dirname(dirname(path)), "package.json"),
    owner,
  );
  return value?.name === "corepack" ? stableVersion(value.version)?.value ?? null : null;
}

async function aptCandidate(path, owner, runningNode, runningCorepack) {
  const manifest = await readTrustedJson(path, owner);
  const node = stableVersion(manifest?.version);
  const corepack = stableVersion(manifest?.corepack?.version);
  if (node === undefined || corepack === undefined) return undefined;

  const current = stableVersion(runningNode);
  const nodeOrder = current === undefined ? -1 : compareReleaseVersions(node.value, current.value);
  const corepackOrder = runningCorepack === null
    ? -1
    : compareReleaseVersions(corepack.value, runningCorepack);
  const compatible =
    current !== undefined &&
    supportedNodeMajors.includes(current.major) &&
    node.major === current.major &&
    nodeOrder >= 0 &&
    corepackOrder >= 0;
  return {
    nodeVersion: node.value,
    corepackVersion: corepack.value,
    status: !compatible ? "incompatible" : nodeOrder || corepackOrder ? "available" : "current",
  };
}

function stableVersion(value) {
  try {
    const version = parseReleaseVersion(value);
    if (!version.prerelease) return version;
  } catch {
    // Package metadata is optional. Ignore malformed or unsupported versions.
  }
}

async function readTrustedJson(path, owner) {
  let file;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== owner ||
      info.mode & 0o022 ||
      info.size > 32768
    )
      return null;
    return JSON.parse(await file.readFile({ encoding: "utf8" }));
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}
