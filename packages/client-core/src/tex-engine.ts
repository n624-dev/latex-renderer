import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import {
  renderEngineSchema,
  type RenderEngine,
} from "@latex-renderer/contracts";
import { AppError, DEFAULT_RESOURCE_LIMITS } from "@latex-renderer/shared";
import { withValidatedSourceFile } from "@latex-renderer/zip-validation";

export const projectEngineConfig = ".n624-latex.json";

export async function resolveLocalTexEngine(
  root: string,
  archive: string,
  entrypoint: string,
): Promise<RenderEngine | undefined> {
  const directive = await withValidatedSourceFile(
    archive,
    entrypoint,
    {
      maxExtractedBytes: DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
      maxFileBytes: DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
      maxEntries: DEFAULT_RESOURCE_LIMITS.maxZipEntries,
      maxFiles: DEFAULT_RESOURCE_LIMITS.maxFileCount,
      maxDepth: 10,
      maxNameLength: 200,
    },
    readTexEngineDirective,
  );
  if (directive !== undefined) return directive;
  const path = join(await realpath(root), projectEngineConfig);
  const info = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (info === undefined) return undefined;
  if (!info.isFile() || info.size > DEFAULT_RESOURCE_LIMITS.maxUploadBytes)
    throw new AppError(
      "INVALID_PROJECT_ENGINE",
      `Invalid engine configuration in ${projectEngineConfig}`,
      400,
    );
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return undefined;
    if (code === "ELOOP")
      throw new AppError(
        "INVALID_PROJECT_ENGINE",
        `Invalid engine configuration in ${projectEngineConfig}`,
        400,
      );
    throw error;
  });
  if (handle === undefined) return undefined;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.ino !== info.ino ||
      opened.dev !== info.dev ||
      opened.size !== info.size
    )
      throw new Error("Invalid project configuration file");
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size)
      throw new Error("Project configuration changed while reading");
    const config: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    );
    if (typeof config !== "object" || config === null || Array.isArray(config))
      throw new Error("Invalid project configuration object");
    return renderEngineSchema
      .optional()
      .parse((config as { engine?: unknown }).engine);
  } catch {
    throw new AppError(
      "INVALID_PROJECT_ENGINE",
      `Invalid engine configuration in ${projectEngineConfig}`,
      400,
    );
  } finally {
    await handle.close();
  }
}

/** Read the editor directives in the initial comment block of the entrypoint. */
async function readTexEngineDirective(
  file: Readable,
): Promise<RenderEngine | undefined> {
  const lines = createInterface({ input: file, crlfDelay: Infinity });
  let picked: RenderEngine | undefined;
  try {
    for await (const line of lines) {
      const text = line.trim();
      if (text === "") continue;
      if (!text.startsWith("%")) break;
      const match = /^%\s*!tex\s+(?:ts-)?program\s*=\s*(.*)$/i.exec(text);
      if (match === null) continue;
      const parsed = renderEngineSchema.safeParse(match[1]?.toLowerCase());
      if (!parsed.success)
        throw new AppError(
          "INVALID_TEX_ENGINE",
          "The TeX program comment does not name a supported LaTeX engine",
          400,
        );
      if (picked !== undefined && picked !== parsed.data)
        throw new AppError(
          "CONFLICTING_TEX_ENGINE",
          "The TeX program comments specify different engines",
          400,
        );
      picked = parsed.data;
    }
  } finally {
    lines.close();
  }
  return picked;
}
