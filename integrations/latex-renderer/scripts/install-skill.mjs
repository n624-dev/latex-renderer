#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path, { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const bundledSkillRoot = resolve(dirname(scriptPath), "..");

export function resolveSkillLocations(home, pathApi = path) {
  return {
    codex: pathApi.join(home, ".agents", "skills", "latex-renderer"),
    codexLegacy: pathApi.join(home, ".codex", "skills", "latex-renderer"),
    claude: pathApi.join(home, ".claude", "skills", "latex-renderer"),
  };
}

export async function installSkillTargets({
  target,
  source = bundledSkillRoot,
  previousSource,
  home = homedir(),
  output = process.stdout,
  warning = process.stderr,
}) {
  if (!["codex", "claude", "both"].includes(target))
    throw new Error("target must be codex, claude, or both");
  const locations = resolveSkillLocations(home);
  const knownManagedSources = [source];
  if (previousSource && (await isDirectory(previousSource)))
    knownManagedSources.push(previousSource);
  const results = [];
  if (target === "codex" || target === "both")
    results.push(
      await installManagedSkill({
        name: "Codex",
        source,
        destination: locations.codex,
        legacy: locations.codexLegacy,
        knownManagedSources,
        output,
        warning,
      }),
    );
  if (target === "claude" || target === "both")
    results.push(
      await installManagedSkill({
        name: "Claude Code",
        source,
        destination: locations.claude,
        knownManagedSources,
        output,
        warning,
      }),
    );
  return results;
}

export async function removeSkillTargets({
  target,
  source = bundledSkillRoot,
  home = homedir(),
  output = process.stdout,
  warning = process.stderr,
}) {
  if (!["codex", "claude", "both"].includes(target))
    throw new Error("target must be codex, claude, or both");
  const locations = resolveSkillLocations(home);
  const candidates = [];
  if (target === "codex" || target === "both")
    candidates.push(
      ["Codex", locations.codex],
      ["Codex legacy", locations.codexLegacy],
    );
  if (target === "claude" || target === "both")
    candidates.push(["Claude Code", locations.claude]);
  const results = [];
  for (const [name, destination] of candidates) {
    if (!(await isDirectory(destination))) continue;
    if (!(await directoriesEqual(destination, source))) {
      warning.write(`Preserved modified ${name} skill: ${destination}\n`);
      results.push({ name, destination, status: "preserved_modified" });
      continue;
    }
    await rm(destination, { recursive: true, force: true });
    output.write(`Removed managed ${name} skill: ${destination}\n`);
    results.push({ name, destination, status: "removed" });
  }
  return results;
}

async function installManagedSkill({
  name,
  source,
  destination,
  legacy,
  knownManagedSources,
  output,
  warning,
}) {
  if (await isDirectory(destination)) {
    if (await directoriesEqual(destination, source)) {
      output.write(`${name} skill is current: ${destination}\n`);
      return { name, destination, status: "current" };
    }
    if (!(await matchesAny(destination, knownManagedSources))) {
      warning.write(`Preserved modified ${name} skill: ${destination}\n`);
      return { name, destination, status: "preserved_modified" };
    }
    await replaceDirectory(source, destination);
    output.write(`Updated managed ${name} skill: ${destination}\n`);
    return { name, destination, status: "updated" };
  }

  if (legacy && (await isDirectory(legacy))) {
    if (!(await matchesAny(legacy, knownManagedSources))) {
      warning.write(
        `Preserved modified legacy ${name} skill; migration was skipped: ${legacy}\n`,
      );
      return { name, destination, legacy, status: "preserved_modified_legacy" };
    }
    await replaceDirectory(source, destination);
    await rm(legacy, { recursive: true, force: true });
    output.write(
      `Migrated managed ${name} skill: ${legacy} -> ${destination}\n`,
    );
    return { name, destination, legacy, status: "migrated" };
  }

  await replaceDirectory(source, destination);
  output.write(`Installed managed ${name} skill: ${destination}\n`);
  return { name, destination, status: "installed" };
}

async function replaceDirectory(source, destination) {
  const parent = dirname(destination);
  const suffix = `${process.pid}-${Date.now()}`;
  const staging = `${destination}.staging-${suffix}`;
  const backup = `${destination}.backup-${suffix}`;
  await mkdir(parent, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true, errorOnExist: true });
  const existed = await isDirectory(destination);
  try {
    if (existed) await rename(destination, backup);
    await rename(staging, destination);
    if (existed) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (
      existed &&
      !(await isDirectory(destination)) &&
      (await isDirectory(backup))
    )
      await rename(backup, destination);
    throw error;
  }
}

async function matchesAny(candidate, sources) {
  for (const source of sources)
    if (await directoriesEqual(candidate, source)) return true;
  return false;
}

async function directoriesEqual(left, right) {
  if (!(await isDirectory(left)) || !(await isDirectory(right))) return false;
  return (await directoryDigest(left)) === (await directoryDigest(right));
}

async function directoryDigest(root) {
  const hash = createHash("sha256");
  for (const item of await walk(root)) {
    hash.update(relative(root, item.path).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(item.type);
    hash.update("\0");
    if (item.type === "file") hash.update(await readFile(item.path));
    else if (item.type === "symlink") hash.update(await readlink(item.path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function walk(directory) {
  const items = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = join(directory, entry.name);
    if (entry.isDirectory()) {
      items.push({ path: item, type: "directory" });
      items.push(...(await walk(item)));
    } else if (entry.isFile()) items.push({ path: item, type: "file" });
    else if (entry.isSymbolicLink())
      items.push({ path: item, type: "symlink" });
    else items.push({ path: item, type: "special" });
  }
  return items.sort((left, right) => left.path.localeCompare(right.path));
}

async function isDirectory(item) {
  return (await stat(item).catch(() => undefined))?.isDirectory() === true;
}

async function main() {
  const args = process.argv.slice(2);
  const action = option(args, "--action") ?? "install";
  const target = option(args, "--target") ?? "both";
  const previousSource = option(args, "--previous-source");
  if (action === "install")
    await installSkillTargets({ target, previousSource });
  else if (action === "remove") await removeSkillTargets({ target });
  else throw new Error("action must be install or remove");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
