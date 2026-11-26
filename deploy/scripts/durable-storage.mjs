import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DurableFileBatch } from "./durable-file-batch.mjs";

async function syncPath(path, flags) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | flags,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function syncFile(path) {
  return syncPath(path, constants.O_NONBLOCK);
}

export function syncDirectory(path) {
  return syncPath(path, constants.O_DIRECTORY);
}

function directoriesTo(parent, root) {
  const boundary = resolve(root);
  const path = relative(boundary, parent);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error("Publication is outside its storage root");
  const directories = [];
  for (let current = resolve(parent); ; current = dirname(current)) {
    directories.push(current);
    if (current === boundary) return directories;
  }
}

export async function syncPublishedAncestors(path, root) {
  for (const directory of directoriesTo(dirname(path), root))
    await syncDirectory(directory);
}

// The caller supplies the validated artifact set, including any separately
// validated private checkpoint files. No discovery or hashing is needed.
export async function syncArtifactTree(root, files) {
  const dirs = new Set([resolve(root)]);
  const pending = new DurableFileBatch();
  try {
    for (const file of files) {
      const path = resolve(root, file);
      for (const directory of directoriesTo(dirname(path), root))
        dirs.add(directory);
      await pending.add(
        await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        ),
      );
    }
    await pending.flush();
    // Descendants precede ancestors. Absolute descendant paths are longer.
    for (const dir of [...dirs].sort((a, b) => b.length - a.length))
      await syncDirectory(dir);
  } catch (error) {
    await pending.discard();
    throw error;
  }
}
