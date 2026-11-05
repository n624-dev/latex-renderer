export function waitForPublishedMcpbAssets(options: {
  baseUrl: string;
  localMetadataPath: string;
  archiveOutputPath: string;
  releaseId: string;
  attempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<string>;
