import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@latex-renderer/shared";

/** Delete only generated paths recorded by the previous job, not user files. */
export async function pruneGeneratedArtifacts(root: string, keep: ReadonlySet<string>): Promise<void> {
  const manifestPath = join(root, "job.json"), manifestInfo = await optionalStat(manifestPath);
  if (manifestInfo === undefined) return;
  assertRegularFile(manifestInfo);
  if (manifestInfo.size > 4 * 1024 * 1024)
    throw new AppError("INVALID_ARTIFACT_MANIFEST", "Previous job metadata is too large", 400);
  let previous: unknown;
  try { previous = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { throw new AppError("INVALID_ARTIFACT_MANIFEST", "Previous job metadata is invalid", 400); }
  if (typeof previous !== "object" || previous === null)
    throw new AppError("INVALID_ARTIFACT_MANIFEST", "Previous job metadata is invalid", 400);
  const record = previous as { artifacts?: unknown; previews?: unknown };
  const candidates = new Set<string>();
  for (const items of [record.artifacts, record.previews]) {
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const path = (item as { relativePath?: unknown }).relativePath;
      if (typeof path !== "string" || !generatedPath(path)) continue;
      candidates.add(path);
      // Older servers advertise padded names; newer clients save a canonical
      // local name, so recognize both representations in the previous manifest.
      const preview = /^previews\/page-(0*[1-9][0-9]*)\.png$/.exec(path);
      if (preview !== null) candidates.add(`previews/page-${Number(preview[1])}.png`);
    }
  }
  for (const name of candidates) {
    if (keep.has(name)) continue;
    let current = root, exists = true;
    for (const component of name.split("/").slice(0, -1)) {
      current = join(current, component);
      const info = await optionalStat(current);
      if (info === undefined) { exists = false; break; }
      if (!info.isDirectory() || info.isSymbolicLink() ||
          (process.getuid !== undefined && info.uid !== process.getuid()) ||
          (info.mode & 0o022) !== 0)
        throw new AppError("UNSAFE_OUTPUT_DIRECTORY", "Generated artifact directory is unsafe", 400);
    }
    if (!exists) continue;
    const path = join(root, name), info = await optionalStat(path);
    if (info === undefined) continue;
    assertRegularFile(info);
    await unlink(path);
  }
}

function generatedPath(path: string): boolean {
  return ["result.pdf", "compile.log", "errors.json", "svg/manifest.json"].includes(path) ||
    /^previews\/page-[0-9]+\.png$/.test(path) ||
    /^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(path);
}

function assertRegularFile(info: Awaited<ReturnType<typeof lstat>>): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new AppError("UNSAFE_OUTPUT_PATH", "Generated artifact must be a regular, single-link file", 400);
}

async function optionalStat(path: string) {
  return lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
}
