import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@latex-renderer/shared";
import type { ValidatedArtifact } from "./artifact-validator.js";

/** Produced by sandboxed pdfinfo, never inferred from the input or PNG count.
 * Older Runtimes omit the file and keep their existing eager preview contract. */
export async function previewPageCount(
  directory: string,
  artifacts: readonly ValidatedArtifact[],
): Promise<number | undefined> {
  let handle;
  try {
    handle = await open(
      join(directory, ".preview-info.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 256)
      throw new AppError(
        "PREVIEW_METADATA_INVALID",
        "Preview metadata is unsafe",
      );
    const data: unknown = JSON.parse(await handle.readFile("utf8"));
    if (typeof data !== "object" || data === null)
      throw new AppError(
        "PREVIEW_METADATA_INVALID",
        "Preview metadata is invalid",
      );
    const value = data as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      value.dpi !== 150 ||
      !Number.isSafeInteger(value.pages) ||
      Number(value.pages) < 1 ||
      Number(value.pages) > 100 ||
      !artifacts.some(
        (a) => a.path === "previews/page-1.png" && a.type === "preview",
      )
    )
      throw new AppError(
        "PREVIEW_METADATA_INVALID",
        "Preview metadata is invalid",
      );
    return Number(value.pages);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}
