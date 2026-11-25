import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ProjectOperations } from "@latex-renderer/database";
import { AppError } from "@latex-renderer/shared";
import type { AdminDependencies, AppActor } from "../types.js";

export async function downloadProjectSource(
  deps: AdminDependencies,
  actor: AppActor,
  projectId: string,
  revisionId: string,
  signal: AbortSignal,
): Promise<Response> {
  const projects = new ProjectOperations(deps.database);
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
    join(deps.storageRoot, source.storage_key),
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
    // The open descriptor remains valid even if the owner deletes the Project
    // while streaming. Close it on completion, failure, or client disconnect.
    const stream = file.createReadStream({ autoClose: true, signal });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(source.size),
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
