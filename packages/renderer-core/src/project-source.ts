import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  ProjectOperations,
  type ProjectActor,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError } from "@latex-renderer/shared";

export async function downloadProjectSource(
  database: RendererDatabase,
  storageRoot: string,
  actor: ProjectActor,
  projectId: string,
  revisionId: string,
  signal: AbortSignal,
): Promise<Response> {
  const projects = new ProjectOperations(database);
  const { source } = projects.revision(actor, projectId, revisionId);
  if (source.storage_key !== `sources/${source.id}/source.zip`)
    throw new AppError(
      "SOURCE_STORAGE_INVALID",
      "Saved Source path is invalid",
      409,
    );
  const unavailable = () =>
    new AppError(
      "SOURCE_ARCHIVE_UNAVAILABLE",
      "Saved Source archive is unavailable",
      410,
    );
  const file = await open(
    join(storageRoot, source.storage_key),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ELOOP") throw unavailable();
    throw error;
  });
  try {
    const stat = await file.stat();
    signal.throwIfAborted();
    const current = projects.revision(actor, projectId, revisionId).source;
    if (
      !stat.isFile() ||
      stat.size !== source.size ||
      source.id !== current.id ||
      source.sha256 !== current.sha256
    )
      throw unavailable();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(128 * 1024);
    let position = 0;
    while (position < stat.size) {
      signal.throwIfAborted();
      const read = await file.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - position),
        position,
      );
      if (read.bytesRead === 0) throw unavailable();
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
    }
    const checked = await file.stat();
    signal.throwIfAborted();
    if (
      checked.size !== stat.size ||
      checked.mtimeMs !== stat.mtimeMs ||
      checked.ctimeMs !== stat.ctimeMs ||
      hash.digest("hex") !== source.sha256
    )
      throw unavailable();
    // The open descriptor remains valid even if the owner deletes the Project
    // while streaming. Close it on completion, failure, or client disconnect.
    const stream = file.createReadStream({ autoClose: true, signal, start: 0 });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(source.size),
        "X-Source-Zip-Size": String(source.size),
        "Content-Disposition": `attachment; filename="${revisionId}.zip"`,
        ETag: `"${source.sha256}"`,
        "Cache-Control": "private, no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
        "CDN-Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await file.close();
    throw error;
  }
}
