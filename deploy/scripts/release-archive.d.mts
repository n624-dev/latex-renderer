export interface ReleaseArchiveValidationOptions {
  bundle: string;
  topLevel: string;
  maxEntries: number;
  maxExpandedBytes: number;
  maxExpandedFileBytes: number;
  maxPathBytes?: number;
  maxListingBytes?: number;
}
export function validateReleaseArchive(
  options: ReleaseArchiveValidationOptions,
): Promise<void>;
