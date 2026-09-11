export function downloadPublishedRelease(
  requested: string,
  stage: string,
  options?: { apiToken?: string | undefined },
): Promise<{ source: string; version: string; commit: string }>;
