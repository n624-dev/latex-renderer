import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { cp, lstat, mkdtemp, open, readdir, rename, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validStableVersion } from "./release-version.mjs";

const nodeRelative = "bin/node";
const corepackRelative = "corepack/dist/corepack.js";
const versionPattern = "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)";
const generationPattern = new RegExp(`^node-${versionPattern}-corepack-${versionPattern}$`);

export function isHostRuntimeGeneration(name) {
  return typeof name === "string" && generationPattern.test(name);
}

export async function stageHostRuntime({
  root,
  library,
  nodeVersion,
  corepackVersion,
  owner = 0,
  verify = verifyExecutables,
}) {
  const generation = `node-${validStableVersion(nodeVersion)}-corepack-${validStableVersion(corepackVersion)}`;
  const target = join(root, generation);
  await assertDirectory(root, owner);
  if (await exists(target)) {
    await verifyGeneration(target, owner, verify, nodeVersion, corepackVersion);
    return generation;
  }
  await assertTrustedTree(library, owner);
  const stage = await mkdtemp(join(root, ".runtime-stage-"));
  try {
    await cp(join(library, "bin"), join(stage, "bin"), { recursive: true });
    await cp(join(library, "corepack"), join(stage, "corepack"), { recursive: true });
    await verifyGeneration(stage, owner, verify, nodeVersion, corepackVersion);
    await syncTree(stage);
    // The service identities must be able to traverse the published generation.
    const directory = await open(stage, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.chmod(0o755);
      await directory.sync();
    } finally {
      await directory.close();
    }
    await rename(stage, target);
    await syncDirectory(root);
    return generation;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function verifyGeneration(root, owner, verify, nodeVersion, corepackVersion) {
  await assertTrustedTree(root, owner);
  await verify({
    node: join(root, nodeRelative),
    corepack: join(root, corepackRelative),
    nodeVersion,
    corepackVersion,
  });
}

export async function replaceHostRuntimeLink(path, target) {
  const parent = dirname(path);
  const stage = await mkdtemp(join(parent, ".runtime-link-"));
  try {
    const link = join(stage, "link");
    await symlink(target, link);
    await rename(link, path);
    await syncDirectory(parent);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function recordHostRuntimeResult(root, value) {
  const stage = await mkdtemp(join(root, ".runtime-stage-"));
  const path = join(stage, "result.json");
  try {
    const file = await open(path, "wx", 0o644);
    try {
      await file.writeFile(JSON.stringify(value) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(path, join(root, "last-result.json"));
    await syncDirectory(root);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function verifyExecutables({ node, corepack, nodeVersion, corepackVersion }) {
  for (const [args, expected] of [
    [["--version"], `v${nodeVersion}`],
    [[corepack, "--version"], corepackVersion],
  ]) {
    const result = spawnSync(node, args, {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
      throw new Error("Installed APT toolchain executables do not match their version metadata");
    }
  }
}

async function assertDirectory(path, owner) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== owner || info.mode & 0o022)
    throw new Error("Untrusted host runtime directory");
}

async function assertTrustedTree(path, owner) {
  await assertDirectory(path, owner);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await assertTrustedTree(child, owner);
    } else {
      const info = await lstat(child);
      if (!info.isFile() || info.uid !== owner || info.mode & 0o022)
        throw new Error("Untrusted file in host runtime");
    }
  }
}

async function syncTree(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await syncTree(child);
    } else {
      const file = await open(child, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
  }
  await syncDirectory(path);
}

async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
