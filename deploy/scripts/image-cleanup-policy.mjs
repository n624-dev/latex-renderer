import { boundedIntegerEnvironment } from "./environment.mjs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

// Preserve the exact Runtime until artifact GC has actually removed its PDF.
// A retention timeout is not proof that a running conversion has stopped.
// Missing/unreadable databases fail closed; pre-preview schemas have no pins.
export function retainedPreviewRuntimeIds(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_preview_documents'",
        )
        .get()
    )
      return new Set();
    const result = new Set();
    for (const row of db
      .prepare(
        `SELECT DISTINCT d.runtime_image FROM job_preview_documents d
      WHERE EXISTS (SELECT 1 FROM artifacts a WHERE a.id=d.pdf_artifact_id AND a.job_id=d.job_id
        AND a.relative_path='result.pdf' AND a.type='pdf' AND a.sha256=d.pdf_sha256)
      OR EXISTS (SELECT 1 FROM job_preview_requests r WHERE r.job_id=d.job_id AND r.status='running')`,
      )
      .iterate()) {
      if (
        typeof row.runtime_image !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(row.runtime_image)
      )
        throw new Error("Invalid retained preview Runtime identity");
      result.add(row.runtime_image);
    }
    return result;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.argv.length !== 4 ||
    process.argv[2] !== "--retained-preview-runtimes"
  )
    throw new Error(
      "usage: image-cleanup-policy.mjs --retained-preview-runtimes DATABASE_PATH",
    );
  for (const id of retainedPreviewRuntimeIds(process.argv[3]))
    process.stdout.write(`${id}\n`);
}

export function imageCleanupPolicy(environment) {
  return {
    intervalHours: boundedIntegerEnvironment(
      environment,
      "IMAGE_CLEANUP_INTERVAL_HOURS",
      24,
      0,
      720,
    ),
    retentionHours: boundedIntegerEnvironment(
      environment,
      "IMAGE_CLEANUP_RETENTION_HOURS",
      24,
      0,
      8760,
    ),
    cacheMaxGiB: boundedIntegerEnvironment(
      environment,
      "IMAGE_BUILD_CACHE_MAX_GIB",
      2,
      0,
      1024,
    ),
  };
}

export function eligibleManagedImage(
  info,
  protectedIds,
  retentionHours,
  now = Date.now(),
) {
  if (!info?.Id || protectedIds.has(info.Id)) return false;
  const created = Date.parse(info.Created);
  if (!Number.isFinite(created) || now - created < retentionHours * 3_600_000)
    return false;
  const labels = info.Config?.Labels ?? {};
  const runtime = Boolean(
    labels["jp.n624.latex-renderer.base-image-id"] &&
    labels["jp.n624.latex-renderer.renderer-runtime-fingerprint"],
  );
  const base =
    labels["org.opencontainers.image.title"] === "latex-renderer-texlive" &&
    labels["jp.n624.latex-renderer.texlive.profile-kind"] ===
      "language-neutral-maximal" &&
    labels["jp.n624.latex-renderer.base-kind"] === "texlive-only-v1";
  return runtime || base;
}
