import { extname } from "node:path";
import {
  ProjectOperations,
  type ProjectActor,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, sha256Hex } from "@latex-renderer/shared";
import {
  listValidatedSourceFiles,
  readValidatedSourceFile,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import type { RendererSourceStore } from "./source-store.js";

export class RendererSavedSources {
  constructor(
    private readonly database: RendererDatabase,
    private readonly sources: RendererSourceStore,
  ) {}

  revisionSource(actor: ProjectActor, projectId: string, revisionId: string) {
    const { revision, source } = new ProjectOperations(this.database).revision(
      actor,
      projectId,
      revisionId,
    );
    return {
      source,
      path: this.sources.sourcePath(source),
      entrypoint: revision.entrypoint,
      engine: revision.engine,
      revision: {
        projectId,
        revisionId,
        sourceId: source.id,
        sourceSha256: source.sha256,
      },
    };
  }

  async listProjectRevisionFiles(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    offset = 0,
    limit = 25,
  ) {
    const { path, revision } = this.revisionSource(
      actor,
      projectId,
      revisionId,
    );
    const files = await readSavedSource(() =>
      listValidatedSourceFiles(path, this.sources.zipLimits()),
    );
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > files.length ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 25
    )
      throw new AppError(
        "SOURCE_FILE_RANGE",
        "Invalid Source file list range",
        416,
      );
    const items = files.slice(offset, offset + limit).map((file) => ({
      ...file,
      kind: sourceFileKind(file.path),
    }));
    return {
      ...revision,
      items,
      totalFiles: files.length,
      nextOffset:
        offset + items.length < files.length ? offset + items.length : null,
    };
  }

  async getProjectRevisionFile(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    requestedPath: string,
    offset = 0,
  ) {
    const { source, path, revision } = this.revisionSource(
      actor,
      projectId,
      revisionId,
    );
    const target = validateSourceFilePath(
      requestedPath,
      this.sources.zipLimits(),
    );
    if (!this.database.sources.paths(source).includes(target))
      throw new AppError(
        "SOURCE_FILE_NOT_FOUND",
        "Source file does not exist",
        404,
      );
    if (sourceFileKind(target) === "binary")
      throw new AppError("SOURCE_FILE_BINARY", "Source file is binary", 422);
    const bytes = await readSavedSource(() =>
      readValidatedSourceFile(path, target, this.sources.zipLimits()),
    );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw new AppError(
        "SOURCE_FILE_ENCODING",
        "Source file is not UTF-8",
        422,
      );
    }
    return {
      ...revision,
      path: target,
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      ...sourceTextPage(text, offset),
    };
  }
}

export function sourceFileKind(path: string): "text" | "binary" {
  return [".png", ".jpg", ".jpeg", ".pdf"].includes(extname(path).toLowerCase())
    ? "binary"
    : "text";
}

async function readSavedSource<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EACCES")
    )
      throw new AppError(
        "SOURCE_ARCHIVE_UNAVAILABLE",
        "Saved Source archive is unavailable",
        409,
      );
    throw error;
  }
}

export function sourceTextPage(text: string, offset: number) {
  const isLowSurrogate = (at: number) =>
    (text.charCodeAt(at) & 0xfc00) === 0xdc00;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    isLowSurrogate(offset)
  )
    throw new AppError("SOURCE_FILE_RANGE", "Invalid UTF-16 offset", 416);
  let end = Math.min(offset + 4000, text.length);
  if (isLowSurrogate(end)) end--;
  return {
    text: text.slice(offset, end),
    unit: "utf16" as const,
    offset,
    nextOffset: end < text.length ? end : null,
    totalUnits: text.length,
  };
}
