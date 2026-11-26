import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const managedRoot = "/opt/latex-renderer/host-runtime/";
const supportedNodeMajors = Object.freeze([24, 26]);

/** Report versions without invoking Node/Corepack or disclosing host paths. */
export async function serverToolchainStatus({
  nodePath = process.execPath,
  nodeVersion = process.versions.node,
  corepackPath = "/usr/local/bin/corepack",
  owner = 0,
} = {}) {
  const node = await realpath(nodePath).catch(() => null);
  const corepack = await realpath(corepackPath).catch(() => null);
  return {
    node: {
      version: nodeVersion,
      source: source(node),
      compatible: supportedNodeMajors.includes(
        Number(nodeVersion.split(".")[0]),
      ),
      supportedMajors: supportedNodeMajors,
    },
    corepack: {
      version: await corepackVersion(corepack, owner),
      source: source(corepack),
    },
  };
}

function source(path) {
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
  let file;
  try {
    file = await open(
      join(dirname(dirname(path)), "package.json"),
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
    const value = JSON.parse(await file.readFile({ encoding: "utf8" }));
    if (
      value?.name !== "corepack" ||
      typeof value.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(value.version)
    )
      return null;
    return value.version;
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}
