export interface PublishedClientAssetOptions {
  clientBaseUrl: string;
  localManifestPath: string;
  archiveOutputPath: string;
  releaseId: string;
  attempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export declare function waitForPublishedClientAssets(
  options: PublishedClientAssetOptions,
): Promise<string>;
