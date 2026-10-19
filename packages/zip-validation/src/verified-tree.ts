import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { AppError } from "@latex-renderer/shared";
import {
  validateEntrypointPath,
  validateSourceFilePath,
  type ExtractResult,
  type ZipLimits,
} from "./index.js";

export interface VerifiedSourceTree {
  readonly version: 1;
  readonly files: readonly {
    path: string;
    bytes: number;
    sha256: string;
    mode: number;
  }[];
  readonly directories: readonly { path: string; mode: number }[];
  readonly bytes: number;
}

/** This is an integrity check, NOT an alternative ZIP validator. Capture only
 * after validateAndExtract succeeded. The caller must separately bind any
 * persistent manifest to owner/Source/archive hash/size/validator+limits version
 * and hold a live reader lease until its read-only sandbox is proven stopped. */
export async function captureValidatedSourceTree(
  root: string,
  extracted: ExtractResult,
  limits: ZipLimits,
): Promise<VerifiedSourceTree> {
  const tree = await inventory(root, limits),
    expected = new Set(extracted.paths);
  if (
    tree.files.length !== extracted.files ||
    tree.bytes !== extracted.bytes ||
    expected.size !== tree.files.length ||
    tree.files.some((f) => !expected.delete(f.path))
  )
    throw mismatch();
  const files: { path: string; bytes: number; sha256: string; mode: number }[] =
    [];
  for (const f of tree.files)
    files.push({
      path: f.path,
      bytes: f.info.size,
      sha256: await digest(f.file, f.info),
      mode: f.info.mode & 0o7777,
    });
  return {
    version: 1,
    files,
    directories: tree.directories,
    bytes: tree.bytes,
  };
}

/** Read-only reuse candidate: rehash every file, reject extra/missing entries,
 * links, mounts/devices and changed permissions. This performs no extraction,
 * copying or chmod and never gives a sandbox a writable shared input. */
export async function verifyValidatedSourceTree(
  root: string,
  manifest: VerifiedSourceTree,
  limits: ZipLimits,
  entrypoint = "main.tex",
): Promise<ExtractResult> {
  if (
    manifest.version !== 1 ||
    manifest.files.length > limits.maxFiles ||
    manifest.directories.length > limits.maxEntries
  )
    throw mismatch();
  const tree = await inventory(root, limits),
    expected = new Map(manifest.files.map((f) => [f.path, f]));
  if (
    expected.size !== manifest.files.length ||
    tree.files.length !== manifest.files.length ||
    tree.bytes !== manifest.bytes ||
    JSON.stringify(tree.directories) !== JSON.stringify(manifest.directories)
  )
    throw mismatch();
  for (const file of tree.files) {
    const prior = expected.get(file.path);
    if (
      !prior ||
      prior.bytes !== file.info.size ||
      prior.mode !== (file.info.mode & 0o7777) ||
      (await digest(file.file, file.info)) !== prior.sha256
    )
      throw mismatch();
  }
  const requested = validateEntrypointPath(entrypoint, limits);
  if (!expected.has(requested))
    throw new AppError(
      "ENTRYPOINT_MISSING",
      "Verified Source does not contain the requested entrypoint",
      422,
    );
  return {
    files: tree.files.length,
    bytes: tree.bytes,
    paths: tree.files.map((f) => f.path),
  };
}

async function inventory(root: string, limits: ZipLimits) {
  const info = await lstat(root);
  if (!info.isDirectory()) throw mismatch();
  const canonical = await realpath(root),
    pending = [canonical],
    files: { file: string; path: string; info: Stats }[] = [],
    directories = [{ path: "", mode: info.mode & 0o7777 }];
  if (process.platform === "linux") {
    const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
      .split("\n")
      .map((line) => line.split(" ")[4])
      .filter((p): p is string => p !== undefined)
      .map((p) =>
        p.replace(/\\([0-7]{3})/g, (_, n: string) =>
          String.fromCharCode(parseInt(n, 8)),
        ),
      );
    if (mounts.some((p) => p === canonical || p.startsWith(canonical + "/")))
      throw mismatch();
  }
  let entries = 0,
    bytes = 0;
  while (pending.length) {
    const directory = pending.pop();
    if (!directory) break;
    for await (const entry of await opendir(directory, { bufferSize: 32 })) {
      const name = entry.name;
      if (++entries > limits.maxEntries) throw mismatch();
      const file = join(directory, name),
        path = relative(canonical, file).split(sep).join("/"),
        stat = await lstat(file);
      if (
        stat.dev !== info.dev ||
        path.includes("\\") ||
        path.split("/").length > limits.maxDepth
      )
        throw mismatch();
      if (stat.isDirectory()) {
        directories.push({ path, mode: stat.mode & 0o7777 });
        pending.push(file);
        continue;
      }
      validateSourceFilePath(path, limits);
      bytes += stat.size;
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > limits.maxFileBytes ||
        bytes > limits.maxExtractedBytes ||
        files.length >= limits.maxFiles
      )
        throw mismatch();
      files.push({ file, path, info: stat });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  directories.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, directories, bytes };
}

async function digest(file: string, expected: Stats): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW),
    hash = createHash("sha256");
  const same = (s: Stats) =>
    s.isFile() &&
    s.nlink === 1 &&
    s.dev === expected.dev &&
    s.ino === expected.ino &&
    s.size === expected.size &&
    s.mode === expected.mode &&
    s.mtimeMs === expected.mtimeMs &&
    s.ctimeMs === expected.ctimeMs;
  try {
    if (!same(await handle.stat())) throw mismatch();
    let bytes = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    })) {
      const data = chunk as Buffer;
      bytes += data.length;
      if (bytes > expected.size) throw mismatch();
      hash.update(data);
    }
    if (bytes !== expected.size || !same(await handle.stat())) throw mismatch();
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
function mismatch() {
  return new AppError(
    "SOURCE_TREE_MISMATCH",
    "Verified Source tree failed integrity validation",
    422,
  );
}
