import type { Stats } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { AppError } from "@latex-renderer/shared";

export function assertOutputDirectory(info: Stats): void {
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid !== undefined && info.uid !== process.getuid()) ||
    (process.platform !== "win32" && (info.mode & 0o022) !== 0)
  )
    throw new AppError(
      "UNSAFE_OUTPUT_DIRECTORY",
      "Artifact output directory must be owned by the current user and not group/world writable",
      400,
    );
}

export function assertOutputFile(info: Stats): void {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new AppError(
      "UNSAFE_OUTPUT_PATH",
      "Artifact output path must be a regular, single-link file",
      400,
    );
}

export async function optionalOutputStat(
  path: string,
): Promise<Stats | undefined> {
  return lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
}

export async function ensureSecureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  assertOutputDirectory(await lstat(path));
}

export async function assertSafeOutputFile(path: string): Promise<void> {
  const info = await optionalOutputStat(path);
  if (info !== undefined) assertOutputFile(info);
}
