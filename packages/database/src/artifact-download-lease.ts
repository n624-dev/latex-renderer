import type { Readable } from "node:stream";
import type { ArtifactsRepository } from "./repositories/artifacts.js";

export const ARTIFACT_DOWNLOAD_LEASE_MS = 300_000;
const HEARTBEAT_MS = 30_000;

/** A live stream must never silently reacquire a lease already lost to GC. */
export function bindArtifactDownloadLeases(
  repository: ArtifactsRepository,
  ids: readonly string[],
  stream: Readable,
): () => void {
  const release = protectArtifactDownloadLeases(repository, ids, () => {
    stream.destroy(
      new Error("Artifact download protection was lost; retry the download"),
    );
  });
  stream.once("end", release);
  stream.once("close", release);
  stream.once("error", release);
  return release;
}

/** For bounded buffered reads as well as streams. Callers must abort on loss. */
export function protectArtifactDownloadLeases(
  repository: ArtifactsRepository,
  ids: readonly string[],
  onLost: () => void,
): () => void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    for (const id of ids) {
      try {
        repository.deleteLease(id);
      } catch {
        process.emitWarning(
          "Artifact download lease release failed; expiry remains the fallback",
          { code: "ARTIFACT_LEASE_RELEASE_FAILED" },
        );
      }
    }
  };
  const timer = setInterval(() => {
    if (released) return;
    const now = Date.now(),
      timestamp = new Date(now).toISOString(),
      expiry = new Date(now + ARTIFACT_DOWNLOAD_LEASE_MS).toISOString();
    try {
      for (const id of ids)
        if (!repository.renewLease(id, timestamp, expiry))
          throw new Error("Artifact download lease was lost");
    } catch {
      try {
        onLost();
      } finally {
        release();
      }
    }
  }, HEARTBEAT_MS);
  timer.unref();
  return release;
}
