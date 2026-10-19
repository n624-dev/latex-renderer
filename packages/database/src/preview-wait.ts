import { setTimeout as delay } from "node:timers/promises";
import { AppError, nowIso } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import type { ArtifactRow } from "./repositories/artifacts.js";
import type { ArtifactAvailability } from "./artifact-availability.js";

const waiting = new WeakMap<RendererDatabase, number>();

/** Call ONLY after normal ticket/owner/admin authorization. The Worker is the
 * sole converter. Neither waiting nor requesting extends PDF retention. */
export async function waitForPreview(
  db: RendererDatabase,
  jobId: string,
  page: number,
  policy: ArtifactAvailability = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ArtifactRow> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100)
    throw new AppError(
      "PREVIEW_PAGE_INVALID",
      "Preview page is outside the PDF",
      404,
    );
  const available = () => {
    const rows = db.artifacts
      .listDownloadable(jobId, policy)
      .filter(
        (a) =>
          a.type === "preview" &&
          /^previews\/page-[0-9]{1,3}\.png$/.test(a.relative_path) &&
          Number(a.relative_path.match(/[0-9]+/)?.[0]) === page,
      );
    if (rows.length > 1)
      throw new AppError("INVALID_PREVIEW", "Preview page is ambiguous", 409);
    return rows[0];
  };
  const existing = available();
  if (existing) return existing;
  const count = waiting.get(db) ?? 0;
  if (count >= 32)
    throw new AppError(
      "PREVIEW_BUSY",
      "Too many preview requests are waiting",
      503,
    );
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
    throw new Error("Invalid preview wait timeout");
  options.signal?.throwIfAborted();
  waiting.set(db, count + 1);
  try {
    db.transaction(() => db.previews.request(jobId, page, nowIso(), policy));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(
        Math.min(250, Math.max(1, deadline - Date.now())),
        undefined,
        options.signal ? { signal: options.signal } : undefined,
      );
      const row = available();
      if (row) return row;
      if (!db.previews.verifiedPdf(jobId, policy))
        throw new AppError(
          "ARTIFACT_NOT_FOUND",
          "Artifact does not exist",
          404,
        );
      if (db.previews.get(jobId, page)?.status === "failed") break;
    }
    throw new AppError(
      "PREVIEW_PENDING",
      "Preview is not ready; retry shortly",
      503,
    );
  } finally {
    const remaining = (waiting.get(db) ?? 1) - 1;
    if (remaining) waiting.set(db, remaining);
    else waiting.delete(db);
  }
}
