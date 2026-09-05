import { boundedIntegerEnvironment } from "./environment.mjs";

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
