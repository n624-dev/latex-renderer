export interface ResourceLimits {
  maxUploadBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxZipEntries: number;
}

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxUploadBytes: 20 * 1024 * 1024,
  maxExtractedBytes: 100 * 1024 * 1024,
  maxFileCount: 500,
  maxZipEntries: 1_000,
});

export function effectiveResourceLimits(
  configured: Partial<ResourceLimits>,
): ResourceLimits {
  return {
    maxUploadBytes:
      configured.maxUploadBytes ?? DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
    maxExtractedBytes:
      configured.maxExtractedBytes ?? DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
    maxFileCount:
      configured.maxFileCount ?? DEFAULT_RESOURCE_LIMITS.maxFileCount,
    maxZipEntries:
      configured.maxZipEntries ?? DEFAULT_RESOURCE_LIMITS.maxZipEntries,
  };
}
